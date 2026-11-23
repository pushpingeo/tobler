// Bundles third-party code into js/vendor so the site doesn't depend on CDNs at run time.
// Usage: npm install && node scripts/build-vendor.mjs
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("js/vendor", { recursive: true });
mkdirSync("fonts", { recursive: true });
for (const name of ["turf", "draw", "osmtogeojson", "fileread"]) {
  await build({ entryPoints: [`scripts/vendor/${name}.mjs`], bundle: true, format: "esm", minify: true,
    outfile: `js/vendor/${name}.js`, legalComments: "eof", logLevel: "warning" });
}
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl.js", "js/vendor/maplibre-gl.js");
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "js/vendor/maplibre-gl.css");
for (const f of ["public-sans-latin-wght-normal.woff2", "public-sans-latin-ext-wght-normal.woff2", "public-sans-latin-wght-italic.woff2"])
  copyFileSync(`node_modules/@fontsource-variable/public-sans/files/${f}`, `fonts/${f}`);
console.log("vendor files written");
