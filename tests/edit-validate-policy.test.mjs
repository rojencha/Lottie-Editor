import test from "node:test";
import assert from "node:assert/strict";
import { applyEdits, DEFAULTS, listColors, clone } from "../js/core/edit.js";
import { analyze } from "../js/core/validate.js";
import { check, can, allowedVisibilities, canView } from "../js/core/policy.js";
import { anim, shapeLayer, withImage } from "./fixtures.mjs";

const fills = (a) => a.layers.flatMap((l) => (l.shapes || []).flatMap((g) => g.it.filter((i) => i.ty === "fl").map((i) => i.c.k.slice(0, 3))));

test("listColors finds fills and strokes", () => {
  const c = Object.fromEntries(listColors(anim()));
  assert.equal(c["#ff0000"], 1); assert.equal(c["#00ff00"], 1); assert.equal(c["#0000ff"], 2);
});

test("applyEdits does not mutate the base and defaults are a no-op", () => {
  const base = anim(), snap = JSON.stringify(base);
  const out = applyEdits(base, DEFAULTS());
  assert.equal(JSON.stringify(base), snap);
  assert.equal(out.layers.length, base.layers.length);
  assert.equal(out.w, 200);
});

test("colour replacement, invert and grayscale", () => {
  const base = anim();
  assert.deepEqual(fills(applyEdits(base, { colors: { "#ff0000": "#00ff00" } }))[0], [0, 1, 0]);
  assert.deepEqual(fills(applyEdits(base, { invert: true }))[0].map((x) => +x.toFixed(2)), [0, 1, 1]);
  const g = fills(applyEdits(base, { gray: true }))[0]; assert.ok(Math.abs(g[0] - g[1]) < 1e-6 && Math.abs(g[1] - g[2]) < 1e-6);
});

test("speed, trim, stroke and opacity", () => {
  const base = anim();
  assert.equal(applyEdits(base, { speed: 200 }).fr, 60);
  const t = applyEdits(base, { start: 10, end: 40 }); assert.deepEqual([t.ip, t.op], [10, 40]);
  const st = applyEdits(base, { stroke: 200 }).layers[0].shapes[0].it.find((i) => i.ty === "st"); assert.equal(st.w.k, 8);
  assert.equal(applyEdits(base, { opacity: 50 }).layers[0].ks.o.k, 50);
});

test("resize adds one wrapper layer and parents root layers to it", () => {
  const out = applyEdits(anim(), { w: 400, h: 400, fit: "contain" });
  assert.equal([out.w, out.h].join("x"), "400x400");
  const wrap = out.layers.find((l) => l.nm === "__transform");
  assert.ok(wrap); assert.equal(wrap.ks.s.k[0], 200);
  assert.ok(out.layers.filter((l) => l !== wrap).every((l) => l.parent === wrap.ind));
  assert.equal(new Set(out.layers.map((l) => l.ind)).size, out.layers.length);
});

test("background layer and layer operations", () => {
  const base = anim();
  const bg = applyEdits(base, { bgOn: true, bg: "#123456" }); assert.equal(bg.layers.at(-1).sc, "#123456");
  const ops = applyEdits(base, { layers: { 0: { deleted: true }, 1: { hidden: true, name: "renamed" } } });
  assert.equal(ops.layers.length, 1); assert.equal(ops.layers[0].nm, "renamed"); assert.equal(ops.layers[0].ks.o.k, 0);
});

test("analyze reports what it checks and never claims compatibility", () => {
  const ok = analyze(anim(), { sizeBytes: 1234 });
  assert.equal(ok.counts.error, 0); assert.equal(ok.info.layers, 2);
  assert.ok(ok.notChecked.some((s) => /platform/.test(s)));
  const a = withImage(); a.layers[0].refId = "nope"; a.layers[0].ddd = 1; a.layers.push({ ty: 99, ind: 9, parent: 77, ks: {} });
  a.layers[0].ks = { o: { a: 0, k: 1, x: "wiggle(1,2)" } };
  const r = analyze(a, { missingAssets: ["x.png"] });
  const ids = r.issues.map((i) => i.id);
  for (const id of ["bad-ref", "bad-parent", "unknown-layer", "expressions", "3d", "missing-images"]) assert.ok(ids.includes(id), id);
  assert.equal(r.issues[0].level, "error");
});

const U = {
  viewer: { id: "v", role: "viewer", verticals: ["fin"], teams: ["fin-a"] },
  contrib: { id: "c", role: "contributor", verticals: ["fin"], teams: ["fin-a"] },
  appr: { id: "p", role: "approver", verticals: ["fin"], teams: ["fin-a"] },
  admin: { id: "a", role: "admin", verticals: [], teams: [] },
};
const asset = (o = {}) => ({ vertical: "fin", team: "fin-a", visibility: "team", ownerId: "c", status: "draft", ...o });

test("policy: visibility scoping", () => {
  assert.ok(canView(U.viewer, asset()));
  assert.ok(!canView(U.viewer, asset({ team: "fin-b" })));
  assert.ok(canView(U.appr, asset({ team: "fin-b" })), "approvers see all teams of their vertical");
  assert.ok(!canView(U.viewer, asset({ vertical: "ops", visibility: "vertical" })));
  assert.ok(canView(U.viewer, asset({ vertical: "ops", visibility: "company" })));
  assert.ok(canView(U.admin, asset({ vertical: "ops" })));
});

test("policy: only approvers approve; contributors can't go company-wide", () => {
  assert.ok(!can(U.contrib, "asset.approve", asset()));
  assert.ok(!can(U.viewer, "asset.create", { vertical: "fin", team: "fin-a", visibility: "team" }));
  assert.ok(can(U.contrib, "asset.create", { vertical: "fin", team: "fin-a", visibility: "team" }));
  assert.ok(!can(U.contrib, "asset.create", { vertical: "fin", visibility: "company" }));
  assert.ok(can(U.appr, "asset.approve", asset({ status: "in_review" })));
  assert.ok(!can(U.appr, "asset.approve", asset({ vertical: "ops", visibility: "company" })));
  assert.ok(can(U.admin, "config.manage") && !can(U.appr, "config.manage"));
  assert.match(check(U.viewer, "asset.duplicate", asset()).reason, /Viewer/);
});

test("policy: owners edit drafts only; approved details need an approver", () => {
  assert.ok(can(U.contrib, "asset.editMetadata", asset()));
  assert.ok(!can(U.contrib, "asset.editMetadata", asset({ status: "approved" })));
  assert.ok(can(U.appr, "asset.editMetadata", asset({ status: "approved" })));
  assert.deepEqual(allowedVisibilities(U.contrib, "fin", "fin-a"), ["team", "vertical"]);
});

test("clone is deep", () => { const a = anim(), b = clone(a); b.layers[0].nm = "x"; assert.notEqual(a.layers[0].nm, "x"); });
