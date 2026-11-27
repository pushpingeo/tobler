// What's planned at a site, read from the person's own words in code (package E, 27 Nov): matched against the asset
// table's names (catalogue/assets.json, each row's names and general.planned). Pure, so it can be tested.
//
// It reads only what the person plainly said is planned: a name with a word that sets it up ("for a solar farm",
// "as a housing site", "a proposed warehouse", "a 200-home scheme"), never one that sits beside the site ("near the
// wind farm", "keep 50 m from homes"). A miss costs little (the model's reading, or the quick picks, take over); a
// wrong read screens the wrong thing, so it errs on missing. Rob, 27 Nov: code's reading wins over the model's.

// Words before a name that make it what's planned.
const LEAD = String.raw`(?:\b(?:for|as)\s+(?:(?:an?|the|our|my|this|some)\s+)?|\b(?:proposed|planned|new|possible|future|prospective)\s+|\bscreen(?:ing)?\s+an?\s+|\b(?:build|building|develop|developing|site|siting|put|putting|install|installing|locate|locating|construct|constructing|plan|planning)\s+(?:(?:an?|the|our|my|some)\s+)?|\b(?:this|our|my|it'?s|it\s+is|it'?ll\s+be|it\s+will\s+be)\s+(?:(?:an?|the)\s+)?|^\s*(?:(?:an?)\s+)?|\ban?\s+(?=\d))`;
// What can sit between those words and the name: a size, and plain describing words.
const SIZE = String.raw`(?:\d[\d,.]*\s*(?:-\s*|\s)?(?:mw|megawatts?|gw|ha|hectares?|acres?|km²|km2)?\s*(?:-\s*)?)?`;
const ADJ = String.raw`(?:(?:proposed|planned|new|small|large|big|onshore|offshore|utility[- ]scale|ground[- ]mounted|floating|solar|wind)\s+)*`;
const LEAD_RE = new RegExp(`${LEAD}${ADJ}${SIZE}${ADJ}$`, "i");
// Words after a name that make it what's planned ("housing site", "warehouse scheme").
const TAIL_RE = /^\s*(?:site|location|scheme|development|project|proposal|application|plot|parcel)\b/i;
// Lead words strong enough to win over a "to" or "near" just before them ("I'd like to screen a warehouse location").
const SETS_UP_RE = /\b(?:for|as|screen(?:ing)?\s+(?:an?|the)|build|building|develop|developing|site|siting|put|putting|install|installing|locate|locating|construct|constructing|plan|planning)\s/i;
// A project's own name between the words that set it up and what it is ("for the proposed Newlands Hill wind farm",
// "screen the Reventazón hydropower dam"): up to four capitalised words, only after these lead words. A bare
// "Screen Whitelee wind farm" isn't read (the name could be what's already there).
const PROPER_RE = /(?:[\p{Lu}][\p{L}\p{M}\p{N}'’.&-]*\s+){1,4}$/u;
const NAMED_LEAD_RE = /(?:\b(?:for|as)\s+(?:the|our|my|this)\s+(?:(?:proposed|planned|new)\s+)?|\bscreen(?:ing)?\s+the\s+(?:(?:proposed|planned|new)\s+)?|\b(?:proposed|planned)\s+)$/i;
// Words just before that put it beside the site, or deny it.
const NOT_RE = /\b(?:not|no|isn'?t|aren'?t|rather\s+than|instead\s+of|except|near|nearby|next\s+to|beside|by|from|around|to|existing|operational|neighbou?ring|adjacent\s+to|close\s+to|away\s+from|of\s+the|than)\s+(?:(?:an?|the|any|our|my|this|its|nearest)\s+)?[\w\s,.-]{0,12}$/i;
// Words after a name that put it beside the site ("a wind farm is next door").
const BESIDE_AFTER_RE = /^\s*(?:is|are|was|were|lies|sits|stands)\s+(?:right\s+|just\s+)?(?:next|near|nearby|beside|close|adjacent|over|across|along|up|down|on\s+the|in\s+the|to\s+the)\b/i;
// "Just a general screen", "nothing particular planned": the person chose no asset.
const GENERAL_RE = /\b(?:general\s+screen|nothing\s+(?:in\s+)?particular(?:\s+is)?\s+planned|nothing\s+(?:is\s+)?planned|not\s+sure\s+what(?:'s|\s+is)?\s+planned|don'?t\s+know\s+(?:yet\s+)?what(?:'s|\s+is)?\s+planned)\b/i;
const MW_RE = /(\d[\d,]*(?:\.\d+)?)\s*(mw|megawatts?|gw)\b/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every name in the table, longest first, each with what it reads as.
function namesOf(table) {
  const out = [];
  for (const [id, row] of Object.entries(table?.assets || {})) for (const n of row.names || []) out.push({ name: n, asset_type: id, label: row.label });
  for (const g of table?.general?.planned || []) {
    for (const n of g.names || []) out.push({ name: n, planned: g.label, label: g.label });
    for (const c of g.counts || []) out.push({ count: c, planned: g.label, label: g.label });
  }
  return out.sort((a, b) => (b.name || b.count).length - (a.name || a.count).length);
}

// A row that doesn't suit where the place is gives way to its pair (wind farm words for a site at sea).
function forSetting(table, id, offshore) {
  const row = table.assets[id];
  const setting = offshore ? "offshore" : "onshore";
  if (row?.[setting] || !row?.pair || !table.assets[row.pair]?.[setting]) return id;
  return row.pair;
}

// One message: what it says is planned, as a list of distinct readings (more than one: the person named several).
export function readMessage(text, table, { offshore = false } = {}) {
  const t = String(text || "");
  const taken = [], beside = [];
  const found = [];
  // Second pass: a name joined to one already read ("a solar farm with battery storage") is planned too.
  const JOIN_RE = new RegExp(String.raw`^\s*,?\s*(?:with|and|plus|\+|&)\s+(?:(?:an?|some)\s+)?${ADJ}${SIZE}${ADJ}$`, "i");
  for (const pass of [1, 2]) for (const e of namesOf(table)) {
    const re = e.count
      ? new RegExp(String.raw`(?<![\w-])\d[\d,]*\s*(?:-\s*|\s)(?:new\s+)?${esc(e.count)}s?(?![\w-])`, "gi")
      : new RegExp(String.raw`(?<![\w-])${esc(e.name)}${/s$/.test(e.name) ? "" : "s?"}(?![\w-])`, "gi");
    for (const m of t.matchAll(re)) {
      const at = m.index, end = at + m[0].length;
      if ([...taken, ...beside].some(([a, b]) => at < b && end > a)) continue;
      const before = t.slice(Math.max(0, at - 80), at);
      let lead = e.count ? before.match(new RegExp(`${LEAD}${ADJ}$`, "i")) : before.match(LEAD_RE);
      if (!lead && !e.count) {
        const pn = before.match(PROPER_RE);
        const l2 = pn && before.slice(0, before.length - pn[0].length).match(NAMED_LEAD_RE);
        if (l2) lead = [l2[0] + pn[0]];
      }
      const tail = t.slice(end, end + 30).match(TAIL_RE);
      const joined = pass === 2 && taken.some(([, b]) => b <= at && at - b <= 40 && JOIN_RE.test(t.slice(b, at)));
      if (pass === 1 ? !lead && !tail : !joined) continue;
      // Words that put it beside the site, unless what sets it up ("for a", "as a", "screen a") comes after them.
      // A name refused as beside the site takes the shorter names inside it with it ("wind farm", then "wind").
      if (BESIDE_AFTER_RE.test(t.slice(end + (tail ? tail[0].length : 0), end + 60))
        || (pass === 1 && (NOT_RE.test(before) || (lead && NOT_RE.test(before.slice(0, before.length - lead[0].length))))
          && !(lead && SETS_UP_RE.test(lead[0])))) { beside.push([at, end]); continue; }
      taken.push([at, end]);
      const from = pass === 1 && lead ? at - lead[0].length : at;
      const words = t.slice(from, end + (tail ? tail[0].length : 0)).replace(/^\s*(?:for|as)\s+/i, "").replace(/\s+/g, " ").trim();
      const what = e.asset_type ? { asset_type: forSetting(table, e.asset_type, offshore) } : { planned: e.planned };
      what.label = what.asset_type ? table.assets[what.asset_type].label : e.label;
      // Named twice: one reading, quoting the "for a" or "as a" phrase if there is one.
      const strong = !!(lead && /\b(?:for|as)\s/i.test(lead[0]));
      const same = found.find((f) => f.label === what.label);
      if (!same) found.push({ ...what, words, strong });
      else if (strong && !same.strong) Object.assign(same, { words, strong });
    }
  }
  return found.map(({ strong, ...f }) => f);
}

// The person's messages that bear on this run, oldest first: newest wins. Returns one of
//   { asset_type, label, words, capacity_mw? }      a row in the table
//   { planned, label, words }                        something with no row (housing): general defaults, its label
//   { several: [{…}, {…}], words }                   more than one named in the same message: ask which
//   { general: true, words }                         they asked for a general screen
//   null                                             nothing said
export function readAsset(messages, table, { offshore = false } = {}) {
  if (!table?.assets) return null;
  const list = (Array.isArray(messages) ? messages : [messages]).filter((m) => typeof m === "string" && m.trim());
  for (let k = list.length - 1; k >= 0; k--) {
    const text = list[k];
    const found = readMessage(text, table, { offshore });
    const general = text.match(GENERAL_RE);
    if (found.length > 1) return { several: found, words: found.map((f) => f.words).join("; ") };
    if (found.length === 1) {
      const mw = text.match(MW_RE);
      const capacity = mw ? +mw[1].replace(/,/g, "") * (/^gw$/i.test(mw[2]) ? 1000 : 1) : null;
      return { ...found[0], ...(found[0].asset_type && capacity > 0 ? { capacity_mw: capacity } : {}) };
    }
    if (general) return { general: true, words: general[0] };
  }
  return null;
}

// How the asset was settled, for the card and the record: the person's words, a pick, or the model's guess.
// `input` is what the analyst passed to screen_site; `read` is readAsset's answer. Returns the input to run with
// and `from`, or `ask` when it must be confirmed first (Rob, 27 Nov: only when the person didn't say).
export function settleAsset(input, read, { table } = {}) {
  const i = { ...input };
  const model = { asset_type: input.asset_type ?? null, ...(input.planned ? { planned: input.planned } : {}), ...(input.assumed ? { assumed: true } : {}) };
  if (read?.several) return { ask: "several", options: read.several, words: read.words, model };
  if (read?.asset_type) {
    Object.assign(i, { asset_type: read.asset_type, assumed: false });
    delete i.planned;
    if (read.capacity_mw && !(+input.capacity_mw > 0)) i.capacity_mw = read.capacity_mw;
    return { input: i, from: { by: "words", words: read.words, ...(differs(model, read) ? { model } : {}) } };
  }
  if (read?.planned) {
    Object.assign(i, { asset_type: "other", planned: read.planned, assumed: false });
    return { input: i, from: { by: "words", words: read.words, ...(differs(model, read) ? { model } : {}) } };
  }
  if (read?.general) {
    Object.assign(i, { asset_type: "other", assumed: false });
    delete i.planned;
    return { input: i, from: { by: "words", words: read.words, general: true } };
  }
  // Nothing in the person's words (a pick from the buttons is words too: "Screen X as a solar farm site"). The
  // analyst's reading is offered first as a guess; with none, the plain picks.
  const known = !!table?.assets?.[input.asset_type] || (input.asset_type === "other" && !!input.planned);
  return { ask: known ? "guess" : "unsaid", model };
}
const differs = (model, read) => (read.asset_type ? model.asset_type !== read.asset_type : model.planned?.toLowerCase() !== read.planned?.toLowerCase());
