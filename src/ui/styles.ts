/**
 * Dark-first. Charcoal surfaces, muted purple accent. One stylesheet for every
 * tool so the toolbox reads as one product. System fonts: instant, and native
 * on whatever machine you happen to be sitting at.
 */
export const styles = `
:root {
  --bg: #121215;
  --panel: #191920;
  --panel-2: #202028;
  --panel-3: #272730;
  --border: #2b2b35;
  --border-strong: #3b3b47;
  --fg: #ebebf0;
  --fg-dim: #a6a6b4;
  --muted: #71717f;
  --accent: #7d5fc9;
  --accent-hi: #9179db;
  --accent-soft: rgba(125, 95, 201, 0.15);
  --ok: #56b088;
  --warn: #cf9a4e;
  --danger: #d46b6b;
  --r: 10px;
  --r-sm: 7px;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* ------------------------------------------------------------- topbar --- */

.topbar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(18, 18, 21, 0.86);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: 900px; margin: 0 auto; padding: 0 18px;
  height: 56px; display: flex; align-items: center; gap: 14px;
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15px; color: var(--fg); }
.brand:hover { text-decoration: none; }
.mark {
  width: 26px; height: 26px; flex: 0 0 auto;
  background: url("/logo.png") center / contain no-repeat;
}
.brand .where { color: var(--muted); font-weight: 450; }
.nav { margin-left: auto; display: flex; align-items: center; gap: 6px; }

/* --------------------------------------------------------------- page --- */

.page { max-width: 900px; margin: 0 auto; padding: 26px 18px 80px; }

.section-head {
  display: flex; align-items: center; gap: 10px;
  margin: 30px 0 12px;
}
.section-head:first-child { margin-top: 6px; }
.section-head h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 600; margin: 0;
}
.section-head .rule { flex: 1; height: 1px; background: var(--border); }

a { color: var(--accent-hi); text-decoration: none; }
a:hover { text-decoration: underline; }

.panel {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--r); padding: 16px;
}
.panel.tight { padding: 12px; }

/* -------------------------------------------------------------- forms --- */

/* 16px minimum: anything smaller makes iOS Safari zoom the page on focus. */
textarea, input[type=text], input[type=password], input[type=tel] {
  width: 100%; display: block;
  padding: 11px 13px;
  background: var(--panel-2); color: var(--fg);
  border: 1px solid var(--border); border-radius: var(--r-sm);
  font-family: var(--mono); font-size: 16px; line-height: 1.55;
  resize: none;          /* no drag handle; textareas grow to fit instead */
  overflow: hidden;
}
textarea::placeholder, input::placeholder { color: var(--muted); font-family: var(--sans); }
textarea:focus, input:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
input.sans { font-family: var(--sans); }

/* ------------------------------------------------------------ buttons --- */

button, .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 9px 15px; border-radius: var(--r-sm);
  border: 1px solid var(--border-strong); background: var(--panel-2);
  color: var(--fg); font-family: var(--sans); font-size: 14px;
  font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: background 0.13s, border-color 0.13s, transform 0.06s;
}
button:hover, .btn:hover { background: var(--panel-3); border-color: var(--muted); text-decoration: none; }
button:active, .btn:active { transform: translateY(1px); }
button.primary, .btn.primary {
  background: var(--accent); border-color: var(--accent); color: #fff;
}
button.primary:hover, .btn.primary:hover { background: var(--accent-hi); border-color: var(--accent-hi); }
button.ghost, .btn.ghost { background: transparent; border-color: transparent; color: var(--fg-dim); }
button.ghost:hover, .btn.ghost:hover { background: var(--panel-2); color: var(--fg); }
button.danger:hover { border-color: var(--danger); color: var(--danger); }
button.sm, .btn.sm { padding: 6px 11px; font-size: 13px; }
button:disabled { opacity: 0.45; cursor: default; }

/* --------------------------------------------------------------- bits --- */

.row { display: flex; gap: 9px; align-items: center; }
.row.wrap { flex-wrap: wrap; }
.grow { flex: 1 1 auto; min-width: 0; }
.muted { color: var(--muted); }
.dim { color: var(--fg-dim); }
.small { font-size: 13px; }
.stack > * + * { margin-top: 11px; }
.spread { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 5px;
  background: var(--panel-3); color: var(--fg-dim); border: 1px solid var(--border);
}
.chip.claude { background: var(--accent-soft); color: var(--accent-hi); border-color: transparent; }
.chip.admin  { background: rgba(86,176,136,0.14); color: var(--ok); border-color: transparent; }
.chip.guest  { background: rgba(207,154,78,0.14); color: var(--warn); border-color: transparent; }
.chip.auto   { background: rgba(125,95,201,0.20); color: var(--accent-hi); border-color: transparent; }

.autorun-banner { margin-bottom: 14px; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.autorun-banner .row { gap: 10px; }
.autorun-steps { margin: 12px 0 14px; padding-left: 20px; color: var(--fg-dim); line-height: 1.7; }
.autorun-steps strong { color: var(--fg); }

.pill-code {
  font-family: var(--mono); font-size: 14px; font-weight: 600; letter-spacing: 0.16em;
  padding: 5px 11px; border-radius: var(--r-sm);
  background: var(--panel-3); border: 1px solid var(--border); color: var(--fg);
}

.count {
  font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 20px;
  background: var(--accent); color: #fff; letter-spacing: 0.03em;
}

/* ------------------------------------------------------------ session --- */

.session-card {
  display: flex; align-items: center; gap: 13px;
  padding: 13px 15px; margin-bottom: 9px;
  border: 1px solid var(--border); border-radius: var(--r);
  background: var(--panel);
  transition: border-color 0.13s, background 0.13s;
}
.session-card:hover { border-color: var(--border-strong); background: var(--panel-2); }
.session-card .title { font-weight: 550; font-size: 15px; }
.session-card .title a { color: var(--fg); }
.session-card .meta { color: var(--muted); font-size: 13px; margin-top: 1px; }
.session-card.dim { opacity: 0.6; }
.session-card.dim:hover { opacity: 1; }

/* Status dot: a session is 'live' only while its agent is actively polling. */
.dot {
  flex: none; width: 9px; height: 9px; border-radius: 50%;
  background: var(--muted);
}
/* Steady, never blinking: a light that flashes reads as an alarm. */
.dot-live {
  background: var(--ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent);
}
.dot-arming { background: var(--warn); }
.dot-inactive { background: var(--border-strong); }
.dot-manual { background: var(--accent); }

/* Auto-run session page: a status line, then a read-only activity log. */
.statuscard {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; margin-bottom: 14px;
  border: 1px solid var(--border); border-radius: var(--r); background: var(--panel);
}
.statuscard.live { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
/* A finished run is good news, so it reads green rather than like a dropped agent. */
.statuscard.done {
  border-color: color-mix(in srgb, var(--ok) 55%, var(--border));
  background: color-mix(in srgb, var(--ok) 8%, var(--panel));
  animation: act-enter 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.statuscard.done .sc-title { color: var(--ok); }
.statuscard .sc-title { font-weight: 600; font-size: 15px; }
.statuscard .sc-sub { margin-top: 1px; }
.statuscard .inline, .statuscard form { margin: 0; }
.setup { margin-bottom: 16px; }

.feed-wrap { margin-top: 20px; }
.feed-head { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; margin-bottom: 8px; }
.act {
  border: 1px solid var(--border); border-radius: var(--r-sm);
  padding: 9px 12px; background: var(--panel);
}
.act-head { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
.act pre {
  margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.5;
  overflow: visible;            /* expanded means fully visible, never a nested scroller */
}
.act-cmd { color: var(--fg); }
.act-out { color: var(--fg-dim); }

/* Commands and output as proper code blocks. */
.codeblock {
  border: 1px solid var(--border); border-radius: var(--r-sm);
  background: #131318; overflow: hidden; margin-top: 8px;
  animation: cb-in 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.codeblock.out { background: #15151b; }
.cb-head {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; background: var(--panel-3); border-bottom: 1px solid var(--border);
}
.cb-lang {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted);
}
.cb-head button { padding: 3px 9px; font-size: 12px; }
.codeblock pre { padding: 11px 12px; }
@keyframes cb-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.rstat { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
  padding: 2px 8px; border-radius: 20px; text-transform: uppercase; }
.rstat.ok  { background: color-mix(in srgb, var(--ok) 20%, transparent); color: var(--ok); }
.rstat.err { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }
.rstat.warn { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
/* Every state is the same pill so a finishing task does not change shape. */
.rstat.run  { background: var(--accent-soft); color: var(--accent-hi); }
.rstat.idle { background: var(--panel-3); color: var(--muted); }

/* The status swap gets its own little flourish. */
@keyframes stat-flip {
  0%   { transform: scale(0.6) rotateX(90deg); opacity: 0; filter: blur(2px); }
  55%  { transform: scale(1.14) rotateX(0deg); opacity: 1; filter: blur(0); }
  100% { transform: scale(1); }
}
.rstat.flip { animation: stat-flip 0.52s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

/* Click anywhere on a step to open it. */
.act.expandable { cursor: pointer; }
.act.expandable:hover { border-color: var(--border-strong); background: var(--panel-2); }
.act.expandable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.caret-x {
  width: 8px; height: 8px; margin-left: 9px; flex: none;
  border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
  transform: rotate(45deg); transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s;
}
.act.open .caret-x { transform: rotate(-135deg); border-color: var(--accent-hi); }

/* Height animates via a grid track, which works with content of unknown size. */
.act-detail {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows 0.38s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.3s ease, margin-top 0.38s ease;
  opacity: 0; margin-top: 0;
}
.act-detail-inner { min-height: 0; overflow: hidden; }
.act.open .act-detail { grid-template-rows: 1fr; opacity: 1; margin-top: 9px; }

/* One step in the action log: what it did, why, result : details on demand. */
.act.step .act-intent { font-weight: 550; font-size: 14.5px; margin-bottom: 2px; }
.act.step .act-why { line-height: 1.4; }
.act-more { margin-top: 7px; }
.act-more summary { cursor: pointer; user-select: none; }
.act-more summary::marker { color: var(--muted); }
.act-more pre { margin-top: 6px; }
.riskflag {
  margin-left: 7px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 20px;
  background: color-mix(in srgb, var(--warn) 22%, transparent); color: var(--warn);
}

/* A new step opens into place: it expands from nothing and fades up, so the list
   below is pushed down smoothly instead of jumping. No colour wash over the whole
   card, which read as a blob covering the row before it settled. */
@keyframes act-enter {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes act-open {
  from { grid-template-rows: 0fr; margin-bottom: 0; }
  to   { grid-template-rows: 1fr; margin-bottom: 8px; }
}
/* The wrapper animates its height; the card inside fades and slides. */
.act-slot {
  display: grid; grid-template-rows: 1fr; margin-bottom: 8px;
}
.act-slot > .act { margin-bottom: 0; min-height: 0; }
.act-slot.entering { animation: act-open 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; overflow: hidden; }
.act-slot.entering > .act { animation: act-enter 0.42s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both; }

/* A quiet accent edge marks what is new, then fades out. */
.act { position: relative; transition: border-color 0.25s ease, background 0.25s ease; }
.act-slot.entering > .act::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  border-radius: var(--r-sm) 0 0 var(--r-sm);
  background: var(--accent-hi);
  animation: edge-fade 1.8s ease-out 0.3s forwards;
}
@keyframes edge-fade { from { opacity: 1; } to { opacity: 0; } }

/* Working indicator: a bar that travels, so it reads as "in progress" without
   claiming to know how far along it is. */
.working-bar {
  position: relative; height: 2px; border-radius: 2px; margin-top: 9px;
  background: color-mix(in srgb, var(--accent) 18%, transparent); overflow: hidden;
}
.working-bar::after {
  content: ''; position: absolute; inset: 0 auto 0 0; width: 38%; border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--accent-hi), transparent);
  animation: bar-sweep 2.6s ease-in-out infinite;
}
/* Same bar, urgent, while a command is actually executing. */
.working-bar.fast::after { animation-duration: 1.1s; }
.working-bar.fast { background: color-mix(in srgb, var(--accent) 26%, transparent); }
@keyframes bar-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}

/* The status card breathes very slightly while a command is actually running. */
.statuscard.busy { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }



/* Held for a decision: the one thing on the page that blocks progress. */
.approval {
  border: 1px solid var(--warn); border-radius: var(--r);
  background: color-mix(in srgb, var(--warn) 7%, var(--panel));
  padding: 14px 16px; margin-bottom: 14px;
}
.approval .ap-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
.approval .ap-intent { font-weight: 600; font-size: 15px; }
.approval .ap-why { margin-top: 2px; line-height: 1.45; }
.approval pre {
  margin: 10px 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.45;
  background: var(--panel-3); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 9px 11px; max-height: 220px; overflow: auto;
}
.approval .row { display: flex; align-items: center; gap: 9px; }
.approval.fresh { animation: act-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; }
form.inline { display: inline; margin: 0; }

/* ------------------------------------------------------------- thread --- */

.entry { margin-bottom: 16px; }
.entry-head { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
.entry-head .when { color: var(--muted); font-size: 12px; }
.entry-head .tools { margin-left: auto; display: flex; gap: 6px; }
.entry pre {
  margin: 0; padding: 13px 15px; overflow-x: auto;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--r);
  font-family: var(--mono); font-size: 13.5px; line-height: 1.6;
  white-space: pre; tab-size: 4; color: var(--fg);
}
.entry.command pre { border-left: 3px solid var(--accent); background: var(--panel-2); }
.entry.output pre { white-space: pre-wrap; word-break: break-word; color: var(--fg-dim); }
.entry.note pre {
  white-space: pre-wrap; font-family: var(--sans); font-size: 14.5px;
  background: transparent; border-style: dashed; color: var(--fg-dim);
}

/* -------------------------------------------------------------- misc --- */

/* ---------------------------------------------------------- run panel --- */

/* The whole point of the target-machine view: copy, run, paste. The command
   text itself is collapsed, because you do not need to read what you are
   about to paste into a terminal. */

.run { border: 1px solid var(--accent); border-radius: var(--r);
       background: var(--panel-2); padding: 16px; box-shadow: 0 0 0 4px var(--accent-soft); }
.run.idle { border-color: var(--border); box-shadow: none; background: var(--panel); }
.run-head { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; }
.run-head .what { font-weight: 600; font-size: 15px; }
.run-actions { display: flex; gap: 9px; align-items: center; }
.run-actions .btn-copy { flex: 1 1 auto; padding: 13px 18px; font-size: 15px; font-weight: 600; }

.disclosure { overflow: hidden; max-height: 0; opacity: 0;
              transition: max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease,
                          margin-top 0.3s cubic-bezier(0.4,0,0.2,1); margin-top: 0; }
.disclosure.open { max-height: 1400px; opacity: 1; margin-top: 13px; }

.caret { display: inline-block; width: 6px; height: 6px; flex: 0 0 auto;
         border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor;
         transform: rotate(45deg) translate(-1px,-1px); transition: transform 0.25s ease; }
.toggled .caret { transform: rotate(-135deg) translate(-2px,-2px); }

.waiting { display: flex; align-items: center; gap: 10px; color: var(--fg-dim); font-size: 14px; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: 0 0 auto;
         animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }

.history-toggle { width: 100%; justify-content: center; color: var(--fg-dim); }

/* pasted screenshots */
.shot { display: block; border: 1px solid var(--border); border-radius: var(--r);
        overflow: hidden; background: var(--panel); }
.shot:hover { border-color: var(--accent); text-decoration: none; }
.shot img { display: block; width: 100%; height: auto; max-height: 460px; object-fit: contain; }
.entry.file pre { display: none; }

body.dropping::after {
  content: 'Drop to upload'; position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(18,18,21,0.82); color: var(--fg); font-size: 17px; font-weight: 600;
  border: 2px dashed var(--accent); pointer-events: none;
}

/* -------------------------------------------------------------- drop --- */

/* Native select furniture sits flush against the edge and renders in the
   platform's own colours. Draw the chevron instead, and give it room. */
select {
  appearance: none; -webkit-appearance: none;
  padding: 10px 40px 10px 13px;
  background-color: var(--panel-2);
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.5 1.5 6 6l4.5-4.5' fill='none' stroke='%23a6a6b4' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 12px 8px;
  color: var(--fg);
  border: 1px solid var(--border); border-radius: var(--r-sm);
  font-family: var(--sans); font-size: 16px; line-height: 1.4;
  cursor: pointer;
  /* Makes the popup list render dark on Windows and macOS. */
  color-scheme: dark;
}
select:hover { border-color: var(--border-strong); }
select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

/* ------------------------------------------------------ custom listbox --- */

/*
 * A native select's popup is drawn by the operating system and cannot be
 * themed: option colours are mostly ignored and the list stays white with the
 * platform's own highlight. So the select is kept in the DOM for its value and
 * for form submission, hidden, and driven by this instead.
 */
.sel { position: relative; display: inline-block; }
.sel select {
  position: absolute; width: 1px; height: 1px;
  padding: 0; border: 0; min-width: 0;
  opacity: 0; pointer-events: none; margin: 0;
}
.sel-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 10px 13px;
  background: var(--panel-2); color: var(--fg);
  border: 1px solid var(--border); border-radius: var(--r-sm);
  font-family: var(--sans); font-size: 16px; font-weight: 400; line-height: 1.4;
  cursor: pointer; text-align: left; white-space: nowrap;
}
.sel-trigger:hover { background: var(--panel-2); border-color: var(--border-strong); }
.sel.open .sel-trigger,
.sel-trigger:focus-visible {
  outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
}
.sel-caret {
  width: 7px; height: 7px; flex: 0 0 auto;
  border-right: 1.7px solid var(--fg-dim); border-bottom: 1.7px solid var(--fg-dim);
  transform: rotate(45deg) translate(-2px, -2px);
  transition: transform 0.2s ease;
}
.sel.open .sel-caret { transform: rotate(-135deg) translate(-2px, -2px); }

.sel-list {
  position: absolute; z-index: 40; left: 0; top: calc(100% + 6px);
  min-width: 100%; margin: 0; padding: 5px; list-style: none;
  background: var(--panel-2);
  border: 1px solid var(--border-strong); border-radius: var(--r-sm);
  box-shadow: 0 18px 44px rgba(0,0,0,0.55);
  max-height: 264px; overflow-y: auto;
  opacity: 0; transform: translateY(-6px) scale(0.98); transform-origin: top;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.16,1,0.3,1);
}
.sel.up .sel-list { top: auto; bottom: calc(100% + 6px); transform-origin: bottom; }
.sel.open .sel-list { opacity: 1; transform: none; pointer-events: auto; }

.sel-opt {
  padding: 9px 12px; border-radius: 5px; cursor: pointer;
  font-size: 15px; color: var(--fg); white-space: nowrap;
}
.sel-opt.active { background: var(--panel-3); }
.sel-opt[aria-selected="true"] { background: var(--accent); color: #fff; }
.sel-opt[aria-selected="true"].active { background: var(--accent-hi); }

.dropzone {
  border: 2px dashed var(--border-strong); border-radius: var(--r);
  padding: 30px 18px; text-align: center; cursor: pointer;
  transition: border-color 0.15s, background 0.15s; background: var(--panel-2);
}
.dropzone:hover, .dropzone.over { border-color: var(--accent); background: var(--accent-soft); }
.dz-inner { display: flex; flex-direction: column; gap: 5px; }

.qrow { display: flex; align-items: center; gap: 11px; padding: 9px 12px;
        border: 1px solid var(--border); border-radius: var(--r-sm);
        background: var(--panel); margin-top: 8px; font-size: 14px; }
.bar { width: 90px; height: 5px; border-radius: 4px; background: var(--panel-3); overflow: hidden; flex: 0 0 auto; }
.bar > span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.15s linear; }

.meter { height: 5px; border-radius: 4px; background: var(--panel-3); overflow: hidden; }
.meter > span { display: block; height: 100%; background: var(--accent); }

.filerow {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--border); border-radius: var(--r); background: var(--panel);
  color: var(--fg);
}
.filerow:hover { border-color: var(--accent); text-decoration: none; background: var(--panel-2); }

.admin-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
.admin-item { border: 1px solid var(--border); border-radius: var(--r); background: var(--panel);
              padding: 10px; position: relative; }
.admin-item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: var(--r-sm);
                  display: block; background: var(--panel-2); }
.admin-item .caprow { margin-top: 8px; }
.admin-item .caprow input { font-size: 13px; padding: 7px 9px; font-family: var(--sans); }
.admin-item form.confirm-delete { margin-top: 6px; }
.vtag { position: absolute; top: 16px; left: 16px; font-size: 11px; font-weight: 700;
        padding: 3px 7px; border-radius: 5px; background: rgba(0,0,0,0.65); color: #fff; }

.empty {
  color: var(--muted); text-align: center; padding: 34px 16px; font-size: 14px;
  border: 1px dashed var(--border); border-radius: var(--r);
}

.flash { padding: 11px 15px; border-radius: var(--r-sm); margin-bottom: 16px;
         border: 1px solid var(--border); background: var(--panel); font-size: 14px; }
.flash.error { border-color: var(--danger); color: var(--danger); background: rgba(212,107,107,0.08); }

.toast { color: var(--ok); font-size: 13px; opacity: 0; transition: opacity 0.2s; }
.toast.show { opacity: 1; }

.centered { max-width: 380px; margin: 8vh auto 0; }
.centered .lead { text-align: center; margin-bottom: 22px; }
.centered .lead h1 { font-size: 21px; margin: 12px 0 4px; font-weight: 600; }
.centered .lead p { color: var(--muted); margin: 0; font-size: 14px; }
.mark-lg { width: 62px; height: 62px; margin: 0 auto 4px; }

.code-input {
  font-family: var(--mono) !important; font-size: 30px !important;
  letter-spacing: 0.42em; text-align: center; text-indent: 0.42em;
  padding: 14px 13px !important;
}

@media (max-width: 640px) {
  .page { padding: 20px 14px 64px; }
  .topbar-inner { padding: 0 14px; }
  .brand .where { display: none; }
  .session-card { flex-wrap: wrap; }
}


/* --- extra motion ------------------------------------------------------- */

/* Cards lift slightly under the cursor so the whole row feels live. */
.act.expandable { transition: border-color 0.25s ease, background 0.25s ease, transform 0.18s ease, box-shadow 0.25s ease; }
.act.expandable:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.28); }
.act.expandable:active { transform: translateY(0); }
.act.open { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }

/* The intent line nudges over when its step opens. */
.act .act-intent { transition: transform 0.3s cubic-bezier(0.22,1,0.36,1), color 0.25s ease; }
.act.open .act-intent { transform: translateX(3px); color: var(--fg); }

/* Buttons get a touch of spring. */
button, .btn { transition: background 0.15s, border-color 0.15s, transform 0.12s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s; }
button:hover, .btn:hover { transform: translateY(-1px); }
button:active, .btn:active { transform: translateY(1px) scale(0.99); }

/* Approval cards pulse gently: they are blocking the run. */
@keyframes ap-glow {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 30%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--warn) 6%, transparent); }
}
.approval { animation: act-enter 0.4s cubic-bezier(0.34,1.56,0.64,1) both, ap-glow 2.4s ease-in-out 0.4s infinite; }

/* The status card fades between states rather than snapping. */
.statuscard { transition: border-color 0.35s ease, background 0.35s ease; }
.sc-title, .sc-sub { transition: color 0.3s ease; }

/* Riskflag and status pills settle in. */
.riskflag { animation: cb-in 0.3s ease-out both; }
`;
