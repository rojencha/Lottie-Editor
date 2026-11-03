// "Save to library": the only path by which a file reaches the library. Always explicit, always with a disclosure.
import { app, teamsOf } from "../state.js";
import { h, modal, field, bannerEl, fmtBytes, plural } from "../ui/dom.js";
import { inspect, PolicyError, ValidationError } from "../data/library.js";
import { allowedVisibilities, inScope, visibleToText, VISIBILITY_LABEL, check } from "../core/policy.js";
import { stem } from "../core/convert.js";

export const saveBlockReason = () => app.user.role === "viewer" ? "Saving is unavailable for this account." : null;

const VIS_HELP = { company: "Everyone signed in", vertical: "Members of the vertical", team: "Members of the team (and the vertical’s Approvers)" };

/**
 * @param {{name:string, bytes:Uint8Array, source?:object, note?:string}} o
 * @returns {Promise<object|null>} the created asset, or null if cancelled
 */
export async function saveToLibraryDialog({ name, bytes, source = null, note = "" }) {
  const u = app.user, lib = app.lib;
  const why = saveBlockReason(); if (why) { await modal({ title: "Can’t save to the library", body: h("p", { style: { margin: 0 } }, why), buttons: [{ label: "OK", kind: "fill" }] }).result; return null; }
  let ins; try { ins = await inspect(bytes, name); } catch (e) { await modal({ title: "This file can’t be saved", body: bannerEl("error", "The file didn’t pass validation", e.message), buttons: [{ label: "OK", kind: "fill" }] }).result; return null; }
  const verticals = app.config.verticals.filter((v) => inScope(u, v.id));
  const collections = (await lib.listCollections(u)).filter((c) => check(u, "collection.manage", c).ok);

  const nameIn = h("input", { class: "input", value: stem(name).slice(0, 120), maxLength: 120, required: true });
  const desc = h("textarea", { class: "textarea", maxLength: 1000, placeholder: "What it is and when to use it" });
  const tags = h("input", { class: "input", placeholder: "e.g. onboarding, success" });
  const vSel = h("select", { class: "select" }, verticals.map((v) => h("option", { value: v.id }, v.name)));
  const tSel = h("select", { class: "select" });
  const visSel = h("select", { class: "select" });
  const noteIn = h("input", { class: "input", value: note, maxLength: 300, placeholder: "Optional note for the version history" });
  const colBox = h("div", { class: "checks" }, collections.map((c) => h("label", {}, h("input", { type: "checkbox", value: c.id }), c.name)));
  const who = h("span", {}), err = h("div", { class: "err-text", role: "alert" });

  const fillTeams = () => {
    const ts = teamsOf(vSel.value).filter((t) => inScope(u, vSel.value, t.id));
    tSel.replaceChildren(h("option", { value: "" }, "No specific team"), ...ts.map((t) => h("option", { value: t.id, selected: u.teams.includes(t.id) }, t.name)));
    if (!tSel.value && ts[0] && u.teams.includes(ts[0].id)) tSel.value = ts[0].id;
    fillVis();
  };
  const fillVis = () => {
    const prev = visSel.value, opts = allowedVisibilities(u, vSel.value, tSel.value || null);
    visSel.replaceChildren(...opts.map((v) => h("option", { value: v }, `${VISIBILITY_LABEL[v]} — ${VIS_HELP[v]}`)));
    visSel.value = opts.includes(prev) ? prev : opts[0] || ""; showWho();
  };
  const showWho = () => { who.textContent = visSel.value ? visibleToText(visSel.value, vSel.selectedOptions[0]?.textContent, tSel.selectedOptions[0]?.textContent || null) : "no one (choose a vertical you belong to)"; };
  vSel.onchange = fillTeams; tSel.onchange = fillVis; visSel.onchange = showWho; fillTeams();

  const img = ins.info.images, c = ins.report.counts;
  const disclosure = h("div", { class: "disclose", role: "note" },
    h("b", {}, "What happens when you save"),
    h("ul", {},
      h("li", {}, `This file (${fmtBytes(bytes.length)}, .${ins.format === "lottie" ? "lottie" : "json"}${img.embedded ? `, ${plural(img.embedded, "embedded image")}` : ""}) and the details above are stored in this browser’s library.`),
      h("li", {}, "Intended audience: ", who, "."),
      h("li", {}, app.lib.persistent ? "This MVP keeps the library in this browser’s local database. Other devices and people cannot access it yet." : "Browser storage is unavailable, so this development library lasts only while this tab is open."),
      h("li", {}, "Nothing is uploaded to a server. It’s saved as a draft; you can approve it when it’s ready.")),
    h("p", { style: { margin: "8px 0 0" } }, c.error || c.warning ? `Validation found ${plural(c.error, "error")} and ${plural(c.warning, "warning")}. You can review them on the asset page.` : "No validation errors or warnings were found."));

  const m = modal({
    title: "Save to library", subtitle: "Add this animation to your library on this device.", wide: true,
    body: [field("Name", nameIn), field("Description", desc), field("Tags", tags, "Separate with commas."),
      h("div", { class: "row", style: { alignItems: "start" } }, h("div", { class: "grow" }, field("Vertical", vSel)), h("div", { class: "grow" }, field("Team", tSel))),
      field("Intended audience", visSel, "This setting is organizational metadata; sharing is not enabled in this browser-only version."), collections.length ? h("div", { class: "field" }, h("div", { class: "lbl" }, "Groups"), colBox) : null, field("Version note", noteIn), disclosure, err],
    buttons: [{ label: "Cancel", value: null }, { label: "Save to library", kind: "fill", close: false, onClick: async (api, btn) => {
      err.textContent = ""; btn.disabled = true;
      try {
        const asset = await lib.createAsset(u, { name: nameIn.value, description: desc.value, tags: tags.value, vertical: vSel.value, team: tSel.value || null, visibility: visSel.value, collectionIds: [...colBox.querySelectorAll("input:checked")].map((i) => i.value), bytes, source, note: noteIn.value });
        api.close(asset);
      } catch (e) { btn.disabled = false; err.textContent = e instanceof PolicyError || e instanceof ValidationError ? e.message : "Couldn’t save: " + (e.message || "unknown error"); }
    } }],
  });
  nameIn.focus(); nameIn.select();
  return (await m.result) || null;
}
