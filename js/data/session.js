// MOCK AUTHENTICATION — DEV ONLY.
// Production must use the company's identity provider (SSO/OIDC) and derive role, verticals and teams from verified
// server-side claims. This stub just remembers which seeded dev user is "signed in" so every role can be tried.
const KEY = "lap.devUser"; // stores only a user id, never animation data

export function rememberedUserId() { try { return localStorage.getItem(KEY); } catch { return null; } }
export function remember(id) { try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch { /* storage unavailable: session-only */ } }
export function pickUser(users, id) { return users.find((u) => u.id === id) || null; }
