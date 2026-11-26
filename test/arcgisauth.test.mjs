// Sign in with ArcGIS (26 Nov): PKCE, the popup's return, where the token may go, and the service panel's use of it.
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import * as A from "../js/arcgisauth.js";
import * as SV from "../js/servicesite.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };

await test("the token goes only to ArcGIS Online's own servers, over https", () => {
  for (const u of ["https://services1.arcgis.com/AbC/arcgis/rest/services/X/FeatureServer/0", "https://tiles.arcgis.com/tiles/AbC/arcgis/rest/services/T/MapServer", "https://shell.maps.arcgis.com/sharing/rest/portals/self", "https://www.arcgis.com/sharing/rest"])
    assert.ok(A.tokenAllowed(u), u);
  for (const u of ["http://services1.arcgis.com/x", "https://arcgis.com.evil.example/x", "https://evilarcgis.com/x", "https://gis.corp.example/arcgis/rest/services/A/MapServer",
    "https://tobler-api.robdunfey.workers.dev/arcgis?url=https://services.arcgis.com/x", "https://atlas-mcp.robdunfey.workers.dev/mcp", "https://services.arcgis.com:8443/x", "https://u:p@services.arcgis.com/x", "not a url"])
    assert.ok(!A.tokenAllowed(u), u);
  assert.equal(SV.isOnline, A.tokenAllowed, "the service panel uses the same rule");
});

await test("the organisation's address: ArcGIS Online only for now; empty is arcgis.com", () => {
  assert.deepEqual(A.portalFrom(""), { portal: "https://www.arcgis.com" });
  assert.deepEqual(A.portalFrom("shell.maps.arcgis.com"), { portal: "https://shell.maps.arcgis.com" });
  assert.deepEqual(A.portalFrom("https://Shell.maps.arcgis.com/home/index.html"), { portal: "https://shell.maps.arcgis.com" });
  assert.deepEqual(A.portalFrom("arcgis.com"), { portal: "https://www.arcgis.com" });
  assert.ok(A.portalFrom("gis.shell.com/portal").error);
  assert.ok(A.portalFrom("http://localhost:8080").error);
});

await test("the redirect address is oauth.html beside the page, as registered", () => {
  assert.equal(A.redirectFor(new URL("https://asktobler.com/?s=abc#x")), "https://asktobler.com/oauth.html");
  assert.equal(A.redirectFor(new URL("https://pushpingeo.github.io/tobler/")), "https://pushpingeo.github.io/tobler/oauth.html");
  assert.equal(A.redirectFor(new URL("https://pushpingeo.github.io/tobler/index.html?x=1")), "https://pushpingeo.github.io/tobler/oauth.html");
  assert.equal(A.redirectFor(new URL("http://localhost:8080/")), "http://localhost:8080/oauth.html");
});

await test("PKCE: the challenge is the verifier's SHA-256, and the sign-in address carries only the challenge", async () => {
  const p = await A.pkcePair(webcrypto);
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(p.challenge, createHash("sha256").update(p.verifier).digest("base64url"));
  const u = new URL(A.authorizeUrl({ portal: "https://shell.maps.arcgis.com", redirect: "https://asktobler.com/oauth.html", challenge: p.challenge, state: p.state }));
  assert.equal(u.origin + u.pathname, "https://shell.maps.arcgis.com/sharing/rest/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), A.CLIENT_ID);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!u.href.includes(p.verifier), "the verifier never leaves the page");
  assert.ok(!/asktobler\.com\/\?|s=abc/.test(u.searchParams.get("state")), "the state is a random id, not the page's address");
});

// A fake window: the popup, messages and a channel, and ArcGIS's token endpoint.
function fakeWin() {
  const handlers = {};
  const channels = [];
  const popup = { location: { href: "" }, closed: false, close() { this.closed = true; } };
  const win = {
    location: new URL("https://asktobler.com/"),
    opened: [],
    open(url, name) { this.opened.push([url, name]); return this.block ? null : popup; },
    addEventListener(t, f) { (handlers[t] ||= []).push(f); },
    BroadcastChannel: class { constructor(n) { this.name = n; channels.push(this); } },
    post(data, origin = "https://asktobler.com") { (handlers.message || []).forEach((f) => f({ origin, data })); },
    broadcast(data) { channels.forEach((c) => c.onmessage?.({ data })); },
    popup,
  };
  return win;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

await test("a sign-in: the window opens at once, the code comes back, this page exchanges it with its own verifier", async () => {
  const win = fakeWin();
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push([url, init.body ? String(init.body) : ""]);
    if (/oauth2\/token/.test(url)) return { ok: true, json: async () => ({ access_token: "AT1", expires_in: 1800, refresh_token: "RT1", refresh_token_expires_in: 7200, username: "rob_shell" }) };
    if (/portals\/self/.test(url)) return { ok: true, json: async () => ({ name: "Shell", user: { username: "rob_shell" } }) };
    throw new Error(url);
  };
  const auth = A.createSignIn({ win, fetchFn, cryptoObj: webcrypto });
  const changes = [];
  auth.onChange((w) => changes.push(w));
  const done = auth.begin("shell.maps.arcgis.com");
  assert.equal(win.opened.length, 1, "opened straight from the click, before any await");
  await settle();
  const go = new URL(win.popup.location.href);
  assert.equal(go.host, "shell.maps.arcgis.com");
  const state = go.searchParams.get("state");
  // A message from another site, or with another state, is ignored.
  win.post({ type: A.CHANNEL, state, code: "EVIL" }, "https://evil.example");
  win.post({ type: A.CHANNEL, state: "other", code: "EVIL" });
  await settle();
  assert.equal(calls.length, 0);
  assert.ok(auth.waiting());
  // The channel brings it back (the popup's link to the opener was cut).
  win.broadcast({ type: A.CHANNEL, state, code: "C0DE" });
  const who = await done;
  assert.deepEqual(who, { portal: "https://shell.maps.arcgis.com", username: "rob_shell", org: "Shell" });
  const body = new URLSearchParams(calls[0][1]);
  assert.equal(calls[0][0], "https://shell.maps.arcgis.com/sharing/rest/oauth2/token");
  assert.equal(body.get("code"), "C0DE");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("redirect_uri"), "https://asktobler.com/oauth.html");
  assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), go.searchParams.get("code_challenge"));
  assert.ok(!body.has("client_secret"));
  assert.equal(await auth.tokenFor("https://services1.arcgis.com/AbC/arcgis/rest/services/X/FeatureServer/0"), "AT1");
  assert.equal(await auth.tokenFor("https://gis.corp.example/arcgis/rest/services/A/MapServer"), null, "never for a server that isn't ArcGIS Online's");
  assert.equal(changes.length, 1);
  // The same code a second time does nothing.
  win.broadcast({ type: A.CHANNEL, state, code: "C0DE" });
  await settle();
  assert.equal(calls.filter(([u]) => /oauth2\/token/.test(u)).length, 1);
  auth.signOut();
  assert.equal(auth.who(), null);
  assert.equal(await auth.tokenFor("https://services1.arcgis.com/AbC/x"), null);
});

await test("refused, blocked and expiring sign-ins", async () => {
  const win = fakeWin();
  let n = 0;
  const fetchFn = async (url, init = {}) => {
    if (/oauth2\/token/.test(url)) { n++; const b = new URLSearchParams(String(init.body)); return { ok: true, json: async () => (b.get("grant_type") === "refresh_token" ? { access_token: "AT2", expires_in: 1800 } : { access_token: "AT1", expires_in: 30, refresh_token: "RT1", refresh_token_expires_in: 7200 }) }; }
    return { ok: true, json: async () => ({}) };
  };
  const auth = A.createSignIn({ win, fetchFn, cryptoObj: webcrypto });
  // The organisation said no (an admin who blocks outside apps, or the person cancelled).
  let p = auth.begin("");
  await settle();
  let state = new URL(win.popup.location.href).searchParams.get("state");
  win.post({ type: A.CHANNEL, state, error: "access_denied" });
  await assert.rejects(p, (e) => e.cancelled && /doesn't allow this app/.test(e.message));
  // A popup blocker.
  win.block = true;
  await assert.rejects(auth.begin(""), /blocked the sign-in window/);
  win.block = false;
  // Not ArcGIS Online.
  await assert.rejects(auth.begin("gis.corp.example"), /ArcGIS Online addresses for now/);
  // A token near its end is refreshed from the refresh token.
  p = auth.begin("");
  await settle();
  state = new URL(win.popup.location.href).searchParams.get("state");
  win.post({ type: A.CHANNEL, state, code: "C" });
  await p;
  assert.equal(await auth.tokenFor("https://services.arcgis.com/x"), "AT2");
  assert.equal(n, 2);
});

await test("the service panel: a public Online service is read plainly; a secured one asks for the sign-in only after it says so; a refusal is said plainly", async () => {
  const asked = [];
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const svcFetch = async (url, init) => { asked.push([url, init.credentials]); return /token=AT1/.test(url) ? reply({ name: "Blocks", layers: [] }) : reply({ error: { code: 499, message: "Token Required" } }); };
  let tokenAsks = 0;
  const state = { getToken: async (u) => { tokenAsks++; return A.tokenAllowed(u) ? "AT1" : null; } };
  const got = await SV.serviceJson("https://services1.arcgis.com/AbC/arcgis/rest/services/B/FeatureServer", {}, state, { fetchFn: svcFetch });
  assert.equal(got.name, "Blocks");
  assert.equal(asked.length, 2);
  assert.ok(!/token=/.test(asked[0][0]), "plain first");
  assert.ok(asked.every(([, c]) => c === "omit"), "no browser login sent to ArcGIS Online");
  assert.ok(state.secured && state.signedIn && state.token === "AT1");
  // A public service: the sign-in isn't asked for, and it's recorded as public.
  asked.length = 0; tokenAsks = 0;
  const pub = {};
  pub.getToken = state.getToken;
  await SV.serviceJson("https://services1.arcgis.com/AbC/arcgis/rest/services/P/FeatureServer", {}, pub, { fetchFn: async (u, i) => { asked.push([u, i.credentials]); return reply({ name: "Public" }); } });
  assert.equal(tokenAsks, 0);
  assert.ok(!pub.secured);
  // Not signed in: it says it needs a sign-in.
  await assert.rejects(SV.serviceJson("https://services1.arcgis.com/AbC/arcgis/rest/services/B/FeatureServer", {}, { getToken: async () => null }, { fetchFn: svcFetch }), (e) => e.needsSignIn && !e.refused);
  // Signed in, but the service isn't shared with the person.
  await assert.rejects(SV.serviceJson("https://services1.arcgis.com/AbC/arcgis/rest/services/B/FeatureServer", {}, { getToken: async () => "WRONG" }, { fetchFn: async () => reply({ error: { code: 403, message: "You do not have permissions" } }) }), (e) => e.refused && /isn't shared with you/.test(e.message));
  // A company server never gets the ArcGIS Online token, even when signed in.
  asked.length = 0;
  await assert.rejects(SV.serviceJson("https://gis.corp.example/arcgis/rest/services/A/MapServer", {}, { getToken: async () => "AT1" }, { fetchFn: async (u, i) => { asked.push([u, i.credentials]); return reply({ error: { code: 499 } }); } }));
  assert.ok(asked.every(([u]) => !/token=/.test(u)));
});

console.log(`${passed} passed`);
