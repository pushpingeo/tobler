// The run card's gaps, grouped so they can be read at a glance (Rob, 18 Nov):
//   - couldn't check: a source failed, timed out or wasn't fetched (from the tools, and the analyst's own lines);
//   - no data: nothing published for this here, or the catalogue holds nothing on it;
//   - caveats: everything else (rough sources, assumptions, hindsight, scope).
// The analyst's gap lines are plain sentences, so they're sorted by wording. A line that fits none stays a caveat.

const COULDNT = /\b(not checked|unchecked|couldn['’]?t|could not|cannot be checked|can['’]?t be checked|failed|failing|fails|errors?\b|timed? ?out|time-?out|unavailable|unreachable|did ?n['’]?o?t (load|respond|answer|return)|didn['’]?t (load|respond|answer|return)|no response|not respond|refused|blocked|down\b|not fetched|wasn['’]?t fetched|not (searched|queried))/i;
const NODATA = /\b(no (data|dataset|datasets|layer|layers|coverage|source|sources|mapped|published|record|records|map|maps|information)\b|not (in|held in) the catalogue|catalogue (has|holds) (no|nothing)|nothing (published|mapped|in the catalogue)|not mapped|isn['’]?t mapped|unmapped|not available (for|in|here)|none available|no .{0,40}\b(data|layer|dataset)s? (for|in|on|here|covering)|lacks?\b|missing\b|not covered|isn['’]?t covered|outside (its|the) coverage)/i;

export function gapKind(line) {
  const s = String(line || "");
  if (COULDNT.test(s)) return "couldnt";
  if (NODATA.test(s)) return "nodata";
  return "caveat";
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Sources the tools couldn't check go first under "couldn't check", unless the analyst already wrote a line
// naming them (a line that contains the dataset's name, or the first few words of it).
export function groupGaps(dataGaps = [], checked = []) {
  const out = { couldnt: [], nodata: [], caveat: [] };
  const lines = dataGaps.map(String).filter((g) => g.trim());
  const said = lines.map(norm).join(" | ");
  for (const c of checked.filter((x) => x.result === "not checked")) {
    const name = norm(c.dataset);
    const head = name.split(" ").slice(0, 3).join(" ");
    if (name && (said.includes(name) || (head.length >= 8 && said.includes(head)))) continue;
    // First sentence of the reason (not cut at "e.g."); the publisher only when the title doesn't already carry one.
    const why = c.why ? String(c.why).split(/(?<=\w{2}\.)\s+(?=[A-Z])/)[0] : "";
    const pub = c.publisher && !/\(/.test(c.dataset) ? ` (${c.publisher})` : "";
    out.couldnt.push(`${c.dataset}${pub}${why ? `: ${why.length > 160 ? `${why.slice(0, 159).trim()}…` : why}` : ""}`);
  }
  for (const g of lines) out[gapKind(g)].push(g);
  return out;
}

// Worded as the work left to do (Rob, 22 Nov): these are what a consultant still has to check.
export const GAP_GROUPS = [
  ["couldnt", "Not checked: check these yourself"],
  ["nodata", "No data here: may need a site visit or a local source"],
  ["caveat", "Assumptions and caveats"],
];

// "What still needs checking: 2 couldn't check, 3 no data, 1 caveat"
export function gapSummary(groups) {
  const bits = [];
  if (groups.couldnt.length) bits.push(`${groups.couldnt.length} couldn't check`);
  if (groups.nodata.length) bits.push(`${groups.nodata.length} no data`);
  if (groups.caveat.length) bits.push(`${groups.caveat.length} caveat${groups.caveat.length === 1 ? "" : "s"}`);
  return bits.length ? `What still needs checking: ${bits.join(", ")}` : "What still needs checking: nothing flagged";
}
