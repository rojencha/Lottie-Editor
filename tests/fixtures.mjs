// Test fixtures built in code so no binary files are needed.
export const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

export const solid = (hex = "#ff0000") => ({ ddd: 0, ind: 1, ty: 1, nm: "bg", sr: 1, ks: {}, ao: 0, sw: 100, sh: 100, sc: hex, ip: 0, op: 60, st: 0, bm: 0 });
export const shapeLayer = (ind, color, name = "shape " + ind, extra = {}) => ({
  ddd: 0, ind, ty: 4, nm: name, sr: 1, ks: { o: { a: 0, k: 100 } }, ao: 0, ip: 0, op: 60, st: 0, bm: 0,
  shapes: [{ ty: "gr", it: [
    { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] }, r: { a: 0, k: 0 } },
    { ty: "fl", c: { a: 0, k: [...color, 1] }, o: { a: 0, k: 100 } },
    { ty: "st", c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } },
    { ty: "tr" }] }], ...extra,
});
export const anim = (over = {}) => ({ v: "5.7.0", fr: 30, ip: 0, op: 60, w: 200, h: 100, nm: "t", ddd: 0, assets: [], layers: [shapeLayer(1, [1, 0, 0]), shapeLayer(2, [0, 1, 0])], ...over });
export const withImage = (over = {}) => anim({
  assets: [{ id: "image_0", w: 1, h: 1, u: "", p: "data:image/png;base64," + PNG_1PX, e: 1 }],
  layers: [{ ddd: 0, ind: 1, ty: 2, nm: "img", refId: "image_0", sr: 1, ks: {}, ao: 0, ip: 0, op: 60, st: 0, bm: 0 }], ...over,
});
export const bytes = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));
