# Claude Code Prompt — Task Drawer Visual Refactor

## Mi ez?

A csatolt `task-drawer-v24.jsx` egy **dizájn irányadó mockup**. Inline style-okkal és dummy adatokkal készült. **NEM production kód.** A layoutot, arányokat, spacinget és vizuális hierarchiát kommunikálja.

A feladatod: a meglévő task drawer komponenst vizuálisan ehhez igazítani, a **meglévő shadcn komponenseket, Tailwind tokeneket és Next.js struktúrát** használva.

---

## 1. EZEKET VÁLTOZTASD MEG (layout/pozíció/spacing)

### Timer a top bar-ba
- A stopper (play/pause gomb + `HH:MM:SS` kijelző) a felső sávba költözik
- Pozíció: a breadcrumb és az akciógombok közé, flex spacerrel jobbra tolva
- Így sidebar bezárva is mindig látható, görgetéskor is
- A mockupban nézd meg a `Timer` komponenst a pontos méretekért (26px gomb, 13px számok)

### Tabok a cím alá
- A tabok (`Overview | Time | Files | Email`) a cím alá kerülnek, NEM a top bar-ba
- Szöveges gombok, NEM ikonok
- Aktív tab: `font-weight: 600` + sötét szín, inaktív: tertiary szürke — semmi más jelölés (nincs háttér, nincs underline)
- Badge: piros pill **inline a szöveg után** (`Time ❸`, `Email ❷`) — NEM az ikon fölött, NEM absolute pozícióban
- A tabok bal széle egy vonalban van a cím és a tartalom bal szélével

### Top bar egyszerűsítés
- Egy sor: bal oldalon `←` + breadcrumb, jobb oldalon fullscreen/sidebar toggle/close ikonok
- A tabok NEM itt vannak

### Sidebar: vertikális property layout
- Label fölötte (11px, tertiary, halvány), érték alatta (13px)
- NEM horizontális key:value sorok
- Properties csoportosítva, csoportok között finom vonal, csoporton belül NINCS vonal — a whitespace a struktúra
- "PROPERTIES" fejléc a sidebar tetején, a címmel egy magasságban (32px padding-top)
- Sidebar toggle-elhető a top bar-ból (panel ikon)

### Activity feed spacing
- Kommentek között: **~24px** margó (jelenleg valószínűleg kevesebb)
- Csoportosított kommentek (ugyanaz a user egymás után): **~6px**, avatar és név nélkül
- Tartalom behúzás: **32px** (avatar szélessége) — a szöveg az avatar mellett indul
- Batch event header: **ugyanaz a ritmus**, mint egy komment header — 24px kör ikon (mint avatar) + "9 changes" félkövér + timestamp mellette (NEM jobb oldalra tolva!) + `>` nyíl

### Kommentek: háttér nélkül
- Nincs buborék, nincs kártya, nincs `bg-muted` — a szöveg közvetlenül a fehér papíron él
- A jelenlegi komment renderelés logikáját NE változtasd — csak a vizuális wrappert (ha van háttér/border, vedd le)

---

## 2. EZEKET ADD HOZZÁ (új funkciók)

### Link preview a kommentekhez
- Ha valaki Figma/Loom/Webflow/bármilyen linket illeszt be, az elküldés után a komment szövege alatt megjelenik egy **badge**
- Ugyanúgy néz ki, mint a fájl csatolmány: halvány háttér (`bg-muted`), ikon/szín pont + félkövér cím + halvány domain
- Példa: `◆ Task Drawer Redesign  figma.com`
- A mockupban nézd meg az `InlineLink` komponenst

### Comment box a kommentek aljára
- A comment input NEM fix pozícióban van az alján — a kommentek után következik, az activity feed végén
- Fókuszra megjelenik a toolbar (B/I/U/S + link + attach + "Ask AI" gomb)
- A mockupban nézd meg a `CommentInput` komponenst a toolbar struktúráért

---

## 3. EZEKHEZ NE NYÚLJ

- **Status badge komponens** — a meglévő shadcn/saját badge marad, ne írd újra
- **Category badge komponens** — marad
- **Priority badge komponens** — marad
- **Komment renderelés logikája** — adatstruktúra, store, API hívások, @mention, reakciók, fájl csatolás logikája MIND marad
- **Activity/changes batch logika** — a kinyitás/becsukás mechanizmusa marad, csak vizuálisan igazítod (kör ikon mint avatar, timestamp balra a label mellé)
- **Tailwind tokenek** — a meglévőket használd, ne definiálj újakat
- **shadcn komponensek** — ahol van megfelelő (Button, Badge, Avatar, stb.), azt használd
- **Next.js routing, layout** — nem nyúlsz hozzá
- **Állapotkezelés** (zustand/context/stb.) — marad
- **API hívások, auth, real-time** — marad

---

## 4. HOGYAN HASZNÁLD A MOCKUP JSX-T

| Erre használd | Erre NE |
|---|---|
| Layout: mi hol van (timer, tabok, sidebar pozíciója) | Komponens kód másolása |
| Spacing: margin/padding értékek (24px kommentek közt, 32px behúzás, stb.) | Avatar/Badge/Tag komponens másolása |
| Hierarchia: font-size, font-weight, color viszonyok | Dummy adatstruktúrák (USERS[], ACTIVITY[]) |
| Vizuális stílus: háttér nélküli kommentek, muted palette | Inline style-ok beillesztése (fordítsd Tailwind-re) |
| Interakció minta: InlineSelect dropdown viselkedése | Állapotkezelés logika |

---

## 5. SORREND

1. **Olvasd be a meglévő task drawer fájlokat** — értsd meg a struktúrát, milyen komponensek vannak, mi hol van
2. **Olvasd be a mockup JSX-t** — értsd meg a vizuális célt
3. **Írd le a tervet** mielőtt kódolsz — mit mozgatsz, mit spacingelsz, mit adsz hozzá
4. **Top bar** — timer ide, tabok ki innen, breadcrumb marad
5. **Cím + tabok** — cím a dokumentumban, tabok alatta szöveges gombokként
6. **Activity feed** — spacing növelés, batch header átrendezés (timestamp balra), komment háttér eltávolítás
7. **Link preview** — új feature a kommentekhez
8. **Comment input** — a feed végére, nem fixre
9. **Sidebar** — vertikális layout, PROPERTIES fejléc, toggle
10. **Minden lépés után kérdezz**, ha valami nem egyértelmű a meglévő kódbázisban

---

## Csatolt fájl

`task-drawer-v24.jsx` — **IRÁNYADÓ REFERENCIA.** Layout, spacing, hierarchia. Nem másolandó, hanem fordítandó a meglévő kódbázis nyelvére.
