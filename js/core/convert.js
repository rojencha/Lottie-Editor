// dotLottie <-> Lottie JSON conversion. Pure logic, no DOM, runs in the browser and in Node.
import { enc, dec, readZip, writeZip } from "./zip.js";

export const LIMITS = { warnBytes: 5 * 1024 * 1024, maxBytes: 100 * 1024 * 1024 };
export const GENERATOR = "lottie-asset-platform";
const MIME_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/avif": ".avif" };
const EXT_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif" };

export class ConvertError extends Error {}
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const stem = (n) => n.replace(/\.[^.]+$/, "");
export const safeName = (s) => (String(s).replace(/[^\w.\-]+/g, "_").replace(/^[._]+|[._]+$/g, "")) || "animation";

/* ---- binary helpers ---- */
export const b64enc = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
export const b64dec = (s) => { const bin = atob(s.replace(/\s/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function sha12(u) { const h = new Uint8Array(await crypto.subtle.digest("SHA-1", u)); return [...h].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join(""); }

/* ---- detection / parsing / validation ---- */
export function sniff(u) {
  if (u[0] === 0x50 && u[1] === 0x4b) return "lottie";
  let i = 0; if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) i = 3;
  while (i < u.length && [32, 9, 10, 13].includes(u[i])) i++;
  if (u[i] === 0x7B) return "json";
  throw new ConvertError("This isn't a dotLottie (.lottie) or Lottie JSON (.json) file.");
}
export function parseJSON(bytes, what) {
  try { return JSON.parse(dec.decode(bytes).replace(/^﻿/, "")); }
  catch (e) { throw new ConvertError(`${what}: the file isn't valid JSON (${e.message}).`); }
}
export function validateLottie(o, what) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new ConvertError(`${what}: the top level isn't an animation object.`);
  const miss = ["fr", "ip", "op", "w", "h", "layers"].filter((k) => !(k in o));
  if (miss.length) throw new ConvertError(`${what}: this doesn't look like a Lottie animation (missing ${miss.join(", ")}).`);
  if (!Array.isArray(o.layers)) throw new ConvertError(`${what}: "layers" must be a list.`);
  if (!(o.fr > 0 && o.w > 0 && o.h > 0)) throw new ConvertError(`${what}: frame rate, width and height must be positive numbers.`);
}

function findInZip(z, name, prefixes) {
  const names = z.names(), lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const pre of prefixes) { const c = pre + name; if (z.has(c)) return c; if (lower.has(c.toLowerCase())) return lower.get(c.toLowerCase()); }
  if (z.has(name)) return name;
  const base = name.split("/").pop().toLowerCase();
  return names.find((n) => n.split("/").pop().toLowerCase() === base) || null;
}

/**
 * dotLottie bytes -> [[id, lottieJson]]. When `inline`, external images are embedded as data URIs.
 * `report` (optional) receives { embedded:number, missing:string[] } so callers can warn about missing files.
 */
export async function dotLottieToJson(buf, { inline = true, report = null } = {}) {
  let z; try { z = await readZip(buf); } catch { throw new ConvertError("The dotLottie archive is damaged (it couldn't be unzipped)."); }
  if (!z.has("manifest.json")) throw new ConvertError("This archive has no manifest.json, so it isn't a valid dotLottie file.");
  const manifest = parseJSON(await z.read("manifest.json"), "manifest.json");
  const ids = (manifest.animations || []).map((a) => (typeof a === "string" ? a : a && a.id)).filter(Boolean);
  const anims = [];
  for (const id of ids) {
    const p = findInZip(z, id + ".json", ["animations/", "a/"]);
    if (!p) throw new ConvertError(`Animation "${id}" is listed in the manifest but missing from the archive.`);
    anims.push([id, parseJSON(await z.read(p), p)]);
  }
  if (!anims.length) for (const n of z.names()) if (/^(animations|a)\/.+\.json$/.test(n)) anims.push([n.split("/").pop().replace(/\.json$/, ""), parseJSON(await z.read(n), n)]);
  if (!anims.length) throw new ConvertError("No animations were found inside this dotLottie file.");
  if (report) { report.embedded = 0; report.missing = []; }
  for (const [, anim] of anims) for (const a of anim.assets || []) {
    if (!a || typeof a !== "object" || !("p" in a) || a.t === "audio") continue;
    const p = a.p; if (!p || String(p).startsWith("data:")) continue;
    if (!inline) continue;
    const u = a.u || ""; const full = u ? (u.replace(/^\/+|\/+$/g, "") + "/" + p).replace(/^\//, "") : p;
    const hit = findInZip(z, full, ["images/", "i/"]) || findInZip(z, p, ["images/", "i/"]);
    if (!hit) { if (report) report.missing.push(String(p)); continue; }
    const ext = (hit.match(/\.[^./]+$/) || [""])[0].toLowerCase();
    a.u = ""; a.p = "data:" + (EXT_MIME[ext] || "application/octet-stream") + ";base64," + b64enc(await z.read(hit)); a.e = 1;
    if (report) report.embedded++;
  }
  return anims;
}

/** [[id, lottieJson]] -> dotLottie bytes. Mutates the animations it is given (pass clones). */
export async function jsonToDotLottie(items, { extract = true, version = "1", pretty = false } = {}) {
  const adir = version === "1" ? "animations/" : "a/", idir = version === "1" ? "images/" : "i/", prefix = version === "1" ? "/images/" : "/i/";
  const manifest = { version, generator: GENERATOR, animations: [] };
  const used = new Set(), files = new Map();
  for (let [id, anim] of items) {
    const base = safeName(id); let k = 1; id = base; while (used.has(id)) { k++; id = base + "_" + k; } used.add(id);
    if (extract) for (const a of anim.assets || []) {
      if (!a || typeof a.p !== "string" || a.t === "audio") continue;
      const m = a.p.match(/^data:([\w.+/-]+);base64,([\s\S]*)$/); if (!m) continue;
      let blob; try { blob = b64dec(m[2]); } catch { continue; }
      const name = (await sha12(blob)) + (MIME_EXT[m[1].toLowerCase()] || ".bin");
      files.set(idir + name, { data: blob, store: true }); a.u = prefix; a.p = name; a.e = 0;
    }
    manifest.animations.push({ id });
    files.set(adir + id + ".json", { data: enc.encode(JSON.stringify(anim, null, pretty ? 2 : 0)), store: false });
  }
  const entries = [{ name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)), store: false }];
  for (const [name, f] of files) entries.push({ name, ...f });
  return writeZip(entries);
}

/**
 * Read any supported file into animations. -> { format, anims:[[id,anim]], missing:string[] }
 * Used by the converter, editor, library previews and version uploads.
 */
export async function readAnimationFile(bytes, { inline = true, name = "file" } = {}) {
  const kind = sniff(bytes);
  if (bytes.length > LIMITS.maxBytes) throw new ConvertError(`${name} is larger than ${LIMITS.maxBytes / 1048576} MB, which is more than this tool handles.`);
  let anims, missing = [];
  if (kind === "lottie") { const report = {}; anims = await dotLottieToJson(bytes, { inline, report }); missing = report.missing || []; }
  else { const a = parseJSON(bytes, name); anims = [[stem(name), a]]; }
  for (const [id, a] of anims) validateLottie(a, anims.length > 1 ? `${name} (${id})` : name);
  return { format: kind, anims, missing };
}

/**
 * Convert one job (a file, or several JSON files to bundle). -> outputs
 * [{ name, format, bytes, anims:[[id,anim]], source, missing }]  (anims keep inlined images, for analysis/preview)
 */
export async function convertJob(inputs, opts, step = () => {}) {
  const outs = [], jsonItems = [];
  for (const f of inputs) {
    step("reading", f);
    if (f.bytes.length > LIMITS.maxBytes) throw new ConvertError(`${f.name} is larger than ${LIMITS.maxBytes / 1048576} MB, which is more than this tool handles.`);
    const kind = sniff(f.bytes);
    step("converting", f);
    if (kind === "lottie") {
      const report = {}; const anims = await dotLottieToJson(f.bytes, { inline: opts.inline, report });
      for (const [id, a] of anims) validateLottie(a, anims.length > 1 ? `${f.name} (${id})` : f.name);
      for (const [id, anim] of anims) {
        const name = anims.length === 1 ? stem(f.name) + ".json" : stem(f.name) + "_" + safeName(id) + ".json";
        outs.push({ name, format: "json", bytes: enc.encode(JSON.stringify(anim, null, opts.pretty ? 2 : 0)), anims: [[id, anim]], source: f.name, missing: report.missing || [] });
      }
    } else {
      const anim = parseJSON(f.bytes, f.name); validateLottie(anim, f.name); jsonItems.push({ name: f.name, anim });
    }
  }
  const groups = opts.bundle && jsonItems.length > 1 ? [jsonItems] : jsonItems.map((x) => [x]);
  for (const g of groups) {
    step("converting", g[0]);
    const anims = g.map((x) => [stem(x.name), x.anim]);
    const bytes = await jsonToDotLottie(anims.map(([id, a]) => [id, clone(a)]), { extract: opts.extract, version: opts.version, pretty: opts.pretty });
    outs.push({ name: (g.length > 1 ? "bundle" : stem(g[0].name)) + ".lottie", format: "lottie", bytes, anims, source: g.map((x) => x.name).join(", "), missing: [] });
  }
  return outs;
}

/** Convert stored bytes between formats for downloads. The first animation is used when a .lottie holds several. */
export async function toFormat(bytes, from, to, { name = "animation", pretty = false, version = "1", extract = true } = {}) {
  if (from === to) return bytes;
  const { anims } = await readAnimationFile(bytes, { name });
  if (to === "json") return enc.encode(JSON.stringify(anims[0][1], null, pretty ? 2 : 0));
  return jsonToDotLottie([[safeName(name), clone(anims[0][1])]], { extract, version, pretty });
}
