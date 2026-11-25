# Tobler

A geospatial analyst you talk to. You say where (a place, a project, "3 km² around the Jackdaw platform"), it finds or builds the shape on the map, and then it screens the site for risks: protected areas, settlements, heritage, boundaries, what's already there.

Live at **[asktobler.com](https://asktobler.com)**. Early days, so expect rough edges.

Named after Waldo Tobler, whose first law of geography says near things are more related than distant things. That's most of site screening, really.

## The idea

GIS has always come in three pieces you buy, find and learn separately: the software, the data, and the know-how. Tobler keeps them together:

- **Tools** do the geometry. Deterministic, in the browser. The model never does geometry in its head.
- **Data** comes from the [AI Living World Atlas](https://github.com/pushpingeo/ai-living-world-atlas), an index of the world's published map services: what exists for a place, who publishes it, and on what terms.
- **Skills** are the method, written down so a screen runs the same way every time. They're plain markdown in [`skills/`](skills/) and can be lifted into other AI workflows.

Every result says where it came from: sources, licences, dates, and what wasn't checked. "Not checked" is not the same as "nothing there", and the screen says which is which.

## What works now

- **Finding places from words.** Names, project descriptions, "a 1 km corridor along the M9". It searches the atlas first (so "block 30/2" comes back as the regulator's outline, not a pin), then OpenStreetMap, Wikidata and Natural Earth. If several things fit, it asks.
- **Drawing and editing** when words aren't enough. Move, reshape, rotate, resize to an exact area.
- **Non-technical risk screening** of a point, line or area, onshore or offshore. Flags first, each with the evidence it rests on, picked out on the map. A slider changes the distance without fetching again. Download the result as GeoJSON with full provenance.
- Settings for units, shape colour, your own Anthropic key, and whether you hold an Esri licence or are non-commercial (some data is only for those).

Coming: saved projects, share links, a PDF report, then area discounting (gross to net developable area) and constraints-and-access mapping.

## Pages

| Page | What |
|---|---|
| [`/`](https://asktobler.com) | The workspace |
| [`report.html`](https://asktobler.com/report.html) | A screen's report, opened from a share link |

The lab is where this started: an IFC screening agent and its evaluation against 45 real projects. It moved to
[`pushpingeo/asktobler-lab`](https://github.com/pushpingeo/asktobler-lab/tree/main/ntr-lab) on 25 Nov 2026.

## How it's built

- Static site, everything in the browser. MapLibre GL with the OpenFreeMap basemap, Terra Draw, Turf. The workspace bundles its libraries rather than loading them from CDNs.
- Claude (Haiku) through a small Cloudflare Worker in [`worker/`](worker/), which holds the key, pins the model and caps use per visitor. It also carries the route to the atlas.
- A screen runs as its own sealed loop (`js/ntrrun.js`), separate from the conversation, so long sessions don't drift.
- Coordinates are stored in WGS84. Distances and areas are geodesic. Web Mercator is for display only.

Judgement calls and test results go in [`docs/decisions.md`](docs/decisions.md).

## Testing

```
npm install
npm test
```

Browser checks (headless Chrome, model and atlas scripted, no cost): serve the repo on port 8000, then `node scripts/browser-run-card.mjs` and `node scripts/browser-choice.mjs`. The place-finding and screening evaluations run in GitHub Actions; results are committed under [`eval/`](eval/).

## Data and licences

Every feature keeps its source's licence. OpenStreetMap data is © OpenStreetMap contributors (ODbL). Natural Earth is public domain. Atlas layers carry their publishers' terms, and Tobler leaves out Esri-licensed and non-commercial layers unless you've said they apply to you.

Screening results are a desk-based first look. They don't replace a proper assessment.

---

Built by Rob Dunfey ([pushpingeo](https://github.com/pushpingeo)).
