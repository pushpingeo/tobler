// Settings for the agent page.
export const CONFIG = {
  // Tobler's own Cloudflare Worker (worker/): holds the keys, pins the model, limits use per visitor.
  // To switch back to demo 1's Worker: "https://north-sea-geo-demo.robdunfey.workers.dev".
  proxyUrl: "https://tobler-api.robdunfey.workers.dev",
  model: "claude-haiku-5-5",
  maxTokens: 8000,
  // Screening runs get more room: Haiku thinks before it writes, and on busy sites the thinking used most of 8,000
  // tokens before the write-up ended (Kelso, 20 Nov). The cap costs nothing unless used. The Worker allows up to this.
  screenMaxTokens: 16000,
  maxRounds: 10,
  // The workspace analyst: a screening asks for many datasets, so it gets more rounds per turn.
  workspaceRounds: 14,
  // The hosted copy of OpenStreetMap (js/osmsnapshot.js; built by the atlas since 25 Nov, Tobler's own workflow retired): the folder
  // holding <market>.json manifests, ending in /. Empty: off, and every OpenStreetMap check goes to Overpass.
  osmSnapshotBase: "https://data.asktobler.com/osm/",
  osmSnapshotMarkets: ["uk"],
};
