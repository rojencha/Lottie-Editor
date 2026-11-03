// App entry: boot, shell (nav, search, dev sign-in) and routing. Views are loaded on demand.
import { app, boot, setUser, onUserChange } from "./state.js";
import { route, start, go, current, href } from "./ui/router.js";
import { h, icon, initials, debounce, emptyState, clear } from "./ui/dom.js";
import { can, ROLE_LABEL } from "./core/policy.js";

const view = document.getElementById("view");
const NAV = [
  { path: "/library", label: "Library", icon: "grid", match: (p) => p === "/library" || p.startsWith("/asset/") },
  { path: "/converter", label: "Converter", icon: "swap", match: (p) => p === "/converter" },
  { path: "/drafts", label: "My drafts", icon: "doc", match: (p) => p === "/drafts" },
  { path: "/admin", label: "Administration", icon: "gear", match: (p) => p === "/admin", gate: () => can(app.user, "admin.access") },
];

function renderNav(path) {
  const items = NAV.filter((n) => !n.gate || n.gate());
  const link = (n, cls) => h("a", { class: cls, href: href(n.path), "aria-current": n.match(path) ? "page" : null }, icon(n.icon), n.label);
  document.getElementById("sideNav").replaceChildren(...items.map((n) => h("li", {}, link(n, "navlink"))));
  document.getElementById("tabNav").replaceChildren(...items.map((n) => link(n, "")));
}

function renderUserbox() {
  const sel = h("select", { class: "pop", "aria-label": "Sign in as (development only)", onchange: (e) => setUser(e.target.value) },
    app.users.map((u) => h("option", { value: u.id, selected: u.id === app.user.id }, `${u.name} · ${ROLE_LABEL[u.role]}`)));
  document.getElementById("userbox").replaceChildren(h("span", { class: "avatar", "aria-hidden": "true" }, initials(app.user.name)), sel);
}

function showError(err) {
  console.error("view error:", err && err.message); // message only: never log animation contents
  clear(view).append(emptyState({ icon: "warn", title: "Something went wrong", text: "This page couldn’t be shown. Your data hasn’t been changed.", actions: [h("button", { class: "btn fill", onclick: () => location.reload() }, "Reload")] }));
}

const VIEWS = {
  library: () => import("./views/library.js"), asset: () => import("./views/asset.js"), converter: () => import("./views/converter.js"),
  editor: () => import("./views/editor.js"), drafts: () => import("./views/drafts.js"), admin: () => import("./views/admin.js"),
};
const def = (pattern, name, meta) => route(pattern, null, { name, ...meta });
def("/library", "library"); def("/asset/:id", "asset"); def("/converter", "converter"); def("/drafts", "drafts"); def("/admin", "admin");
def("/editor/file", "editor", { full: true }); def("/editor/draft/:id", "editor", { full: true }); def("/editor/asset/:id", "editor", { full: true });

async function render(ctx) {
  const name = ctx.meta.name;
  document.body.classList.toggle("editing", !!ctx.meta.full);
  renderNav(ctx.path);
  const search = document.getElementById("globalSearch"); if (document.activeElement !== search) search.value = name === "library" ? ctx.query.q || "" : "";
  clear(view);
  try {
    if (name === "admin" && !can(app.user, "admin.access")) { view.append(emptyState({ icon: "gear", title: "Administration isn’t available", text: "Administration is for Approvers and Administrators. Switch the development sign-in to try it.", actions: [h("a", { class: "btn fill", href: "#/library" }, "Back to library")] })); return; }
    const mod = await VIEWS[name]();
    if (ctx.isStale()) return;
    await mod.render(ctx, view);
    if (ctx.isStale()) return;
    const h1 = view.querySelector("h1"); document.title = (h1 ? h1.textContent + " · " : "") + "Lottie Library";
    if (h1 && !ctx.meta.full) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  } catch (err) { if (!ctx.isStale()) showError(err); }
}

(async function init() {
  try { await boot(); } catch (e) { console.error("boot failed:", e && e.message); view.append(emptyState({ icon: "warn", title: "Couldn’t start", text: "The library couldn’t be opened in this browser.", actions: [h("button", { class: "btn fill", onclick: () => location.reload() }, "Try again")] })); return; }
  renderUserbox();
  document.getElementById("devbar").hidden = false;
  if (!app.store.persistent) document.getElementById("devbar").append(h("span", {}, " Browser storage is unavailable, so changes last only until you close this tab."));
  const searchGo = debounce((q) => go("/library", { ...(current().path === "/library" ? current().query : {}), q: q.trim() || undefined }), 250);
  document.getElementById("globalSearch").addEventListener("input", (e) => searchGo(e.target.value));
  document.getElementById("searchForm").addEventListener("submit", (e) => { e.preventDefault(); searchGo.cancel(); go("/library", { q: document.getElementById("globalSearch").value.trim() || undefined }); });
  onUserChange(() => { renderUserbox(); go(current().path, current().query, { replace: true }); });
  start(render);
})();
