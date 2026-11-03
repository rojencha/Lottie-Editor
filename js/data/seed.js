// DEMO DATA for local development only. Verticals, teams, users and assets here are fictional examples; in production
// they come from the company directory and the real library. The Administration page can reset this at any time.
import { enc } from "../core/zip.js";
import { toFormat } from "../core/convert.js";
import { inspect, uid, deriveStatus } from "./library.js";

export const SEED_CONFIG = { id: "main", verticals: [
  { id: "consumer", name: "Consumer Apps", teams: [{ id: "consumer-growth", name: "Growth" }, { id: "consumer-core", name: "Core Experience" }] },
  { id: "payments", name: "Payments", teams: [{ id: "payments-checkout", name: "Checkout" }, { id: "payments-risk", name: "Risk & Trust" }] },
  { id: "marketing", name: "Marketing", teams: [{ id: "marketing-brand", name: "Brand" }, { id: "marketing-campaigns", name: "Campaigns" }] },
] };

export const DEV_USERS = [
  { id: "u_vera", name: "Vera Viewer", role: "viewer", verticals: ["consumer"], teams: ["consumer-growth"] },
  { id: "u_cal", name: "Cal Contributor", role: "contributor", verticals: ["consumer"], teams: ["consumer-growth"] },
  { id: "u_pia", name: "Pia Payments", role: "contributor", verticals: ["payments"], teams: ["payments-checkout"] },
  { id: "u_ada", name: "Ada Approver", role: "approver", verticals: ["consumer", "marketing"], teams: ["consumer-growth", "consumer-core", "marketing-brand"] },
  { id: "u_alex", name: "Alex Admin", role: "admin", verticals: [], teams: [] },
];

/* ---- tiny procedural animations so seeded previews are alive ---- */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
const S = (k) => ({ a: 0, k }), ease = (n) => ({ i: { x: Array(n).fill(0.5), y: Array(n).fill(1) }, o: { x: Array(n).fill(0.5), y: Array(n).fill(0) } });
const kfs = (arr, n) => ({ a: 1, k: arr.map(([t, s], i) => (i < arr.length - 1 ? { ...ease(n), t, s } : { t, s })) });
const fill = (c) => ({ ty: "fl", c: S([...hex(c), 1]), o: S(100) });
const stroke = (c, w) => ({ ty: "st", c: S([...hex(c), 1]), o: S(100), w: S(w), lc: 2, lj: 2 });
const group = (items, tr = {}) => ({ ty: "gr", it: [...items, { ty: "tr", p: S([0, 0]), a: S([0, 0]), s: S([100, 100]), r: S(0), o: S(100), ...tr }] });
const layer = (ind, nm, shapes, ks = {}) => ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: S(100), r: S(0), p: S([100, 100, 0]), a: S([0, 0, 0]), s: S([100, 100, 100]), ...ks }, ao: 0, shapes, ip: 0, op: 60, st: 0, bm: 0 });
const base = (nm, layers) => ({ v: "5.7.0", fr: 30, ip: 0, op: 60, w: 200, h: 200, nm, ddd: 0, assets: [], layers });
const circle = (r) => ({ ty: "el", p: S([0, 0]), s: S([r * 2, r * 2]) });

export function makeSeedAnim(kind, c1, c2) {
  switch (kind) {
    case "pulse": return base("pulse", [
      layer(1, "Dot", [group([circle(34), fill(c1)])], { s: kfs([[0, [100, 100, 100]], [30, [125, 125, 100]], [60, [100, 100, 100]]], 3) }),
      layer(2, "Ring", [group([circle(52), stroke(c2, 6)])], { o: kfs([[0, [100]], [30, [30]], [60, [100]]], 1) })]);
    case "spinner": return base("spinner", [
      layer(1, "Arc", [group([{ ty: "rc", p: S([0, 0]), s: S([70, 70]), r: S(18) }, stroke(c1, 10)])], { r: kfs([[0, [0]], [60, [360]]], 1) }),
      layer(2, "Dot", [group([circle(8), fill(c2)])])]);
    case "bounce": return base("bounce", [
      layer(1, "Ball", [group([circle(26), fill(c1)])], { p: kfs([[0, [100, 60, 0]], [30, [100, 140, 0]], [60, [100, 60, 0]]], 3) }),
      layer(2, "Shadow", [group([{ ty: "el", p: S([0, 0]), s: S([60, 12]) }, fill(c2)])], { p: S([100, 170, 0]), o: kfs([[0, [30]], [30, [80]], [60, [30]]], 1) })]);
    default: return base("success", [
      layer(1, "Check", [group([{ ty: "sh", ks: S({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-24, 2], [-6, 20], [26, -18]], c: false }) }, stroke(c2, 12), { ty: "tm", s: S(0), e: kfs([[8, [0]], [38, [100]]], 1), o: S(0), m: 1 }])]),
      layer(2, "Badge", [group([circle(60), fill(c1)])], { s: kfs([[0, [60, 60, 100]], [18, [100, 100, 100]]], 3) })]);
  }
}

const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();

async function put(store, spec) {
  const a = { id: spec.id, name: spec.name, description: spec.desc, tags: spec.tags, vertical: spec.vertical, team: spec.team || null, visibility: spec.visibility,
    collectionIds: spec.cols || [], ownerId: spec.owner.id, ownerName: spec.owner.name, createdAt: ago(spec.age), updatedAt: ago(spec.age - spec.versions.length),
    versions: [], approvedVersion: null, deprecated: !!spec.deprecated, source: spec.source || null, history: [] };
  a.history.push({ at: ago(spec.age), by: spec.owner.id, byName: spec.owner.name, action: "created", detail: spec.source ? `Duplicated from ${spec.source.name} v${spec.source.version}` : "Created" });
  let n = 0;
  for (const v of spec.versions) {
    n++; let bytes = enc.encode(JSON.stringify(makeSeedAnim(v.kind, v.c1, v.c2)));
    if (v.format === "lottie") bytes = await toFormat(bytes, "json", "lottie", { name: spec.name });
    const ins = await inspect(bytes, spec.name), key = `${spec.id}:${n}`;
    await store.put("files", key, { key, bytes });
    a.versions.push({ n, createdAt: ago(spec.age - n), authorId: spec.owner.id, authorName: spec.owner.name, note: v.note || (n === 1 ? "Initial version" : ""), status: v.status, format: ins.format, size: bytes.length, fileKey: key, animCount: ins.animCount, info: ins.info, report: ins.report });
    if (v.status === "approved") { a.approvedVersion = n; a.history.push({ at: ago(spec.age - n), by: "u_ada", byName: "Ada Approver", action: "approved", detail: `Version ${n} approved` }); }
    if (v.status === "in_review") a.history.push({ at: ago(spec.age - n), by: spec.owner.id, byName: spec.owner.name, action: "submitted", detail: `Version ${n} submitted for review` });
  }
  a.status = deriveStatus(a); await store.put("assets", a.id, a);
}

export async function seedDemo(store) {
  await store.put("config", "main", SEED_CONFIG); await store.put("config", "users", DEV_USERS);
  const U = Object.fromEntries(DEV_USERS.map((u) => [u.id, u]));
  const cols = [
    { id: "col_brand", name: "Brand essentials", description: "Approved motion that every product can use.", type: "company", verticalId: null, teamId: null },
    { id: "col_loading", name: "Loading & progress", description: "Spinners and progress indicators for Consumer Apps.", type: "vertical", verticalId: "consumer", teamId: null },
    { id: "col_checkout", name: "Checkout moments", description: "Confirmation and trust animations.", type: "vertical", verticalId: "payments", teamId: null },
  ];
  for (const c of cols) await store.put("collections", c.id, c);
  await put(store, { id: "seed_success", name: "Success checkmark", desc: "Confirmation badge with a drawn checkmark. Use after a completed action.", tags: ["success", "confirmation", "feedback"], vertical: "consumer", team: null, visibility: "company", owner: U.u_ada, cols: ["col_brand"], age: 40,
    versions: [{ kind: "check", c1: "#34c759", c2: "#ffffff", status: "approved", format: "lottie" }, { kind: "check", c1: "#30b350", c2: "#ffffff", status: "draft", note: "Slightly deeper green for contrast", format: "lottie" }] });
  await put(store, { id: "seed_spinner", name: "Loading spinner", desc: "Compact spinner for buttons and cards.", tags: ["loading", "spinner"], vertical: "consumer", team: null, visibility: "vertical", owner: U.u_ada, cols: ["col_loading"], age: 30,
    versions: [{ kind: "spinner", c1: "#0a84ff", c2: "#ff9f0a", status: "approved", format: "json" }] });
  await put(store, { id: "seed_pulse", name: "Growth pulse", desc: "Attention pulse for onboarding hints.", tags: ["onboarding", "hint"], vertical: "consumer", team: "consumer-growth", visibility: "team", owner: U.u_cal, age: 12,
    versions: [{ kind: "pulse", c1: "#bf5af2", c2: "#5e5ce6", status: "in_review", format: "json" }] });
  await put(store, { id: "seed_bounce", name: "Welcome bounce", desc: "Playful bouncing ball for the welcome screen.", tags: ["welcome", "onboarding"], vertical: "consumer", team: "consumer-growth", visibility: "team", owner: U.u_cal, age: 5,
    versions: [{ kind: "bounce", c1: "#ff375f", c2: "#8e8e93", status: "draft", format: "json" }] });
  await put(store, { id: "seed_pay_ok", name: "Payment confirmed", desc: "Checkout confirmation moment.", tags: ["checkout", "success"], vertical: "payments", team: "payments-checkout", visibility: "vertical", owner: U.u_pia, cols: ["col_checkout"], age: 25,
    versions: [{ kind: "check", c1: "#0a84ff", c2: "#ffffff", status: "approved", format: "lottie" }] });
  await put(store, { id: "seed_old_pulse", name: "Legacy pulse (old brand)", desc: "Retired with the previous brand refresh. Kept for reference.", tags: ["legacy"], vertical: "marketing", team: "marketing-brand", visibility: "company", owner: U.u_ada, age: 90, deprecated: true,
    versions: [{ kind: "pulse", c1: "#ff9f0a", c2: "#ff453a", status: "deprecated", format: "json" }] });
  await put(store, { id: "seed_copy", name: "Copy of Success checkmark", desc: "Success confirmation badge with a drawn checkmark. Use after a completed action.", tags: ["success", "confirmation", "feedback"], vertical: "consumer", team: "consumer-growth", visibility: "team", owner: U.u_cal, age: 3,
    source: { assetId: "seed_success", name: "Success checkmark", version: 1 }, versions: [{ kind: "check", c1: "#ff9f0a", c2: "#ffffff", status: "draft", note: "Copied from Success checkmark v1", format: "lottie" }] });
}

export async function ensureSeeded(store) { if (!(await store.get("config", "main"))) await seedDemo(store); }
