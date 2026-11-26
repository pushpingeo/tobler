// Headless browser check of display units (package C, 26 Nov): the units follow the country of the place in view
// until the person chooses in Settings; their choice is kept and wins; "From the site's country" hands it back.
// Desktop and phone. Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-units.mjs [chrome path].
import { chromium } from "playwright-core";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const square = (lon, lat, d = 0.004) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[lon, lat], [r6(lon + d), lat], [r6(lon + d), r6(lat + d)], [lon, r6(lat + d)], [lon, lat]]] } });
const PITTSFIELD = square(-73.236, 42.452); // the former GE plant, Pittsfield, Massachusetts
const LINLITHGOW = square(-3.6, 55.97);

for (const [label, viewport, touch] of [["desktop", { width: 1280, height: 820 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|wikidata|overpass|nominatim/, (r) => r.abort());
  await page.route(/tobler-api/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.evaluate(() => { try { localStorage.removeItem("tobler.units"); } catch { /* blocked */ } });
  const add = (f, name) => page.evaluate(({ f, name }) => window.__ws.host.addPlace({ feature: f, name, origin: { method: "drawn", confidence: "high", steps: [], at: new Date().toISOString() } }), { f, name });
  const card = (name) => page.evaluate((name) => {
    const c = [...document.querySelectorAll(".shape")].find((x) => x.querySelector(".name")?.textContent.includes(name));
    return { summary: c?.querySelector(".summary")?.textContent || "", facts: c?.querySelector(".facts")?.textContent || "", stored: localStorage.getItem("tobler.units") };
  }, name);
  const settled = (re, name) => page.waitForFunction(({ re, name }) => {
    const c = [...document.querySelectorAll(".shape")].find((x) => x.querySelector(".name")?.textContent.includes(name));
    return new RegExp(re).test(c?.querySelector(".summary")?.textContent || "");
  }, { re, name }, { timeout: 15000 }).catch(() => {});

  // 1. A US site, nothing chosen: feet, miles and acres, from the country.
  await add(PITTSFIELD, "Pittsfield GE site");
  await settled("acres", "Pittsfield");
  let us = await card("Pittsfield");
  check(/acres/.test(us.summary) && /United States/.test(us.facts) && /\bmi\b|\bft\b/.test(us.summary) && us.stored == null,
    `${label}: a US site shows acres and miles without anything chosen ("${us.summary.slice(0, 70)}")`);
  const said = await page.evaluate(() => document.querySelector("#activity .activity-text")?.textContent || document.body.textContent);
  check(/feet and miles, the usual units in the United States/.test(said), `${label}: the page says why it switched to feet and miles ("${said.slice(0, 160)}")`);

  // 2. A Scottish site in view: back to metric.
  await add(LINLITHGOW, "Linlithgow field");
  await settled("ha", "Linlithgow");
  const sc = await card("Linlithgow");
  check(/\bha\b/.test(sc.summary) && !/acres/.test(sc.summary), `${label}: a Scottish site in view goes back to metric ("${sc.summary.slice(0, 60)}")`);

  // 3. The person chooses feet and miles in Settings: kept, and it wins over the Scottish site.
  await page.click("#gear");
  await page.waitForSelector("#settings[open]");
  const autoTicked = await page.evaluate(() => document.querySelector('input[name="units"][value="auto"]').checked);
  check(autoTicked, `${label}: Settings shows "From the site's country" while nothing is chosen`);
  await page.check('input[name="units"][value="imperial"]');
  await settled("acres", "Linlithgow");
  const chosen = await card("Linlithgow");
  check(/acres/.test(chosen.summary) && chosen.stored === "imperial", `${label}: choosing feet and miles is kept and shows on a Scottish site ("${chosen.summary.slice(0, 60)}")`);
  await page.keyboard.press("Escape");
  await add(square(-3.62, 55.96), "Linlithgow second field");
  await settled("acres", "second field");
  const still = await card("second field");
  check(/acres/.test(still.summary), `${label}: the choice wins over the country of a new place`);

  // 4. Hand it back to the country.
  await page.click("#gear");
  await page.waitForSelector("#settings[open]");
  await page.check('input[name="units"][value="auto"]');
  await settled("ha", "second field");
  const back = await card("second field");
  check(/\bha\b/.test(back.summary) && back.stored == null, `${label}: "From the site's country" forgets the choice and follows the place again`);
  await page.keyboard.press("Escape");

  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.join(" | ").slice(0, 200)}` : ""}`);
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
