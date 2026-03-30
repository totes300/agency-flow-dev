import { useState, useRef, useEffect } from "react";

const font = "'Inter', system-ui, -apple-system, sans-serif";
const ink = "#37352F";
const sec = "#787774";
const ter = "#B4B0AC";
const line = "#E9E9E7";
const bg = "#FFFFFF";
const hov = "#F7F6F3";
const sel = "#EDEDEC";

const USERS = [
  { id: "adam", name: "Ádám Tóth", initials: "ÁT", hue: 30 },
  { id: "bence", name: "Szabó Bence", initials: "SZB", hue: 150 },
  { id: "petra", name: "Kiss Petra", initials: "KP", hue: 15 },
  { id: "ai", name: "AI", initials: "AI", hue: 220 },
];

const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;

const SUBTASKS = [
  { id: 1, text: "Drawer layout újratervezés", done: true },
  { id: 2, text: "Comment box rich editor", done: true },
  { id: 3, text: "Tag rendszer implementálás", done: false },
  { id: 4, text: "@mention autocomplete", done: false },
  { id: 5, text: "Fullscreen mód", done: false },
];

const ACTIVITY = [
  { id: "b1", type: "batch", count: 9, timeAgo: "4d ago", items: [
    { icon: "create", text: "You created this task", time: "6d ago" },
    { icon: "move", text: <>Moved to project <b>Fixed project</b></>, time: "6d ago" },
    { icon: "category", text: <>Changed category to <b>Development</b></>, time: "6d ago" },
    { icon: "time", text: <>Logged <b>01:00</b></>, time: "6d ago" },
    { icon: "billing", text: <>Marked as <b>Non-billable</b></>, time: "6d ago" },
    { icon: "assign", text: <>Assigned <b>Oslop Adam</b></>, time: "5d ago" },
    { icon: "category", text: <>Changed category to <b>Copywriting</b></>, time: "5d ago" },
    { icon: "category", text: <>Changed category to <b>Strategy</b></>, time: "5d ago" },
    { icon: "category", text: <>Changed category to <b>Development</b></>, time: "4d ago" },
  ]},
  { id: "c1", type: "comment", user: 0, time: "Mar 25, 18:10",
    content: "Elkezdtem a drawer refaktorálást. A jelenlegi struktúra nem skálázódik jól, teljesen újratervezem a komponens hierarchiát.",
    reactions: [{ emoji: "😍", count: 1 }, { emoji: "👍", count: 2 }],
    link: { title: "Task Drawer Redesign", domain: "figma.com", icon: "figma" },
  },
  { id: "b2", type: "batch", count: 6, timeAgo: "8h ago", items: [
    { icon: "assign", text: <>Assigned <b>Szabó Bence</b></>, time: "8h ago" },
    { icon: "category", text: <>Status → <b>In Progress</b></>, time: "8h ago" },
    { icon: "time", text: <>Estimate → <b>10h</b></>, time: "8h ago" },
    { icon: "category", text: <>Added tag <b>sprint-4</b></>, time: "8h ago" },
    { icon: "category", text: <>Priority → <b>High</b></>, time: "8h ago" },
    { icon: "assign", text: <>Assigned <b>Kiss Petra</b></>, time: "8h ago" },
  ]},
  { id: "c2", type: "comment", user: 0, time: "Mar 25, 20:11",
    content: "Ez egy értesítő amit meg kell nézz",
    file: { name: "Ertesito_Konverted_2026-03-11.pdf", size: "894 KB" },
  },
  { id: "c3", type: "comment", user: 1, time: "Mar 25, 20:45",
    content: "A Properties panel responsive legyen — tablet nézetben összecsukhatónak kell lennie.",
    replyTo: "Elkezdtem a drawer refaktorálást...",
    link: { title: "Properties panel — responsive", domain: "loom.com", icon: "loom" },
  },
  { id: "c4", type: "comment", user: 2, time: "Mar 25, 21:10",
    content: "Az ügyfél jelezte, hogy @mention funkciót szeretnének. Itt a staging link:",
    tag: { label: "Ügyfélre várok", color: "#9F7445", bg: "#F2E8DB" },
    replyTo: "Ez egy értesítő amit meg kell nézz",
    link: { title: "Task Drawer — Staging", domain: "webflow.io", icon: "webflow" },
  },
  { id: "b3", type: "batch", count: 2, timeAgo: "3h ago", items: [
    { icon: "category", text: <>Status → <b>Review</b></>, time: "3h ago" },
    { icon: "time", text: <>Logged <b>02:30</b></>, time: "3h ago" },
  ]},
  { id: "c6", type: "comment", user: 0, time: "Mar 26, 14:02",
    content: "Oké srácok, gyors update.",
    tag: { label: "Napi riport", color: "#527A4A", bg: "#DBEDDB" },
  },
  { id: "c7", type: "comment", user: 0, time: "Mar 26, 14:02",
    content: "A subtask collapsible kész, progress bar működik. Most a comment grouping-on dolgozom.",
  },
  { id: "c8", type: "comment", user: 0, time: "Mar 26, 14:03",
    content: "Tag színeket finomítottam, nézzétek és szóljatok.",
    file: { name: "screenshot-tags.png", size: "67 KB" },
  },
  { id: "c9", type: "comment", user: 2, time: "Mar 26, 14:15",
    content: "Ez király lett!",
    replyTo: "Oké srácok, gyors update.",
    reactions: [{ emoji: "🔥", count: 2 }],
  },
  { id: "c10", type: "comment", user: 0, time: "Mar 26, 14:20",
    content: "Van egy kérdésem a tag renderinggel — valaki ránézne?",
    tag: { label: "Elakadás", color: "#B3635A", bg: "#F5E0DE" },
    replyTo: "Ez király lett!",
  },
];

/* (sidebar data is now inline in the Sidebar component) */

/* ── Primitives ── */

const Av = ({ user, size = 22 }) => (
  <div style={{
    width: size, height: size, minWidth: size, borderRadius: "50%",
    background: hsl(user.hue, 25, 90), color: hsl(user.hue, 20, 40),
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: Math.round(size * 0.38), fontWeight: 600, fontFamily: font, flexShrink: 0,
  }}>{user.initials}</div>
);

const Tag = ({ tag }) => (
  <span style={{
    fontSize: 12, fontWeight: 500, fontFamily: font,
    color: tag.color, background: tag.bg,
    padding: "2px 8px", borderRadius: 3,
  }}>{tag.label}</span>
);

/* ── Timer (compact, for top bar) ── */

const Timer = () => {
  const [on, setOn] = useState(false);
  const [s, setS] = useState(3685);
  const ref = useRef(null);
  useEffect(() => {
    if (on) ref.current = setInterval(() => setS(v => v + 1), 1000);
    else clearInterval(ref.current);
    return () => clearInterval(ref.current);
  }, [on]);
  const p = n => String(n).padStart(2, "0");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button onClick={() => setOn(!on)} style={{
        width: 26, height: 26, borderRadius: "50%", border: "none",
        background: on ? "#FDECEC" : "#DBEDDB",
        color: on ? "#EB5757" : "#527A4A",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
      }}>
        {on
          ? <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          : <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
        }
      </button>
      <span style={{
        fontSize: 13, fontWeight: 600, fontFamily: font,
        color: on ? ink : sec, letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
      }}>
        {p(Math.floor(s/3600))}:{p(Math.floor((s%3600)/60))}:{p(s%60)}
      </span>
    </div>
  );
};

/* ── Batch — same visual rhythm as comments ── */

const BATCH_ICONS = {
  create: "M12 5v14M5 12h14",
  move: "M5 12h14M12 5l7 7-7 7",
  category: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z",
  time: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  assign: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2",
  billing: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
};

const Batch = ({ data }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      {/* Header — matches comment header: icon · label · time, left-aligned */}
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8,
        cursor: "pointer", userSelect: "none",
        marginBottom: open ? 6 : 0,
      }}>
        <div style={{
          width: 24, height: 24, minWidth: 24, borderRadius: "50%",
          background: hov,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ter} strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: sec, fontFamily: font }}>
          {data.count} changes
        </span>
        <span style={{ fontSize: 12, color: ter, fontFamily: font }}>{data.timeAgo}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ter} strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transformOrigin: "center", transition: "transform 0.15s", marginLeft: 2 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      {/* Expanded items — indented to align with text after avatar */}
      {open && (
        <div style={{ marginLeft: 32 }}>
          {data.items.map((item, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 0",
              fontSize: 13, color: sec, fontFamily: font, lineHeight: 1.5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ter} strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <path d={item.icon ? (BATCH_ICONS[item.icon] || BATCH_ICONS.create) : BATCH_ICONS.create} />
                {item.icon === "assign" && <circle cx="12" cy="7" r="4" />}
              </svg>
              <span>{item.text || item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Link ── */

const FAVI = { figma: { e: "◆", c: "#A259FF" }, loom: { e: "●", c: "#625DF5" }, webflow: { e: "◆", c: "#4353FF" } };

const InlineLink = ({ link }) => {
  const f = FAVI[link.icon] || { e: "◆", c: ter };
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 10px", borderRadius: 5,
      background: hov, cursor: "pointer",
      fontSize: 12.5, fontFamily: font, color: sec,
    }}>
      <span style={{ fontSize: 10, color: f.c, flexShrink: 0 }}>{f.e}</span>
      <span style={{ fontWeight: 500, color: ink }}>{link.title}</span>
      <span style={{ fontSize: 11, color: ter }}>{link.domain}</span>
    </div>
  );
};

/* ── Comment — spacious, clear hierarchy ── */

const Comment = ({ item, grouped }) => {
  const user = USERS[item.user];
  const isAI = item.type === "ai";
  const [h, setH] = useState(false);

  return (
    <div style={{
      padding: grouped ? "0 0 0 32px" : "0",
      marginTop: grouped ? 6 : 24,
      position: "relative",
    }}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    >
      {/* Header — only for first message in group */}
      {!grouped && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 6,
        }}>
          <Av user={user} size={24} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: ink, fontFamily: font }}>
              {user.name}
            </span>
            <span style={{ fontSize: 12, color: ter, fontFamily: font }}>
              {item.time}
            </span>
          </div>
          {item.tag && <Tag tag={item.tag} />}
        </div>
      )}

      {/* Tag on grouped */}
      {grouped && item.tag && (
        <div style={{ marginBottom: 4 }}><Tag tag={item.tag} /></div>
      )}

      {/* Reply thread indicator */}
      {item.replyTo && (
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          marginBottom: 4, marginLeft: grouped ? 0 : 32,
          fontSize: 12, color: ter, fontFamily: font,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={ter} strokeWidth="2.5">
            <polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 01-4 4H4" />
          </svg>
          {item.replyTo}
        </div>
      )}

      {/* Content area — indented to align with name */}
      <div style={{ marginLeft: grouped ? 0 : 32 }}>

        {/* Text */}
        {isAI ? (
          <div style={{
            padding: "12px 16px", borderRadius: 6,
            background: "#F6F5F4", border: `1px solid ${line}`,
            fontSize: 14, lineHeight: 1.75, color: ink, fontFamily: font,
          }}>
            <div style={{
              fontSize: 10.5, color: sec, fontWeight: 600,
              marginBottom: 6,
              display: "flex", alignItems: "center", gap: 4,
              textTransform: "uppercase", letterSpacing: "0.03em",
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={sec} strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              AI
            </div>
            {item.content}
          </div>
        ) : (
          <div style={{
            fontSize: 14, lineHeight: 1.75, color: ink, fontFamily: font,
          }}>
            {item.content}
          </div>
        )}

        {/* File attachment */}
        {item.file && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 8, padding: "5px 10px", borderRadius: 5,
            background: hov, fontSize: 12.5, fontFamily: font,
            color: sec, cursor: "pointer",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={sec} strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            {item.file.name}
            <span style={{ color: ter, fontSize: 11 }}>{item.file.size}</span>
          </div>
        )}

        {/* Link preview */}
        {item.link && <div style={{ marginTop: 8 }}><InlineLink link={item.link} /></div>}

        {/* Reactions */}
        {item.reactions && (
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            {item.reactions.map((r, i) => (
              <span key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 7px", borderRadius: 99, fontSize: 12,
                background: hov, border: `1px solid ${line}`,
                cursor: "pointer", fontFamily: font,
              }}>
                {r.emoji} <span style={{ fontSize: 11, color: sec }}>{r.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hover actions */}
      {h && !isAI && (
        <div style={{
          position: "absolute", top: grouped ? -6 : 0, right: 0,
          display: "flex", gap: 1,
          background: bg, border: `1px solid ${line}`, borderRadius: 6,
          padding: 2, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          {["💬", "👍", "···"].map((ic, i) => (
            <button key={i} style={{
              width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
              border: "none", background: "transparent", cursor: "pointer", borderRadius: 4,
              fontSize: 11, color: sec,
            }}
              onMouseEnter={e => e.currentTarget.style.background = hov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >{ic}</button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Subtasks ── */

const Subtasks = ({ tasks, onToggle }) => {
  const [open, setOpen] = useState(true);
  const done = tasks.filter(t => t.done).length;
  return (
    <div>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 0", margin: "0 -4px" }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ter} strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s", marginLeft: 4 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: sec, fontFamily: font }}>Subtasks</span>
        <span style={{ fontSize: 12, color: ter }}>{done}/{tasks.length}</span>
        <div style={{ width: 40, height: 2, borderRadius: 1, background: line, overflow: "hidden", marginLeft: 2 }}>
          <div style={{ height: "100%", width: `${Math.round((done/tasks.length)*100)}%`, background: "#35B075", borderRadius: 1, transition: "width 0.3s" }} />
        </div>
      </div>
      {open && (
        <div style={{ paddingTop: 2 }}>
          {tasks.map((t, i) => (
            <div key={t.id} onClick={() => onToggle(i)} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", cursor: "pointer" }}>
              <div style={{ width: 16, height: 16, minWidth: 16, marginTop: 2, borderRadius: 3, border: t.done ? "none" : `1.5px solid ${ter}`, background: t.done ? "#35B075" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
                {t.done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
              <span style={{ fontSize: 14, fontFamily: font, lineHeight: "20px", color: t.done ? ter : ink, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: ter, fontSize: 13, fontFamily: font }}
            onMouseEnter={e => e.currentTarget.style.color = sec} onMouseLeave={e => e.currentTarget.style.color = ter}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New subtask
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Comment Input ── */

const CommentInput = ({ onSend }) => {
  const [text, setText] = useState("");
  const [foc, setFoc] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${line}`, padding: "12px 0 0" }}>
      {foc && (
        <div style={{ display: "flex", alignItems: "center", gap: 1, marginBottom: 6 }}>
          {["B","I","U","S"].map(l => (
            <button key={l} style={{ width: 26, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", cursor: "pointer", borderRadius: 3, fontSize: 12.5, fontFamily: font, color: sec, fontWeight: l==="B"?700:400, fontStyle: l==="I"?"italic":"normal", textDecoration: l==="U"?"underline":l==="S"?"line-through":"none" }}
              onMouseEnter={e => e.currentTarget.style.background = hov} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{l}</button>
          ))}
          <div style={{ width: 1, height: 14, background: line, margin: "0 3px" }} />
          {["M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71","M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"].map((d,i) => (
            <button key={i} style={{ width: 26, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", cursor: "pointer", borderRadius: 3 }}
              onMouseEnter={e => e.currentTarget.style.background = hov} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={sec} strokeWidth="2" strokeLinecap="round"><path d={d} /></svg>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button style={{ fontSize: 11.5, color: sec, fontFamily: font, fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: "3px 8px", borderRadius: 3, display: "flex", alignItems: "center", gap: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = hov} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={sec} strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
            Ask AI
          </button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Av user={USERS[0]} size={20} />
        <div style={{ flex: 1 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} onFocus={() => setFoc(true)}
            placeholder="Write a comment..." rows={foc ? 3 : 1}
            style={{ width: "100%", border: "none", outline: "none", resize: "none", fontSize: 14, lineHeight: 1.6, color: ink, fontFamily: font, background: "transparent", padding: 0, boxSizing: "border-box" }} />
          {foc && text.trim() && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <button onClick={() => { onSend?.(text); setText(""); }}
                style={{ padding: "5px 14px", borderRadius: 4, border: "none", background: "#2383E2", color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: font }}>
                Comment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Sidebar ── */

/* ── Notion-style inline select ── */

const STATUSES = [
  { label: "Backlog", color: "#787774", bg: "#F1F1EF" },
  { label: "To Do", color: "#527A4A", bg: "#DBEDDB" },
  { label: "Today", color: "#527A4A", bg: "#DBEDDB" },
  { label: "In Progress", color: "#5B7BB5", bg: "#D3E0F0" },
  { label: "Review", color: "#9F7445", bg: "#F2E8DB" },
  { label: "Done", color: "#527A4A", bg: "#DBEDDB" },
  { label: "Stuck", color: "#B3635A", bg: "#F5E0DE" },
];

const CATEGORIES = [
  { label: "Development", color: "#5B7BB5", bg: "#D3E0F0" },
  { label: "Design", color: "#9F7445", bg: "#F2E8DB" },
  { label: "Strategy", color: "#7A5BA5", bg: "#E4D8F0" },
  { label: "Copywriting", color: "#527A4A", bg: "#DBEDDB" },
  { label: "Marketing", color: "#B3635A", bg: "#F5E0DE" },
];

const PRIORITIES = [
  { label: "None", color: "#787774", bg: "#F1F1EF" },
  { label: "Low", color: "#5B7BB5", bg: "#D3E0F0" },
  { label: "Medium", color: "#9F7445", bg: "#F2E8DB" },
  { label: "High", color: "#B3635A", bg: "#F5E0DE" },
  { label: "Urgent", color: "#B3635A", bg: "#F5E0DE" },
];

const InlineSelect = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = options.find(o => o.label === value) || options[0];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 13, fontWeight: 500,
          color: current.color, background: current.bg,
          padding: "3px 10px", borderRadius: 4,
          cursor: "pointer", transition: "opacity 0.1s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: current.color }} />
        {current.label}
      </span>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          background: "#FFFFFF", borderRadius: 8,
          border: "1px solid #E9E9E7",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
          padding: 4, minWidth: 170, zIndex: 50,
        }}>
          {options.map(opt => (
            <div
              key={opt.label}
              onClick={() => { onChange(opt.label); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: 4,
                cursor: "pointer",
                background: opt.label === value ? "#F7F6F3" : "transparent",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#F7F6F3"}
              onMouseLeave={e => e.currentTarget.style.background = opt.label === value ? "#F7F6F3" : "transparent"}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12.5, fontWeight: 500,
                color: opt.color, background: opt.bg,
                padding: "2px 8px", borderRadius: 3,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: opt.color }} />
                {opt.label}
              </span>
              {opt.label === value && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#37352F" strokeWidth="2.5" style={{ marginLeft: "auto" }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Sidebar = () => {
  const [status, setStatus] = useState("Today");
  const [category, setCategory] = useState("Development");
  const [priority, setPriority] = useState("High");

  const groups = [
    [
      { label: "Status", render: () => <InlineSelect value={status} options={STATUSES} onChange={setStatus} /> },
      { label: "Assignees", render: () => (
        <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
        >
          <Av user={USERS[0]} size={20} />
          <span style={{ fontSize: 13, color: ink }}>Ádám Tóth</span>
        </div>
      )},
      { label: "Category", render: () => <InlineSelect value={category} options={CATEGORIES} onChange={setCategory} /> },
    ],
    [
      { label: "Priority", render: () => <InlineSelect value={priority} options={PRIORITIES} onChange={setPriority} /> },
      { label: "Due date", render: () => <span style={{ fontSize: 13, color: ink }}>Apr 2, 2026</span> },
      { label: "Estimate", render: () => <span style={{ fontSize: 13, color: ink }}>10h 0m</span> },
      { label: "Tracked", render: () => <span style={{ fontSize: 13, color: ink }}>1h 30m</span> },
    ],
    [
      { label: "Billing", render: () => <span style={{ fontSize: 13, color: ink }}>Non-Billable</span> },
      { label: "Project", render: () => (
        <div>
          <div style={{ fontSize: 13, color: ink, fontWeight: 500 }}>Konverted Web Agency Kft</div>
          <div style={{ fontSize: 12, color: ter }}>Fixed project</div>
        </div>
      )},
    ],
    [
      { label: "Created by", render: () => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Av user={USERS[0]} size={20} />
          <span style={{ fontSize: 13, color: ink }}>Adam Toth</span>
        </div>
      )},
      { label: "Created on", render: () => <span style={{ fontSize: 13, color: ink }}>2026. márc. 23.</span> },
    ],
  ];

  return (
    <div style={{
      width: 240, minWidth: 240, borderLeft: `1px solid ${line}`,
      padding: "0 18px 20px", overflowY: "auto",
      fontFamily: font, color: ink,
    }}>
      <div style={{
        padding: "32px 0 16px",
        fontSize: 11, fontWeight: 600, color: ter,
        textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        Properties
      </div>

      {groups.map((group, gi) => (
        <div key={gi} style={{
          paddingBottom: 16, marginBottom: 16,
          borderBottom: gi < groups.length - 1 ? `1px solid ${line}` : "none",
        }}>
          {group.map((prop, pi) => (
            <div key={pi} style={{
              marginBottom: pi < group.length - 1 ? 14 : 0,
              borderRadius: 4, padding: "2px 0",
            }}>
              <div style={{
                fontSize: 11, color: ter, fontWeight: 500,
                marginBottom: 4, letterSpacing: "0.01em",
              }}>
                {prop.label}
              </div>
              {prop.render()}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};


/* ── Icon button helper ── */

const IcoBtn = ({ onClick, active, children, tip }) => (
  <button onClick={onClick} title={tip} style={{
    width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", cursor: "pointer", borderRadius: 4,
    background: active ? sel : "transparent",
    color: active ? ink : ter,
  }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = hov; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
  >{children}</button>
);

/* ── Main ── */

export default function TaskDrawerV24() {
  const [tasks, setTasks] = useState(SUBTASKS);
  const [activity, setActivity] = useState(ACTIVITY);
  const [view, setView] = useState("overview");
  const [full, setFull] = useState(false);
  const [side, setSide] = useState(true);
  const scrollRef = useRef(null);
  const toggleTask = i => setTasks(t => t.map((x, j) => j === i ? { ...x, done: !x.done } : x));
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [activity]);
  const send = text => setActivity(prev => [...prev, { id: `c-${Date.now()}`, type: "comment", user: 0, time: "just now", content: text }]);

  const views = [
    { id: "overview", label: "Overview" },
    { id: "time", label: "Time", badge: 3 },
    { id: "files", label: "Files" },
    { id: "email", label: "Email", badge: 2 },
  ];

  return (
    <div style={{ fontFamily: font, background: "#F7F6F3", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: full ? "none" : 960, background: bg, display: "flex", flexDirection: "column", minHeight: "100vh", boxShadow: "0 0 0 1px rgba(0,0,0,0.04)" }}>

        {/* ── Chrome bar: breadcrumb · timer · actions ── */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "5px 8px 5px 10px",
          borderBottom: `1px solid ${line}`,
          gap: 8,
        }}>
          {/* Left: back + breadcrumb */}
          <IcoBtn tip="Back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </IcoBtn>
          <span style={{ fontSize: 12, color: ter, fontFamily: font }}>
            Konverted Web Agency <span style={{ color: line }}>/</span> Fixed project
          </span>

          {/* Center spacer */}
          <div style={{ flex: 1 }} />

          {/* Timer — always visible, compact */}
          <Timer />

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: line }} />

          {/* Actions */}
          <IcoBtn onClick={() => setFull(!full)} tip="Fullscreen">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {full ? <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                : <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />}
            </svg>
          </IcoBtn>
          <IcoBtn onClick={() => setSide(!side)} active={side} tip="Properties">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
          </IcoBtn>
          <IcoBtn tip="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </IcoBtn>
        </div>

        {/* ── Body ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
            {view === "overview" ? (
              <div style={{ padding: full ? "0 60px" : "0 40px" }}>

                {/* Title — sole hero, clean */}
                <h1 style={{
                  fontSize: 30, fontWeight: 700, color: ink, margin: "32px 0 0",
                  fontFamily: font, lineHeight: 1.25, letterSpacing: "-0.02em",
                }}>
                  Fixed 02
                </h1>

                {/* Tabs — subtle, part of the document */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 0,
                  margin: "14px 0 0 -8px",
                }}>
                  {views.map(v => (
                    <button key={v.id} onClick={() => setView(v.id)} style={{
                      height: 30, display: "inline-flex", alignItems: "center", gap: 4,
                      border: "none", cursor: "pointer", borderRadius: 4,
                      background: "transparent",
                      padding: "0 8px",
                      fontSize: 13, fontFamily: font,
                      fontWeight: view === v.id ? 600 : 400,
                      color: view === v.id ? ink : ter,
                    }}
                      onMouseEnter={e => e.currentTarget.style.color = view === v.id ? ink : sec}
                      onMouseLeave={e => e.currentTarget.style.color = view === v.id ? ink : ter}
                    >
                      {v.label}
                      {v.badge > 0 && (
                        <span style={{
                          minWidth: 16, height: 16, borderRadius: 8,
                          background: "#EB5757", color: "#fff",
                          fontSize: 10, fontWeight: 700, fontFamily: font,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          padding: "0 4px",
                        }}>{v.badge}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Thin rule — the only separator, creates the "below the fold" */}
                <div style={{ height: 1, background: line, margin: "6px 0 24px" }} />

                {/* Description */}
                <p style={{ fontSize: 15, lineHeight: 1.8, color: ink, margin: "0 0 12px", fontFamily: font }}>
                  Testvérem, Szabó Bence hosszú éveken át szolgálta a hazáját a rendőrség kötelékében. Munkáját mindig a törvények betartásával, lelkiismeretesen és erős igazságérzettel végezte, esküjéhez hű maradva igyekezett helytállni minden helyzetben.
                </p>
                <p style={{ fontSize: 15, lineHeight: 1.8, color: ink, margin: "0 0 12px", fontFamily: font }}>
                  A közelmúlt eseményei azonban gyökeresen megváltoztatták az életét. Kiállása miatt hivatali visszaéléssel gyanúsították meg, és házkutatást tartottak nála. Az ügy jelenleg is folyamatban van.
                </p>
                <blockquote style={{ margin: "16px 0 0", padding: "0 0 0 14px", borderLeft: `3px solid ${line}`, fontSize: 15, lineHeight: 1.7, color: sec, fontFamily: font, fontStyle: "italic" }}>
                  „Egy ideális rendszerben nekem nem kellene itt ülnöm. De mégis itt ülök, úgyhogy úgy tűnik, ez nem egy ideális rendszer."
                </blockquote>

                {/* Subtasks */}
                <div style={{ margin: "28px 0 0" }}>
                  <Subtasks tasks={tasks} onToggle={toggleTask} />
                </div>

                {/* Activity */}
                <div style={{ borderTop: `1px solid ${line}`, paddingTop: 20, marginTop: 28 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: ter, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: font }}>Activity</span>
                  <div>
                    {activity.map((item, idx) => {
                      if (item.type === "batch") return <Batch key={item.id} data={item} />;
                      const prev = activity[idx - 1];
                      const grouped = prev && (prev.type === "comment" || prev.type === "ai") && prev.user === item.user && item.type !== "ai";
                      return <Comment key={item.id} item={item} grouped={grouped} />;
                    })}
                  </div>
                </div>

                <div style={{ margin: "24px 0 40px" }}>
                  <CommentInput onSend={send} />
                </div>
              </div>
            ) : (
              <div style={{ padding: "80px 40px", textAlign: "center", color: ter, fontSize: 14, fontFamily: font }}>
                {view === "time" && "Time tracking entries and reports"}
                {view === "files" && "Attached files and documents"}
                {view === "email" && "Connected email threads"}
              </div>
            )}
          </div>
          {side && <Sidebar />}
        </div>
      </div>
    </div>
  );
}
