// Asset detail: preview, metadata, file info, validation report, version history, lifecycle and actions.
import { app, verticalName, teamName, teamsOf } from "../state.js";
import { h, icon, clear, statusBadge, emptyState, bannerEl, modal, field, confirmDialog, toast, download, mime, fmtBytes, fmtDate, fmtDateTime, fmtDur, ago, plural, popMenu, segmented } from "../ui/dom.js";
import { go, href } from "../ui/router.js";
import { mountPlayer, createControls, backgroundControl } from "../ui/player.js";
import { check, can, inScope, allowedVisibilities, visibleToText, STATUS_LABEL, VISIBILITY_LABEL, ROLE_LABEL } from "../core/policy.js";
import { currentVersion, PolicyError, NotFoundError, ValidationError } from "../data/library.js";
import { readAnimationFile } from "../core/convert.js";
import { LIMITS } from "../core/convert.js";
import { openSnippets } from "./snippets.js";
import { manageCollections, canManageAnyCollection } from "./collections-dialog.js";

const dd = (label, ...v) => [h("dt", {}, label), h("dd", {}, ...v)];

export async function render(ctx, view) {
  const u = app.user, id = ctx.params.id;
  let a;
  try { a = await app.lib.getAsset(u, id); }
  catch (e) {
    const denied = e instanceof PolicyError;
    view.append(h("h1", { class: "large-title", style: { marginBottom: "14px" } }, denied ? "No access" : "Asset not found"), emptyState({ icon: "folder", title: denied ? "You don’t have access to this asset" : "This asset no longer exists", text: denied ? e.message + " Switch the development sign-in to a user with access to try it." : "It may have been removed or the link may be wrong.", actions: [h("a", { class: "btn fill", href: "#/library" }, "Back to library")] }));
    return;
  }
  const ver = a.versions.find((x) => x.n === +ctx.query.v) || currentVersion(a);
  const reload = () => go("/asset/" + id, ctx.query.v ? { v: ctx.query.v } : {}, { replace: true });
  const fail = (e) => toast(e.message || "Something went wrong", "error");
  const gate = (action, extra = {}) => check(u, action, { ...a, ...extra });
  /** Button that stays focusable when not allowed and explains why, instead of silently doing nothing. */
  const permBtn = (label, action, onClick, { kind = "gray", ic, extra } = {}) => {
    const r = gate(action, extra);
    return h("button", { class: `btn ${kind} sm`.trim() + (r.ok ? "" : " disabled"), type: "button", "aria-disabled": r.ok ? null : "true", title: r.ok ? null : r.reason, onclick: () => (r.ok ? Promise.resolve(onClick()).catch(fail) : toast(r.reason, "error")) }, ic ? icon(ic) : null, label);
  };

  /* ---- header ---- */
  view.append(h("a", { class: "crumb", href: "#/library" }, icon("back"), "Library"));
  view.append(h("div", { class: "page-head" },
    h("div", {}, h("h1", { class: "large-title" }, a.name),
      h("div", { class: "row", style: { marginTop: "8px" } }, statusBadge(a.status, STATUS_LABEL[a.status]),
        h("span", { class: "muted" }, a.approvedVersion != null ? `Approved version: v${a.approvedVersion}` : "No approved version yet"), a.source ? h("span", { class: "muted" }, "· Duplicated from ", h("a", { href: href("/asset/" + a.source.assetId) }, a.source.name), ` v${a.source.version}`) : null))));
  if (a.deprecated) view.append(bannerEl("warn", "This asset is deprecated", "It stays here for reference and history. Prefer an approved alternative, or duplicate it to start a new asset."), h("div", { style: { height: "14px" } }));
  if (ver.n !== (a.approvedVersion ?? ver.n) || (a.approvedVersion == null && a.versions.length > 1)) {
    view.append(bannerEl("info", `You’re viewing version ${ver.n}`, a.approvedVersion != null ? `It’s ${STATUS_LABEL[ver.status].toLowerCase()}. The approved version is v${a.approvedVersion}.` : `It’s ${STATUS_LABEL[ver.status].toLowerCase()}. Nothing has been approved yet.`), h("div", { style: { height: "14px" } }));
  }

  /* ---- preview column ---- */
  const stage = h("div", { class: "stage" }), controls = createControls();
  const loop = h("input", { type: "checkbox", checked: true, "aria-label": "Loop" });
  const verSel = h("select", { class: "pop", "aria-label": "Version", onchange: (e) => go("/asset/" + id, { v: e.target.value }) }, [...a.versions].reverse().map((v) => h("option", { value: v.n, selected: v.n === ver.n }, `Version ${v.n}${v.n === a.approvedVersion ? " (approved)" : ""}`)));
  const preview = h("div", { class: "preview" }, h("div", { class: "canvas" }, stage), controls.el, h("div", { class: "pv-opts" }, verSel, backgroundControl(stage), h("label", {}, "Loop ", loop)));
  let player = null;
  ctx.onLeave(() => player && player.destroy());
  app.lib.getPreview(u, id, ver.n).then(async (data) => {
    if (ctx.isStale()) return;
    player = await mountPlayer(stage, data, { loop: true }); controls.attach(player); loop.onchange = () => player.setLoop(loop.checked);
  }).catch((e) => stage.replaceChildren(h("div", { class: "stage-msg" }, "The preview couldn’t be shown. ", e.message === "player" ? "The preview player didn’t load, but you can still download the file." : e.message)));

  /* ---- actions ---- */
  const dl = (format) => async () => { const f = await app.lib.getFile(u, id, ver.n, format); download(f.bytes, f.name, mime(f.format)); toast("Downloaded " + f.name); };
  const dlBtn = h("button", { class: "btn gray sm", type: "button" }, icon("download"), "Download", icon("chev"));
  const dlMenu = popMenu(dlBtn, [
    { label: "Lottie JSON (.json)", onClick: () => dl("json")().catch(fail) }, { label: "dotLottie (.lottie)", onClick: () => dl("lottie")().catch(fail) },
  ]);
  const dlOk = gate("asset.download");
  const actions = h("div", { class: "actions" },
    permBtn("Duplicate and edit", "asset.duplicate", () => duplicate(), { kind: "fill", ic: "copy" }),
    dlOk.ok ? dlMenu : null,
    h("button", { class: "btn gray sm", type: "button", onclick: () => openSnippets(a, ver) }, icon("code"), "Implementation snippets"),
    permBtn("Edit details", "asset.editMetadata", () => editDetails(), { ic: "pencil" }),
    permBtn("Edit as new version", "asset.addVersion", () => go("/editor/asset/" + id, { v: ver.n }), { ic: "sliders" }));

  async function duplicate() {
    const nameIn = h("input", { class: "input", value: `Copy of ${a.name}`.slice(0, 120), maxLength: 120 }), err = h("div", { class: "err-text", role: "alert" });
    const m = modal({ title: "Duplicate and edit", subtitle: "Make your own working copy. The original is never changed.",
      body: [field("Name of the copy", nameIn), h("div", { class: "disclose" }, h("b", {}, "What this does"), h("ul", {},
        h("li", {}, `Starts from version ${ver.n} (${STATUS_LABEL[ver.status].toLowerCase()}).`), h("li", {}, "Creates a new Draft asset you own, linked back to this asset and version."),
        h("li", {}, "Keeps the description and tags. It keeps this asset’s vertical and visibility when you’re allowed to, otherwise it goes to your own team."), h("li", {}, "Then opens the editor, where saving adds versions to the copy only."))), err],
      buttons: [{ label: "Cancel" }, { label: "Create copy and edit", kind: "fill", close: false, onClick: async (api, btn) => { btn.disabled = true; try { const c = await app.lib.duplicate(u, id, { version: ver.n, name: nameIn.value }); api.close(c); } catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    nameIn.focus(); nameIn.select();
    const copy = await m.result; if (copy) { toast("Created “" + copy.name + "”"); go("/editor/asset/" + copy.id, { v: 1 }); }
  }
  async function editDetails() {
    const nameIn = h("input", { class: "input", value: a.name, maxLength: 120 }), desc = h("textarea", { class: "textarea", maxLength: 1000 }, a.description), tags = h("input", { class: "input", value: a.tags.join(", ") }), err = h("div", { class: "err-text", role: "alert" });
    const m = modal({ title: "Edit details", subtitle: "Changes the name, description and tags only. The animation isn’t touched. To change the animation itself, use Duplicate and edit.", body: [field("Name", nameIn), field("Description", desc), field("Tags", tags, "Separate with commas."), err],
      buttons: [{ label: "Cancel" }, { label: "Save", kind: "fill", close: false, onClick: async (api, btn) => { btn.disabled = true; try { await app.lib.updateMetadata(u, id, { name: nameIn.value, description: desc.value, tags: tags.value }); api.close(true); } catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    nameIn.focus(); if (await m.result) { toast("Details saved"); reload(); }
  }
  async function editScope() {
    const verts = app.config.verticals.filter((v) => inScope(u, v.id));
    const vSel = h("select", { class: "select" }, verts.map((v) => h("option", { value: v.id, selected: v.id === a.vertical }, v.name))), tSel = h("select", { class: "select" }), visSel = h("select", { class: "select" }), who = h("span"), err = h("div", { class: "err-text", role: "alert" });
    const fillT = () => { tSel.replaceChildren(h("option", { value: "" }, "No specific team"), ...teamsOf(vSel.value).map((t) => h("option", { value: t.id, selected: t.id === a.team }, t.name))); fillV(); };
    const fillV = () => { const o = allowedVisibilities(u, vSel.value, tSel.value || null); visSel.replaceChildren(...o.map((v) => h("option", { value: v, selected: v === a.visibility }, VISIBILITY_LABEL[v]))); showW(); };
    const showW = () => { who.textContent = visSel.value ? visibleToText(visSel.value, vSel.selectedOptions[0]?.textContent, tSel.selectedOptions[0]?.textContent) : "no one"; };
    vSel.onchange = fillT; tSel.onchange = fillV; visSel.onchange = showW; fillT();
    const m = modal({ title: "Visibility and ownership scope", body: [field("Vertical", vSel), field("Team", tSel), field("Who can see it", visSel), h("div", { class: "disclose" }, "Visible to ", who, "."), err],
      buttons: [{ label: "Cancel" }, { label: "Save", kind: "fill", close: false, onClick: async (api, btn) => { btn.disabled = true; try { await app.lib.updateScope(u, id, { vertical: vSel.value, team: tSel.value || null, visibility: visSel.value }); api.close(true); } catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    if (await m.result) { toast("Visibility updated"); reload(); }
  }
  async function editCollections() {
    const cols = (await app.lib.listCollections(u)).filter((c) => check(u, "collection.manage", c).ok);
    const box = h("div", { class: "checks" }, cols.map((c) => h("label", {}, h("input", { type: "checkbox", value: c.id, checked: a.collectionIds.includes(c.id) }), c.name)));
    const m = modal({ title: "Collections", subtitle: "Choose the collections this asset belongs to.", body: cols.length ? box : h("p", { class: "muted" }, "There are no collections you can manage yet."), buttons: [{ label: "Cancel" }, { label: "Save", kind: "fill", value: true }] });
    if (await m.result) { const keep = a.collectionIds.filter((c) => !cols.some((x) => x.id === c)); await app.lib.setAssetCollections(u, id, [...keep, ...[...box.querySelectorAll("input:checked")].map((i) => i.value)]); toast("Collections updated"); reload(); }
  }
  async function uploadVersion() {
    const file = h("input", { type: "file", accept: ".json,.lottie,application/json", class: "input" }), note = h("input", { class: "input", maxLength: 300, placeholder: "What changed?" }), err = h("div", { class: "err-text", role: "alert" });
    const m = modal({ title: "Upload a new version", subtitle: a.approvedVersion != null ? `It’s added as a draft. Version ${a.approvedVersion} stays approved until an Approver approves the new one.` : "It’s added as a draft version.", body: [field("File (.json or .lottie)", file), field("Version note", note), err],
      buttons: [{ label: "Cancel" }, { label: "Add version", kind: "fill", close: false, onClick: async (api, btn) => {
        const f = file.files[0]; if (!f) { err.textContent = "Choose a file first."; return false; }
        if (f.size > LIMITS.maxBytes) { err.textContent = `That file is larger than ${LIMITS.maxBytes / 1048576} MB.`; return false; }
        btn.disabled = true; try { await app.lib.addVersion(u, id, { bytes: new Uint8Array(await f.arrayBuffer()), note: note.value }); api.close(true); } catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    if (await m.result) { toast("Version added as draft"); go("/asset/" + id, {}, { replace: true }); }
  }
  const lifecycle = async (verb, n) => { await app.lib[verb](u, id, n); reload(); };
  async function approve(n) {
    const prev = a.approvedVersion;
    if (await confirmDialog({ title: `Approve version ${n}?`, message: prev != null ? `Version ${n} becomes the approved version. Version ${prev} is marked deprecated (superseded) but stays in the history.` : `Version ${n} becomes the approved version for this asset.`, confirm: "Approve" })) { await lifecycle("approve", n); toast(`Version ${n} approved`); }
  }
  async function deprecate() { if (await confirmDialog({ title: "Deprecate this asset?", message: "Deprecated assets stay in the library and history so existing uses can still find them, but they’re flagged as not recommended. It can’t be undone here.", confirm: "Deprecate", danger: true })) { await app.lib.deprecate(u, id); toast("Asset deprecated"); reload(); } }

  /* ---- lifecycle panel ---- */
  const life = h("div", { class: "panel pad stack" }, h("dl", { class: "kv", style: { margin: 0 } },
    dd("Asset status", statusBadge(a.status, STATUS_LABEL[a.status])), dd("Approved version", a.approvedVersion != null ? `v${a.approvedVersion}` : "None yet"), dd(`Version ${ver.n}`, statusBadge(ver.status, STATUS_LABEL[ver.status]))),
    h("p", { class: "help", style: { margin: 0 } }, "New versions always start as drafts. Only an Approver can make a version the approved one, and earlier versions are kept."),
    h("div", { class: "actions" },
      ver.status === "draft" && !a.deprecated ? permBtn(`Submit v${ver.n} for review`, "asset.submit", () => lifecycle("submit", ver.n).then(() => toast("Submitted for review")), { kind: "tint", ic: "check" }) : null,
      ver.status === "in_review" ? permBtn(`Approve v${ver.n}`, "asset.approve", () => approve(ver.n), { kind: "fill", ic: "check" }) : null,
      ver.status === "in_review" ? permBtn("Return to draft", "asset.approve", async () => { await lifecycle("rejectReview", ver.n); toast("Returned to draft"); }) : null,
      !a.deprecated ? permBtn("Upload new version", "asset.addVersion", uploadVersion, { ic: "tray" }) : null,
      permBtn("Visibility…", "asset.editScope", editScope),
      canManageAnyCollection() ? h("button", { class: "btn gray sm", type: "button", onclick: () => editCollections().catch(fail) }, "Collections…") : null,
      !a.deprecated ? permBtn("Deprecate asset", "asset.deprecate", deprecate, { kind: "gray red" }) : null));

  /* ---- details + file info ---- */
  const cols = await app.lib.listCollections(u), colNames = a.collectionIds.map((c) => cols.find((x) => x.id === c)?.name).filter(Boolean);
  const details = h("dl", { class: "kv panel", style: { margin: 0 } },
    dd("Description", a.description || h("span", { class: "muted" }, "No description")), dd("Owner", a.ownerName), dd("Vertical", verticalName(a.vertical)), dd("Team", a.team ? teamName(a.team) : "—"),
    dd("Visible to", `${VISIBILITY_LABEL[a.visibility]} — ${visibleToText(a.visibility, verticalName(a.vertical), a.team ? teamName(a.team) : null)}`),
    dd("Tags", a.tags.length ? h("span", { class: "row", style: { gap: "6px" } }, a.tags.map((t) => h("a", { class: "tag", href: href("/library", { tag: t }) }, t))) : h("span", { class: "muted" }, "None")),
    dd("Collections", colNames.length ? colNames.join(", ") : h("span", { class: "muted" }, "None")), dd("Created", fmtDate(a.createdAt)), dd("Updated", ago(a.updatedAt)));
  const i = ver.info, im = i.images;
  const fileInfo = h("dl", { class: "kv panel", style: { margin: 0 } },
    dd("Format", ver.format === "lottie" ? "dotLottie (.lottie)" : "Lottie JSON (.json)"), dd("File size", fmtBytes(ver.size)), dd("Dimensions", `${i.w} × ${i.h} px`), dd("Frame rate", `${+i.fr.toFixed(2)} fps`),
    dd("Duration", `${fmtDur(i.duration)} (${Math.round(i.frames)} frames)`), dd("Layers", `${i.layers} top-level${i.totalLayers !== i.layers ? `, ${i.totalLayers} including precomps` : ""}`),
    dd("Animations in file", String(ver.animCount)), dd("Images", im.embedded + im.external + im.missing === 0 ? "None" : [im.embedded ? `${im.embedded} embedded` : null, im.external ? `${im.external} referenced by name` : null, im.missing ? `${im.missing} missing` : null].filter(Boolean).join(", ")));

  /* ---- validation report ---- */
  const rep = ver.report, c = rep.counts;
  const validation = h("div", { class: "panel pad" },
    h("div", { class: "row", style: { marginBottom: "6px" } }, c.error ? h("span", { class: "badge deprecated" }, plural(c.error, "error")) : null, c.warning ? h("span", { class: "badge in_review" }, plural(c.warning, "warning")) : null, c.info ? h("span", { class: "badge plain" }, plural(c.info, "note")) : null,
      !c.error && !c.warning ? h("span", { class: "badge approved" }, "No errors or warnings") : null, h("span", { class: "muted", style: { marginLeft: "auto", fontSize: "12px" } }, "Checked " + ago(rep.at))),
    rep.issues.length ? rep.issues.map((x) => h("div", { class: "issue " + x.level }, icon(x.level === "info" ? "info" : "warn", "dot"), h("div", {}, h("b", {}, x.title), h("p", {}, x.detail)))) : h("p", { class: "muted", style: { margin: "8px 0" } }, "None of the checks below found a problem."),
    h("details", { class: "disc" }, h("summary", {}, "What was and wasn’t checked"), h("p", { style: { margin: "6px 0 0" } }, "This report lists only the checks this tool ran. It does not confirm the animation will work on any particular platform, player or runtime version."),
      h("b", {}, "Checked"), h("ul", {}, rep.checked.map((t) => h("li", {}, t))), h("b", {}, "Not checked"), h("ul", {}, rep.notChecked.map((t) => h("li", {}, t)))));

  /* ---- versions ---- */
  const verRows = [...a.versions].reverse().map((v) => h("tr", { class: v.n === ver.n ? "cur" : "" },
    h("td", {}, h("b", {}, "v" + v.n), v.n === a.approvedVersion ? h("div", { class: "muted", style: { fontSize: "12px" } }, "Approved") : null), h("td", {}, statusBadge(v.status, STATUS_LABEL[v.status])),
    h("td", {}, v.format === "lottie" ? ".lottie" : ".json", h("div", { class: "muted", style: { fontSize: "12px" } }, fmtBytes(v.size))), h("td", {}, v.authorName, h("div", { class: "muted", style: { fontSize: "12px" } }, fmtDateTime(v.createdAt))), h("td", { class: "muted" }, v.note || "—"),
    h("td", {}, h("div", { class: "acts" }, v.n !== ver.n ? h("a", { class: "btn gray sm", href: href("/asset/" + id, { v: v.n }) }, "Preview") : null,
      dlOk.ok ? h("button", { class: "btn gray sm", type: "button", "aria-label": `Download version ${v.n}`, onclick: async () => { try { const f = await app.lib.getFile(u, id, v.n); download(f.bytes, f.name, mime(f.format)); } catch (e) { fail(e); } } }, icon("download")) : null))));
  const versions = h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("caption", { class: "sr-only" }, "Version history"), h("thead", {}, h("tr", {}, ["Version", "Status", "File", "Author", "Note", ""].map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, verRows)));
  const hist = [...a.history].reverse();
  const timeline = h("ol", { class: "timeline" }, hist.slice(0, 12).map((e) => h("li", {}, h("time", { datetime: e.at }, fmtDateTime(e.at)), h("b", {}, e.byName), " · ", e.detail || e.action)));

  view.append(h("div", { class: "detail" }, preview, h("div", { class: "stack" }, actions, life, h("h2", { class: "sec-title", style: { margin: "6px 0 -4px" } }, "Details"), details, h("h2", { class: "sec-title", style: { margin: "6px 0 -4px" } }, "File"), fileInfo)),
    h("h2", { class: "sec-title" }, `Validation report · version ${ver.n}`), validation,
    h("h2", { class: "sec-title" }, "Version history"), versions,
    h("h2", { class: "sec-title" }, "Activity"), h("div", { class: "panel pad" }, timeline, hist.length > 12 ? h("p", { class: "help" }, `Showing the latest 12 of ${hist.length} events.`) : null),
    h("p", { class: "help", style: { marginTop: "18px" } }, `Signed in as ${u.name} (${ROLE_LABEL[u.role]}), a simulated development sign-in. Buttons that look unavailable explain why when pressed.`));
}
