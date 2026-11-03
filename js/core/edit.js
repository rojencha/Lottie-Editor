// Non-destructive edit engine: applyEdits(base, params) always starts from the untouched base and returns a fresh edited copy,
// so undo/reset/preview are idempotent. Anything the engine doesn't touch is preserved exactly.
import { clone } from "./convert.js";
export { clone };

const _h2 = (n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");
export const toHex = (c) => "#" + _h2(c[0]) + _h2(c[1]) + _h2(c[2]);
export const fromHex = (h) => { h = String(h).replace("#", ""); if (h.length === 3) h = [...h].map((x) => x + x).join(""); return [0, 2, 4].map((i) => (parseInt(h.substr(i, 2), 16) || 0) / 255); };
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t % 1 + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

export const DEFAULTS = () => ({ colors: {}, hue: 0, sat: 0, light: 0, invert: false, gray: false, stroke: 100, opacity: 100, speed: 100,
  start: null, end: null, w: null, h: null, fit: "contain", scale: 100, rot: 0, flipH: false, flipV: false, bgOn: false, bg: "#ffffff", layers: {} });

/* ---- colour traversal: fn(rgb) -> rgb | undefined; edits in place ---- */
function touchArr(arr, fn, grad) {
  const one = (o) => { if (arr.length < o + 3 || typeof arr[o] !== "number") return; const r = fn([arr[o], arr[o + 1], arr[o + 2]]); if (r) { arr[o] = r[0]; arr[o + 1] = r[1]; arr[o + 2] = r[2]; } };
  if (grad) { for (let i = 0; i < grad; i++) one(4 * i + 1); } else one(0);
}
function visitColorProp(prop, fn, grad) {
  if (!prop || prop.k == null) return; const k = prop.k;
  if (Array.isArray(k) && k.length && k[0] && typeof k[0] === "object" && !Array.isArray(k[0])) { for (const kf of k) for (const key of ["s", "e"]) if (Array.isArray(kf[key])) touchArr(kf[key], fn, grad); }
  else if (Array.isArray(k)) touchArr(k, fn, grad);
}
export function eachShape(items, f) { for (const it of items || []) { f(it); if (it.it) eachShape(it.it, f); } }
export function layerSets(anim) { const sets = [anim.layers || []]; for (const a of anim.assets || []) if (Array.isArray(a.layers)) sets.push(a.layers); return sets; }
export function visitColors(anim, fn) {
  for (const layers of layerSets(anim)) for (const L of layers) {
    if (L.ty === 1 && typeof L.sc === "string") { const r = fn(fromHex(L.sc)); if (r) L.sc = toHex(r); }
    eachShape(L.shapes, (it) => {
      if (it.ty === "fl" || it.ty === "st") visitColorProp(it.c, fn, 0);
      else if ((it.ty === "gf" || it.ty === "gs") && it.g) visitColorProp(it.g.k, fn, it.g.p || 0);
    });
    if (L.t && L.t.d && Array.isArray(L.t.d.k)) for (const kf of L.t.d.k) { const s = kf && kf.s; if (s) { if (Array.isArray(s.fc)) touchArr(s.fc, fn, 0); if (Array.isArray(s.sc)) touchArr(s.sc, fn, 0); } }
    for (const ef of L.ef || []) for (const sub of ef.ef || []) if (sub.ty === 2) visitColorProp(sub.v, fn, 0);
  }
}
export function listColors(anim) {
  const m = new Map(); visitColors(anim, (c) => { const h = toHex(c); m.set(h, (m.get(h) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]);
}
function adjustColor(c, P) {
  let [r, g, b] = c; if (P.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
  if (P.gray || P.hue || P.sat || P.light) {
    let [h, s, l] = rgb2hsl(r, g, b);
    h = (h + P.hue / 360 + 1) % 1; s = P.gray ? 0 : Math.max(0, Math.min(1, P.sat >= 0 ? s + (1 - s) * P.sat / 100 : s * (1 + P.sat / 100)));
    l = P.light >= 0 ? l + (1 - l) * P.light / 100 : l * (1 + P.light / 100);
    [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, l)));
  }
  return [r, g, b];
}
function mapNum(prop, f) {
  if (!prop || prop.k == null) return; const k = prop.k;
  if (typeof k === "number") { prop.k = f(k); return; }
  if (Array.isArray(k)) {
    if (k.length && k[0] && typeof k[0] === "object") { for (const kf of k) for (const key of ["s", "e"]) if (Array.isArray(kf[key])) kf[key] = kf[key].map(f); }
    else prop.k = k.map(f);
  }
}
const nextInd = (layers) => layers.reduce((m, l) => Math.max(m, l.ind || 0), 0) + 1;
const staticProp = (v) => ({ a: 0, k: v });

export function applyEdits(base, P) {
  const A = clone(base); P = Object.assign(DEFAULTS(), P || {});
  /* 1. layers: delete / hide / rename (keyed by index in the base file) */
  const removed = new Set(), keep = [];
  A.layers.forEach((L, i) => {
    const e = P.layers[i] || {};
    if (e.deleted) { if (L.ind != null) removed.add(L.ind); return; }
    if (e.name) L.nm = e.name;
    if (e.hidden) { L.hd = true; L.ks = L.ks || {}; L.ks.o = staticProp(0); }
    keep.push(L);
  });
  A.layers = keep;
  if (removed.size) for (const L of keep) if (removed.has(L.parent)) delete L.parent;
  /* 2. colours */
  const neutral = !(P.invert || P.gray || P.hue || P.sat || P.light), hasMap = Object.keys(P.colors).length > 0;
  if (hasMap || !neutral) visitColors(A, (c) => { let out = null; const m = P.colors[toHex(c)]; if (m) out = fromHex(m); if (!neutral) out = adjustColor(out || c, P); return out; });
  /* 3. stroke width, global opacity */
  if (P.stroke !== 100) { const f = P.stroke / 100; for (const ls of layerSets(A)) for (const L of ls) eachShape(L.shapes, (it) => { if (it.ty === "st" || it.ty === "gs") mapNum(it.w, (v) => v * f); }); }
  if (P.opacity !== 100) for (const L of A.layers) if (L.ks && L.ks.o) mapNum(L.ks.o, (v) => Math.max(0, Math.min(100, v * P.opacity / 100)));
  /* 4. timing */
  if (P.speed !== 100) A.fr = +(base.fr * P.speed / 100).toFixed(4);
  if (P.start != null || P.end != null) {
    const s = Math.max(base.ip, P.start == null ? base.ip : P.start), e = Math.min(base.op, P.end == null ? base.op : P.end);
    if (e > s + 1) { A.ip = s; A.op = e; }
  }
  /* 5. canvas + transform via one wrapper null layer parenting all root layers */
  const w0 = base.w, h0 = base.h, w1 = Math.max(1, Math.round(P.w || w0)), h1 = Math.max(1, Math.round(P.h || h0));
  let sx = 1, sy = 1;
  if (P.fit === "contain") sx = sy = Math.min(w1 / w0, h1 / h0); else if (P.fit === "cover") sx = sy = Math.max(w1 / w0, h1 / h0); else if (P.fit === "stretch") { sx = w1 / w0; sy = h1 / h0; }
  sx *= P.scale / 100; sy *= P.scale / 100; if (P.flipH) sx = -sx; if (P.flipV) sy = -sy;
  A.w = w1; A.h = h1;
  if (w1 !== w0 || h1 !== h0 || Math.abs(sx) !== 1 || Math.abs(sy) !== 1 || sx < 0 || sy < 0 || P.rot) {
    const ind = nextInd(A.layers);
    for (const L of A.layers) if (L.parent == null) L.parent = ind;
    A.layers.push({ ddd: 0, ind, ty: 3, nm: "__transform", sr: 1, ks: { o: staticProp(0), r: staticProp(P.rot), p: staticProp([w1 / 2, h1 / 2, 0]), a: staticProp([w0 / 2, h0 / 2, 0]), s: staticProp([sx * 100, sy * 100, 100]) }, ao: 0, ip: base.ip, op: base.op, st: 0, bm: 0 });
  }
  /* 6. background: solid layer at the bottom of the stack */
  if (P.bgOn) A.layers.push({ ddd: 0, ind: nextInd(A.layers), ty: 1, nm: "__background", sr: 1, ks: { o: staticProp(100), r: staticProp(0), p: staticProp([w1 / 2, h1 / 2, 0]), a: staticProp([w1 / 2, h1 / 2, 0]), s: staticProp([100, 100, 100]) }, ao: 0, sw: w1, sh: h1, sc: P.bg || "#ffffff", ip: base.ip, op: base.op, st: 0, bm: 0 });
  return A;
}
export const durationOf = (a) => (a.op - a.ip) / a.fr;
