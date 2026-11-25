// Which public Overpass servers answer from here, and how fast? Used on its own
// by .github/workflows/overpass-probe.yml. No API key, no cost.
import { OVERPASS_ENDPOINTS, fetchOverpass } from "../js/gazetteer.js";

const UA = { "User-Agent": "tobler-eval/1.0 (+https://github.com/pushpingeo/tobler)" };
const QUERIES = {
  tiny: "[out:json][timeout:10];node(57.0,-2.2,57.01,-2.19);out 1;",
  // A real feature search like the analyst's: mines within 15 km of Reko Diq.
  mines: "[out:json][timeout:14];(nwr[landuse=quarry](around:15000,29.13,62.05);nwr[industrial=mine](around:15000,29.13,62.05);nwr[man_made=mineshaft](around:15000,29.13,62.05););out center 20;",
};

export async function probeOverpass({ timeoutMs = 20000 } = {}) {
  const out = [];
  for (const ep of OVERPASS_ENDPOINTS) {
    for (const [name, q] of Object.entries(QUERIES)) {
      const t0 = Date.now();
      try {
        const j = await fetchOverpass(q, ep, (u, o) => fetch(u, { ...o, headers: { ...UA, ...o.headers } }), timeoutMs);
        out.push({ endpoint: ep, query: name, ok: true, seconds: (Date.now() - t0) / 1000, elements: j.elements?.length ?? 0 });
      } catch (e) {
        out.push({ endpoint: ep, query: name, ok: false, seconds: (Date.now() - t0) / 1000, error: String(e.message).slice(0, 160) });
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await probeOverpass();
  for (const x of r) console.log(`${x.ok ? "ok  " : "FAIL"} ${x.query.padEnd(5)} ${x.seconds.toFixed(1).padStart(5)} s  ${x.endpoint}${x.ok ? `  (${x.elements} elements)` : `  ${x.error}`}`);
}
