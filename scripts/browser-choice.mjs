// Headless browser check of two small things from Rob's Miri log (18 Nov): picking from the choices shows the
// person a name, not a candidate id, while the analyst still gets the id; and the scale bar sits below the zoom
// buttons. Model scripted, no network, no cost.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-choice.mjs [chrome path].
import { chromium } from "playwright-core";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);

const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
const sent = [];
// Scripted replies, oldest first; when the queue is empty the model just says "Done."
const queue = [];
const msg = (content, stop = "end_turn") => ({ id: "m", type: "message", role: "assistant", stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });
await page.route(/tobler-api.*\/v1\/messages/, (r) => {
  sent.push(JSON.parse(r.request().postData()));
  const body = JSON.parse(r.request().postData());
  let next = queue.shift() || msg([{ type: "text", text: "Done." }]);
  if (typeof next === "function") next = next(JSON.stringify(body.messages.at(-1).content));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
});
await page.goto("http://localhost:8000/");
await page.waitForFunction(() => window.__ws?.map?.loaded?.() || document.querySelector(".maplibregl-canvas"), null, { timeout: 30000 });
await page.waitForTimeout(1500);

// The scale bar below the zoom buttons.
const pos = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const z = r(".maplibregl-ctrl-zoom-out"), s = r(".maplibregl-ctrl-scale");
  return z && s ? { zoomBottom: z.bottom, scaleTop: s.top } : null;
});
check(pos && pos.scaleTop >= pos.zoomBottom, `desktop: scale bar below the zoom buttons (${JSON.stringify(pos)})`);

// A pick from the choices.
const cand = (id, name, lon, lat) => ({ id, name, type: "place: city", geometry: { type: "Point", coordinates: [lon, lat] }, source: { publisher: "OpenStreetMap contributors", title: "Nominatim search", url: "https://www.openstreetmap.org", licence: "ODbL 1.0" } });
await page.evaluate(([a, b]) => window.__ws.host.offerChoices({ choices: [a, b], recommended: a, reason: "The city most people mean." }), [cand("C29", "Miri", 113.988, 4.394), cand("C30", "Miri Division", 114, 4)]);
await page.waitForSelector('.choices [data-op="use"]', { state: "visible" });
await page.click('.choices [data-op="use"]');
await page.waitForFunction(() => document.querySelectorAll(".msg.analyst").length && !document.querySelector(".msg.analyst:last-child")?.textContent.includes("Thinking"), null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
const bubble = await page.evaluate(() => [...document.querySelectorAll(".msg.user")].at(-1)?.textContent || "");
check(bubble === "Use Miri (OpenStreetMap contributors).", `the person's message names the pick, no id ("${bubble}")`);
const toModel = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
check(/candidate C29/.test(toModel) && /match named_place/.test(toModel), "the analyst still gets the candidate id and how to build it");
// The analyst removes places (Ben Nevis log, 20 Nov): its own proposal unasked; an accepted place only when asked.
const box = (x, y) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.05, y], [x + 0.05, y + 0.03], [x, y + 0.03], [x, y]]] } });
await page.evaluate(([a, b]) => {
  const h = window.__ws.host;
  h.addPlace({ feature: a, origin: { method: "words", words: "Ben Nevis", confidence: "low", steps: ["point"], checks: [] }, name: "Ben Nevis" });
  const k = h.addPlace({ feature: b, origin: { method: "words", words: "Ben Nevis SAC", confidence: "medium", steps: ["outline of Ben Nevis"], checks: [] }, name: "Ben Nevis SAC" });
  k.status = "accepted";
}, [box(-5.0, 56.79), box(-4.95, 56.81)]);
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const turn = async (text) => {
  const before = await page.evaluate(() => document.querySelectorAll(".msg.analyst").length);
  await page.fill("#say", text);
  await page.click("button.send");
  await page.waitForFunction((n) => document.querySelectorAll(".msg.analyst").length > n && !document.querySelector("#ask")?.classList.contains("busy"), before, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
};
queue.push(msg([use("t1", "remove_place", { place: "Ben Nevis", reason: "a duplicate of mine" }), use("t2", "remove_place", { place: "Ben Nevis SAC", reason: "tidying" })], "tool_use"), msg([{ type: "text", text: "Removed my duplicate." }]));
await turn("Thanks, that looks right.");
let state = await page.evaluate(() => ({ names: window.__ws.host.places().map((p) => p.name), gone: [...document.querySelectorAll(".gone .summary")].map((e) => e.textContent) }));
check(!state.names.includes("Ben Nevis") && state.gone.some((t) => /Removed by the analyst: a duplicate of mine/.test(t)), `its own proposal is removed and its card says so (${JSON.stringify(state)})`);
check(state.names.includes("Ben Nevis SAC"), "an accepted place stays when the person didn't ask");
const toolResults = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
check(/remove it only when they ask/.test(toolResults), "the analyst is told why the accepted place stayed");
queue.push(msg([use("t3", "remove_place", { place: "Ben Nevis SAC", reason: "the person asked" })], "tool_use"), msg([{ type: "text", text: "Removed." }]));
await turn("Please remove Ben Nevis SAC.");
state = await page.evaluate(() => window.__ws.host.places().map((p) => p.name));
check(!state.includes("Ben Nevis SAC"), `an accepted place goes when the person asks (${JSON.stringify(state)})`);

// A place and an activity in one message (Rob, 24 Nov): "screen a warehouse location in Livingston". The analyst
// finds Livingston and tries to screen it straight away; the screen is held until the person has seen the place.
await page.route(/nominatim/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify([{ osm_type: "relation", osm_id: 1, lat: "55.886", lon: "-3.522", category: "place", type: "town", name: "Livingston", display_name: "Livingston, West Lothian, Scotland, United Kingdom", importance: 0.6, address: { country: "United Kingdom" } }]) }));
let placeName = "";
queue.push(
  msg([use("t4", "find_place", { query: "Livingston" })], "tool_use"),
  (last) => msg([use("t5", "make_place", { anchor: (last.match(/C\d+/) || [])[0], shape: "circle", radius_km: 3, words: "a warehouse location in Livingston", match: "named_place", reason: "the town named" })], "tool_use"),
  (last) => { placeName = (last.match(/\\"place\\":\\"([^\\]+)/) || last.match(/\\"name\\":\\"([^\\]+)/) || [])[1] || "Livingston"; return msg([use("t6", "screen_site", { place: placeName, asset_type: "other", planned: "a warehouse" })], "tool_use"); },
  msg([{ type: "text", text: "I've put Livingston on the map. Is that the right place?" }]),
);
await turn("I would like to screen a warehouse location in Livingston");
const held = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
const lv = await page.evaluate(() => ({ runs: document.querySelectorAll(".run").length, proposed: window.__ws.host.places().filter((p) => p.status === "proposed").map((p) => p.name), trace: [...document.querySelectorAll(".trace li")].map((li) => li.textContent).join(" | ") }));
check(/not_yet/.test(held) && /haven't seen it/.test(held), `the screen is held until the person has seen ${placeName} (${held.slice(0, 160)})`);
check(lv.runs === 0 && lv.proposed.length >= 1, `no run card; the place waits as a proposal (${JSON.stringify(lv.proposed)})`);
check(/Not screened yet/.test(lv.trace), "the working-out says it wasn't screened yet");
await page.screenshot({ path: "/tmp/choice-livingston.png" });

// Skill chips (Rob, 24 Nov): the screen runs; skills not built yet are "soon" chips that say what they'll do, with no
// model call; a chip that doesn't suit the place's role is hidden.
const chipsNow = () => page.evaluate(() => [...document.querySelectorAll(".chips .chip")].filter((b) => !b.hidden).map((b) => `${b.firstChild.textContent}${b.classList.contains("soon") ? " (soon)" : ""}`));
let chips = await chipsNow();
check(chips.includes("Contamination desk study") && chips.includes("Developable area (soon)") && chips.some((c) => /^Screen/.test(c)), `the skill chips show for an area (${JSON.stringify(chips)})`);
const calls = sent.length;
await page.click('.chip.soon[data-skill="developable-area"]');
await page.waitForTimeout(300);
const note = await page.evaluate(() => document.querySelector(".soon-note:last-of-type")?.textContent || "");
check(/Developable area isn't built yet\. How much of the site could be built on/.test(note) && sent.length === calls, `a "soon" chip says what it will do, with no model call (${note.slice(0, 90)})`);
await page.evaluate(() => { const h = window.__ws.host; h.addPlace({ feature: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-3.6, 55.97] } }, origin: { method: "drawn" }, name: "Pin 1" }); });
await page.waitForTimeout(300);
await page.evaluate(() => window.__ws.focus?.("Pin 1"));
chips = await chipsNow();
const focused = await page.evaluate(() => document.querySelector(".place.active, .card.active")?.textContent?.slice(0, 20) || "");
check(!chips.includes("Developable area (soon)") && chips.includes("Contamination desk study"), `developable area is hidden for a point (${JSON.stringify(chips)}; focused ${focused})`);
await page.screenshot({ path: "/tmp/choice-chips.png" });

// A place and what's planned, but no analysis named (Shell House, Perth, 24 Nov): the analyst offers the skills as
// buttons; the screen button sends a screen request as the person's next message.
queue.push(msg([use("t7", "offer_skills", { place: placeName })], "tool_use"), msg([{ type: "text", text: "Which would you like?" }]));
await turn(`I'd like to site a warehouse on ${placeName}`);
const pick = await page.evaluate(() => [...([...document.querySelectorAll(".skill-pick")].at(-1)?.querySelectorAll(".chip") || [])].map((b) => `${b.firstChild.textContent}${b.classList.contains("soon") ? " (soon)" : ""}`));
check(pick.length === 3 && /^Screen/.test(pick[0]) && pick.includes("Contamination desk study") && pick.includes("Developable area (soon)"), `the skills offered as buttons (${JSON.stringify(pick)})`);
await page.screenshot({ path: "/tmp/choice-skillpick.png" });
queue.push(msg([{ type: "text", text: "Screening." }]));
const before2 = sent.length;
await page.locator(".skill-pick").last().locator(".chip:not(.soon)").first().click();
await page.waitForFunction((n) => !document.querySelector("#ask")?.classList.contains("busy"), before2, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const lastUser = sent.at(-1)?.messages?.filter((m) => m.role === "user").at(-1);
const lastText = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content || "");
check(/Screen Livingston[^"]* for environmental constraints\./.test(lastText), `the screen button sends a screen request (${lastText.slice(0, 90)})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
