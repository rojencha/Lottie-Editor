// Library data-access service. This is the single boundary the UI talks to.
//
// LOCAL DEVELOPMENT ADAPTER: it enforces policy.js in the browser purely so every role can be exercised without a
// backend. That is NOT security. In production, implement this same interface as an API client and enforce the same
// rules server-side (see docs/HANDOFF). Nothing here logs animation contents.
import { readAnimationFile, toFormat, safeName } from "../core/convert.js";
import { analyze } from "../core/validate.js";
import { check, canView, inScope } from "../core/policy.js";

export class PolicyError extends Error {}
export class NotFoundError extends Error {}
export class ValidationError extends Error {}

const now = () => new Date().toISOString();
export const uid = (p) => p + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const must = (r) => { if (!r.ok) throw new PolicyError(r.reason); };
const MAX_REPORT_ISSUES = 60;

/** Lifecycle of the asset as a whole. A newer draft version never changes it. */
export function deriveStatus(a) {
  if (a.deprecated) return "deprecated";
  if (a.approvedVersion != null) return "approved";
  return a.versions.some((v) => v.status === "in_review") ? "in_review" : "draft";
}
export const latestVersion = (a) => a.versions[a.versions.length - 1];
export const currentVersion = (a) => a.versions.find((v) => v.n === (a.approvedVersion ?? -1)) || latestVersion(a);
export const fileName = (a, v, format) => `${safeName(a.name)}-v${v.n}.${format === "lottie" ? "lottie" : "json"}`;

/** Parse + analyse stored bytes. The report always describes exactly the bytes that are saved. */
export async function inspect(bytes, name = "file") {
  const { format, anims, missing } = await readAnimationFile(bytes, { name, inline: true });
  const rep = analyze(anims[0][1], { sizeBytes: bytes.length, missingAssets: missing });
  if (anims.length > 1) rep.issues.push({ level: "warning", id: "multi-anim", title: `Contains ${anims.length} animations`, detail: "Previews and edits use the first animation only. The file is stored unchanged.", count: anims.length });
  const issues = rep.issues.slice(0, MAX_REPORT_ISSUES);
  const counts = { error: 0, warning: 0, info: 0 }; for (const i of rep.issues) counts[i.level]++;
  return { format, animCount: anims.length, info: rep.info, report: { counts, issues, checked: rep.checked, notChecked: rep.notChecked, at: now() } };
}

export function createLibrary(store) {
  const previews = new Map(); // "assetId:n" -> parsed animation (bounded)
  const history = (a, user, action, detail = "") => { a.history.push({ at: now(), by: user.id, byName: user.name, action, detail }); a.updatedAt = now(); };
  const load = async (id) => { const a = await store.get("assets", id); if (!a) throw new NotFoundError("This asset no longer exists."); return a; };
  const loadFor = async (user, id, action) => { const a = await load(id); must(check(user, action, { ...a, status: deriveStatus(a) })); return a; };
  const save = async (a) => { a.status = deriveStatus(a); await store.put("assets", a.id, a); return a; };
  const getConfig = async () => (await store.get("config", "main")) || { verticals: [] };

  async function validateScope({ vertical, team }) {
    const cfg = await getConfig(); const v = cfg.verticals.find((x) => x.id === vertical);
    if (!v) throw new ValidationError("Choose a vertical for this asset.");
    if (team && !v.teams.some((t) => t.id === team)) throw new ValidationError("That team isn't part of the selected vertical.");
  }
  const cleanName = (n) => { const s = String(n || "").trim().replace(/\s+/g, " "); if (!s) throw new ValidationError("Give the asset a name."); if (s.length > 120) throw new ValidationError("Names can be up to 120 characters."); return s; };
  const cleanTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || "").split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const cleanDesc = (d) => String(d || "").trim().slice(0, 1000);

  async function newVersion(a, user, { bytes, note, status = "draft" }) {
    const n = a.versions.length ? latestVersion(a).n + 1 : 1;
    const ins = await inspect(bytes, a.name);
    const key = `${a.id}:${n}`; await store.put("files", key, { key, bytes });
    const v = { n, createdAt: now(), authorId: user.id, authorName: user.name, note: String(note || "").trim().slice(0, 300), status, format: ins.format, size: bytes.length, fileKey: key, animCount: ins.animCount, info: ins.info, report: ins.report };
    a.versions.push(v); return v;
  }

  const lib = {
    storeKind: store.kind, persistent: store.persistent,
    getConfig, getUsers: async () => (await store.get("config", "users")) || [],

    /* ---------- assets ---------- */
    async listAssets(user, f = {}) {
      let list = (await store.all("assets")).filter((a) => canView(user, a));
      const q = String(f.q || "").toLowerCase().split(/\s+/).filter(Boolean);
      const cfg = await getConfig(), vname = Object.fromEntries(cfg.verticals.map((v) => [v.id, v.name]));
      list = list.filter((a) => {
        if (f.vertical && a.vertical !== f.vertical) return false;
        if (f.team && a.team !== f.team) return false;
        if (f.collection && !a.collectionIds.includes(f.collection)) return false;
        if (f.owner && a.ownerId !== f.owner) return false;
        if (f.status && deriveStatus(a) !== f.status) return false;
        if (f.tag && !a.tags.includes(f.tag)) return false;
        const cv = currentVersion(a);
        if (f.format && cv.format !== f.format) return false;
        if (f.check) {
          const c = cv.report.counts, imgs = cv.info.images;
          const ok = { clean: !c.error && !c.warning, warnings: c.warning > 0, errors: c.error > 0, expressions: cv.report.issues.some((i) => i.id === "expressions"), images: imgs.embedded + imgs.external > 0 }[f.check];
          if (!ok) return false;
        }
        if (q.length) { const hay = [a.name, a.description, a.tags.join(" "), a.ownerName, vname[a.vertical] || "", a.source?.name || ""].join(" ").toLowerCase(); if (!q.every((t) => hay.includes(t))) return false; }
        return true;
      });
      const sort = f.sort || "updated";
      list.sort(sort === "name" ? (x, y) => x.name.localeCompare(y.name) : sort === "created" ? (x, y) => y.createdAt.localeCompare(x.createdAt) : (x, y) => y.updatedAt.localeCompare(x.updatedAt));
      return list;
    },
    async getAsset(user, id) { return loadFor(user, id, "asset.view"); },

    async createAsset(user, input) {
      const name = cleanName(input.name), scope = { vertical: input.vertical, team: input.team || null, visibility: input.visibility };
      must(check(user, "asset.create", scope)); await validateScope(scope);
      const collectionIds = await lib._checkCollections(user, input.collectionIds || [], []);
      const a = { id: uid("asset"), name, description: cleanDesc(input.description), tags: cleanTags(input.tags), ...scope, collectionIds, ownerId: user.id, ownerName: user.name,
        createdAt: now(), updatedAt: now(), versions: [], approvedVersion: null, deprecated: false, source: input.source || null, history: [] };
      await newVersion(a, user, { bytes: input.bytes, note: input.note || "Initial version" });
      history(a, user, "created", input.source ? `Duplicated from ${input.source.name} v${input.source.version}` : "Created"); return save(a);
    },

    async addVersion(user, id, { bytes, note }) {
      const a = await loadFor(user, id, "asset.addVersion");
      const v = await newVersion(a, user, { bytes, note });
      history(a, user, "version_added", `Version ${v.n} added as draft` + (a.approvedVersion != null ? `; version ${a.approvedVersion} remains approved` : "")); previews.delete(`${id}:${v.n}`); return save(a);
    },

    async updateMetadata(user, id, p) {
      const a = await loadFor(user, id, "asset.editMetadata"); const ch = [];
      if (p.name !== undefined) { const n = cleanName(p.name); if (n !== a.name) { ch.push("name"); a.name = n; } }
      if (p.description !== undefined) { a.description = cleanDesc(p.description); ch.push("description"); }
      if (p.tags !== undefined) { a.tags = cleanTags(p.tags); ch.push("tags"); }
      history(a, user, "details_edited", ch.join(", ") || "no changes"); return save(a);
    },

    async updateScope(user, id, p) {
      const a = await loadFor(user, id, "asset.editScope");
      const next = { vertical: p.vertical ?? a.vertical, team: p.team === undefined ? a.team : p.team, visibility: p.visibility ?? a.visibility };
      must(check(user, "asset.create", next)); await validateScope(next);
      Object.assign(a, next); history(a, user, "scope_changed", `${next.vertical}${next.team ? " / " + next.team : ""}, ${next.visibility}`); return save(a);
    },

    async submit(user, id, n) {
      const a = await loadFor(user, id, "asset.submit"), v = a.versions.find((x) => x.n === n);
      if (!v || v.status !== "draft") throw new ValidationError("Only draft versions can be submitted for review.");
      if (a.deprecated) throw new ValidationError("Deprecated assets can't be submitted. Duplicate the asset to start a new one.");
      v.status = "in_review"; history(a, user, "submitted", `Version ${n} submitted for review`); return save(a);
    },

    /** Explicit approver action. The only way approvedVersion ever changes. */
    async approve(user, id, n) {
      const a = await loadFor(user, id, "asset.approve"), v = a.versions.find((x) => x.n === n);
      if (!v || v.status !== "in_review") throw new ValidationError("Only versions that are in review can be approved.");
      if (a.deprecated) throw new ValidationError("This asset is deprecated.");
      const prev = a.approvedVersion != null ? a.versions.find((x) => x.n === a.approvedVersion) : null;
      if (prev) prev.status = "deprecated";
      v.status = "approved"; a.approvedVersion = n;
      history(a, user, "approved", `Version ${n} approved` + (prev ? `; version ${prev.n} superseded and kept in history` : "")); return save(a);
    },

    async rejectReview(user, id, n, reason) {
      const a = await loadFor(user, id, "asset.approve"), v = a.versions.find((x) => x.n === n);
      if (!v || v.status !== "in_review") throw new ValidationError("This version isn't in review.");
      v.status = "draft"; history(a, user, "returned", `Version ${n} returned to draft${reason ? ": " + String(reason).slice(0, 200) : ""}`); return save(a);
    },

    async deprecate(user, id) {
      const a = await loadFor(user, id, "asset.deprecate");
      if (a.deprecated) throw new ValidationError("This asset is already deprecated.");
      a.deprecated = true; for (const v of a.versions) if (v.status === "approved") v.status = "deprecated";
      history(a, user, "deprecated", "Asset deprecated. All versions stay available in history."); return save(a);
    },

    /** Creates a NEW asset (never touches the source). Inherits details, links back to source asset + version. */
    async duplicate(user, id, { version, name } = {}) {
      const src = await loadFor(user, id, "asset.duplicate");
      const v = src.versions.find((x) => x.n === (version ?? src.approvedVersion ?? latestVersion(src).n)); if (!v) throw new NotFoundError("That version doesn't exist.");
      const rec = await store.get("files", v.fileKey); if (!rec) throw new NotFoundError("The file for this version is missing from storage.");
      const cfg = await getConfig(); let scope = { vertical: src.vertical, team: src.team, visibility: src.visibility };
      if (!check(user, "asset.create", scope).ok) {
        const vert = inScope(user, src.vertical) ? src.vertical : user.verticals[0] || cfg.verticals[0]?.id;
        const team = user.teams.find((t) => cfg.verticals.find((x) => x.id === vert)?.teams.some((y) => y.id === t)) || null;
        scope = { vertical: vert, team, visibility: team ? "team" : "vertical" };
      }
      // Collections are curated by managers, so a copy starts unfiled; description and tags are inherited.
      const a = { id: uid("asset"), name: name ? cleanName(name) : `Copy of ${src.name}`.slice(0, 120), description: src.description, tags: [...src.tags], ...scope, collectionIds: [], ownerId: user.id, ownerName: user.name,
        createdAt: now(), updatedAt: now(), versions: [], approvedVersion: null, deprecated: false, source: { assetId: src.id, name: src.name, version: v.n }, history: [] };
      must(check(user, "asset.create", scope)); await validateScope(scope);
      await newVersion(a, user, { bytes: rec.bytes, note: `Copied from ${src.name} v${v.n}` });
      history(a, user, "created", `Duplicated from ${src.name} v${v.n}`); return save(a);
    },

    async getFile(user, id, n, as) {
      const a = await loadFor(user, id, "asset.download"), v = a.versions.find((x) => x.n === (n ?? currentVersion(a).n));
      if (!v) throw new NotFoundError("That version doesn't exist.");
      const rec = await store.get("files", v.fileKey); if (!rec) throw new NotFoundError("The file for this version is missing from storage.");
      const format = as || v.format, bytes = await toFormat(rec.bytes, v.format, format, { name: a.name });
      return { bytes, format, name: fileName(a, v, format), version: v };
    },

    /** Parsed animation (images inlined) for live previews. Bounded in-memory cache. */
    async getPreview(user, id, n) {
      const a = await loadFor(user, id, "asset.view"), v = a.versions.find((x) => x.n === (n ?? currentVersion(a).n)); if (!v) throw new NotFoundError("That version doesn't exist.");
      const k = `${id}:${v.n}`; if (previews.has(k)) return previews.get(k);
      const rec = await store.get("files", v.fileKey); if (!rec) throw new NotFoundError("The file for this version is missing from storage.");
      const { anims } = await readAnimationFile(rec.bytes, { name: a.name });
      if (previews.size > 40) previews.delete(previews.keys().next().value);
      previews.set(k, anims[0][1]); return anims[0][1];
    },

    /* ---------- collections ---------- */
    async listCollections(user) {
      return (await store.all("collections")).filter((c) => user.role === "admin" || c.type === "company" || (c.type === "vertical" && user.verticals.includes(c.verticalId)) || (c.type === "team" && (user.teams.includes(c.teamId) || (user.role === "approver" && user.verticals.includes(c.verticalId)))))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async saveCollection(user, c) {
      const col = { id: c.id || uid("col"), name: String(c.name || "").trim().slice(0, 80), description: String(c.description || "").trim().slice(0, 300), type: c.type, verticalId: c.verticalId || null, teamId: c.teamId || null };
      if (!col.name) throw new ValidationError("Give the collection a name.");
      if (!["company", "vertical", "team"].includes(col.type)) throw new ValidationError("Choose who the collection is for.");
      if (col.type !== "company" && !col.verticalId) throw new ValidationError("Choose a vertical for this collection.");
      if (col.type === "team" && !col.teamId) throw new ValidationError("Choose a team for this collection.");
      must(check(user, "collection.manage", col));
      if (c.id) { const old = await store.get("collections", c.id); if (old) must(check(user, "collection.manage", old)); }
      await store.put("collections", col.id, col); return col;
    },
    async deleteCollection(user, id) {
      const col = await store.get("collections", id); if (!col) return; must(check(user, "collection.manage", col));
      await store.del("collections", id);
      for (const a of await store.all("assets")) if (a.collectionIds.includes(id)) { a.collectionIds = a.collectionIds.filter((x) => x !== id); await store.put("assets", a.id, a); }
    },
    async _checkCollections(user, next, prev) {
      const all = new Map((await store.all("collections")).map((c) => [c.id, c])), out = [];
      for (const id of new Set(next)) {
        const c = all.get(id); if (!c) continue;
        if (!prev.includes(id)) must(check(user, "collection.manage", c));
        out.push(id);
      }
      for (const id of prev) if (!next.includes(id)) { const c = all.get(id); if (c) must(check(user, "collection.manage", c)); }
      return out;
    },
    async setAssetCollections(user, id, collectionIds) {
      const a = await loadFor(user, id, "asset.view"); a.collectionIds = await lib._checkCollections(user, collectionIds, a.collectionIds);
      history(a, user, "collections_changed", `${a.collectionIds.length} collection(s)`); return save(a);
    },

    /* ---------- configuration (verticals and teams) ---------- */
    async saveConfig(user, cfg) {
      must(check(user, "config.manage"));
      const seen = new Set(), clean = { verticals: [] };
      for (const v of cfg.verticals || []) {
        const name = String(v.name || "").trim(); if (!name) throw new ValidationError("Every vertical needs a name.");
        const id = v.id || uid("vert"); if (seen.has(id)) throw new ValidationError("Duplicate vertical."); seen.add(id);
        const teams = [];
        for (const t of v.teams || []) { const tn = String(t.name || "").trim(); if (!tn) throw new ValidationError(`Every team in ${name} needs a name.`); const tid = t.id || uid("team"); if (seen.has(tid)) throw new ValidationError("Duplicate team."); seen.add(tid); teams.push({ id: tid, name: tn }); }
        clean.verticals.push({ id, name, teams });
      }
      if (!clean.verticals.length) throw new ValidationError("Keep at least one vertical.");
      const keep = new Set(seen), users = [...(await store.all("assets")), ...(await store.all("collections"))];
      for (const x of users) {
        const vid = x.vertical || x.verticalId, tid = x.team || x.teamId;
        if (vid && !keep.has(vid)) throw new ValidationError(`Can't remove a vertical that is still used by "${x.name}". Move or deprecate it first.`);
        if (tid && !keep.has(tid)) throw new ValidationError(`Can't remove a team that is still used by "${x.name}". Move that asset first.`);
      }
      await store.put("config", "main", { id: "main", ...clean }); return clean;
    },

    /* ---------- private drafts (editor working copies) ---------- */
    async listDrafts(user) { return (await store.all("drafts")).filter((d) => d.ownerId === user.id).map(({ bytes, ...meta }) => meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async getDraft(user, id) { const d = await store.get("drafts", id); if (!d || d.ownerId !== user.id) throw new NotFoundError("This draft no longer exists."); return d; },
    async saveDraft(user, d) {
      if (d.id) { const old = await store.get("drafts", d.id); if (old && old.ownerId !== user.id) throw new PolicyError("This draft belongs to someone else."); }
      const rec = { id: d.id || uid("draft"), ownerId: user.id, name: cleanName(d.name), format: d.format, bytes: d.bytes, params: d.params, source: d.source || null, size: d.bytes.length, updatedAt: now() };
      await store.put("drafts", rec.id, rec); const { bytes, ...meta } = rec; return meta;
    },
    async deleteDraft(user, id) { const d = await store.get("drafts", id); if (d && d.ownerId === user.id) await store.del("drafts", id); },

    async resetAll() { await store.clear(); previews.clear(); },
  };
  return lib;
}
