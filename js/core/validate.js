// Inspection + validation report. This only reports what is actually checked below; it does NOT certify that an
// animation renders correctly on any platform or runtime version.
import { layerSets, eachShape } from "./edit.js";

export const CHECKED = [
  "File structure and frame range",
  "Image, precomposition and parent references",
  "Embedded image weight",
  "Expressions",
  "3D layers and cameras",
  "Layer and shape types",
  "Text layers",
  "Audio",
  "Layer effects",
  "Merge Paths",
];
export const NOT_CHECKED = [
  "How it renders on a specific platform or runtime version",
  "Performance on target devices",
  "Whether fonts used by text are installed where it plays",
];
const KNOWN_LAYER = new Set([0, 1, 2, 3, 4, 5, 6, 13]);
const KNOWN_SHAPE = new Set(["gr", "fl", "st", "gf", "gs", "rc", "el", "sr", "sh", "tr", "tm", "rd", "mm", "rp", "pb", "tw", "op", "zz", "no"]);

function countExpressions(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) countExpressions(x, acc); return; }
  if (typeof node.x === "string" && "k" in node && node.x.trim()) acc.n++;
  for (const k in node) { const v = node[k]; if (v && typeof v === "object") countExpressions(v, acc); }
}

/**
 * @param {object} anim parsed Lottie JSON
 * @param {{sizeBytes?:number|null, missingAssets?:string[]}} [ctx]
 */
export function analyze(anim, { sizeBytes = null, missingAssets = [] } = {}) {
  const issues = [];
  const add = (level, id, title, detail, count = 1) => issues.push({ level, id, title, detail, count });
  const sets = layerSets(anim), all = sets.flat();
  const info = {
    version: anim.v || null, w: anim.w, h: anim.h, fr: anim.fr, ip: anim.ip, op: anim.op,
    frames: anim.op - anim.ip, duration: anim.fr > 0 ? (anim.op - anim.ip) / anim.fr : 0,
    layers: (anim.layers || []).length, totalLayers: all.length,
    precomps: (anim.assets || []).filter((a) => Array.isArray(a.layers)).length,
    images: { embedded: 0, external: 0, missing: missingAssets.length, embeddedBytes: 0 }, sizeBytes,
  };
  // structure
  if (!(info.frames > 0)) add("error", "frames", "Frame range is empty", "The out-point is not after the in-point, so there is nothing to play.");
  if (info.w > 4096 || info.h > 4096) add("warning", "huge-canvas", "Very large canvas", `The canvas is ${info.w}×${info.h}px. Large canvases can be slow to render.`);
  if (info.fr > 60) add("info", "high-fps", "High frame rate", `${info.fr} fps is higher than most screens refresh; playback may be capped.`);
  // assets
  const assetIds = new Set(), externalNames = [];
  for (const a of anim.assets || []) {
    if (a && a.id != null) assetIds.add(String(a.id));
    if (!a || typeof a !== "object" || !("p" in a) || a.t === "audio") continue;
    if (typeof a.p === "string" && a.p.startsWith("data:")) { info.images.embedded++; info.images.embeddedBytes += Math.floor((a.p.length - a.p.indexOf(",") - 1) * 3 / 4); }
    else if (a.p) { info.images.external++; externalNames.push(String(a.p)); }
  }
  if (missingAssets.length) add("warning", "missing-images", "Some images are missing", `The file references ${missingAssets.length} image${missingAssets.length > 1 ? "s" : ""} that weren't in the archive (${missingAssets.slice(0, 5).join(", ")}${missingAssets.length > 5 ? "…" : ""}). Those areas will render empty.`, missingAssets.length);
  else if (info.images.external) add("warning", "external-images", "Images are referenced by file name", `${info.images.external} image${info.images.external > 1 ? "s are" : " is"} referenced by name (${externalNames.slice(0, 5).join(", ")}${externalNames.length > 5 ? "…" : ""}) and not embedded. They will only show if the files sit next to the animation. Convert with "Embed images in JSON" or use a .lottie file to carry them along.`, info.images.external);
  if (info.images.embeddedBytes > 1048576) add("warning", "heavy-images", "Embedded images are heavy", `Embedded images add about ${(info.images.embeddedBytes / 1048576).toFixed(1)} MB. Consider smaller or compressed images for faster loading.`);
  // references and layer types
  let badRef = 0, badParent = 0, unknownLayer = 0, threeD = 0, text = 0, audio = 0, effects = 0, unknownShape = 0, merge = 0;
  for (const layers of sets) {
    const inds = new Set(layers.map((l) => l.ind).filter((i) => i != null));
    for (const L of layers) {
      if ((L.ty === 0 || L.ty === 2) && L.refId != null && !assetIds.has(String(L.refId))) badRef++;
      if (L.parent != null && !inds.has(L.parent)) badParent++;
      if (!KNOWN_LAYER.has(L.ty)) unknownLayer++;
      if (L.ddd === 1 || L.ty === 13) threeD++;
      if (L.ty === 5) text++;
      if (L.ty === 6) audio++;
      if (Array.isArray(L.ef) && L.ef.length) effects += L.ef.length;
      eachShape(L.shapes, (it) => { if (!KNOWN_SHAPE.has(it.ty)) unknownShape++; if (it.ty === "mm") merge++; });
    }
  }
  if (anim.ddd === 1) threeD++;
  for (const a of anim.assets || []) if (a && a.t === "audio") audio++;
  if (badRef) add("error", "bad-ref", "Broken references", `${badRef} layer${badRef > 1 ? "s point" : " points"} to an image or precomposition that doesn't exist in the file.`, badRef);
  if (badParent) add("warning", "bad-parent", "Missing parent layers", `${badParent} layer${badParent > 1 ? "s are" : " is"} parented to a layer that doesn't exist, so transforms may not behave as designed.`, badParent);
  if (unknownLayer) add("warning", "unknown-layer", "Unrecognized layer types", `${unknownLayer} layer${unknownLayer > 1 ? "s use" : " uses"} a type this tool doesn't recognize. They're kept as-is but can't be inspected here.`, unknownLayer);
  if (unknownShape) add("warning", "unknown-shape", "Unrecognized shape elements", `${unknownShape} shape element${unknownShape > 1 ? "s aren't" : " isn't"} recognized by this tool. They're kept as-is but can't be inspected here.`, unknownShape);
  const ex = { n: 0 }; countExpressions(anim, ex);
  if (ex.n) add("warning", "expressions", "Uses expressions", `${ex.n} animated propert${ex.n > 1 ? "ies use" : "y uses"} expressions. Expression support varies between runtimes, and colors driven by expressions can't be edited here. Test on your target platform.`, ex.n);
  if (threeD) add("warning", "3d", "Uses 3D layers or a camera", "3D features aren't supported by every runtime and may render flat or be ignored.", threeD);
  if (audio) add("warning", "audio", "Contains audio", "Audio support is limited in many Lottie players. Check that your target runtime plays it.", audio);
  if (merge) add("info", "merge-paths", "Uses Merge Paths", `${merge} Merge Paths element${merge > 1 ? "s" : ""}. Support for this varies between runtimes.`, merge);
  if (effects) add("info", "effects", "Uses layer effects", `${effects} layer effect${effects > 1 ? "s" : ""}. Effect support varies between runtimes.`, effects);
  if (text) add("info", "text", "Contains text layers", `${text} text layer${text > 1 ? "s" : ""}. Text depends on fonts being available where the animation plays.`, text);
  const counts = { error: 0, warning: 0, info: 0 }; for (const i of issues) counts[i.level]++;
  const order = { error: 0, warning: 1, info: 2 }; issues.sort((a, b) => order[a.level] - order[b.level]);
  return { info, issues, counts, checked: CHECKED, notChecked: NOT_CHECKED };
}
