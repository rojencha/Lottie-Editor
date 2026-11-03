// Administration (role-gated): review queue, verticals & teams, roles, production-integration notes, dev data.
import { app, refreshDirectory, resetDemo, verticalName } from "../state.js";
import { h, icon, statusBadge, bannerEl, confirmDialog, modal, field, toast, ago, plural, clear } from "../ui/dom.js";
import { href, go } from "../ui/router.js";
import { check, ROLE_LABEL, ROLE_SUMMARY } from "../core/policy.js";
import { STATUS_LABEL } from "../core/policy.js";

export async function render(ctx, view) {
  const u = app.user, isAdmin = u.role === "admin";
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "large-title" }, "Administration"), h("p", { class: "lede" }, "Review submissions, manage verticals and teams, and see how access works."))));
  view.append(bannerEl("warn", "Simulated access control", "Roles here are enforced only in this browser so every role can be tried without a backend. Real authorization must be done by a server before this is used with company data. See “Production integration” below."), h("div", { style: { height: "8px" } }));

  /* ---- review queue ---- */
  const queue = h("div", {});
  view.append(h("h2", { class: "sec-title" }, "Review queue"), queue);
  async function drawQueue() {
    const all = await app.lib.listAssets(u), items = [];
    for (const a of all) for (const v of a.versions) if (v.status === "in_review" && check(u, "asset.approve", a).ok) items.push({ a, v });
    if (ctx.isStale()) return;
    queue.replaceChildren(items.length ? h("div", { class: "list" }, items.map(({ a, v }) => h("div", { class: "cell" },
      h("div", { class: "grow" }, h("a", { class: "t", href: href("/asset/" + a.id, { v: v.n }) }, `${a.name} · v${v.n}`), h("div", { class: "s" }, `${verticalName(a.vertical)} · submitted by ${v.authorName} ${ago(v.createdAt)}${v.report.counts.error ? ` · ${plural(v.report.counts.error, "validation error")}` : ""}`)),
      h("button", { class: "btn fill sm", type: "button", onclick: async () => {
        const prev = a.approvedVersion;
        if (!(await confirmDialog({ title: `Approve ${a.name} v${v.n}?`, message: prev != null ? `Version ${v.n} becomes the approved version. Version ${prev} is marked deprecated (superseded) and stays in history.` : `Version ${v.n} becomes the approved version.`, confirm: "Approve" }))) return;
        try { await app.lib.approve(u, a.id, v.n); toast("Approved"); drawQueue(); } catch (e) { toast(e.message, "error"); } } }, "Approve"),
      h("button", { class: "btn gray sm", type: "button", onclick: async () => {
        const why = h("input", { class: "input", maxLength: 200, placeholder: "Reason (optional)" });
        const m = modal({ title: "Return to draft", body: [field("Why is it being returned?", why)], buttons: [{ label: "Cancel" }, { label: "Return", kind: "fill", value: true }] });
        if (await m.result) { try { await app.lib.rejectReview(u, a.id, v.n, why.value); toast("Returned to draft"); drawQueue(); } catch (e) { toast(e.message, "error"); } } } }, "Return")))) : bannerEl("ok", "Nothing is waiting for review", "Submissions from your verticals will appear here."));
  }

  /* ---- verticals & teams ---- */
  const cfgBox = h("div", {}); view.append(h("h2", { class: "sec-title" }, "Verticals and teams"), cfgBox);
  let cfg = structuredClone(app.config);
  function drawConfig() {
    const err = h("div", { class: "err-text", role: "alert", style: { marginTop: "8px" } });
    const readOnly = !isAdmin;
    const rows = cfg.verticals.map((v, vi) => h("div", { class: "panel pad stack", style: { marginBottom: "12px" } },
      h("div", { class: "row" }, h("input", { class: "input grow", value: v.name, "aria-label": "Vertical name", disabled: readOnly, oninput: (e) => { v.name = e.target.value; } }),
        isAdmin ? h("button", { class: "btn plain red", type: "button", "aria-label": "Remove vertical " + v.name, onclick: () => { cfg.verticals.splice(vi, 1); drawConfig(); } }, icon("trash")) : null),
      h("div", { class: "stack", style: { gap: "8px", paddingLeft: "14px" } }, v.teams.map((t, ti) => h("div", { class: "row" },
        h("input", { class: "input grow", value: t.name, "aria-label": `Team name in ${v.name}`, disabled: readOnly, oninput: (e) => { t.name = e.target.value; } }),
        isAdmin ? h("button", { class: "btn plain red", type: "button", "aria-label": "Remove team " + t.name, onclick: () => { v.teams.splice(ti, 1); drawConfig(); } }, icon("trash")) : null)),
        isAdmin ? h("div", {}, h("button", { class: "btn tint sm", type: "button", onclick: () => { v.teams.push({ name: "" }); drawConfig(); } }, icon("plus"), "Add team")) : null)));
    cfgBox.replaceChildren(...rows,
      isAdmin ? h("div", { class: "row" }, h("button", { class: "btn tint", type: "button", onclick: () => { cfg.verticals.push({ name: "", teams: [] }); drawConfig(); } }, icon("plus"), "Add vertical"),
        h("button", { class: "btn fill", type: "button", onclick: async () => { err.textContent = ""; try { await app.lib.saveConfig(u, cfg); await refreshDirectory(); cfg = structuredClone(app.config); toast("Verticals and teams saved"); drawConfig(); } catch (e) { err.textContent = e.message; } } }, "Save changes"), h("button", { class: "btn gray", type: "button", onclick: () => { cfg = structuredClone(app.config); drawConfig(); } }, "Discard edits"))
        : h("p", { class: "help" }, "Only Administrators can change verticals and teams."), err,
      h("p", { class: "help" }, "Verticals and teams are configuration, not code. Renaming is safe; a vertical or team that still has assets or collections can’t be removed."));
  }

  /* ---- roles ---- */
  const users = app.users;
  view.append(h("h2", { class: "sec-title" }, "Roles and access"),
    h("div", { class: "list" }, ROLE_SUMMARY.map((r) => h("div", { class: "cell" }, h("div", { class: "grow" }, h("div", { class: "t" }, ROLE_LABEL[r.role]), h("div", { class: "s" }, r.can))))),
    h("p", { class: "help", style: { margin: "8px 4px 0" } }, "Roles apply within the verticals and teams a person belongs to. Visibility is Team, Vertical or Company-wide. Approvers cover every team of their verticals; Administrators cover everything."),
    h("h3", { style: { margin: "20px 0 8px", fontSize: "16px" } }, "Development users (simulated)"),
    h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("caption", { class: "sr-only" }, "Development users"), h("thead", {}, h("tr", {}, ["Name", "Role", "Verticals", "Teams"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, users.map((x) => h("tr", {}, h("td", {}, x.name), h("td", {}, ROLE_LABEL[x.role]), h("td", {}, x.role === "admin" ? "All" : x.verticals.map(verticalName).join(", ") || "—"), h("td", {}, x.role === "admin" ? "All" : x.teams.length ? x.teams.length + " team(s)" : "—")))))));

  /* ---- production integration ---- */
  view.append(h("h2", { class: "sec-title" }, "Production integration"),
    h("div", { class: "panel pad" }, h("p", { style: { margin: "0 0 8px" } }, "This build runs fully in the browser. To use it with company data, these pieces must be connected:"),
      h("ol", { style: { margin: 0, paddingLeft: "20px", lineHeight: 1.6 } },
        h("li", {}, h("b", {}, "Sign-in. "), "Replace the development user switcher (js/data/session.js) with the company identity provider. Role, verticals and teams must come from verified server-side claims."),
        h("li", {}, h("b", {}, "Authorization. "), "Re-implement js/core/policy.js on the server and check it on every request. Browser-side checks here only shape the interface and are not security."),
        h("li", {}, h("b", {}, "Library API and storage. "), "Implement the js/data/library.js interface as an API client over a database and object storage. Today it uses IndexedDB through js/data/store.js."),
        h("li", {}, h("b", {}, "File safety. "), "Validate and size-limit uploads on the server, and scan files before they’re shared."),
        h("li", {}, h("b", {}, "Audit trail. "), "Persist who approved, deprecated or changed what on the server. The history shown here is local."),
        h("li", {}, h("b", {}, "Search at scale. "), "Move search and filtering to the server once the library grows beyond what a browser should hold.")),
      h("p", { class: "help", style: { margin: "10px 0 0" } }, "See docs/HANDOFF.docx for the full checklist.")));

  /* ---- dev data ---- */
  if (isAdmin) view.append(h("h2", { class: "sec-title" }, "Development data"), h("div", { class: "panel pad stack" },
    h("p", { style: { margin: 0 } }, `Storage: ${app.lib.persistent ? "this browser’s IndexedDB" : "memory only (browser storage unavailable)"}. Demo verticals, users and assets are fictional.`),
    h("div", {}, h("button", { class: "btn gray red", type: "button", onclick: async () => {
      if (!(await confirmDialog({ title: "Reset demo data?", message: "This deletes everything in this browser’s development library, including drafts, and restores the sample data.", confirm: "Reset", danger: true }))) return;
      await resetDemo(); toast("Demo data restored"); go("/admin", {}, { replace: true }); } }, "Reset demo data"))));

  await Promise.all([drawQueue(), Promise.resolve(drawConfig())]);
}
