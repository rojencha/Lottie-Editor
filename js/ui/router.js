// Hash router with a leave-guard (used by the editor to protect unsaved changes).
const table = [];
let cleanup = null, guard = null, lastHash = "", skip = false, onRender = () => {}, seq = 0;

const compile = (p) => new RegExp("^" + p.replace(/:([a-z]+)/gi, "([^/]+)") + "$");
export function route(pattern, handler, meta = {}) { table.push({ re: compile(pattern), keys: [...pattern.matchAll(/:([a-z]+)/gi)].map((m) => m[1]), handler, meta }); }
export function parse(hash = location.hash) {
  const [p, q = ""] = hash.replace(/^#/, "").split("?");
  return { path: p || "/library", query: Object.fromEntries(new URLSearchParams(q)) };
}
export const href = (path, query) => "#" + path + (query && Object.keys(query).length ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v))).toString() : "");
export function go(path, query, { replace = false } = {}) { const h = href(path, query); if (replace) { history.replaceState(null, "", h); run(); } else if (location.hash === h) run(); else location.hash = h; }
/** guard = { dirty():boolean, confirm():Promise<boolean> } | null */
export function setGuard(g) { guard = g; }
export const current = () => parse();

async function run() {
  const hash = location.hash || "#/library";
  if (skip) { skip = false; return; }
  if (guard && guard.dirty() && hash !== lastHash) {
    skip = true; location.hash = lastHash; // stay put while asking
    if (await guard.confirm()) { guard = null; location.hash = hash; run(); }
    return;
  }
  lastHash = hash;
  const { path, query } = parse(hash), my = ++seq;
  for (const r of table) {
    const m = r.re.exec(path); if (!m) continue;
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    guard = null;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const leave = []; const ctx = { params, query, path, meta: r.meta, onLeave: (fn) => leave.push(fn), isStale: () => my !== seq };
    cleanup = () => leave.forEach((f) => f());
    onRender(ctx); return;
  }
  go("/library", null, { replace: true });
}
export function start(render) { onRender = render; window.addEventListener("hashchange", run); run(); }
