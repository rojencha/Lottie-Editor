// Converter: multi-file queue, per-file progress, before/after preview, summary, download-all, optional Save to library.
// Conversion and preview happen entirely in the browser. Nothing is sent anywhere unless the user presses "Save to library".
import { app } from "../state.js";
import { h, icon, clear, bannerEl, download, mime, fmtBytes, fmtDur, plural, toast, segmented, field } from "../ui/dom.js";
import { go } from "../ui/router.js";
import { mountPlayer, createControls, backgroundControl } from "../ui/player.js";
import { convertJob, readAnimationFile, ConvertError, LIMITS, stem } from "../core/convert.js";
import { writeZip, enc } from "../core/zip.js";
import { analyze } from "../core/validate.js";
import { saveToLibraryDialog, saveBlockReason } from "./save-dialog.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
let uidn = 0;
// Session state lives at module level so switching tabs and coming back keeps the queue (never persisted).
const S = { items: [], opts: { version: "1", inline: true, extract: true, pretty: false, bundle: false }, dest: "local" };

export async function render(ctx, view) {
  const list = h("div", { class: "queue", "aria-live": "polite" }), summary = h("div", { class: "row", style: { justifyContent: "space-between", marginTop: "18px" } });
  const input = h("input", { type: "file", multiple: true, accept: ".lottie,.json,application/json,application/zip", hidden: true, onchange: (e) => { addFiles([...e.target.files]); e.target.value = ""; } });
  const editInput = h("input", { type: "file", accept: ".lottie,.json,application/json", hidden: true, onchange: (e) => openInEditor(e.target.files[0]) });
  const pick = () => input.click();
  const drop = h("div", { class: "drop", tabindex: 0, role: "button", "aria-label": "Choose or drop Lottie files", onclick: pick, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } },
    h("div", { class: "ico" }, icon("tray")), h("h2", {}, "Drop Lottie files here"), h("p", {}, ".lottie and .json, several at once. Converted on this device."), h("button", { class: "btn fill", type: "button", tabindex: -1 }, "Choose files"));
  const over = (on) => drop.classList.toggle("over", on), hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const onDragOver = (e) => { if (hasFiles(e)) { e.preventDefault(); over(true); } }, onDragLeave = (e) => { if (!e.relatedTarget) over(false); };
  const onDrop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); over(false); addFiles([...e.dataTransfer.files]); };
  window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop);
  ctx.onLeave(() => { window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); S.items.forEach((i) => i.dispose && i.dispose()); });

  async function openInEditor(file) { if (!file) return; try { if (file.size > LIMITS.maxBytes) throw new ConvertError(`${file.name} is larger than ${LIMITS.maxBytes / 1048576} MB.`); app.pending = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), source: null }; go("/editor/file"); } catch (e) { toast(e.message, "error"); } }

  /* ---- options + destination ---- */
  const optCell = (key, title, sub) => h("label", { class: "cell" }, h("div", { class: "grow" }, h("div", { class: "t" }, title), h("div", { class: "s" }, sub)), h("input", { type: "checkbox", checked: S.opts[key], onchange: (e) => { S.opts[key] = e.target.checked; refresh(); } }));
  const destNote = h("p", { class: "help", style: { margin: "8px 2px 0" } });
  const dest = segmented([["local", "This device only"], ["library", "Library"]], S.dest, (v) => { S.dest = v; destInfo(); refresh(); }, "Where the result goes");
  const destInfo = () => { destNote.textContent = S.dest === "local" ? "Results stay in this browser tab. You can download them, and save any of them to the library later." : "You’ll be asked to confirm details and who can see the file before anything is added to the library. Nothing is uploaded automatically."; };
  destInfo();
  const side = h("div", { class: "stack" },
    h("div", {}, h("div", { class: "sh", style: { margin: "0 4px 7px" } }, "Destination"), h("div", { class: "dest" }, dest), destNote),
    h("div", {}, h("div", { class: "sh", style: { margin: "0 4px 7px" } }, "Options"), h("div", { class: "list" },
      h("div", { class: "cell" }, h("div", { class: "grow" }, h("div", { class: "t" }, "dotLottie version"), h("div", { class: "s" }, "v1 has the widest player support.")), segmented([["1", "v1"], ["2", "v2"]], S.opts.version, (v) => { S.opts.version = v; refresh(); }, "dotLottie version")),
      optCell("inline", "Embed images in JSON", "Makes .json files self-contained."), optCell("extract", "Extract images into .lottie", "Stores each image once for smaller files."),
      optCell("pretty", "Pretty-print JSON", "Readable indentation instead of minified."), optCell("bundle", "Bundle into one .lottie", "Combine several JSON files into one dotLottie.")),
      h("p", { class: "help", style: { margin: "8px 2px 0" } }, "Files are validated first. A .lottie holding several animations is split into one JSON per animation.")));

  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "large-title" }, "Converter"), h("p", { class: "lede" }, "Convert between dotLottie and Lottie JSON, preview the result, then download it or save it to the library.")),
    h("div", { class: "actions" }, h("button", { class: "btn tint", type: "button", onclick: () => editInput.click() }, icon("sliders"), "Open a file in the editor"), editInput)),
    h("div", { class: "convert-layout" }, h("div", {}, drop, input, summary, list), side));

  /* ---- queue ---- */
  const optsKey = () => JSON.stringify(S.opts);
  const stale = (i) => i.status === "done" && i.optsKey !== optsKey();
  function refresh() { const n = S.items.filter(stale).length; paintSummary(n); S.items.forEach((i) => i.paint && i.paint()); }
  function paintSummary(nStale = S.items.filter(stale).length) {
    const done = S.items.filter((i) => i.status === "done" && !i.bundledInto), busy = S.items.some((i) => i.status === "working" || i.status === "queued");
    summary.hidden = !S.items.length;
    summary.replaceChildren(h("span", { class: "muted", role: "status" }, `${plural(S.items.length, "file")} · ${done.length} converted${busy ? " · working…" : ""}`),
      h("span", { class: "row" },
        nStale ? h("button", { class: "btn tint sm", type: "button", onclick: () => { S.items.filter(stale).forEach((i) => { i.status = "queued"; }); refresh(); run(); } }, icon("reset"), `Settings changed · Convert again (${nStale})`) : null,
        done.length > 1 ? h("button", { class: "btn gray sm", type: "button", onclick: downloadAll }, icon("download"), "Download all (.zip)") : null,
        h("button", { class: "btn gray sm red", type: "button", onclick: () => { S.items.forEach((i) => i.dispose && i.dispose()); S.items.length = 0; list.replaceChildren(); paintSummary(); } }, "Clear")));
  }
  async function downloadAll() {
    const used = new Set(), entries = [];
    for (const i of S.items) for (const o of i.outputs || []) { let n = o.name, k = 1; while (used.has(n)) n = `${stem(o.name)}_${++k}.${o.format === "lottie" ? "lottie" : "json"}`; used.add(n); entries.push({ name: n, data: o.bytes, store: o.format === "lottie" }); }
    if (!entries.length) return;
    download(await writeZip(entries), `converted-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip"); toast(`Downloaded ${plural(entries.length, "file")}`);
  }

  function addFiles(files) {
    if (!files.length) return;
    for (const f of files) {
      const item = { id: ++uidn, file: f, name: f.name, size: f.size, status: "queued", pct: 0, stage: "Waiting", outputs: [], sel: 0, open: false, optsKey: null };
      item.node = h("div", { class: "qi" }); item.paint = () => paintItem(item); item.dispose = () => { item.cleanup && item.cleanup(); item.cleanup = null; };
      S.items.push(item); list.append(item.node); paintItem(item);
    }
    paintSummary(); run();
  }
  let running = false;
  async function run() {
    if (running) return; running = true;
    try {
      for (;;) {
        const item = S.items.find((i) => i.status === "queued"); if (!item) break;
        const group = S.opts.bundle ? S.items.filter((i) => i.status === "queued" && /\.json$/i.test(i.name)) : [];
        if (group.length > 1) await processGroup(group); else await process(item);
      }
    } finally { running = false; paintSummary(); }
  }
  const setStage = (i, stage, pct) => { i.stage = stage; i.pct = pct; i.status = "working"; paintItem(i); return tick(); };
  async function readBytes(i) {
    if (i.bytes) return i.bytes;
    if (i.size > LIMITS.maxBytes) throw new ConvertError(`${i.name} is ${fmtBytes(i.size)}, which is more than the ${LIMITS.maxBytes / 1048576} MB this tool handles.`);
    try { i.bytes = new Uint8Array(await i.file.arrayBuffer()); } catch { throw new ConvertError(`${i.name} couldn’t be read. It may have been moved or deleted.`); }
    return i.bytes;
  }
  async function process(i) {
    i.dispose(); i.error = null; i.outputs = []; i.open = false;
    try {
      await setStage(i, "Reading file", 12); const bytes = await readBytes(i);
      await setStage(i, "Converting", 45);
      const outs = await convertJob([{ name: i.name, bytes }], S.opts);
      await setStage(i, "Verifying result", 78);
      for (const o of outs) o.summary = await summarize(o);
      i.outputs = outs; i.sel = 0; i.optsKey = optsKey(); i.status = "done"; i.pct = 100; i.open = S.items.length === 1;
    } catch (e) { i.status = "error"; i.pct = 0; i.error = e instanceof ConvertError ? e.message : `${i.name} couldn’t be converted. ${e.message || ""}`.trim(); }
    paintItem(i); paintSummary(); await tick();
  }
  async function processGroup(group) {
    const lead = group[0];
    try {
      const inputs = []; for (const g of group) { g.dispose(); g.error = null; g.outputs = []; await setStage(g, "Reading file", 12); inputs.push({ name: g.name, bytes: await readBytes(g) }); }
      for (const g of group) await setStage(g, "Bundling", 50);
      const outs = await convertJob(inputs, S.opts); for (const o of outs) o.summary = await summarize(o);
      lead.outputs = outs; lead.sel = 0; lead.open = true;
      for (const g of group) { g.status = "done"; g.pct = 100; g.optsKey = optsKey(); g.bundledInto = g === lead ? null : lead.id; paintItem(g); }
    } catch (e) { for (const g of group) { g.status = "error"; g.pct = 0; g.error = e instanceof ConvertError ? e.message : `The bundle couldn’t be created. ${e.message || ""}`.trim(); paintItem(g); } }
    paintSummary(); await tick();
  }
  /** Re-open the result (proves it loads) and gather the numbers shown in the summary. */
  async function summarize(o) {
    const re = await readAnimationFile(o.bytes, { name: o.name, inline: true }), a = re.anims[0][1];
    const rep = analyze(a, { sizeBytes: o.bytes.length, missingAssets: [...new Set([...(o.missing || []), ...re.missing])] });
    return { info: rep.info, counts: rep.counts, issues: rep.issues, missing: [...new Set([...(o.missing || []), ...re.missing])], animCount: o.format === "lottie" ? re.anims.length : 1 };
  }

  /* ---- one queue item ---- */
  function paintItem(i) {
    i.dispose && i.dispose();
    const o = i.outputs[i.sel], state = i.status === "done" ? (stale(i) ? ["stale", "Settings changed"] : ["ok", "Done"]) : i.status === "error" ? ["err", "Failed"] : i.status === "working" ? ["work", i.stage] : ["work", "Waiting"];
    const tile = h("div", { class: "tile " + (i.status === "error" ? "err" : /\.lottie$/i.test(i.name) ? "lottie" : "json") }, icon(i.status === "error" ? "warn" : "braces"));
    const head = h("div", { class: "qi-head" }, tile, h("div", { class: "grow" }, h("div", { class: "t", title: i.name }, i.name),
      h("div", { class: "s" }, i.bundledInto ? "Included in the bundle above" : i.status === "done" && o ? `${fmtBytes(i.size)} → ${fmtBytes(o.bytes.length)}${i.outputs.length > 1 ? ` · ${i.outputs.length} files` : ""}` : fmtBytes(i.size) + (i.size > LIMITS.warnBytes ? " · Large file, this may take a moment" : ""))),
      h("span", { class: "qi-state " + state[0] }, i.status === "working" ? h("span", { class: "spin", "aria-hidden": "true" }) : null, state[1]),
      i.status === "done" && !i.bundledInto ? h("button", { class: "btn plain", type: "button", "aria-expanded": String(i.open), onclick: () => { i.open = !i.open; paintItem(i); } }, i.open ? "Hide" : "Preview") : null,
      i.status === "error" ? h("button", { class: "btn tint sm", type: "button", onclick: () => { i.status = "queued"; paintItem(i); paintSummary(); run(); } }, icon("reset"), "Retry") : null,
      h("button", { class: "icon-btn", type: "button", "aria-label": "Remove " + i.name, onclick: () => { i.dispose(); S.items.splice(S.items.indexOf(i), 1); i.node.remove(); paintSummary(); } }, icon("xmark")));
    const bar = i.status === "working" || i.status === "queued" ? h("div", { class: "bar", role: "progressbar", "aria-label": `${i.name}: ${i.stage}`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": i.pct }, h("i", { style: { width: i.pct + "%" } })) : null;
    i.node.replaceChildren(...[head, bar, i.status === "error" ? h("div", { class: "qi-body" }, bannerEl("error", "This file couldn’t be converted", i.error)) : null, i.status === "done" && i.open && !i.bundledInto ? body(i) : null].filter(Boolean));
  }

  function body(i) {
    const o = i.outputs[i.sel], s = o.summary, inf = s.info, wrap = h("div", { class: "qi-body" });
    const sel = i.outputs.length > 1 ? h("select", { class: "pop", "aria-label": "Output file", onchange: (e) => { i.sel = +e.target.value; paintItem(i); } }, i.outputs.map((x, k) => h("option", { value: k, selected: k === i.sel }, x.name))) : null;
    const beforeStage = h("div", { class: "stage sm" }), afterStage = h("div", { class: "stage sm" }), controls = createControls();
    const srcFmt = /\.lottie$/i.test(i.name) ? ".lottie" : ".json", outFmt = o.format === "lottie" ? ".lottie" : ".json";
    const players = []; i.cleanup = () => players.forEach((p) => p.destroy());
    (async () => {
      try {
        const src = await readAnimationFile(await readBytes(i), { name: i.name, inline: true }), after = await readAnimationFile(o.bytes, { name: o.name, inline: true });
        const b = await mountPlayer(beforeStage, src.anims[0][1]), a = await mountPlayer(afterStage, after.anims[0][1]); players.push(b, a);
        controls.attach({ get paused() { return a.paused; }, get frame() { return a.frame; }, get total() { return a.total; }, on: (ev, cb) => a.on(ev, cb),
          toggle() { if (a.paused) { b.anim.goToAndPlay(a.frame, true); a.play(); } else { a.pause(); b.pause(); } }, seek(f) { a.seek(f); b.seek(f); }, pause() { a.pause(); b.pause(); } });
      } catch (e) { beforeStage.replaceChildren(h("div", { class: "stage-msg" }, "Preview unavailable.")); afterStage.replaceChildren(h("div", { class: "stage-msg" }, e.message === "player" ? "The preview player didn’t load. Downloads still work." : e.message)); }
    })();
    const delta = i.size ? Math.round(((o.bytes.length - i.size) / i.size) * 100) : 0, im = inf.images;
    const stat = (v, l) => h("div", { class: "stat" }, h("b", {}, v), h("span", {}, l));
    const notable = s.issues.filter((x) => x.level !== "info").slice(0, 4);
    wrap.append(...[sel ? h("div", { class: "row" }, h("span", { class: "muted" }, "Showing"), sel) : null,
      s.missing.length ? bannerEl("warn", `${plural(s.missing.length, "image")} missing`, `The file refers to images that weren’t found: ${s.missing.slice(0, 4).join(", ")}${s.missing.length > 4 ? "…" : ""}. Those areas will be blank in the output.`) : null,
      h("div", { class: "ba" }, h("figure", {}, h("figcaption", {}, h("span", {}, "Before"), h("span", {}, `${srcFmt} · ${fmtBytes(i.size)}`)), beforeStage), h("figure", {}, h("figcaption", {}, h("span", {}, "After"), h("span", {}, `${outFmt} · ${fmtBytes(o.bytes.length)}`)), afterStage)),
      controls.el, h("div", { class: "pv-opts" }, backgroundControl([beforeStage, afterStage])),
      h("div", { class: "stats" }, stat(`${fmtBytes(o.bytes.length)}${delta ? ` (${delta > 0 ? "+" : ""}${delta}%)` : ""}`, "Size after"), stat(`${inf.w} × ${inf.h}`, "Dimensions (px)"), stat(fmtDur(inf.duration), `Duration · ${Math.round(inf.frames)} frames`), stat(`${+inf.fr.toFixed(2)} fps`, "Frame rate"),
        stat(String(s.animCount), s.animCount === 1 ? "Animation" : "Animations in source"), stat(im.embedded + im.external + im.missing === 0 ? "None" : [im.embedded && `${im.embedded} included`, im.external && `${im.external} by name`, im.missing && `${im.missing} missing`].filter(Boolean).join(" · "), "Image assets")),
      notable.length ? h("div", {}, notable.map((x) => bannerEl(x.level === "error" ? "error" : "warn", x.title, x.detail)).flatMap((b) => [b, h("div", { style: { height: "8px" } })])) : bannerEl("ok", "No errors or warnings found", "These are structural checks only. They don’t confirm playback on any specific platform or runtime version."),
      notable.length ? h("p", { class: "help", style: { margin: 0 } }, "These are structural checks only. They don’t confirm playback on any specific platform or runtime version.") : null,
      h("div", { class: "actions" }, action(i, o))].filter(Boolean));
    return wrap;
  }
  function action(i, o) {
    const why = saveBlockReason(), saved = i.saved && i.saved[o.name];
    const dl = h("button", { class: "btn sm " + (S.dest === "local" ? "fill" : "gray"), type: "button", onclick: () => { download(o.bytes, o.name, mime(o.format)); toast("Downloaded " + o.name); } }, icon("download"), `Download ${o.format === "lottie" ? ".lottie" : ".json"}`);
    const save = h("button", { class: "btn sm " + (S.dest === "library" ? "fill" : "gray") + (why ? " disabled" : ""), type: "button", "aria-disabled": why ? "true" : null, title: why, onclick: async () => {
      if (why) return toast(why, "error");
      const asset = await saveToLibraryDialog({ name: o.name, bytes: o.bytes }); if (asset) { (i.saved ||= {})[o.name] = asset; toast("Saved to the library as a draft"); paintItem(i); } } }, icon("tray"), saved ? "Save another copy…" : "Save to library…");
    const edit = h("button", { class: "btn gray sm", type: "button", onclick: () => { app.pending = { name: o.name, bytes: o.bytes, source: null }; go("/editor/file"); } }, icon("sliders"), "Edit");
    return [S.dest === "library" ? [save, dl] : [dl, save], edit, saved ? h("a", { class: "btn plain", href: "#/asset/" + saved.id }, "Saved · View in library") : null];
  }

  /* restore queue if the user navigated away and back */
  for (const i of S.items) { i.node = h("div", { class: "qi" }); i.paint = () => paintItem(i); i.dispose = () => { i.cleanup && i.cleanup(); i.cleanup = null; }; list.append(i.node); paintItem(i); }
  paintSummary(); if (S.items.some((i) => i.status === "queued")) run();
}
