// Headless browser check of Rob's two bugs from his live test (22 Nov): a card header with a long name stays inside
// the card (the name ends in an ellipsis), and a shape dragged on the map leaves no trailing "shadow" (our copy of
// the shape is held back during the drag and redrawn where it lands). Desktop with a mouse, phone with touch.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-cards.mjs [chrome path].
import { chromium } from "playwright-core";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const SHOTS = process.env.SHOTS || "/tmp";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
const SQUARE = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-3.6, 55.97], [-3.58, 55.97], [-3.58, 55.98], [-3.6, 55.98], [-3.6, 55.97]]] } };
const LONG = "Proposed onshore wind extension at Kettlestoun and Bowden Hill near Linlithgow";

for (const [label, viewport, touch] of [["desktop", { width: 1280, height: 820 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|wikidata|overpass|nominatim/, (r) => r.abort());
  await page.route(/tobler-api/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.waitForTimeout(800);
  await page.evaluate(({ f, name }) => window.__ws.host.addPlace({ feature: f, name, origin: { method: "drawn", confidence: "high", steps: [], at: new Date().toISOString() } }), { f: SQUARE, name: LONG });
  await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.waitForTimeout(400);

  // 1. A long name stays inside the card: nothing in the header is wider than the card, and the name is cut with "…".
  const hdr = await page.evaluate(() => {
    const c = document.querySelector(".shape"), h = c.querySelector("h2"), n = h.querySelector(".name"), b = c.querySelector(".badge");
    const cr = c.getBoundingClientRect(), hr = h.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { inside: hr.right <= cr.right && (!b.textContent || br.right <= cr.right), noScroll: c.scrollWidth <= c.clientWidth,
      cut: n.scrollWidth > n.clientWidth && getComputedStyle(n).textOverflow === "ellipsis", badge: b.textContent };
  });
  check(hdr.inside && hdr.noScroll && hdr.cut, `${label}: a long name stays inside its card and ends in an ellipsis (badge "${hdr.badge}" still shown)`);
  await page.screenshot({ path: `${SHOTS}/cards-${label}-header.png` });

  // 2. Drag the shape on the map. During the drag our copy is held back (Terra Draw draws the shape), and after it
  // lands our copy matches where Terra Draw put it, and the card's history records the move.
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.add("collapsed"));
  await page.evaluate(() => window.__ws.map.jumpTo({ center: [-3.59, 55.975], zoom: 13 }));
  await page.waitForTimeout(600);
  await page.evaluate(() => { const c = document.querySelector('.shape [data-op="adjust"]'); c.click(); });
  await page.waitForTimeout(400);
  const at = await page.evaluate(() => { const ws = window.__ws; const p = ws.map.project([-3.59, 55.975]); const r = ws.map.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  const state = () => page.evaluate(() => {
    const ws = window.__ws, id = [...ws.places.keys()][0];
    const minx = (g) => Math.min(...g.coordinates[0].map((q) => q[0]));
    const d = ws.draw.getSnapshot().find((f) => f.id === id);
    const ours = ws.map.getSource("aoi")._data.features.filter((f) => f.geometry.type === "Polygon").map((f) => minx(f.geometry));
    return { draw: minx(d.geometry), ours };
  });
  const mid = [];
  const STEPS = 20, DX = 6, DY = 2;
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await t("touchStart", at.x, at.y);
    for (let i = 1; i <= STEPS; i++) { await t("touchMove", at.x + i * DX, at.y + i * DY); if (i > STEPS / 2) mid.push(await state()); }
    await t("touchEnd");
  } else {
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    for (let i = 1; i <= STEPS; i++) { await page.mouse.move(at.x + i * DX, at.y + i * DY); if (i > STEPS / 2) mid.push(await state()); }
    await page.screenshot({ path: `${SHOTS}/cards-${label}-mid-drag.png` });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  const end = await state();
  const moved = end.draw > -3.6 + 1e-4;
  check(moved, `${label}: the shape moved with the ${touch ? "finger" : "mouse"} (west edge ${end.draw.toFixed(5)})`);
  check(mid.length > 0 && mid.every((s) => s.ours.length === 0), `${label}: during the drag our copy is held back, so nothing trails behind`);
  check(end.ours.length === 1 && Math.abs(end.ours[0] - end.draw) < 1e-9, `${label}: after the drag our copy is redrawn exactly where the shape landed`);
  const hist = await page.evaluate(() => document.querySelector(".shape .history").textContent);
  check(/moved/i.test(hist), `${label}: the card records the move ("${hist.slice(0, 60)}")`);

  // 3. A rotate from the Adjust buttons (not a drag) still redraws our copy straight away.
  const before = (await state()).ours[0];
  const nudge = await page.evaluate(() => !!document.querySelector('.shape .adjust:not([hidden]) button'));
  if (nudge) {
    await page.evaluate(() => { const b = [...document.querySelectorAll(".shape .adjust button")].find((x) => /→|east|right/i.test(x.textContent + x.getAttribute("aria-label"))); (b || document.querySelector(".shape .adjust button")).click(); });
    await page.waitForTimeout(400);
    const after = await state();
    check(after.ours.length === 1 && Math.abs(after.ours[0] - after.draw) < 1e-9, `${label}: a rotate from the Adjust buttons redraws our copy at once (${before.toFixed(5)} → ${after.ours[0].toFixed(5)})`);
  }
  await page.screenshot({ path: `${SHOTS}/cards-${label}-after-drag.png` });
  check(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors[0]})` : ""}`);
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
