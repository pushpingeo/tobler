// Headless browser check of three UX points from Rob (20 Nov): a dropped point is named after the settlement it's
// near and can be renamed on its card; screening a place with no asset type asks with quick picks first; and at the
// end of a turn its first result sits at the top of the conversation. Desktop and phone. Model scripted, no cost.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-ux.mjs [chrome path].
import { chromium } from "playwright-core";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
const msg = (content, stop = "end_turn") => ({ id: "m", type: "message", role: "assistant", stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });
const LONG = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}: a long answer that runs well past the height of the panel, so the start would be lost if the panel jumped to the bottom.`).join("\n\n");

for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|wikidata|overpass|nominatim\.openstreetmap\.org\/search/, (r) => r.abort());
  await page.route(/nominatim\.openstreetmap\.org\/reverse/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ address: { town: "Linlithgow", county: "West Lothian" } }) }));
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  const sent = [], queue = [];
  await page.route(/tobler-api.*\/v1\/messages/, (r) => {
    sent.push(JSON.parse(r.request().postData()));
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(queue.shift() || msg([{ type: "text", text: "Done." }])) });
  });
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  const openPanel = () => page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));

  // Drop a point with the drawing tools: it's named after the settlement it's near.
  await page.click("#drawbtn");
  await page.click('#tools [data-mode="point"]');
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.add("collapsed"));
  const mapBox = await page.evaluate(() => { const r = document.querySelector(".maplibregl-canvas").getBoundingClientRect(); return { x: r.right - 120, y: r.top + 160 }; });
  await page.mouse.click(mapBox.x, mapBox.y);
  await page.waitForFunction(() => /near Linlithgow/.test(document.querySelector(".shape h2 .name")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  await openPanel();
  const name1 = await page.evaluate(() => document.querySelector(".shape h2 .name")?.textContent);
  check(name1 === "Point near Linlithgow", `${label}: a dropped point is named after the settlement it's near (${name1})`);

  // Rename it on the card: tap the name, type, Enter. Old names still find the place.
  await page.click(".shape h2 .name");
  await page.fill(".shape h2 input.rename", "Kettlestoun site");
  await page.press(".shape h2 input.rename", "Enter");
  const ren = await page.evaluate(() => ({ name: document.querySelector(".shape h2 .name").textContent, box: !!document.querySelector(".shape h2 input.rename"),
    byOld: window.__ws.host.findPlace("Point near Linlithgow")?.name, byCount: window.__ws.host.findPlace("Point 1")?.name,
    history: document.querySelector(".shape .history").textContent }));
  check(ren.name === "Kettlestoun site" && !ren.box && ren.byOld === "Kettlestoun site" && ren.byCount === "Kettlestoun site" && /renamed from Point near Linlithgow to Kettlestoun site \(by you\)/.test(ren.history),
    `${label}: renamed on the card; old names still find it; the edit is in its history`);
  await page.click(".shape h2 .name");
  await page.fill(".shape h2 input.rename", "Something else");
  await page.press(".shape h2 input.rename", "Escape");
  check(await page.evaluate(() => document.querySelector(".shape h2 .name").textContent) === "Kettlestoun site", `${label}: Escape cancels a rename`);

  // The screen chip asks what's planned: land picks, More…, a general screen. A pick screens at once.
  await page.click(".chip[data-screen]");
  await page.waitForSelector(".asset-pick");
  const picks = await page.evaluate(() => [...document.querySelectorAll(".asset-pick .picks button")].map((b) => b.textContent));
  check(picks.slice(0, 6).join("|") === "Solar farm|Onshore wind|Oil and gas|Mine|Pipeline or cable|Substation" && picks.at(-2) === "More…" && picks.at(-1) === "Just a general screen",
    `${label}: what's planned? land picks, More…, general (${picks.join(", ")})`);
  check(sent.length === 0, `${label}: asking costs no model call`);
  await page.click(".asset-pick .more");
  const all = await page.evaluate(() => [...document.querySelectorAll(".asset-pick .picks button")].map((b) => b.textContent));
  check(all.includes("Hydro") && all.includes("Road or rail") && !all.includes("Offshore wind") && !all.includes("More…") && all.at(-1) === "Just a general screen", `${label}: More… shows the rest for the setting`);
  queue.push(msg([{ type: "text", text: LONG }]));
  await page.click('.asset-pick button:text-is("Onshore wind")');
  await page.waitForFunction(() => !document.getElementById("ask").classList.contains("busy"), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  const turn = await page.evaluate(() => ({ said: [...document.querySelectorAll(".msg.user")].at(-1)?.textContent, done: document.querySelector(".asset-pick").classList.contains("done") }));
  const toModel = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
  check(turn.said === "Screen Kettlestoun site as an onshore wind site." && turn.done, `${label}: a tap sends the request in plain words ("${turn.said}")`);
  check(/asset_type \\"wind-onshore\\" and assumed false/.test(toModel), `${label}: the analyst is told the asset type the person picked`);

  // The long answer starts at the top of the conversation, not scrolled away.
  const pos = await page.evaluate(() => {
    const conv = document.getElementById("conversation");
    const first = [...document.querySelectorAll(".msg.user")].at(-1).nextElementSibling;
    const off = first.getBoundingClientRect().top - conv.getBoundingClientRect().top;
    return { off: Math.round(off), scrolled: conv.scrollTop > 0, bottom: conv.scrollHeight - conv.scrollTop - conv.clientHeight };
  });
  check(pos.off >= -2 && pos.off <= 20 && pos.bottom > 50, `${label}: the turn's first result sits at the top of the conversation (offset ${pos.off} px, ${pos.bottom} px below)`);

  // Typed, with the analyst asking: the tool shows the same buttons.
  // The model's own line, written in the same step as the call, is the reply; the turn ends in code with no second call.
  queue.push(msg([{ type: "text", text: "Happy to. What's planned there?" }, { type: "tool_use", id: "t1", name: "ask_asset_type", input: { place: "Kettlestoun site" } }], "tool_use"));
  await page.fill("#say", "screen it");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => !document.getElementById("ask").classList.contains("busy"), null, { timeout: 10000 });
  check(await page.evaluate(() => document.querySelectorAll(".asset-pick:not(.done)").length === 1), `${label}: the analyst's ask_asset_type shows the buttons`);
  check(queue.length === 0 && await page.evaluate(() => /^Happy to\. What's planned there\?/.test([...document.querySelectorAll(".msg.analyst")].at(-1)?.textContent || "")), `${label}: the turn ends at the buttons, with the model's own line`);
  // A short turn that fits stays at the bottom, as before.
  queue.push(msg([{ type: "text", text: "Fine." }]));
  await page.click('.asset-pick:not(.done) button.general');
  await page.waitForFunction(() => !document.getElementById("ask").classList.contains("busy"), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  const general = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
  check(/asset_type \\"other\\"/.test(general), `${label}: a general screen tells the analyst asset_type other`);
  const end = await page.evaluate(() => { const c = document.getElementById("conversation"); return Math.round(c.scrollHeight - c.scrollTop - c.clientHeight); });
  check(end <= 4, `${label}: a short turn that fits ends at the bottom (${end} px left)`);
  await page.screenshot({ path: `/tmp/ux-${label}.png` });
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
