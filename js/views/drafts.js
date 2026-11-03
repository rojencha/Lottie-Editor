// My drafts: private working copies (this device) and the user's own assets that are still in progress.
import { app, verticalName } from "../state.js";
import { h, icon, statusBadge, emptyState, bannerEl, confirmDialog, toast, fmtBytes, ago, plural } from "../ui/dom.js";
import { href } from "../ui/router.js";
import { STATUS_LABEL } from "../core/policy.js";

export async function render(ctx, view) {
  const u = app.user;
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "large-title" }, "My drafts"), h("p", { class: "lede" }, "Your private working copies and the assets you own that are still being prepared.")),
    h("div", { class: "actions" }, h("a", { class: "btn fill", href: "#/converter" }, icon("swap"), "Convert a file"))));
  const body = h("div", {}); view.append(body);
  const draw = async () => {
    const [drafts, mine] = await Promise.all([app.lib.listDrafts(u), app.lib.listAssets(u, { owner: u.id })]);
    if (ctx.isStale()) return;
    const inProgress = mine.filter((a) => a.status === "draft" || a.status === "in_review");
    body.replaceChildren(
      h("h2", { class: "sec-title" }, "Working copies"),
      drafts.length ? h("div", { class: "list" }, drafts.map((d) => h("div", { class: "cell" },
        h("div", { class: "tile " + (d.format === "lottie" ? "lottie" : "json") }, icon("braces")),
        h("div", { class: "grow" }, h("div", { class: "t" }, d.name), h("div", { class: "s" }, `Saved ${ago(d.updatedAt)} · ${fmtBytes(d.size)}${d.source ? " · from " + d.source.name : ""}`)),
        h("a", { class: "btn tint sm", href: href("/editor/draft/" + d.id) }, "Open"),
        h("button", { class: "btn plain red", type: "button", "aria-label": "Delete draft " + d.name, onclick: async () => {
          if (!(await confirmDialog({ title: `Delete “${d.name}”?`, message: "This working copy will be permanently removed from this device.", confirm: "Delete", danger: true }))) return;
          await app.lib.deleteDraft(u, d.id); toast("Draft deleted"); draw(); } }, icon("trash")))))
        : emptyState({ icon: "doc", title: "No saved drafts", text: "Open a file in the editor and choose Save → Save draft to keep your work here. Drafts are private to you.", actions: [h("a", { class: "btn fill", href: "#/converter" }, "Open converter")] }),
      h("p", { class: "help", style: { marginTop: "8px" } }, app.lib.persistent ? "Drafts are stored in this browser’s local database for the development build. They are private to your sign-in here but not backed up." : "Browser storage is unavailable, so drafts last only while this tab is open."),
      h("h2", { class: "sec-title" }, "Your assets in progress"),
      inProgress.length ? h("div", { class: "list" }, inProgress.map((a) => h("a", { class: "cell", href: href("/asset/" + a.id), style: { color: "inherit", textDecoration: "none" } },
        h("div", { class: "grow" }, h("div", { class: "t" }, a.name), h("div", { class: "s" }, `${verticalName(a.vertical)} · ${plural(a.versions.length, "version")} · updated ${ago(a.updatedAt)}`)), statusBadge(a.status, STATUS_LABEL[a.status]))))
        : bannerEl("info", "Nothing in progress", "Assets you save to the library start as drafts and appear here until they’re approved."));
  };
  try { await draw(); } catch (e) { body.append(bannerEl("error", "Couldn’t load your drafts", e.message)); }
}
