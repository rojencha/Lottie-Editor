// Collection management (Approvers within their verticals; Administrators everywhere).
import { app, verticalName, teamName, teamsOf } from "../state.js";
import { h, modal, field, confirmDialog, toast, icon, plural } from "../ui/dom.js";
import { check, inScope } from "../core/policy.js";

const TYPE_LABEL = { company: "Company-wide", vertical: "Vertical", team: "Team" };
export const scopeLabel = (c) => c.type === "company" ? "Company-wide" : c.type === "vertical" ? verticalName(c.verticalId) : `${verticalName(c.verticalId)} · ${teamName(c.teamId)}`;
export const canManageAnyCollection = () => app.user.role === "approver" || app.user.role === "admin";

export async function manageCollections(onChange) {
  const u = app.user, body = h("div", { class: "stack" });
  const draw = async () => {
    const [cols, assets] = await Promise.all([app.lib.listCollections(u), app.lib.listAssets(u)]);
    const rows = cols.map((c) => {
      const can = check(u, "collection.manage", c);
      const n = assets.filter((a) => a.collectionIds.includes(c.id)).length;
      return h("div", { class: "cell" }, h("div", { class: "grow" }, h("div", { class: "t" }, c.name), h("div", { class: "s" }, `${scopeLabel(c)} · ${plural(n, "asset")}${c.description ? " · " + c.description : ""}`)),
        h("button", { class: "btn plain", disabled: !can.ok, title: can.ok ? null : can.reason, onclick: () => editCollection(c) }, "Edit"),
        h("button", { class: "btn plain red", disabled: !can.ok, title: can.ok ? null : can.reason, "aria-label": "Delete " + c.name, onclick: async () => {
          if (await confirmDialog({ title: `Delete “${c.name}”?`, message: "Assets stay in the library; they’re just removed from this collection.", confirm: "Delete", danger: true })) { await app.lib.deleteCollection(u, c.id); toast("Collection deleted"); await draw(); onChange && onChange(); } } }, icon("trash")));
    });
    body.replaceChildren(rows.length ? h("div", { class: "list" }, rows) : h("p", { class: "muted" }, "There are no collections you can see yet."));
  };
  async function editCollection(existing) {
    const types = u.role === "admin" ? ["company", "vertical", "team"] : ["vertical", "team"];
    const name = h("input", { class: "input", value: existing?.name || "", maxLength: 80 }), desc = h("input", { class: "input", value: existing?.description || "", maxLength: 300 });
    const type = h("select", { class: "select" }, types.map((t) => h("option", { value: t, selected: existing?.type === t }, TYPE_LABEL[t])));
    const verts = app.config.verticals.filter((v) => inScope(u, v.id));
    const vert = h("select", { class: "select" }, verts.map((v) => h("option", { value: v.id, selected: existing?.verticalId === v.id }, v.name)));
    const team = h("select", { class: "select" }), err = h("div", { class: "err-text", role: "alert" });
    const sync = () => { team.replaceChildren(...teamsOf(vert.value).filter((t) => inScope(u, vert.value, t.id)).map((t) => h("option", { value: t.id, selected: existing?.teamId === t.id }, t.name))); vertF.hidden = type.value === "company"; teamF.hidden = type.value !== "team"; };
    const vertF = field("Vertical", vert), teamF = field("Team", team);
    type.onchange = sync; vert.onchange = sync; sync();
    const m = modal({ title: existing ? "Edit collection" : "New collection", body: [field("Name", name), field("Description", desc), field("Who it’s for", type), vertF, teamF, err],
      buttons: [{ label: "Cancel" }, { label: "Save", kind: "fill", close: false, onClick: async (api, btn) => {
        btn.disabled = true; err.textContent = "";
        try { await app.lib.saveCollection(u, { id: existing?.id, name: name.value, description: desc.value, type: type.value, verticalId: type.value === "company" ? null : vert.value, teamId: type.value === "team" ? team.value : null }); api.close(true); }
        catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    name.focus();
    if (await m.result) { toast("Collection saved"); await draw(); onChange && onChange(); }
  }
  await draw();
  modal({ title: "Collections", subtitle: "Collections group related assets. Approvers curate them within their verticals.", wide: true, body: [body, h("div", { class: "row" }, h("button", { class: "btn tint", type: "button", onclick: () => editCollection(null) }, icon("plus"), "New collection"))], buttons: [{ label: "Done", kind: "fill" }] });
}
