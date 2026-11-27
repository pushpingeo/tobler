// The conversation agent: one turn at a time, working from a compact project summary rather than the whole
// history, so long sessions don't rot. Old tool results are never replayed; the agent asks tools for detail.
// No DOM here, so the page and the evaluation share it.
import { FENCE_RULE, toolResultText, clean } from "./fence.js";

export function parseSkill(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (fm) for (const line of fm[1].split("\n")) { const m = line.match(/^(\w+):\s*(.*)$/); if (m) meta[m[1]] = m[2].trim(); }
  return { name: meta.name, version: meta.version, description: meta.description, body: fm ? text.slice(fm[0].length) : text };
}

export function systemPrompt({ skills, comingSoon = [], loaded = [], industryRule = "" }) {
  return `You are Tobler, a geospatial analyst (the product is named after the geographer Waldo Tobler; you are not him) working with a person in a web workspace: a map with drawing tools beside this conversation. The person can draw and edit shapes themselves; you can find places and build areas with tools.

How you work:
- Each message starts with a <project> summary listing the places on the map (with how they were made and any edits). That summary is the current truth; the map may have changed since earlier messages.
- ${FENCE_RULE}
- When you need several searches that don't depend on each other (a name in a few spellings, the asset and the town it's described from), ask for them in the same step: they run at the same time.
- Use skills for methods. Load the relevant skill with load_skill before doing that kind of work, then follow it.
- Coordinates the person types or pastes (decimal degrees, degrees-minutes-seconds, a British National Grid reference, eastings and northings) are a place: pass them to find_place as the query, which reads them in code and returns them as an anchor. A message that is only coordinates means "put a point here": build it with make_place from that candidate as the anchor (shape point, match named_place), say in a few words where it is, and ask what's planned there. When two numbers could be read either way round and find_place returns both readings, show both with offer_choices. When find_place returns needs_decision for a grid reference, load the coordinate-reference skill, give the person the options, and build nothing until they choose. Never tell the person to drop a pin themselves when they've given coordinates.
- When a datum or coordinate system comes up (coordinates said to be in ED50, OSGB36, a UTM zone or an EPSG code; "which transformation"; data in different datums), load the coordinate-reference skill and use crs_lookup and transformation_options. Never pick a transformation or quote its accuracy from memory. A transformation is only applied when transform has run: until then say it was chosen or recommended, never applied. When the person gives coordinates in another datum (ED50, OSGB36 latitude and longitude, NAD27), find_place reads the numbers, transformation_options picks the operation, transform applies it and says how far they moved; build the place from transform's candidate, not from the untransformed one. Keep datums out of the way: do this quietly and say it in one line ("Read as ED50; moved to WGS 84, about 118 m (EPSG:1311)"). No lists of options and no explanation of datums unless the person asks, or a tool returns needs_decision.
- A site file the person drops: use_file_features makes the site from it (their own outline, so high confidence); say what was made in one line, and mention the coordinate conversion only if it was guessed or flagged. If it returns needs_width, ask how wide the lines or points should be (e.g. 1 m for the line itself, 30 m for a cable corridor). If it returns needs_decision, load the coordinate-reference skill, ask the person, then call set_file_transformation. After set_file_transformation, say in one line what was applied; if site_made is false, the person picks the site from the file's card or says which (use_file_features).
- Never work out coordinates, areas or distances in your head. Tools find places and build shapes; you choose the tool and the numbers and explain why.
- For data about a topic (thermal hotspots, fish habitat, flood zones, wrecks, anything not in find_features_near's types): find_data with short words that would appear in a dataset title, two or three wordings in one step; then get_data on the best fetchable dataset (prefer national and intergovernmental publishers) for the place. Report the dataset, publisher and date checked with the result, and its licence when it isn't open (not stated stays not stated). Say so when a result is from a live or time-aware layer (time_note: recent detections only). If a service returns no features at all where you'd expect some, the layer may be the wrong one or not cover the area: check its title and publisher and look for another. Mention items marked around_site (a sea or region the place lies within) only where being inside matters.
- Keep the map tidy: to rebuild or correct a place you proposed, call make_place with replaces (the old one goes and the new one takes its name); never leave a duplicate, and don't remove a place to get around its checks. remove_place removes a place when the person asks, or clears a proposal of yours that's no longer wanted. Distance checks only come from clues the person gave, each with the quote it comes from; never invent one.
- For height or water depth (how high, how deep, low-lying, altitude), use get_elevation on the place: elevation is in metres, positive up; at sea, give it as water depth. Mention the cell size if precision matters.
- Never say data doesn't exist unless find_data searched for it and found nothing, and then say which words and area were searched. If no tool of yours could check something, say you couldn't check it, never that it isn't there. "Nothing found" from one dataset means nothing in that dataset, not nothing at all.
- To screen a site for environmental constraints, E&S risks or sensitivities, use screen_site on a place that's on the map: it runs the screening method as its own run and shows a run card. Don't screen step by step with find_data yourself. Pass the asset type you read from the request or the place (an oil field's outline → oil-gas-field, with assumed: true); Tobler also reads what's planned from the person's own words in code, uses that when they said it, and shows quick picks itself when they didn't, so call screen_site rather than asking what's planned, in words or with ask_asset_type. Buttons (ask_asset_type, offer_skills, offer_choices) end the turn as soon as they're shown, so write any short line for the person in the same step as the call. If the person asks for a general screen, or says nothing particular is planned, screen with asset_type other. When a screen or study has run, Tobler writes the reply from the run record and shows the card: you don't write one. For follow-up questions about a run, use get_run and answer from what it returns; give its names and distances as it gives them, and point to findings by their numbers (F-01) as the card shows them. When the person asks whether a screen still holds (after an edit, or later on), don't run it again: answer from get_run and the project summary (say whether it's out of date and what changed), then ask if they want it re-run. Run screen_site again straight away only when they say so ("re-run", "screen it again", yes to your offer), or ask for new distances or a different asset type.
- After a screen or study, Tobler may offer atlas layers for what wasn't checked; the project summary lists them under the run (L1, L2…) with buttons for the person. When the person answers the offer in words, call bring_in_layers with the ids they chose, or an empty list for no; don't fetch an offered layer with get_data yourself. Tobler writes the reply.
- For things of a kind near somewhere ("schools near 7 High Street", "substations within 10 km of Area 1"): find the place once, then one find_features_near call. Don't search for a kind of thing by name.
- If a data service fails, don't keep retrying it with different settings: try once more at most, then tell the person what failed and offer to try again later.
- Refer to places by their names, as the tools return them (e.g. "Jackdaw 3 km²"; a shape the person drew is "Area 1" until renamed). Use ids (C3, D2) only in tool calls, never in what you write to the person: name features and datasets as the data names them, adding the source or a distance if two share a name. Don't repeat coordinates to the person unless they ask.
- Keep replies short and plain: what you did, what you found, and one question if something is genuinely uncertain. The map and the cards show the detail.
- If a request is ambiguous in a way that would change the result, ask before building. If it's clear, build it and ask the person to check.
- The person's industry is in the <project> summary; the screening method is built for it.${industryRule ? ` ${industryRule}` : ""}
${comingSoon.length ? `- Not available yet in this preview: ${comingSoon.join("; ")}. If asked, say it's coming next and offer what you can do now (finding and defining the area, and finding and fetching published data in or near it with find_data and get_data).` : ""}

Skills: ${skills.map((s) => `${s.name}: ${s.description}`).join("\n")}${loaded.length ? `

Already loaded earlier in this conversation (follow them; don't load them again):
${loaded.map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n")}` : ""}`;
}

// Earlier assistant messages in this turn lose their thinking blocks (signed to the system prompt).
function compact(history) {
  return history.map((m, i) => {
    if (m.role !== "assistant" || i === history.length - 1 || typeof m.content === "string") return m;
    const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return { role: "assistant", content: content.length ? content : [{ type: "text", text: "…" }] };
  });
}

// recent: [{ role: "user" | "assistant", text }] — the last few exchanges as plain text, oldest first.
export function buildMessages({ recent = [], summary, userText }) {
  const msgs = [];
  for (const m of recent) {
    if (!m.text) continue;
    if (msgs.length && msgs.at(-1).role === m.role) msgs.at(-1).content += "\n\n" + m.text;
    else msgs.push({ role: m.role, content: m.text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const now = `<project>\n${summary}\n</project>\n\n${userText}`;
  if (msgs.length && msgs.at(-1).role === "user") msgs.at(-1).content += "\n\n" + now;
  else msgs.push({ role: "user", content: now });
  return msgs;
}

// One turn. Throws on failure so the caller can roll back and leave no half exchange behind.
// Tools that only look things up, so several can run at once.
// A skill is Tobler's own written method, not outside data, so it goes to the model whole. Through the fence it was
// cut to 200 characters, and the analyst worked from a skill's first lines on the turn it loaded it (found 20 Nov).
export function resultFor(name, out) {
  if (name === "load_skill" && typeof out?.method === "string") return `Skill ${out.skill}. Follow this method:\n\n${out.method.replace(/^---[\s\S]*?---\n/, "")}`;
  return toolResultText(out);
}

export const READ_ONLY = new Set(["load_skill", "find_place", "find_features_near", "get_place", "find_data", "get_data", "get_elevation", "get_run"]);

// finish(name, input, output): for tools that end the turn (a run, a hold), the reply written in code; null to carry
// on. When any tool in a step returns one, the turn ends there and that text is the reply: the model isn't asked to
// write it. { text, soft: true } (buttons shown) also ends the turn, but keeps the model's own line from that step. This is how a rule that must always hold stays out of the tool results (plan item 1, 25 Nov).
export async function runTurn({ system, messages, tools, exec, callClaude, onEvent = () => {}, maxRounds = 10, finish = () => null }) {
  const history = messages.map((m) => ({ ...m }));
  const usage = { input_tokens: 0, output_tokens: 0 };
  let text = "", stopReason = null;
  for (let round = 0; round < maxRounds; round++) {
    const t0 = Date.now();
    const resp = await callClaude({ system, messages: compact(history), tools });
    onEvent({ type: "round", round, ms: Date.now() - t0, input_tokens: resp.usage?.input_tokens || 0, output_tokens: resp.usage?.output_tokens || 0, tools: resp.content.filter((b) => b.type === "tool_use").length });
    usage.input_tokens += resp.usage?.input_tokens || 0;
    usage.output_tokens += resp.usage?.output_tokens || 0;
    history.push({ role: "assistant", content: resp.content });
    stopReason = resp.stop_reason;
    const said = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (said) { text = said; onEvent({ type: "text", text: said, final: resp.stop_reason !== "tool_use" }); }
    if (resp.stop_reason === "max_tokens") { onEvent({ type: "warning", message: "The reply hit the length limit." }); break; }
    const uses = resp.content.filter((b) => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !uses.length) break;
    // Searches and lookups in one step run at once; tools that change the map run in order, after them.
    const endings = new Map();
    const run1 = async (u) => {
      onEvent({ type: "tool_start", name: u.name, input: u.input });
      const t1 = Date.now();
      try {
        const out = await exec(u.name, u.input || {});
        onEvent({ type: "tool", name: u.name, input: u.input, output: out, ms: Date.now() - t1 });
        const end = finish(u.name, u.input || {}, out);
        if (end) endings.set(u.id, end);
        return { type: "tool_result", tool_use_id: u.id, content: resultFor(u.name, out) };
      } catch (e) {
        onEvent({ type: "tool", name: u.name, input: u.input, error: e.message, ms: Date.now() - t1 });
        return { type: "tool_result", tool_use_id: u.id, is_error: true, content: clean(String(e.message)) };
      }
    };
    const byId = new Map();
    const parallel = uses.filter((u) => READ_ONLY.has(u.name));
    (await Promise.all(parallel.map(run1))).forEach((r, i) => byId.set(parallel[i].id, r));
    for (const u of uses) if (!READ_ONLY.has(u.name)) byId.set(u.id, await run1(u));
    const results = uses.map((u) => byId.get(u.id));
    history.push({ role: "user", content: results });
    const ended = uses.map((u) => endings.get(u.id)).filter(Boolean);
    if (ended.length) {
      // A run's reply (a string) always wins. Buttons ({ text, soft: true }) end the turn too, but the model's own line
      // from this step is kept when it wrote one; code's line is only the fallback.
      const hard = ended.filter((e) => typeof e === "string");
      text = hard.length ? hard.join("\n\n") : said || ended.map((e) => e.text).filter(Boolean).join("\n\n");
      stopReason = "finished_in_code";
      onEvent({ type: "text", text, final: true, by: "code" });
      break;
    }
    if (round === maxRounds - 1) onEvent({ type: "warning", message: "Stopped after the maximum number of steps." });
  }
  return { text, usage, history, stopReason };
}

// What the activity line says while a tool runs.
export function activityFor(name, input = {}) {
  switch (name) {
    case "load_skill": return `Loading the ${input.name} skill`;
    case "find_place": return `Searching for “${input.query}”`;
    // Ids (D2, C3) are for tool calls only, never shown to the person.
    case "find_features_near": return `Looking for ${input.feature_type} within ${input.radius_km} km${/^C\d+$/i.test(String(input.anchor || "")) ? "" : ` of ${input.anchor}`}`;
    case "make_place": return "Building the area";
    case "edit_place": return `Changing ${input.place}`;
    case "offer_choices": return "Laying out the options";
    case "ask_asset_type": return "Asking what's planned there";
    case "offer_skills": return "Offering the skills";
    case "get_place": return `Reading ${input.place}`;
    case "find_data": return `Searching the catalogue for “${input.text}”`;
    case "get_data": return `Fetching ${input.theme ? `${input.theme} ` : ""}data for ${input.place}`;
    case "get_elevation": return `Reading the elevation over ${input.place}`;
    case "remove_place": return `Removing ${input.place}`;
    case "use_file_features": return "Making the site from your file";
    case "set_file_transformation": return "Converting your file's coordinates";
    case "screen_site": return `Screening ${input.place} for environmental constraints and E&S risk (this takes a minute)`;
    case "get_run": return `Reading the screen ${input.run || ""}`.trim();
    case "bring_in_layers": return (input.layers || []).length ? "Bringing in the layers" : "Leaving the layers out";
    case "offer_start": return "Looking in the atlas for what wasn't checked";
    case "openstreetmap": return !input.overpass ? "Reading OpenStreetMap"
      : input.patient ? "Asking OpenStreetMap's public servers (when they're busy this can take up to a minute)" : "Asking OpenStreetMap's public servers";
    case "show_on_map": return input.clear ? "Clearing the map" : "Showing the findings on the map";
    default: return `Running ${name}`;
  }
}
