// Tiny DOM toolkit. Everything user-supplied goes in via textContent / properties, never innerHTML.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "for") el.htmlFor = v;
    else if (k in el && !k.includes("-")) { try { el[k] = v; } catch { el.setAttribute(k, v === true ? "" : v); } }
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids); return el;
}
function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); } }
export const clear = (el) => { el.replaceChildren(); return el; };
export function icon(name, cls = "") { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "i " + cls); s.setAttribute("aria-hidden", "true"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#i-" + name); s.append(u); return s; }

/* ---------- formatting ---------- */
export const fmtBytes = (n) => n == null ? "—" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : (n / 1048576).toFixed(1) + " MB";
const dtf = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const dtt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtDate = (iso) => dtf.format(new Date(iso));
export const fmtDateTime = (iso) => dtt.format(new Date(iso));
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago"; return fmtDate(iso);
}
export const fmtDur = (s) => (s < 10 ? s.toFixed(2) : s.toFixed(1)) + " s";
export const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
export const initials = (name) => name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
export const debounce = (fn, ms = 200) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

/* ---------- files ---------- */
export function download(data, name, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const mime = (format) => (format === "lottie" ? "application/zip" : "application/json");

/* ---------- toast ---------- */
export function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: "toast " + kind }, msg); box.append(t); setTimeout(() => t.remove(), kind === "error" ? 4500 : 2200);
}

/* ---------- modal dialog (native <dialog>: focus trap + Escape for free) ---------- */
export function modal({ title, subtitle, body, buttons = [], wide = false, onClose }) {
  const dlg = h("dialog", { class: "dlg" + (wide ? " wide" : ""), "aria-labelledby": "dlg-t" });
  const foot = h("footer", {});
  const api = { el: dlg, close: (v) => { api.value = v; dlg.close(); }, value: undefined };
  for (const b of buttons) {
    const btn = h("button", { class: "btn " + (b.kind || "gray"), type: "button", onclick: async () => { if (b.onClick) { const r = await b.onClick(api, btn); if (r === false) return; } if (b.close !== false) api.close(b.value); } }, b.label);
    if (b.id) btn.id = b.id; foot.append(btn); b.el = btn;
  }
  dlg.append(h("header", {}, h("h2", { id: "dlg-t" }, title), subtitle ? h("p", {}, subtitle) : null), h("div", { class: "dbody" }, body), foot);
  api.result = new Promise((res) => dlg.addEventListener("close", () => { dlg.remove(); onClose && onClose(); res(api.value); }));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) api.close(undefined); });
  document.body.append(dlg); dlg.showModal(); return api;
}
export async function confirmDialog({ title, message, confirm = "Continue", cancel = "Cancel", danger = false }) {
  const m = modal({ title, body: h("p", { style: { margin: 0, color: "var(--l2)" } }, message), buttons: [{ label: cancel, value: false }, { label: confirm, kind: danger ? "fill red-fill" : "fill", value: true }] });
  if (danger) m.el.querySelector(".btn.fill").style.background = "var(--red)";
  return (await m.result) === true;
}
export const alertDialog = (title, message) => modal({ title, body: h("p", { style: { margin: 0, color: "var(--l2)" } }, message), buttons: [{ label: "OK", kind: "fill", value: true }] }).result;

/* ---------- field helpers ---------- */
let fid = 0;
export function field(label, control, help) { const id = "f" + ++fid; control.id = control.id || id; return h("div", { class: "field" }, h("label", { for: control.id }, label), control, help ? h("div", { class: "help" }, help) : null); }
export const statusBadge = (s, label) => h("span", { class: "badge " + s }, label);
export const bannerEl = (kind, title, text) => h("div", { class: "banner " + kind, role: kind === "error" ? "alert" : null }, icon(kind === "ok" ? "check" : kind === "info" ? "info" : "warn"), h("div", { class: "grow" }, title ? h("b", {}, title) : null, text));
export function emptyState({ icon: ic = "tray", title, text, actions = [] }) { return h("div", { class: "empty" }, h("div", { class: "ico" }, icon(ic)), h("h2", {}, title), h("p", {}, text), actions.length ? h("div", { class: "row" }, actions) : null); }
export const skeletonGrid = (n = 8) => h("div", { class: "grid", "aria-busy": "true", "aria-label": "Loading" }, Array.from({ length: n }, () => h("div", { class: "skel", style: { height: "250px" } })));

/** Segmented control (radiogroup). */
export function segmented(options, value, onChange, label) {
  const el = h("div", { class: "seg", role: "radiogroup", "aria-label": label || null });
  const btns = options.map(([v, text]) => h("button", { type: "button", role: "radio", "aria-checked": String(v === value), onclick: () => set(v, true), onkeydown: (e) => { const i = options.findIndex((o) => o[0] === cur); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const n = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length][0]; set(n, true); btns[options.findIndex((o) => o[0] === n)].focus(); } } }, text));
  let cur = value;
  function set(v, emit) { cur = v; btns.forEach((b, i) => { b.setAttribute("aria-checked", String(options[i][0] === v)); b.tabIndex = options[i][0] === v ? 0 : -1; }); if (emit) onChange(v); }
  el.append(...btns); set(value, false); el.set = (v) => set(v, false); return el;
}

/** Paint the filled part of a range input (CSS vars --a/--b). */
export function paintRange(r) { const mn = +r.min || 0, mx = +r.max || 100, v = +r.value, p = (x) => ((x - mn) / (mx - mn)) * 100; const zero = mn < 0 && mx > 0; r.style.setProperty("--a", (zero ? Math.min(p(0), p(v)) : 0) + "%"); r.style.setProperty("--b", (zero ? Math.max(p(0), p(v)) : p(v)) + "%"); }

/** Popover menu attached to a trigger button (HIG-style). items: [{label, icon, onClick, danger, disabled, title}] | {sep:true} */
export function popMenu(trigger, items, { align = "left" } = {}) {
  const menu = h("div", { class: "menu", role: "menu", hidden: true, style: align === "left" ? { left: "0", right: "auto", transformOrigin: "top left" } : {} },
    items.map((it) => it.sep ? h("hr") : h("button", { class: "mi" + (it.danger ? " red" : ""), type: "button", role: "menuitem", disabled: !!it.disabled, title: it.title || null, onclick: () => { close(); it.onClick && it.onClick(); } }, it.label, it.icon ? icon(it.icon) : null)));
  const wrap = h("div", { class: "menu-wrap" }, trigger, menu);
  trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  function close() { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", outside); }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu.hidden) return close();
    menu.hidden = false; trigger.setAttribute("aria-expanded", "true"); document.addEventListener("pointerdown", outside); menu.querySelector(".mi:not(:disabled)")?.focus();
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { e.stopPropagation(); close(); trigger.focus(); }
    const its = [...menu.querySelectorAll(".mi:not(:disabled)")], i = its.indexOf(document.activeElement);
    if (e.key === "ArrowDown" && its.length) { e.preventDefault(); its[(i + 1) % its.length].focus(); }
    if (e.key === "ArrowUp" && its.length) { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
  });
  wrap.close = close; return wrap;
}
