// The welcome examples: one per scale (local site, regional project, international project), picked afresh on
// every load from a small pool (Rob, 22 Nov). The pool lives in the industry profile
// (catalogue/industries/<id>.json, "examples"), so each industry shows its own.
// - local: a site of a few hectares in places the atlas covers well (housing and warehouses are outside the
//   profile, so they also show the general-screen caveat).
// - regional: wind and solar schemes that are proposed but not yet decided, so the screen is genuinely before
//   consent and the map doesn't show them built. Newlands Hill (Scottish s36 inquiry) and The Droves (NSIP
//   EN0110013) were both undecided on 22 Nov 2026. Swap them out once decided.
// - global: projects from the IFC evaluation set with high or medium location confidence, calm and well documented.
// No oil and gas, no mining. Screening examples say where and how big, so the analyst acts rather than asks.
// Each should be tried through the live analyst before it goes in (docs/decisions.md).

// pool: { local: [...], regional: [...], global: [...] }. rand: () => [0, 1), so tests can pin the pick.
export function pickExamples(pool = {}, rand = Math.random) {
  return Object.values(pool).filter((list) => Array.isArray(list) && list.length).map((list) => list[Math.floor(rand() * list.length)]);
}
