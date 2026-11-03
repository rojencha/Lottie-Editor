import test from "node:test";
import assert from "node:assert/strict";
import { memoryStore } from "../js/data/store.js";
import { createLibrary, PolicyError, ValidationError, deriveStatus } from "../js/data/library.js";
import { seedDemo, DEV_USERS } from "../js/data/seed.js";
import { bytes, anim, withImage } from "./fixtures.mjs";

const U = Object.fromEntries(DEV_USERS.map((u) => [u.id, u]));
const fresh = async () => { const store = memoryStore(); await seedDemo(store); return { store, lib: createLibrary(store) }; };
const newAsset = (lib, user, o = {}) => lib.createAsset(user, { name: "Test", bytes: bytes(anim()), vertical: "consumer", team: "consumer-growth", visibility: "team", ...o });

test("seed data loads, analyses and lists per role", async () => {
  const { lib } = await fresh();
  const vera = await lib.listAssets(U.u_vera), alex = await lib.listAssets(U.u_alex), pia = await lib.listAssets(U.u_pia);
  assert.ok(alex.length === 7 && vera.length < alex.length);
  assert.ok(vera.every((a) => a.vertical === "consumer" || a.visibility === "company"));
  assert.ok(!pia.some((a) => a.id === "seed_spinner"), "payments contributor can't see consumer vertical assets");
  assert.equal((await lib.getAsset(U.u_alex, "seed_old_pulse")).status, "deprecated");
});

test("search and filters", async () => {
  const { lib } = await fresh();
  assert.deepEqual((await lib.listAssets(U.u_alex, { q: "spinner" })).map((a) => a.id), ["seed_spinner"]);
  assert.ok((await lib.listAssets(U.u_alex, { status: "in_review" })).every((a) => a.status === "in_review"));
  assert.ok((await lib.listAssets(U.u_alex, { collection: "col_brand" })).length === 1);
  assert.ok((await lib.listAssets(U.u_alex, { format: "lottie" })).length >= 2);
  assert.ok((await lib.listAssets(U.u_alex, { check: "clean" })).length > 0);
  assert.ok((await lib.listAssets(U.u_alex, { tag: "legacy" })).length === 1);
});

test("a new version never silently becomes the approved one", async () => {
  const { lib } = await fresh();
  const a0 = await lib.getAsset(U.u_ada, "seed_spinner"); assert.equal(a0.approvedVersion, 1);
  const a1 = await lib.addVersion(U.u_ada, "seed_spinner", { bytes: bytes(anim()), note: "tweak" });
  assert.equal(a1.versions.length, 2); assert.equal(a1.approvedVersion, 1); assert.equal(a1.versions[1].status, "draft"); assert.equal(a1.status, "approved");
  await assert.rejects(() => lib.approve(U.u_ada, "seed_spinner", 2), ValidationError, "drafts can't be approved without review");
  await lib.submit(U.u_ada, "seed_spinner", 2);
  await assert.rejects(() => lib.approve(U.u_cal, "seed_spinner", 2), PolicyError);
  const a2 = await lib.approve(U.u_ada, "seed_spinner", 2);
  assert.equal(a2.approvedVersion, 2); assert.equal(a2.versions[0].status, "deprecated"); assert.equal(a2.versions.length, 2, "history preserved");
  assert.ok((await lib.getFile(U.u_ada, "seed_spinner", 1)).bytes.length > 0, "old version still downloadable");
});

test("deprecated assets stay listed and downloadable", async () => {
  const { lib } = await fresh();
  const a = await lib.deprecate(U.u_ada, "seed_spinner");
  assert.equal(a.status, "deprecated"); assert.equal(a.versions[0].status, "deprecated");
  assert.ok((await lib.listAssets(U.u_ada, { status: "deprecated" })).some((x) => x.id === "seed_spinner"));
  await assert.rejects(() => lib.deprecate(U.u_cal, "seed_pulse"), PolicyError);
});

test("duplicate-and-edit makes a separate linked copy and leaves the original untouched", async () => {
  const { lib, store } = await fresh();
  const before = JSON.stringify(await store.get("assets", "seed_success"));
  const d = await lib.duplicate(U.u_cal, "seed_success");
  assert.equal(d.name, "Copy of Success checkmark"); assert.notEqual(d.id, "seed_success");
  assert.deepEqual(d.source, { assetId: "seed_success", name: "Success checkmark", version: 1 });
  assert.equal(d.status, "draft"); assert.equal(d.ownerId, "u_cal"); assert.equal(d.versions.length, 1); assert.deepEqual(d.tags, ["success", "confirmation", "feedback"]);
  assert.equal(d.visibility, "team", "company-wide original → contributor's own team");
  assert.equal(JSON.stringify(await store.get("assets", "seed_success")), before);
  await assert.rejects(() => lib.duplicate(U.u_vera, "seed_success"), PolicyError);
});

test("create: scope rules and validation", async () => {
  const { lib } = await fresh();
  await assert.rejects(() => newAsset(lib, U.u_vera), PolicyError);
  await assert.rejects(() => newAsset(lib, U.u_cal, { vertical: "payments", team: "payments-checkout" }), PolicyError);
  await assert.rejects(() => newAsset(lib, U.u_cal, { visibility: "company" }), PolicyError);
  await assert.rejects(() => newAsset(lib, U.u_cal, { name: "  " }), ValidationError);
  await assert.rejects(() => newAsset(lib, U.u_cal, { bytes: bytes("{nope") }), /valid JSON/);
  const a = await newAsset(lib, U.u_cal, { tags: "A, b ,a" }); assert.deepEqual(a.tags, ["a", "b"]); assert.equal(a.versions[0].report.checked.length > 0, true);
});

test("owner edits drafts; approved details need an approver", async () => {
  const { lib } = await fresh();
  await lib.updateMetadata(U.u_cal, "seed_bounce", { name: "Renamed" });
  await assert.rejects(() => lib.updateMetadata(U.u_cal, "seed_success", { name: "x" }), PolicyError);
  assert.equal((await lib.updateMetadata(U.u_ada, "seed_success", { description: "ok" })).description, "ok");
});

test("collections are role-gated and removal cleans memberships", async () => {
  const { lib } = await fresh();
  await assert.rejects(() => lib.saveCollection(U.u_cal, { name: "X", type: "vertical", verticalId: "consumer" }), PolicyError);
  await assert.rejects(() => lib.saveCollection(U.u_ada, { name: "X", type: "company" }), PolicyError);
  const c = await lib.saveCollection(U.u_ada, { name: "Hints", type: "vertical", verticalId: "consumer" });
  const a = await lib.setAssetCollections(U.u_ada, "seed_pulse", [c.id]); assert.deepEqual(a.collectionIds, [c.id]);
  await lib.deleteCollection(U.u_ada, c.id); assert.deepEqual((await lib.getAsset(U.u_ada, "seed_pulse")).collectionIds, []);
});

test("config is admin-only and refuses to orphan assets", async () => {
  const { lib } = await fresh(); const cfg = await lib.getConfig();
  await assert.rejects(() => lib.saveConfig(U.u_ada, cfg), PolicyError);
  const without = { verticals: cfg.verticals.filter((v) => v.id !== "consumer") };
  await assert.rejects(() => lib.saveConfig(U.u_alex, without), /still used/);
  const added = { verticals: [...cfg.verticals, { name: "Labs", teams: [{ name: "R&D" }] }] };
  assert.equal((await lib.saveConfig(U.u_alex, added)).verticals.length, 4);
});

test("drafts are private to their owner and hold the binary in the store", async () => {
  const { lib } = await fresh();
  const m = await lib.saveDraft(U.u_cal, { name: "wip", format: "json", bytes: bytes(withImage()), params: { speed: 150 } });
  assert.equal((await lib.listDrafts(U.u_cal)).length, 1); assert.equal((await lib.listDrafts(U.u_ada)).length, 0);
  assert.equal(m.bytes, undefined);
  assert.equal((await lib.getDraft(U.u_cal, m.id)).params.speed, 150);
  await assert.rejects(() => lib.getDraft(U.u_ada, m.id), /no longer exists/);
  await lib.deleteDraft(U.u_cal, m.id); assert.equal((await lib.listDrafts(U.u_cal)).length, 0);
});

test("downloads convert formats and previews parse", async () => {
  const { lib } = await fresh();
  const j = await lib.getFile(U.u_alex, "seed_success", 1, "json"); assert.match(j.name, /\.json$/); assert.equal(JSON.parse(new TextDecoder().decode(j.bytes)).w, 200);
  const l = await lib.getFile(U.u_alex, "seed_spinner", 1, "lottie"); assert.match(l.name, /\.lottie$/);
  assert.equal((await lib.getPreview(U.u_alex, "seed_pulse")).nm, "pulse");
  assert.equal(deriveStatus({ deprecated: false, approvedVersion: null, versions: [{ status: "in_review" }] }), "in_review");
});
