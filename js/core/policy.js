// Roles, scopes and permission rules.
//
// IMPORTANT: this module describes the rules and is used by the UI for guidance and by the local development adapter.
// Client-side checks are NOT security. A production deployment must re-implement these same rules on the server and
// enforce them on every request (see docs: "Production integration").

export const ROLES = ["viewer", "contributor", "approver", "admin"];
export const ROLE_LABEL = { viewer: "Viewer", contributor: "Contributor", approver: "Approver", admin: "Administrator" };
export const STATUSES = ["draft", "in_review", "approved", "deprecated"];
export const STATUS_LABEL = { draft: "Draft", in_review: "In review", approved: "Approved", deprecated: "Deprecated" };
export const VISIBILITIES = ["company", "vertical", "team"];
export const VISIBILITY_LABEL = { company: "Company-wide", vertical: "Vertical", team: "Team" };
const RANK = { viewer: 0, contributor: 1, approver: 2, admin: 3 };

/** @typedef {{id:string,name:string,role:'viewer'|'contributor'|'approver'|'admin',verticals:string[],teams:string[]}} User */
const rank = (u) => RANK[u && u.role] ?? -1;
const isAdmin = (u) => rank(u) >= 3;

/** Is the user a member of the vertical (and team, if given)? Approvers cover every team of their verticals. */
export function inScope(u, vertical, team) {
  if (!u) return false; if (isAdmin(u)) return true;
  if (!vertical || !u.verticals.includes(vertical)) return false;
  if (!team) return true;
  return u.teams.includes(team) || rank(u) >= 2;
}

export function canView(u, a) {
  if (!u) return false; if (isAdmin(u)) return true;
  if (a.visibility === "company") return true;
  if (a.visibility === "vertical") return u.verticals.includes(a.vertical);
  return u.teams.includes(a.team) || (rank(u) >= 2 && u.verticals.includes(a.vertical));
}

export function allowedVisibilities(u, vertical, team) {
  if (rank(u) < 1) return [];
  const out = [];
  if (team && inScope(u, vertical, team)) out.push("team");
  if (vertical && inScope(u, vertical)) out.push("vertical");
  if (rank(u) >= 2 && u.verticals.length + (isAdmin(u) ? 1 : 0) > 0) out.push("company");
  return out;
}

const deny = (reason) => ({ ok: false, reason });
const ok = { ok: true, reason: "" };

/**
 * Central permission check. -> { ok, reason }  (reason is plain language, safe to show to users)
 * ctx: an asset (for asset.* actions), a scope {vertical,team,visibility} (asset.create), or a collection scope.
 */
export function check(u, action, ctx = {}) {
  const r = rank(u), role = u ? ROLE_LABEL[u.role] : "Signed out";
  const need = (min, what) => (r >= min ? null : deny(`${role}s can't ${what}. This needs ${ROLE_LABEL[ROLES[min]]} access or higher.`));
  const outOfScope = () => deny("This asset belongs to a vertical or team you aren't a member of.");
  switch (action) {
    case "asset.view": case "asset.download": return canView(u, ctx) ? ok : deny("You don't have access to this asset.");
    case "asset.create": {
      const n = need(1, "create assets"); if (n) return n;
      if (!ctx.vertical) return deny("Choose a vertical for this asset.");
      if (!allowedVisibilities(u, ctx.vertical, ctx.team).includes(ctx.visibility))
        return deny(ctx.visibility === "company" ? "Only Approvers and Administrators can make an asset company-wide." : "You can only save to verticals and teams you belong to.");
      return ok;
    }
    case "asset.duplicate": { const n = need(1, "duplicate assets"); if (n) return n; return canView(u, ctx) ? ok : deny("You don't have access to this asset."); }
    case "asset.addVersion": {
      const n = need(1, "add versions"); if (n) return n; if (!canView(u, ctx)) return outOfScope();
      if (isAdmin(u) || (rank(u) >= 2 && inScope(u, ctx.vertical, ctx.team)) || ctx.ownerId === u.id) return ok;
      return deny("Only the owner, or an Approver of this vertical, can add versions.");
    }
    case "asset.editMetadata": {
      const n = need(1, "edit asset details"); if (n) return n; if (!canView(u, ctx)) return outOfScope();
      if (isAdmin(u) || (rank(u) >= 2 && inScope(u, ctx.vertical, ctx.team))) return ok;
      if (ctx.ownerId === u.id && (ctx.status === "draft" || ctx.status === "in_review")) return ok;
      return deny("Details of approved or deprecated assets can only be changed by an Approver of this vertical. Duplicate the asset to make your own version.");
    }
    case "asset.editScope": {
      const n = need(2, "change who can see an asset"); if (n) return n;
      return isAdmin(u) || inScope(u, ctx.vertical, ctx.team) ? ok : outOfScope();
    }
    case "asset.submit": {
      const n = need(1, "submit assets for review"); if (n) return n; if (!canView(u, ctx)) return outOfScope();
      return ctx.ownerId === u.id || isAdmin(u) || (rank(u) >= 2 && inScope(u, ctx.vertical, ctx.team)) ? ok : deny("Only the owner or an Approver can submit this asset for review.");
    }
    case "asset.approve": case "asset.deprecate": case "asset.archive": {
      const n = need(2, "approve, deprecate or archive assets"); if (n) return n;
      return isAdmin(u) || inScope(u, ctx.vertical, ctx.team) ? ok : outOfScope();
    }
    case "collection.manage": {
      const n = need(2, "manage collections"); if (n) return n;
      if (isAdmin(u)) return ok;
      if (ctx.type === "company") return deny("Only Administrators manage company-wide collections.");
      return inScope(u, ctx.verticalId, ctx.type === "team" ? ctx.teamId : null) ? ok : outOfScope();
    }
    case "config.manage": return isAdmin(u) ? ok : deny("Only Administrators can change verticals and teams.");
    case "admin.access": return r >= 2 ? ok : deny("Administration is available to Approvers and Administrators.");
    default: return deny("Unknown action.");
  }
}
export const can = (u, action, ctx) => check(u, action, ctx).ok;

/** Plain-language description of who will be able to see an asset (for the upload disclosure). */
export function visibleToText(visibility, vertical, team) {
  if (visibility === "company") return "everyone signed in to the company library";
  if (visibility === "vertical") return `members of ${vertical || "the selected vertical"}`;
  return `members of ${team || "the selected team"} and Approvers of ${vertical || "its vertical"}`;
}

/** Human-readable role summary used on the Administration page. */
export const ROLE_SUMMARY = [
  { role: "viewer", can: "Browse and download assets they can access." },
  { role: "contributor", can: "Everything a Viewer can, plus convert files, duplicate assets, create assets and add versions in their own verticals and teams, and submit them for review." },
  { role: "approver", can: "Everything a Contributor can, plus approve, deprecate and archive assets, change visibility, publish company-wide, and manage collections within their verticals." },
  { role: "admin", can: "Everything, across all verticals. Manages verticals, teams and company-wide configuration." },
];
