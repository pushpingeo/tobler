// Browser checks without a local server: `node --import ./scripts/route-local.mjs scripts/browser-x.mjs`.
// Every context routes http://localhost:8000/* to the repo on disk (used 26 Nov when the server couldn't be started).
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".md": "text/markdown", ".geojson": "application/json", ".pbf": "application/x-protobuf", ".parquet": "application/octet-stream", ".fgb": "application/octet-stream", ".csv": "text/csv", ".txt": "text/plain" };
const serve = async (route) => {
  const u = new URL(route.request().url());
  let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
  try { const body = await readFile(ROOT + p); await route.fulfill({ status: 200, body, contentType: TYPES[extname(p)] || "application/octet-stream" }); }
  catch { await route.fulfill({ status: 404, body: "not found" }); }
};
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a) => {
  const b = await launch(...a);
  const nc = b.newContext.bind(b);
  b.newContext = async (...c) => { const ctx = await nc(...c); await ctx.route("http://localhost:8000/**", serve); return ctx; };
  const np = b.newPage.bind(b);
  b.newPage = async (...c) => { const pg = await np(...c); await pg.context().route("http://localhost:8000/**", serve); return pg; };
  return b;
};
