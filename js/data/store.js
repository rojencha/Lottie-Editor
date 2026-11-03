// LOCAL DEVELOPMENT STORAGE ADAPTER.
// Persists library data in the browser's IndexedDB (or memory if unavailable). Animation binaries go in the "files"
// store (never localStorage). Replace with a server-backed implementation of the same five-method interface in production.
export const STORES = ["assets", "files", "collections", "config", "drafts"];

export function memoryStore() {
  const m = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return {
    kind: "memory", persistent: false,
    async get(s, k) { const v = m[s].get(k); return v === undefined ? undefined : structuredClone(v); },
    async put(s, k, v) { m[s].set(k, structuredClone(v)); },
    async del(s, k) { m[s].delete(k); },
    async all(s) { return [...m[s].values()].map((v) => structuredClone(v)); },
    async clear() { for (const s of STORES) m[s].clear(); },
  };
}

export function idbStore(name = "lottie-platform-dev") {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const s of STORES) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("Storage is blocked by another tab."));
  }));
  const run = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode); let out;
      const rq = fn(t); if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    kind: "indexeddb", persistent: true,
    get: (s, k) => run(s, "readonly", (t) => t.objectStore(s).get(k)),
    put: (s, k, v) => run(s, "readwrite", (t) => t.objectStore(s).put(v, k)),
    del: (s, k) => run(s, "readwrite", (t) => t.objectStore(s).delete(k)),
    all: (s) => run(s, "readonly", (t) => t.objectStore(s).getAll()),
    clear: () => run(STORES, "readwrite", (t) => { for (const s of STORES) t.objectStore(s).clear(); }),
  };
}

/** Prefer IndexedDB; fall back to memory (private windows, blocked storage) so the app still works for the session. */
export async function openStore() {
  try {
    if (!globalThis.indexedDB) throw new Error("no indexedDB");
    const s = idbStore(); await s.get("config", "_probe"); return s;
  } catch { return memoryStore(); }
}
