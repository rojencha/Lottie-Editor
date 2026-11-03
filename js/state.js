// Shared app state. The UI never touches storage directly: everything goes through `app.lib`.
import { openStore } from "./data/store.js";
import { createLibrary } from "./data/library.js";
import { ensureSeeded } from "./data/seed.js";
import { rememberedUserId, remember, pickUser } from "./data/session.js";

export const app = { lib: null, store: null, user: null, users: [], config: { verticals: [] }, pending: null, listeners: new Set() };

export async function boot() {
  app.store = await openStore();
  await ensureSeeded(app.store);
  app.lib = createLibrary(app.store);
  await refreshDirectory();
  app.user = pickUser(app.users, rememberedUserId()) || app.users.find((u) => u.role === "contributor") || app.users[0];
}
export async function refreshDirectory() { app.config = await app.lib.getConfig(); app.users = await app.lib.getUsers(); }
export function setUser(id) { app.user = pickUser(app.users, id) || app.user; remember(app.user.id); app.listeners.forEach((f) => f()); }
export const onUserChange = (f) => { app.listeners.add(f); return () => app.listeners.delete(f); };
export async function resetDemo() { const { seedDemo } = await import("./data/seed.js"); await app.lib.resetAll(); await seedDemo(app.store); await refreshDirectory(); app.user = pickUser(app.users, app.user?.id) || app.users[0]; }

/* lookups */
export const verticalName = (id) => app.config.verticals.find((v) => v.id === id)?.name || id || "—";
export const teamName = (id) => { for (const v of app.config.verticals) { const t = v.teams.find((x) => x.id === id); if (t) return t.name; } return id || "—"; };
export const teamsOf = (vid) => app.config.verticals.find((v) => v.id === vid)?.teams || [];
