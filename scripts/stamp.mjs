// Version-stamps the workspace's files so a deploy loads together.
// GitHub Pages caches each file for 10 minutes, so without this a visitor can get a mix of old and new.
// Each file gets ?v=<hash of its content>, so only files that changed are fetched again.
//   - ES modules: through the page's import map (every relative import resolves to one stamped URL,
//     so no module is ever loaded twice under two names).
//   - The stylesheet and the main script: in their tags.
//   - Files the page fetches (skills, catalogue, reference data): a small JSON block the page reads.
// Run: node scripts/stamp.mjs        (rewrites index.html, the workspace)
//      node scripts/stamp.mjs --check (exits 1 if index.html is out of date; used by npm test)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Each page with its entry module and stylesheet (the report page since 20 Nov).
const PAGES = [
  { page: "index.html", entry: "js/workspace.js", css: "css/workspace.css" },
  { page: "report.html", entry: "js/reportpage.js", css: "css/report.css" },
  { page: "sheet.html", entry: "js/sheetpage.js", css: "css/sheet.css" },
];
const FETCHED_DIRS = ["skills", "catalogue", "data/ref"];
const FETCHED_EXT = /\.(json|md)$/;

const hash = (rel) => createHash("sha1").update(readFileSync(join(root, rel))).digest("hex").slice(0, 8);
const stamped = (rel) => `./${rel}?v=${hash(rel)}`;

// Walk the module graph from the entry point, reading relative import specifiers.
function moduleGraph(entry) {
  const seen = new Set(), keys = new Map(); // keys: resolved path (as imported, query kept) -> file
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(join(root, rel), "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith(".")) continue;
      const [path, query] = spec.split("?");
      const file = posix.normalize(posix.join(posix.dirname(rel), path));
      if (!existsSync(join(root, file))) throw new Error(`${rel} imports ${spec}, which doesn't exist`);
      keys.set(query ? `${file}?${query}` : file, file);
      visit(file);
    }
  };
  visit(entry);
  return { files: [...seen], keys };
}

function build({ page: PAGE, entry: ENTRY, css: CSS }) {
  const html = readFileSync(join(root, PAGE), "utf8");
  const { files, keys } = moduleGraph(ENTRY);
  const imports = {
    "@turf/turf": stamped("js/vendor/turf.js"),
    "osmtogeojson": stamped("js/vendor/osmtogeojson.js"),
  };
  for (const f of files) imports[`./${f}`] = stamped(f);
  for (const [k, f] of keys) imports[`./${k}`] = stamped(f);
  const sorted = Object.fromEntries(Object.entries(imports).sort(([a], [b]) => a.localeCompare(b)));

  const assets = {};
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (FETCHED_EXT.test(e.name) && !/README/i.test(e.name)) assets[rel] = `${rel}?v=${hash(rel)}`;
    }
  };
  FETCHED_DIRS.forEach(walk);

  let out = html
    .replace(/<script type="importmap">[\s\S]*?<\/script>/,
      `<script type="importmap">\n${JSON.stringify({ imports: sorted }, null, 1)}\n</script>`)
    .replace(/<script type="application\/json" id="asset-versions">[\s\S]*?<\/script>\n?/, "")
    .replace(/(<script type="importmap">[\s\S]*?<\/script>\n)/,
      `$1<script type="application/json" id="asset-versions">\n${JSON.stringify(assets, null, 1)}\n</script>\n`)
    .replace(new RegExp(`href="${CSS.replace(/[./]/g, "\\$&")}(\\?v=[^"]*)?"`), `href="${stamped(CSS).slice(2)}"`)
    .replace(new RegExp(`src="${ENTRY.replace(/[./]/g, "\\$&")}(\\?v=[^"]*)?"`), `src="${stamped(ENTRY).slice(2)}"`);
  return { html, out };
}

let stale = false;
for (const p of PAGES) {
  const { html, out } = build(p);
  if (process.argv.includes("--check")) {
    if (html !== out) { console.error(`${p.page} has stale version stamps: run node scripts/stamp.mjs`); stale = true; }
    else console.log(`ok ${p.page} version stamps are current`);
  } else {
    writeFileSync(join(root, p.page), out);
    console.log(html === out ? `${p.page} already current` : `${p.page} restamped`);
  }
}
if (stale) process.exit(1);
