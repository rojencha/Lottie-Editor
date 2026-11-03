// Editor: colours, size, timing, style, layers. Non-destructive (edits are parameters applied to an untouched base),
// with undo/redo, reset, unsaved-change tracking and warnings for anything the tool can't edit.
import { app } from "../state.js";
import { h, icon, bannerEl, emptyState, modal, confirmDialog, toast, download, mime, field, paintRange, popMenu, plural, fmtDur } from "../ui/dom.js";
import { go, setGuard } from "../ui/router.js";
import { mountPlayer, createControls, backgroundControl } from "../ui/player.js";
import { readAnimationFile, validateLottie, safeName, stem, jsonToDotLottie, clone } from "../core/convert.js";
import { applyEdits, DEFAULTS, listColors, durationOf } from "../core/edit.js";
import { analyze } from "../core/validate.js";
import { enc } from "../core/zip.js";
import { check } from "../core/policy.js";
import { saveToLibraryDialog, saveBlockReason } from "./save-dialog.js";

const LAYER_TYPES = { 0: "Precomp", 1: "Solid", 2: "Image", 3: "Null", 4: "Shape", 5: "Text", 6: "Audio", 13: "Camera" };
const RANGES = { hue: ["Hue", -180, 180, ""], sat: ["Saturation", -100, 100, ""], light: ["Brightness", -100, 100, ""], scale: ["Scale", 10, 300, "%"], rot: ["Rotate", -180, 180, "°"], speed: ["Speed", 10, 400, "%"], stroke: ["Stroke width", 0, 400, "%"], opacity: ["Opacity", 0, 100, "%"] };
const TOGGLES = { invert: "Invert", gray: "Grayscale", flipH: "Flip horizontal", flipV: "Flip vertical", bgOn: "Background color" };

export async function render(ctx, view) {
  const u = app.user, kind = ctx.path.startsWith("/editor/asset/") ? "asset" : ctx.path.startsWith("/editor/draft/") ? "draft" : "file";
  const back = { file: () => go("/converter"), draft: () => go("/drafts"), asset: () => go("/asset/" + ctx.params.id) };
  const fail = (title, text) => view.append(h("div", { style: { padding: "40px 20px", maxWidth: "640px", margin: "0 auto" } }, emptyState({ icon: "warn", title, text, actions: [h("a", { class: "btn fill", href: "#/converter" }, "Converter"), h("a", { class: "btn gray", href: "#/drafts" }, "My drafts"), h("a", { class: "btn gray", href: "#/library" }, "Library")] })));

  /* ---- load the source for this editing session ---- */
  let name, bytes, format, params = null, source = null, assetInfo = null;
  try {
    if (kind === "file") { const p = app.pending; if (!p) return fail("Nothing to edit", "Open a file from the converter or pick one with “Open a file in the editor”. Editor sessions aren’t kept when the page is reloaded; save a draft to keep your work."); ({ name, bytes, source } = p); format = null; }
    else if (kind === "draft") { const d = await app.lib.getDraft(u, ctx.params.id); ({ name, bytes, params, source } = d); }
    else {
      const a = await app.lib.getAsset(u, ctx.params.id), r = check(u, "asset.addVersion", a);
      if (!r.ok) return fail("You can’t add versions to this asset", r.reason + " Use Duplicate and edit on the asset page to make your own copy.");
      const f = await app.lib.getFile(u, a.id, +ctx.query.v || undefined); bytes = f.bytes; name = a.name; format = f.format; assetInfo = { id: a.id, name: a.name, version: f.version.n, hasApproved: a.approvedVersion != null };
      source = a.source;
    }
  } catch (e) { return fail("Couldn’t open the editor", e.message); }
  let file;
  try { file = await readAnimationFile(bytes, { name: kind === "file" ? name : name + ".json", inline: true }); }
  catch (e) { return fail("This file can’t be edited", e.message); }
  format = file.format; const origFormat = format;
  const baseName = kind === "file" ? stem(name).replace(/-edited$/, "") : name;

  /* ---- state ---- */
  const ed = { anims: file.anims, idx: params?.__idx || 0, base: null, P: null, hist: [], hi: 0, rev: 0, player: null, tok: 0, savedKey: "", name: baseName };
  const key = () => ed.rev + "|" + JSON.stringify(ed.P);
  const dirty = () => key() !== ed.savedKey;
  const R = {}; // control refs
  const root = h("div", { class: "editor" }); view.append(root);
  const schedule = (() => { let t; return () => { clearTimeout(t); t = setTimeout(renderPreview, 70); }; })();

  /* ---- toolbar ---- */
  const undo = h("button", { class: "icon-btn", type: "button", "aria-label": "Undo", title: "Undo (⌘/Ctrl+Z)", onclick: () => ed.hi > 0 && restore(ed.hi - 1) }, icon("undo"));
  const redo = h("button", { class: "icon-btn", type: "button", "aria-label": "Redo", title: "Redo (⇧⌘/Ctrl+Shift+Z)", onclick: () => ed.hi < ed.hist.length - 1 && restore(ed.hi + 1) }, icon("redo"));
  const dirtyEl = h("span", { class: "clean-note", role: "status" });
  const animSel = h("select", { class: "pop", "aria-label": "Animation in this file", hidden: ed.anims.length < 2, onchange: (e) => switchAnim(+e.target.value) }, ed.anims.map(([id], i) => h("option", { value: i, selected: i === ed.idx }, id)));
  const exportName = (ext) => `${safeName(ed.name)}-edited.${ext}`;
  const exportBytes = async (fmt, pretty = false) => { const out = applyEdits(ed.base, ed.P); return fmt === "json" ? enc.encode(JSON.stringify(out, null, pretty ? 2 : 0)) : jsonToDotLottie([[safeName(ed.anims[ed.idx][0]), out]], { extract: true, version: "1" }); };
  const dl = (fmt, pretty) => async () => { download(await exportBytes(fmt, pretty), exportName(fmt === "json" ? "json" : "lottie"), mime(fmt)); toast("Downloaded " + exportName(fmt === "json" ? "json" : "lottie")); };

  const exportBtn = h("button", { class: "btn gray", type: "button" }, icon("share"), "Export");
  const exportMenu = popMenu(exportBtn, [
    { label: "Download .json", icon: "download", onClick: dl("json", false) }, { label: "Download .json (pretty)", icon: "download", onClick: dl("json", true) }, { label: "Download .lottie", icon: "download", onClick: dl("lottie") },
    { label: "Copy JSON", icon: "copy", onClick: async () => { try { await navigator.clipboard.writeText(JSON.stringify(applyEdits(ed.base, ed.P))); toast("Copied to clipboard"); } catch { toast("Couldn’t copy", "error"); } } },
    { sep: true }, { label: "Reset all edits", icon: "reset", danger: true, onClick: () => resetAll() }], { align: "right" });

  /* saving */
  const saveFmt = () => (origFormat === "lottie" ? "lottie" : "json");
  async function saveDraft() {
    const useBase = ed.rev > 0, rec = await app.lib.saveDraft(u, { id: ed.draftId, name: ed.name, format: useBase ? "json" : origFormat, bytes: useBase ? enc.encode(JSON.stringify(ed.base)) : bytes, params: { ...ed.P, __idx: ed.idx }, source });
    ed.draftId = rec.id; ed.savedKey = key(); updateDirty(); toast("Draft saved on this device");
  }
  async function saveToLibrary() {
    const asset = await saveToLibraryDialog({ name: exportName(saveFmt() === "lottie" ? "lottie" : "json"), bytes: await exportBytes(saveFmt()), source });
    if (asset) { ed.savedKey = key(); updateDirty(); toast("Saved to the library as a draft"); setGuard(null); go("/asset/" + asset.id); }
  }
  async function saveVersion() {
    const note = h("input", { class: "input", maxLength: 300, placeholder: "What did you change?" }), err = h("div", { class: "err-text", role: "alert" });
    const m = modal({ title: "Save as new version", subtitle: assetInfo.hasApproved ? "It’s added as a draft. The approved version stays unchanged until an Approver approves this one." : "It’s added to the asset as a draft version.", body: [field("Version note", note), err],
      buttons: [{ label: "Cancel" }, { label: "Save version", kind: "fill", close: false, onClick: async (api, btn) => { btn.disabled = true; try { await app.lib.addVersion(u, assetInfo.id, { bytes: await exportBytes(saveFmt()), note: note.value || `Edited in the editor (from v${assetInfo.version})` }); api.close(true); } catch (e) { btn.disabled = false; err.textContent = e.message; } } }] });
    note.focus();
    if (await m.result) { ed.savedKey = key(); setGuard(null); toast("Version saved as draft"); go("/asset/" + assetInfo.id); }
  }
  const fail2 = (e) => toast(e.message || "Couldn’t save", "error");
  let saveEl;
  if (kind === "asset") saveEl = h("button", { class: "btn fill", type: "button", onclick: () => saveVersion().catch(fail2) }, icon("check"), "Save version");
  else {
    const b = h("button", { class: "btn fill", type: "button" }, icon("check"), "Save", icon("chev")), why = saveBlockReason();
    saveEl = popMenu(b, [{ label: "Save draft (private, this device)", onClick: () => saveDraft().catch(fail2) }, { label: why ? "Save to library… (not available)" : "Save to library…", disabled: !!why, title: why, onClick: () => saveToLibrary().catch(fail2) }], { align: "right" });
  }
  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close editor", onclick: () => closeEditor() }, icon("xmark"));
  const titleEl = h("div", { class: "tb-title" }, h("div", { class: "t" }, kind === "asset" ? `${assetInfo.name} · v${assetInfo.version}` : name), dirtyEl, animSel);
  root.append(h("div", { class: "tb" }, closeBtn, titleEl, h("div", { class: "tb-actions" }, h("div", { class: "group" }, undo, redo), exportMenu, saveEl)));

  async function discardPrompt() {
    const canDraft = kind !== "asset";
    const m = modal({ title: "Discard unsaved changes?", body: h("p", { style: { margin: 0, color: "var(--l2)" } }, "You have edits that haven’t been saved. If you leave now they’ll be lost."),
      buttons: [{ label: "Keep editing", value: "stay" }, canDraft ? { label: "Save draft and leave", kind: "tint", close: false, onClick: async (api) => { try { await saveDraft(); api.close("save"); } catch (e) { fail2(e); } } } : null, { label: "Discard", kind: "fill", value: "discard", id: "discardBtn" }].filter(Boolean) });
    m.el.querySelector("#discardBtn").style.background = "var(--red)";
    const r = await m.result; return r === "discard" || r === "save";
  }
  async function closeEditor() { if (dirty() && !(await discardPrompt())) return; setGuard(null); back[kind](); }
  setGuard({ dirty, confirm: discardPrompt });
  const beforeUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  const keydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/TEXTAREA|INPUT/.test(document.activeElement.tagName)) { e.preventDefault(); (e.shiftKey ? redo : undo).click(); } else if (e.key === "Escape" && !document.querySelector("dialog[open]") && !document.querySelector(".menu:not([hidden])") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) closeEditor(); };
  document.addEventListener("keydown", keydown);
  ctx.onLeave(() => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("keydown", keydown); if (ed.player) ed.player.destroy(); setGuard(null); });

  /* ---- preview column ---- */
  const stage = h("div", { class: "stage" }), controls = createControls(), stats = h("span", { style: { marginLeft: "auto" } });
  const loop = h("input", { type: "checkbox", checked: true, "aria-label": "Loop", onchange: () => ed.player && ed.player.setLoop(loop.checked) });
  const prev = h("div", { class: "ed-prev" }, h("div", { class: "canvas" }, stage), controls.el, h("div", { class: "pv-opts" }, backgroundControl(stage), h("label", {}, "Loop ", loop), stats),
    h("p", { class: "help", style: { margin: "8px 0 0" } }, "Preview background is only for viewing. Use Style → Background to add a color to the animation itself."));

  /* ---- inspector ---- */
  const warnBox = h("div", { class: "ed-warn" });
  const tabNames = [["color", "Color"], ["size", "Size"], ["time", "Time"], ["style", "Style"], ["layers", "Layers"], ["json", "JSON"]];
  const panes = {}, tabs = h("div", { class: "seg full", role: "tablist", "aria-label": "Inspector" });
  const tabBtns = tabNames.map(([id, label], i) => h("button", { type: "button", role: "tab", id: "tab-" + id, "aria-controls": "pane-" + id, "aria-selected": String(i === 0), tabIndex: i === 0 ? 0 : -1, onclick: () => selectTab(id),
    onkeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = tabBtns[(i + (e.key === "ArrowRight" ? 1 : -1) + tabBtns.length) % tabBtns.length]; n.focus(); n.click(); } } }, label));
  tabs.append(...tabBtns);
  function selectTab(id) { tabBtns.forEach((b, i) => { const on = tabNames[i][0] === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }); for (const k in panes) panes[k].hidden = k !== id; }

  const sh = (t) => h("div", { class: "sh" }, t), sf = (t) => h("div", { class: "sf" }, t), list = (...c) => h("div", { class: "list" }, ...c);
  const slider = (k) => { const [label, min, max, suf] = RANGES[k]; const inp = h("input", { type: "range", min, max, value: 0, "aria-label": label }), val = h("span", { class: "v" }); R[k] = { inp, val, suf };
    inp.oninput = () => { ed.P[k] = +inp.value; val.textContent = inp.value + suf; paintRange(inp); schedule(); updateDirty(); }; inp.onchange = commit; return h("div", { class: "cell col" }, h("div", { class: "r" }, h("span", { class: "grow" }, label), val), inp); };
  const toggle = (k) => { const inp = h("input", { type: "checkbox", "aria-label": TOGGLES[k] }); R[k] = { inp }; inp.onchange = () => { ed.P[k] = inp.checked; schedule(); commit(); }; return h("label", { class: "cell" }, h("span", { class: "grow t" }, TOGGLES[k]), inp); };
  const num = (k, label, unit) => { const inp = h("input", { type: "number", class: "fld", min: k === "w" || k === "h" ? 1 : null, step: 1, inputmode: "numeric" }); R[k] = { inp }; inp.id = "n-" + k; return h("div", { class: "cell" }, h("label", { class: "grow t", for: inp.id }, label), inp, unit ? h("span", { class: "unit" }, unit) : null); };
  const lock = h("input", { type: "checkbox", checked: true, "aria-label": "Lock aspect ratio" });
  const fit = h("select", { class: "select", "aria-label": "Content fit", onchange: () => { ed.P.fit = fit.value; schedule(); commit(); } }, [["contain", "Fit inside canvas"], ["cover", "Fill canvas (crop)"], ["stretch", "Stretch"], ["keep", "Keep original size, centered"]].map(([v, t]) => h("option", { value: v }, t)));
  const bgColor = h("input", { type: "color", value: "#ffffff", "aria-label": "Background color", oninput: () => { ed.P.bg = bgColor.value; ed.P.bgOn = true; R.bgOn.inp.checked = true; schedule(); updateDirty(); }, onchange: commit });
  const swatches = h("div", { class: "list" }), layersBox = h("div", { class: "list" });
  const json = h("textarea", { class: "code", spellcheck: false, "aria-label": "Animation JSON" }), jsonMsg = h("span", { class: "muted" });

  panes.color = h("section", { id: "pane-color", role: "tabpanel", "aria-labelledby": "tab-color" }, sh("Palette"), swatches, sf("Swatches show the original colors. The sliders below adjust the whole animation on top."), sh("Adjust"), list(slider("hue"), slider("sat"), slider("light"), toggle("invert"), toggle("gray")));
  panes.size = h("section", { id: "pane-size", role: "tabpanel", "aria-labelledby": "tab-size", hidden: true }, sh("Canvas"), list(num("w", "Width", "px"), num("h", "Height", "px"), h("label", { class: "cell" }, h("span", { class: "grow t" }, "Lock aspect ratio"), lock)), sh("Content"), list(h("div", { class: "cell" }, fit)), sf("Fit scales inside the canvas, Fill crops to cover it, Keep original centers it."), sh("Transform"), list(slider("scale"), slider("rot"), toggle("flipH"), toggle("flipV")));
  panes.time = h("section", { id: "pane-time", role: "tabpanel", "aria-labelledby": "tab-time", hidden: true }, sh("Playback"), list(slider("speed")), sh("Trim"), list(num("start", "Start frame"), num("end", "End frame")), sf("Leave blank to keep the original range."));
  panes.style = h("section", { id: "pane-style", role: "tabpanel", "aria-labelledby": "tab-style", hidden: true }, sh("Appearance"), list(slider("stroke"), slider("opacity")), sh("Background"), list(toggle("bgOn"), h("div", { class: "cell" }, h("span", { class: "grow t" }, "Color"), bgColor)), sf("Adds a solid layer behind the animation, so it’s included when you export or save."));
  panes.layers = h("section", { id: "pane-layers", role: "tabpanel", "aria-labelledby": "tab-layers", hidden: true }, sh("Layers"), layersBox, sf("Top-level layers, topmost first. Hide or rename layers, or delete them. Deleting detaches layers parented to it. Undo brings it back."));
  panes.json = h("section", { id: "pane-json", role: "tabpanel", "aria-labelledby": "tab-json", hidden: true }, sh("Raw JSON"), list(h("div", { class: "cell" }, json)), sf("Edit by hand, then apply. Applying makes it the new starting point and clears slider edits."),
    h("div", { class: "r", style: { margin: "14px 16px 0", gap: "10px" } }, h("button", { class: "btn tint", type: "button", onclick: () => { json.value = JSON.stringify(applyEdits(ed.base, ed.P), null, 2); jsonMsg.textContent = ""; } }, "Load current"), h("button", { class: "btn fill", type: "button", onclick: applyJson }, "Apply"), jsonMsg));
  root.append(h("div", { class: "ed-body" }, prev, h("div", { class: "ed-side" }, warnBox, tabs, ...Object.values(panes))));

  /* ---- state sync ---- */
  const bindInputs = () => {
    for (const k of ["w", "h"]) R[k].inp.oninput = () => {
      const P = ed.P, v = R[k].inp.value === "" ? null : Math.max(1, parseInt(R[k].inp.value, 10) || 1); P[k] = v;
      if (lock.checked) { const o = k === "w" ? "h" : "w"; if (v == null) { P[o] = null; R[o].inp.value = ""; } else { const r = k === "w" ? ed.base.h / ed.base.w : ed.base.w / ed.base.h; P[o] = Math.max(1, Math.round(v * r)); R[o].inp.value = P[o]; } }
      schedule(); updateDirty();
    };
    for (const k of ["start", "end"]) R[k].inp.oninput = () => { ed.P[k] = R[k].inp.value === "" ? null : +R[k].inp.value; schedule(); updateDirty(); };
    for (const k of ["w", "h", "start", "end"]) R[k].inp.onchange = commit;
  };
  function syncUI() {
    const P = ed.P, b = ed.base;
    for (const k in RANGES) { R[k].inp.value = P[k]; R[k].val.textContent = P[k] + RANGES[k][3]; paintRange(R[k].inp); }
    for (const k in TOGGLES) R[k].inp.checked = P[k];
    fit.value = P.fit; bgColor.value = P.bg || "#ffffff";
    R.w.inp.placeholder = b.w; R.h.inp.placeholder = b.h; R.w.inp.value = P.w ?? ""; R.h.inp.value = P.h ?? ""; R.start.inp.placeholder = b.ip; R.end.inp.placeholder = b.op; R.start.inp.value = P.start ?? ""; R.end.inp.value = P.end ?? "";
  }
  const emptyCell = (box, msg) => box.append(h("div", { class: "cell" }, h("span", { class: "muted" }, msg)));
  function buildSwatches() {
    swatches.replaceChildren(); const cols = listColors(ed.base);
    if (!cols.length) return emptyCell(swatches, "No editable solid colors found. The animation may use images or expressions.");
    for (const [hex, count] of cols.slice(0, 80)) {
      const cur = ed.P.colors[hex] || hex, inp = h("input", { type: "color", value: cur, "aria-label": "Replace " + hex }), code = h("code", {}, cur), rs = h("button", { class: "btn plain", type: "button", hidden: cur === hex }, "Reset");
      inp.oninput = () => { if (inp.value === hex) delete ed.P.colors[hex]; else ed.P.colors[hex] = inp.value; code.textContent = inp.value; rs.hidden = inp.value === hex; schedule(); updateDirty(); }; inp.onchange = commit;
      rs.onclick = () => { delete ed.P.colors[hex]; inp.value = hex; code.textContent = hex; rs.hidden = true; schedule(); commit(); };
      swatches.append(h("div", { class: "cell sw" }, inp, code, h("span", { class: "c" }, count + "×"), rs));
    }
    if (cols.length > 80) emptyCell(swatches, `Showing the 80 most used of ${cols.length} colors. Use the sliders for the rest.`);
  }
  const setLayer = (i, patch) => { const e = Object.assign(ed.P.layers[i] || {}, patch); if (!e.deleted && !e.hidden && !e.name) delete ed.P.layers[i]; else ed.P.layers[i] = e; };
  function buildLayers() {
    layersBox.replaceChildren();
    ed.base.layers.forEach((L, i) => {
      const e = ed.P.layers[i] || {}, known = L.ty in LAYER_TYPES;
      const nm = h("input", { type: "text", class: "fld plain", "aria-label": "Layer name", value: e.name || L.nm || "", placeholder: "Layer " + (i + 1) });
      const vis = h("input", { type: "checkbox", checked: !e.hidden, hidden: !!e.deleted, "aria-label": "Visible", title: "Visible" });
      const detail = `Frames ${Math.round(L.ip ?? 0)}–${Math.round(L.op ?? 0)}${L.parent != null ? " · has parent" : ""}${known ? "" : " · type not recognized, kept as-is"}`;
      const bt = h("button", { class: "btn plain" + (e.deleted ? "" : " red"), type: "button", "aria-label": e.deleted ? "Restore layer" : "Delete layer" }, e.deleted ? "Restore" : icon("trash"));
      vis.onchange = () => { setLayer(i, { hidden: !vis.checked }); schedule(); commit(); };
      nm.oninput = () => { setLayer(i, { name: nm.value.trim() && nm.value !== L.nm ? nm.value.trim() : "" }); schedule(); updateDirty(); }; nm.onchange = commit;
      bt.onclick = () => { setLayer(i, { deleted: !e.deleted }); buildLayers(); schedule(); commit(); };
      layersBox.append(h("div", { class: "cell ly" + (e.deleted ? " del" : "") }, h("span", { class: "ty" }, LAYER_TYPES[L.ty] || "Other"), h("div", { class: "grow" }, nm, h("div", { class: "s", style: { padding: "0" } }, detail)), vis, bt));
    });
    if (!ed.base.layers.length) emptyCell(layersBox, "No layers.");
  }
  function buildWarnings() {
    const rep = analyze(ed.base, { sizeBytes: bytes.length, missingAssets: file.missing }), items = rep.issues.filter((x) => x.level !== "info");
    warnBox.replaceChildren();
    if (ed.anims.length > 1) warnBox.append(bannerEl("warn", `This file contains ${ed.anims.length} animations`, `You’re editing “${ed.anims[ed.idx][0]}”. Saving or exporting keeps only this animation.`));
    for (const x of items.slice(0, 5)) warnBox.append(bannerEl("warn", x.title, x.detail));
    if (items.length > 5) warnBox.append(h("p", { class: "help", style: { margin: 0 } }, `…and ${plural(items.length - 5, "more warning")}. Nothing is removed from your file; unsupported parts are kept exactly as they are.`));
  }
  function buildAll() { syncUI(); buildSwatches(); buildLayers(); buildWarnings(); updateDirty(); }

  /* ---- history ---- */
  function updateDirty() { undo.disabled = ed.hi <= 0; redo.disabled = ed.hi >= ed.hist.length - 1; const d = dirty(); dirtyEl.className = d ? "dirty-dot" : "clean-note"; dirtyEl.textContent = d ? "Unsaved changes" : ed.draftId ? "Saved draft" : "No changes"; }
  function commit() { const cur = ed.hist[ed.hi], snap = JSON.stringify(ed.P); if (cur.base === ed.base && JSON.stringify(cur.P) === snap) { updateDirty(); return; } ed.hist = ed.hist.slice(0, ed.hi + 1); ed.hist.push({ base: ed.base, rev: ed.rev, P: JSON.parse(snap) }); if (ed.hist.length > 80) ed.hist.shift(); ed.hi = ed.hist.length - 1; updateDirty(); }
  function restore(i) { ed.hi = i; const s = ed.hist[i]; ed.base = s.base; ed.rev = s.rev; ed.P = clone(s.P); buildAll(); renderPreview(); }
  async function resetAll() {
    if (dirty() && !(await confirmDialog({ title: "Reset all edits?", message: "This clears every change you’ve made in this session. You can undo it right after.", confirm: "Reset", danger: true }))) return;
    ed.base = ed.anims[ed.idx][1]; ed.rev = 0; ed.P = DEFAULTS(); commit(); buildAll(); renderPreview(); toast("All edits reset");
  }
  function applyJson() {
    try { const o = JSON.parse(json.value); validateLottie(o, "JSON"); ed.base = o; ed.rev++; ed.P = DEFAULTS(); commit(); buildAll(); renderPreview(); jsonMsg.style.color = "var(--green-t)"; jsonMsg.textContent = "Applied"; }
    catch (err) { jsonMsg.style.color = "var(--red-t)"; jsonMsg.textContent = err.message; }
  }
  async function switchAnim(i) {
    if (dirty() && !(await confirmDialog({ title: "Switch animation?", message: "Edits to the current animation will be discarded.", confirm: "Switch", danger: true }))) { animSel.value = ed.idx; return; }
    ed.idx = i; ed.base = ed.anims[i][1]; ed.rev = 0; ed.P = DEFAULTS(); ed.hist = [{ base: ed.base, rev: 0, P: clone(ed.P) }]; ed.hi = 0; ed.savedKey = key(); buildAll(); renderPreview();
  }

  /* ---- live preview ---- */
  async function renderPreview() {
    const tok = ++ed.tok, out = applyEdits(ed.base, ed.P);
    stats.textContent = `${out.w}×${out.h} · ${+out.fr.toFixed(2)} fps · ${fmtDur(durationOf(out))} · ${plural(out.layers.length, "layer")}`;
    const prevP = ed.player, paused = prevP ? prevP.paused : false, frame = prevP ? prevP.frame : 0;
    try {
      const p = await mountPlayer(stage, out, { loop: loop.checked, startFrame: frame, paused });
      if (tok !== ed.tok) { p.destroy(); return; }
      stage.querySelectorAll(".stage-msg").forEach((x) => x.remove());
      if (prevP && prevP !== p) prevP.destroy();
      ed.player = p; controls.attach(p); stage.style.aspectRatio = `${out.w} / ${out.h}`;
    } catch (e) { if (tok === ed.tok) stage.replaceChildren(h("div", { class: "stage-msg" }, e.message === "player" ? "The live preview couldn’t load its player. Editing and exporting still work." : "The preview couldn’t be shown: " + e.message)); }
  }

  /* ---- go ---- */
  bindInputs();
  ed.base = ed.anims[ed.idx][1]; ed.rev = 0; ed.P = params ? { ...DEFAULTS(), ...params } : DEFAULTS(); delete ed.P.__idx;
  ed.hist = [{ base: ed.base, rev: 0, P: clone(ed.P) }]; ed.hi = 0; ed.savedKey = key(); if (kind === "draft") ed.draftId = ctx.params.id;
  buildAll(); renderPreview();
  closeBtn.focus({ preventScroll: true });
}
