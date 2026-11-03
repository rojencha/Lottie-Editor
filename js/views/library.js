// Library: search, filters, groups and asset cards with live previews.
import { app, verticalName, teamName, teamsOf } from "../state.js";
import { h, icon, clear, statusBadge, emptyState, skeletonGrid, ago, plural, bannerEl } from "../ui/dom.js";
import { go, href } from "../ui/router.js";
import { lazyMount } from "../ui/player.js";
import { STATUSES, STATUS_LABEL, can } from "../core/policy.js";
import { currentVersion } from "../data/library.js";
import { manageCollections, canManageAnyCollection } from "./collections-dialog.js";

const PAGE = 24, FILTER_KEYS = ["vertical", "team", "format", "status", "tag", "check", "collection"];
const CHECKS = [["clean", "No errors or warnings"], ["warnings", "Has warnings"], ["errors", "Has errors"], ["expressions", "Uses expressions"], ["images", "Contains images"]];

export async function render(ctx, view) {
  const q = ctx.query, u = app.user, setQ = (patch) => go("/library", { ...q, n: undefined, ...patch });
  view.append(h("div", { class: "page-head" },
    h("div", {}, h("h1", { class: "large-title" }, "Library"), h("p", { class: "lede" }, "Keep converted animations organized in groups, with versions and downloads in one place.")),
    h("div", { class: "actions" }, h("a", { class: "btn fill", href: "#/converter" }, icon("swap"), "Convert a file"))));
  const body = h("div", { class: "lib-layout" }); view.append(body);
  body.append(h("div", {}), skeletonGrid(8));
  let all, list;
  try { [all, list] = await Promise.all([app.lib.listAssets(u), app.lib.listAssets(u, q)]); }
  catch (e) { clear(body).append(bannerEl("error", "Couldn’t load the library", e.message)); return; }
  if (ctx.isStale()) return;
  const cols = await app.lib.listCollections(u);

  /* ---- facets: groups ---- */
  const countBy = (id) => all.filter((a) => a.collectionIds.includes(id)).length;
  const facets = h("aside", { class: "facets", "aria-label": "Groups" },
    h("h3", {}, "Groups"),
    h("button", { class: "facet", type: "button", "aria-pressed": String(!q.collection), onclick: () => setQ({ collection: undefined }) }, icon("grid"), "All assets", h("span", { class: "n" }, all.length)),
    cols.map((c) => h("button", { class: "facet", type: "button", "aria-pressed": String(q.collection === c.id), onclick: () => setQ({ collection: q.collection === c.id ? undefined : c.id }) }, icon("folder"), h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, c.name), h("span", { class: "n" }, countBy(c.id)))),
    canManageAnyCollection() ? h("button", { class: "facet", type: "button", onclick: () => manageCollections(() => go("/library", q, { replace: true })) }, icon("gear"), "Manage groups…") : null);

  /* ---- filters ---- */
  const uniq = (f) => [...new Map(all.map((a) => [f(a)[0], f(a)])).values()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const sel = (key, label, options) => {
    const s = h("select", { class: "pop" + (q[key] ? " on" : ""), "aria-label": label, onchange: (e) => setQ({ [key]: e.target.value || undefined, ...(key === "vertical" ? { team: undefined } : {}) }) },
      h("option", { value: "" }, label), options.map(([v, t]) => h("option", { value: v, selected: q[key] === v }, t)));
    return s;
  };
  const teams = q.vertical ? teamsOf(q.vertical).map((t) => [t.id, t.name]) : uniq((a) => [a.team, teamName(a.team)]).filter((x) => x[0]);
  const tags = [...new Set(all.flatMap((a) => a.tags))].sort().map((t) => [t, t]);
  const filtersOn = FILTER_KEYS.filter((k) => q[k] && k !== "collection").length > 0 || q.q || q.collection;
  const filters = h("div", { class: "filters", role: "group", "aria-label": "Filters" },
    sel("vertical", "Vertical", uniq((a) => [a.vertical, verticalName(a.vertical)])), sel("team", "Team", teams),
    sel("format", "Format", [["json", ".json"], ["lottie", ".lottie"]]),
    sel("status", "Status", STATUSES.map((s) => [s, STATUS_LABEL[s]])), sel("tag", "Tag", tags), sel("check", "Validation", CHECKS),
    filtersOn ? h("button", { class: "btn plain", type: "button", onclick: () => go("/library", {}) }, "Clear all") : null);

  const main = h("div", {}, filters);
  const limit = Math.max(PAGE, +q.n || PAGE), shown = list.slice(0, limit);
  const sortSel = h("select", { class: "pop", "aria-label": "Sort", onchange: (e) => setQ({ sort: e.target.value === "updated" ? undefined : e.target.value }) },
    [["updated", "Recently updated"], ["created", "Newest"], ["name", "Name"]].map(([v, t]) => h("option", { value: v, selected: (q.sort || "updated") === v }, t)));
  main.append(h("div", { class: "result-meta", role: "status" }, h("span", {}, q.q ? `${plural(list.length, "result")} for “${q.q}”` : plural(list.length, "asset")), sortSel));

  if (!all.length) main.append(emptyState({ icon: "tray", title: "The library is empty", text: "Convert an animation and save it to the library to get started.", actions: [h("a", { class: "btn fill", href: "#/converter" }, "Open converter")] }));
  else if (!list.length) main.append(emptyState({ icon: "search", title: "No matching assets", text: "Try a different search or remove some filters.", actions: [h("button", { class: "btn fill", type: "button", onclick: () => go("/library", {}) }, "Clear search and filters")] }));
  else {
    const grid = h("ul", { class: "grid", style: { listStyle: "none", margin: 0, padding: 0 } });
    for (const a of shown) grid.append(h("li", {}, card(a, ctx)));
    main.append(grid);
    if (list.length > shown.length) main.append(h("div", { class: "row", style: { justifyContent: "center", marginTop: "20px" } }, h("button", { class: "btn tint", type: "button", onclick: () => setQ({ n: limit + PAGE }) }, `Show more (${list.length - shown.length} left)`)));
  }
  clear(body).append(facets, main);
}

function card(a, ctx) {
  const v = currentVersion(a), thumb = h("div", { class: "thumb", "aria-hidden": "true" });
  ctx.onLeave(lazyMount(thumb, () => app.lib.getPreview(app.user, a.id, v.n)));
  const pending = a.approvedVersion != null && a.versions.some((x) => x.n > a.approvedVersion && x.status !== "deprecated");
  return h("a", { class: "card", href: href("/asset/" + a.id), "aria-label": `${a.name}, ${STATUS_LABEL[a.status]}` }, thumb,
    h("div", { class: "body" }, h("div", { class: "name" }, a.name),
      h("div", { class: "badges" }, statusBadge(a.status, STATUS_LABEL[a.status]), h("span", { class: "badge fmt" }, v.format === "lottie" ? ".lottie" : ".json"), pending ? h("span", { class: "badge plain" }, "Newer draft") : null),
      h("div", { class: "meta" }, `${verticalName(a.vertical)}${a.team ? " · " + teamName(a.team) : ""}`),
      h("div", { class: "meta" }, `Updated ${ago(a.updatedAt)}`)));
}
