# Email Triage — senior review + implementációs terv (orchestrált phase-ek)

Írta: Claude (orchestrator) · 2026-10-19 · Forrás: `docs/prd-email-triage.md` (1285 sor), a 2026-10-19-i
Codex review, és a kódbázis tényleges állapota (`main` @ `e5d87b0`).

**Verdikt röviden:** a termékirány és a döntések jók, a PRD alaposan átgondolt. Viszont **három helyen
nem a valós kódbázisra épít**, és **az agentic rész több ponton email-specifikus primitíveket vezet be**
olyan helyekre, ahol egy általános platform-primitív ugyanannyi munkával megvan, és a következő agentek
(Monthly Close, PM watcher, standup, scheduled runok) mind erre épülhetnek. A locked owner-döntéseket
(D1–D37, O1–O10, a Codex-ből elutasított pontok) **nem nyitom újra**; ahol mégis kérdés van, külön jelölöm.

---

## 1. Ahol a PRD nem a valós kódbázishoz képest jó (tények)

| # | PRD feltételezés | Valóság a kódban | Következmény |
|---|---|---|---|
| F1 | P-0 „`agentBackground.ts`: runs without a signed-in user" — egy kis kiegészítés | **Minden** registry tool `ctx.runQuery(api.X)`-et hív és `ctx.auth`-ra épít (`agentToolRegistry.ts`, pl. :131, :884, :976); a `beginRun` `getAuthContext`-et hív (`agentRunner.ts:137`); a BYOK kulcs (`aiIntegration.ts:339`) és a `connectors.resolveForRun` (`connectors.ts:259`) is. Ütemezett függvény nem örököl auth-ot. | A P-0 valójában egy **actor-réteg bevezetése a teljes runnerbe** — ez a projekt legkockázatosabb refaktora, nem egy fájl. Lásd §3 P1. |
| F2 | „Any org owner/admin decides" a megosztott email threadben | `requireOwnedThread` (`agentThreads.ts:29`) csak a tulajdonost engedi írni; a proposal `userId = thread.userId` (`agentProposals.ts:209`) | Thread-láthatósági policy kell (§3 P3), nem csak egy `scope` mező. |
| F3 | `notifications` új típusok + digest | `notifications.taskId` **kötelező** (`schema.ts:715`), a `type` union 5 elemű | A digest / watch / „mailbox not syncing" nem task-hoz kötött → `taskId` optional + általános `subject` ref. |
| F4 | „owner/admin" szerep | Csak `admin \| member` létezik (`schema.ts:40`, `lib/auth.ts:28`) | A PRD-ben „owner/admin" = `isAdmin`. Szövegpontosítás. |
| F5 | D15 „Draft state a task drawerben" | A drawer csak létező taskot tud (`task-detail.tsx`), létrehozás = `TaskFormModal` | A Draft mód egy **önálló frontend munka** (drawer forrás-absztrakció: task vagy proposal payload). Saját phase. |
| F6 | Working-day órák (D37), default due (§6.1) | Nincs szerveroldali munkanap-helper (csak kliens `lib/planner.ts:19`), nincs `convex/crons.ts` | Pure `convex/lib/workingDays.ts` (org timezone) + crons scaffold kell, korán. |
| F7 | „coordinate with the open tasks-refactor slices (7b)" | A tasks refactor **kész és mergelve** (#13) | A koordinációs megjegyzések törölhetők; a gate helye ismert: `tasks/write.ts` `updateTask` :827 (a `bulkUpdate` is ezen megy át). |
| F8 | D30 Undo: „assignee notifications wait until the toast ends" | `createTask` szinkron értesít (`createNotifications`) | `createTask`-hoz `deferNotifications` opció + ütemezett értesítés kell. |
| F9 | Slice 2 tartalmazza a kickoff reply-t (D21) | A küldés (send pipeline) csak slice 3-ban jön | **Függőségi hiba:** a kickoff küldéséhez a send pipeline backendje kell → előrehozom (Phase 8). |
| F10 | §7.7 `2` Merge, `3` Decline + `1–4` válasz a kérdésre | Ugyanazon a képernyőn ütközik | Kérdésblokk fókuszban → 1–4 a kérdésé; egyébként Merge/Decline. Vagy Merge/Decline betűbillentyű. (UI-részlet, nem owner-döntés-módosítás.) |
| F11 | `agent.model` override | A runner sosem használja (`agentRunner.ts:253`) | A jobokhoz (olcsó classify modell vs erős prepare) ez kell — P2 része. |
| F12 | I-5 képinput a modellnek | `ai` v6 + `@convex-dev/agent` 0.6.4 — file/image part támogatás nincs ellenőrizve | I-5 első lépése egy tracer, mielőtt bármi épülne rá. |

Ami **jól illeszkedik** és változatlanul maradhat: `tasks/write.ts` mint egyetlen író (a
`tasksWriteBoundary.test.ts` ezt ki is kényszeríti), `subtaskCount/subtaskDoneCount` a `derived.ts`-ből,
`clientContacts.by_orgId_email` (feladó → kliens már ma lekérdezhető), `projects.defaultAssignees` +
`resolveDefaultAssignee`, `statuses.category` (a `workflowRole` erre ül rá), a block-classifier marker
mintája (`lib/agents/blocks.ts` — új block kind = ~5 kis lépés), a proposal approve-as-approver út,
`secretCrypto.ts`, `convex-test` (19 fájl már használja).

---

## 2. Egyszerűsítések (overengineering / hacky pontok) — a döntések érintése nélkül

| # | Most a PRD-ben | Javaslat | Miért |
|---|---|---|---|
| S1 | `classifyInbound`, completeness pass, „unknown sender" check, promise-kinyerés mind **agent run** (thread, runner, run lock) | Ezek **egylövéses strukturált LLM-hívások** (`generateText` + output schema, ahogy `worksheetAi.ts` már csinálja), agent thread nélkül, egy könnyű audit sorral | Nincs beszélgetés, nincs tool-loop → nincs mit szerializálni, olcsóbb, determinisztikusabb, tesztelhetőbb. Agent run csak ott, ahol ember beszélget vele (prepareTask, draft, chat). |
| S2 | ~10 új proposal kind: `createTaskFromEmail`, `changeFromEmail`, `editTask`, `addSubtasks`, `tickSubtask`, `regroupTasks`, `attachFiles`, `postComment`, `proposeSkill` | **4 kind:** `createTask` (kibővítve: subtasks, descriptionJson, `source`, `fieldReasons`, grouping) · `updateTask` (mezők + subtask add/amend/cancel/tick + status/reopen + attachFiles) · `postComment` · `proposeSkill` | Ugyanaz a change-list UI (új / változás / komment) pontosan erre a 3+1 kindre képez le. Az email-specifikus dolgok (`threadId`, `requestIds`) a `source` mezőbe kerülnek, nem a kind nevébe → a standup, a transcript és a Monthly Close agent ugyanazt használja. |
| S3 | `handoverChecks` tábla + `emailDrafts.checks` mező, azonos alakkal | Egy `agentChecks` tábla: `subject` (task \| draft) + `kind` (handover \| presend) + `revision` + `results[]` | Egy renderer, egy gate-olvasó. A jövőbeli QA agentek (pl. számla előtti ellenőrzés) is ide írnak. |
| S4 | `mailboxSync` külön tábla | `connectors.sync?: { cursor, lastSyncAt, lastFullSyncAt, error }` | Minden polling connector (Drive, Slack, …) ugyanígy szinkronizál; eggyel kevesebb tábla, a connector sor UI-ja már ott van. |
| S5 | `attachmentContents`: `source` union + 4 opcionális FK | Kulcs = `storageId` (egyedi index), FK-k nélkül | A kivonat a fájl tartalmához tartozik, nem a hivatkozóhoz; a jogosultságot a hivatkozó (task/komment/email/chat) olvasása adja. |
| S6 | `tasks.emailThreadId` read cache | Kihagyni; `emailThreadTasks.by_orgId_taskId` olcsó | Nem kell a tasks táblához nyúlni; nincs szinkronban tartandó cache. |
| S7 | `emailMessages.handling` string | Kihagyni | Az eredményt a `triageItems.outcome` / proposal / draft már hordozza; duplikált állapot. |
| S8 | 10 új notification `type` | 3: `email_event` (reasonText + subtype), `agent_signal` (`signal` mezővel), `daily_digest` | A Inbox renderer ugyanaz; új jelzés = új `signal` érték, nem schema-módosítás. |
| S9 | `agentThreads.scope: "private" \| "email" \| "member_task"` | `visibility: "private" \| "admins"` + `anchor?: { type, id }` (§3 P3) | Az `email` és `member_task` email-specifikus enumérték egy platformtáblán; az anchor+visibility minden jövőbeli agentre jó (projekt-PM thread = admins + anchor project). |

Kockázat, amit fixture-rel kell kalibrálni (nem döntés-módosítás): a magyar hard trigger szavak közül a
„még" és a „lehetne" nagyon gyakori → sok „needs a look" item. Mivel ez csak a csendes `acknowledge`-ot
tiltja (D4), ez biztonságos irány, de a 30+ fixture-ön mérni kell a zajt.

---

## 3. Általános agentic alap — mit építünk platformként (email = első fogyasztó)

Az elv: **ami nem az email domainről szól, az platform.** Az alábbi 6 primitív a PRD P-0 / I-1…I-5
slice-ait strukturálja át úgy, hogy a Monthly Close (Wave 2), PM watcher (Wave 4), standup és ütemezett
runok ugyanerre épüljenek, email-kód nélkül.

**P1 — Actor-réteg és háttérfutás.** Egy `AgentActor = { orgId, userId, isAdmin, via: "user" | "background", jobRunId? }`.
- Interaktív run: a `beginRun` a `ctx.auth`-ból számolja és **eltárolja az `agentRuns` sorban**.
- Háttérrun: `internal.agentBackground.start(job, anchor, actingUserId)` — az actort tárolt rekordból
  tölti, és **futásidőben újraellenőrzi** a tagságot/szerepet. Public „run as userId" belépési pont nincs.
- A toolok az actort a run sorból olvassák (`resolveRunActor(ctx)`), és **internal** query-ket hívnak
  explicit actorral. Így a két mód kódútja azonos.
- Inkrementálisan migrálunk: a registry entry kap egy `background: true` jelzőt. Háttérrunban csak a
  migrált toolok érhetők el (kezdetben az email jobokhoz kellők, a pénzügyi toolok nem). A BYOK kulcs- és
  a connector-feloldás is actor-alapú variánst kap.

**P2 — Job registry (code-defined agent jobs).** `convex/lib/agentJobs.ts`, a tool registry mintájára:
`{ name, tier: "llm_step" | "agent_run", instructions, tools, stages, outputSchema, model }`.
- Az email jobjai: `classifyInbound`, `checkCompleteness`, `screenSender` (llm_step), valamint
  `prepareTask`, `draftReply`, `presendReview`, `handoverQA` (agent_run).
- A §6.5 „fixed stage list in code" így egy konkrét struktúra lesz, amiből a run line renderel. Az
  `agents.model` (F11) itt végre bekötődik.
- Később a Monthly Close és a watcher is csak egy-egy új job.

**P3 — Anchored threadek + láthatóság + revíziók.**
- `agentThreads.visibility` (`private` | `admins`) + `anchor?: { type: "emailThread" | "task" | "project" | …, id }`.
- `admins` láthatóságú threadben bármely admin írhat és dönthet (O3). Ehhez a policy kiváltja a
  `requireOwnedThread` és a `requireOwnProposal` mostani szabályát.
- Per-thread run lock (I11), valamint `revision` a proposalokon és a kérdéseken.
- A member a saját `private` + task-anchor threadjében dolgozik (I10).

**P4 — Közös kérdés-, proposal- és check-primitívek.**
- `agentQuestions` (I-2, ahogy a PRD írja — ez már általános).
- A 4 proposal kind (S2), shared decision policy-val.
- `agentChecks` (S3).

**P5 — Attention queue mint platform-tábla.** A `triageItems` már most sem csak email: watcher-tételek
(`waiting`, `attention`) is ide kerülnek. Javaslat: `agentItems` (`source: "email" | "watch" | "job"`,
`anchor`, `kind`, open/snoozed/done/filtered, linkek: agentThread / proposal / draft).
- A Triage UI = `source = email` (+ az emailhez tartozó watcher-tételek). A **UI-döntések változatlanok**
  (D5, D26), csak az adat általános.
- A Monthly Close „review this close" tétele ugyanígy jelenhet meg később, a saját képernyőjén.

**P6 — Typed blocks + live widgetek** (a PRD §7.1 mintája jó, csak platformszinten kell kimondani):
- Minden új block (question, email draft, change list, task card, request checklist, retainer card)
  marker-alapú block kind a `lib/agents/blocks.ts`-ben.
- Referenciát tárolnak, a renderelés reaktív query a néző jogával. Így bármely agent megkapja őket, ha
  ticked a tool.

Ami **email-domain marad** (`convex/email/*`): Gmail sync/ingest/filter, `emailThreads/Messages/Drafts`,
`emailThreadTasks`, `clientRequests` ledger, `emailPromises`, a send pipeline, a dispatch-tábla.

---

## 4. Phase-terv (mindegyik egy subagent, én orchestrálok)

Branch: `email-triage` (egy hosszú életű branch, mérföldkövenként PR — a „one-PR refactor" szabály
szerint a mérföldkő a PR egysége). Minden phase után én kapuzok, mielőtt a következő indul.

### Mérföldkő A — Agent platform (email-kód nélkül, a meglévő agentek is nyernek vele)

| Phase | Tartalom | Done | Függ |
|---|---|---|---|
| **A1** Actor + háttérfutás | P1: `agentRuns` actor mezők, `resolveRunActor`, `agentBackground.start` (internal) + tagság-újraellenőrzés, BYOK / connector actor-variáns, `background` jelző a registry-ben, az email jobokhoz kellő read toolok migrálva (listClients, listProjects, listTeamMembers, listWorkCategories, listStatuses, findTasks, getTaskDetail) | convex-test: háttérrun fake modellel lefut; kizárt tag → elutasítva; public út nincs; a meglévő interaktív runok változatlanok (regresszió) | — |
| **A2** Threadek + jobok | P3 (visibility, anchor, run lock, revíziók) + P2 job registry (`llm_step` + `agent_run` tier, `agents.model` bekötve) | admin B dönt admin A `admins` threadjében; párhuzamos run elutasítva; régi revízió elutasítva; llm_step tesztelhető fake modellel | A1 |
| **A3** Read layer | I-1: T3, T9, T10, T11, T14 actor-alapon + member-scope tesztek | member csak olvasható taskot lát; T14 egy hívás | A1 |
| **A4** Proposal konszolidáció | S2: `createTask` bővítés (subtasks, description, source, fieldReasons), `updateTask`, `postComment` kind + shared decision policy + `tasks/write.ts` belépési pontok (`deferNotifications`, I3 gate az `updateTask`-ban a `workflowRole`-ra) | approve egy mutációban hozza létre a task+subtask fát; I3 a `bulkUpdate`-en is áll; a meglévő Task Drafter működik | A2 |
| **A5** Kérdésblokk | I-2: `agentQuestions`, `askUser` (lezárja a runt), answer/later, „pontosan egy következő run", `question-block.tsx` | I7 teszt: két admin egyszerre válaszol → egy run | A2 |
| **A6** Fájltartalom | I-3: `attachmentContents` (S5), `unpdf` / `mammoth` / `image-size` node action, T2 | PDF/DOCX/kép állapotok, olvashatatlan = látható unresolved | — |

A3 és A6 párhuzamosíthatók A2-vel, de mindegyik a `schema.ts`-hez nyúl. Ezért **egyszerre egy író
subagent** fut, a kis phase-eknél szekvenciálisan; párhuzam csak read-only feltérképezésre.

### Mérföldkő B — Email be → Triage → Task (+ kickoff küldés)

| Phase | Tartalom | Done | Függ |
|---|---|---|---|
| **B1** Gmail connect | I-4: `gmail` catalog, OAuth (PKCE, `oauthStates`, http routes), token refresh, Settings › Connectors sor, `connectors.sync` (S4) | valódi fiók connect / disconnect / expired → reconnect | **owner: Google OAuth client** |
| **B2** Email schema + pure modell | slice 0: email táblák (S5–S7 szerint szűkítve), `agentItems` (P5), `statuses.workflowRole` + seed, `emailTriageEnabled` + I14 helper, `convex/lib/workingDays.ts`, `convex/crons.ts` scaffold, `email/model.ts` 100% unit (stripQuoted HU/EN, triggerek, domain-match, subject, dátum) | a model tesztek zöldek; a seed betölti a canvas-szcenáriókat | A2 |
| **B3** Sync + ingest + filter | slice 1/a (LLM nélkül): 1 perces history sync, start-from-now, korlátos resync, D24 filter, rfcMessageId dedupe, stage-ek + retry (I5), D33 Gmail-oldali válasz, csatolmány letöltés → A6 | fake Gmail E2E: két mailbox → egy item; kimaradt sync utolér; lejárt cursor; hírlevél sosem jut be | B1, B2, A6 |
| **B4** Classify + ledger + dispatch | slice 1/b: `classifyInbound` + `checkCompleteness` + `screenSender` llm_step-ként, `clientRequests`, dispatch-tábla (§5.3), `agentItems` open/join/snooze/wake, `email_event` notification | determinisztikus réteg CI-ben; 30 fixture a model rétegen env flag mögött | B3, A2 |
| **B5** Send pipeline (backend) | slice 3 előrehozott magja: `emailDrafts`, verziók, approval hash, queued → dispatching → sent / failed / unknown, 15 s undo (`sendAt`), Message-ID generálás + megerősítés, sending-mailbox szabály (D35, előbb csak a szabály) | E2E: timeout → unknown → megerősítve, nem küld duplán; edit a countdown alatt érvényteleníti; reload utáni undo | B1, B2 |
| **B6** prepareTask + Triage backend | slice 2 backend: `prepareTask` agent_run job, ledger-check + completeness, kérdések, create (+10 s undo, D30) / merge (`updateTask` proposal, D29) / decline / snooze, approval → Mark done (D32), új kliens, kickoff `draftReply` (D21) | I12 gate; az Undo nem értesít; Merge = ugyanaz a kódút, mint a reply-change | B4, B5, A4, A5 |
| **B7** Drawer Draft mód | D15: a drawer forrás-absztrakciója (task \| proposal payload), Draft állapot tabok nélkül, meglévő pickerek | proposal szerkesztése a drawerben → `editedPayload`; létező task változatlan | A4 |
| **B8** Conversation kit + Triage UI | §7.1 blokkok (run line a job stage-ekből, plan list, email component, event line, widgetek T15/T14/retainer), `/triage` (lista + nézetek, layout, billentyűk F10 szerint), sidebar badge | böngészőben végigjátszott canvas-szcenáriók (Réka, Gábor, Péter, Judit, Anna) | B6, B7 |

### Mérföldkő C — Válasz ki (Reviews) + task oldal

| Phase | Tartalom | Függ |
|---|---|---|
| **C1** draftCompletion + presend review | `draftReply` completion módban, `agentChecks` presend, gate-tábla (§6.7), T6, T12, `emailPromises` küldéskor (I8) | B8 |
| **C2** Reviews UI | `/reviews` beszélgetés, Approve & send / Approve / Approve without email / Send back → subtasks, D8 partial + follow-up csak Gmail-elfogadáskor | C1 |
| **C3** Task drawer Emails tab + kolléga oldal | Emails tab, activity események, member `private` task-thread assistant (I10 negatív teszt a retainer-adattal), handover QA (`agentChecks`), T13 | C1 |

### Mérföldkő D — Agents workspace + figyelés + hardening + tanulás

| Phase | Tartalom | Függ |
|---|---|---|
| **D1** Change lists + chat-csatolmányok | M-1 (3 change list block a 4 kindre, drawer „proposed change" állapot) + I-5 (először tracer: képinput a 0.6.4-ben) | A4, B7 |
| **D2** Watching | slice 5: determinisztikus jelzések working-hour órákkal, 9:00 digest, assignee emlékeztetők, T4 | C2 |
| **D3** Hardening | slice 6: ≥30 HU/EN fixture + release metrikák (recall ≥98%, acknowledge precision 100%), E2E, access mátrix, runbook | D1, D2 |
| **D4** Learning | slice 7: `proposeSkill` | C2 |

**Az első valódi érték:** a B mérföldkő végén a saját Gmail-ünkből jönnek a levelek, Triage-ban taskká
válnak, és a kickoff kimegy. Ezért a B1-hez szükséges Google OAuth clientet **most** érdemes elindítani,
hogy ne ott álljunk meg.

---

## 5. Orchestrációs protokoll (hogyan vezetem a subagenteket)

1. **Brief phase-enként** (én írom, a subagent semmi mást nem lát): cél, pontos fájlok/terület, a PRD
   releváns §-ai + ennek a dokumentumnak a döntései, invariánsok, nem-célok, „done" definíció,
   kötelező ellenőrzések. Convex phase-nél kötelező olvasmány a `convex/_generated/ai/guidelines.md`, a
   **1.34 API-kon maradva** (O9). Next phase-nél a `node_modules/next/dist/docs/` releváns fájlja.
2. **Subagent:** `general-purpose`, egyszerre egy író. Implementál, tesztet ír (pure logika + convex-test),
   lefuttatja: `npx tsc --noEmit`, `npm run lint`, `npm test`, UI phase-nél `npm run build`. **Nem
   commitol**, a végén strukturált riportot ad (mi kész, mi nem, eltérések, nyitott kérdések).
3. **Kapu (én):**
   - diff-review a brief ellen; a kockázatos phase-eknél (A1, A2, B5, C2) független `code-review`
     subagent is;
   - a checkek újrafuttatása;
   - UI phase-nél böngészős ellenőrzés;
   - commit a branchre, a PRD slice-státusz táblájának frissítése.
   Hiba esetén ugyanannak a subagentnek küldöm vissza (megvan a kontextusa).
4. **Neked marad:**
   - a bejelentkezett live gate-ek listája phase-enként (valódi Gmail, két admin, member fiók);
   - a reseed parancsok;
   - minden, ami küld vagy valódi fiókhoz nyúl.
5. **Tiltások minden briefben:** nincs `git stash/clean/restore/checkout --`; a `convex/tasks/*`-hoz csak
   a `write.ts` belépési pontokon át nyúl; nincs public „run as" endpoint; titok nem kerül logba vagy
   fixture-be.

---

## 6. Döntések (owner, 2026-10-19: „mehet" — mind az ajánlott opció)

- **E1** A platform-általánosítások (§2 S1–S9, §3 P1–P6) elfogadva; a PRD ezek szerint frissül.
- **E2** Háttérrun: a Gmail-hozzáférés a connector owneré, de az `admins` láthatóságú (Triage) thread
  futása **admin-szintű olvasással** megy, egy kijelölt admin nevében (`via: "agent"`). Ez az O1-et
  árnyalja.
- **E3** Branch `email-triage`, mérföldkövenként PR (A, B, C, D) a main-be.
- **E4** A Google OAuth clientet az owner a mérföldkő A alatt készíti el; a B1 erre vár.

Az eredeti kérdések (történeti):

1. **A platform-általánosítások elfogadása** (§2 S1–S9, §3 P1–P6). Ezek a PRD adatmodelljét és a
   slice-okat érintik, a UI-döntéseket nem. Igen esetén a PRD-t frissítem (§4, §5.1, §9, §12 sorokkal).
2. **Háttérrun actor egy member mailboxából érkező levélnél** (O1 árnyalása). „Connector owner" = a
   member. Így a prepareTask member-joggal olvas, és az admin-only retainer kártya hiányozna a Triage
   threadből. Javaslat: a Gmail-hozzáférés a connector owneré, de az `admins` láthatóságú thread
   olvasási joga admin-szintű legyen (az org első adminja vagy egy kijelölt admin nevében, `via: "agent"`).
3. **Branch/PR stratégia:** egy `email-triage` branch, mérföldkövenként PR (A, B, C, D) — vagy egyetlen PR
   a végén.
4. **Google OAuth client** (Internal app + `GOOGLE_CLIENT_ID/SECRET` a Convex env-ben) — ez blokkolja a B1-et.
