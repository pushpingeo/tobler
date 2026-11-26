// Sign in with ArcGIS (26 Nov; plan: "Tobler registered as an ArcGIS app"). OAuth 2.0 authorization code with PKCE,
// in a popup, for ArcGIS Online. Tobler's app ("Ask Tobler") lives in Rob's own org; people from any organisation can
// sign in with it unless their admin blocks outside apps. There's no client secret: PKCE stands in for it.
//
// The popup (oauth.html, js/oauthreturn.js) only hands the code back. This page keeps the code verifier, exchanges the
// code for the token, and keeps the token in this module's memory: never in storage, the log, the Worker, the atlas or
// the model. A reload forgets it. The token is only ever given out for ArcGIS Online's own servers (tokenAllowed).
// No DOM here beyond the popup window: js/workspace.js does the panel.

export const CLIENT_ID = "4GhkbypqSzSYKEb2";
export const CHANNEL = "tobler-arcgis-oauth";
const ONLINE = "https://www.arcgis.com";
// The refresh token's life, in minutes (the access token itself lasts about 30 minutes and is refreshed from it).
const EXPIRATION = 120;

// Is this host one of ArcGIS Online's own (the portal, an org's portal, hosted services and tiles)?
export const isOnlineHost = (host) => { const h = String(host || "").toLowerCase(); return h === "arcgis.com" || h.endsWith(".arcgis.com"); };

// What the person typed as their organisation's address, as a portal origin. Empty: ArcGIS Online itself.
// Returns { portal } or { error }. Only ArcGIS Online for now; Enterprise portals need their own app registration.
export function portalFrom(text) {
  const t = String(text || "").trim();
  if (!t) return { portal: ONLINE };
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return { error: "That doesn't look like a web address." }; }
  const host = u.host.toLowerCase();
  if (!isOnlineHost(host) || u.port) return { error: "Sign in with ArcGIS works with ArcGIS Online addresses for now (yours.maps.arcgis.com). Your organisation's own ArcGIS Enterprise portal comes later." };
  return { portal: `https://${host === "arcgis.com" ? "www.arcgis.com" : host}` };
}

// May the sign-in's token go to this address? Only https, and only ArcGIS Online's own servers. A company's own
// ArcGIS Server, Tobler's Worker, the atlas or anything else never gets it.
export function tokenAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === "https:" && !u.port && !u.username && isOnlineHost(u.host);
}

// The page oauth.html beside this one (it has to match a redirect address registered on the app exactly).
export const redirectFor = (loc) => new URL("oauth.html", `${loc.origin}${loc.pathname.replace(/[^/]*$/, "")}`).href;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function pkcePair(cryptoObj = globalThis.crypto) {
  const verifier = b64url(cryptoObj.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await cryptoObj.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge, state: b64url(cryptoObj.getRandomValues(new Uint8Array(16))) };
}

export function authorizeUrl({ portal, redirect, challenge, state, clientId = CLIENT_ID }) {
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state, expiration: String(EXPIRATION) });
  return `${portal}/sharing/rest/oauth2/authorize?${q}`;
}

export class SignInError extends Error {
  constructor(message, { cancelled = false } = {}) { super(message); this.cancelled = cancelled; }
}

async function tokenCall(portal, params, fetchFn) {
  let r;
  try {
    r = await fetchFn(`${portal}/sharing/rest/oauth2/token`, { method: "POST", credentials: "omit", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, f: "json" }) });
  } catch { throw new SignInError("ArcGIS couldn't be reached to finish the sign-in."); }
  let j = null;
  try { j = await r.json(); } catch { /* below */ }
  if (!r.ok || !j || j.error || !j.access_token) throw new SignInError(`ArcGIS didn't finish the sign-in${j?.error?.message || j?.error_description ? `: ${String(j.error?.message || j.error_description).slice(0, 160)}` : ""}.`);
  const now = Date.now();
  return { token: j.access_token, expires: now + (+j.expires_in || 1800) * 1000, refresh: j.refresh_token || null, refreshExpires: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : null, username: j.username || null };
}

// What the code came back as, from the popup: { type, state, code } or { type, state, error, error_description }.
export const isReturn = (m) => !!m && typeof m === "object" && m.type === CHANNEL && typeof m.state === "string";

// One sign-in at a time, for this page. win: the window (for popups, messages and the redirect address).
export function createSignIn({ win = globalThis.window, fetchFn = (...a) => globalThis.fetch(...a), cryptoObj = globalThis.crypto, timeoutMs = 5 * 60 * 1000 } = {}) {
  let session = null; // { portal, token, expires, refresh, refreshExpires, username, org }
  let pending = null; // { state, resolve, reject, timer }
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => { try { f(who()); } catch { /* a listener's own fault */ } });
  const who = () => (session ? { portal: session.portal, username: session.username, org: session.org } : null);

  async function onReturn(m) {
    if (!pending || !isReturn(m) || m.state !== pending.state) return; // not ours, or stale: ignored
    const p = pending; pending = null; clearTimeout(p.timer);
    if (m.error) { p.reject(new SignInError(m.error === "access_denied" ? "The sign-in was cancelled, or your organisation doesn't allow this app." : `ArcGIS said: ${String(m.error_description || m.error).slice(0, 160)}.`, { cancelled: m.error === "access_denied" })); return; }
    if (!m.code) { p.reject(new SignInError("The sign-in window came back without a code.")); return; }
    try {
      const got = await tokenCall(p.portal, { client_id: CLIENT_ID, grant_type: "authorization_code", code: m.code, redirect_uri: p.redirect, code_verifier: p.verifier }, fetchFn);
      let org = null;
      try {
        const r = await fetchFn(`${p.portal}/sharing/rest/portals/self?f=json&token=${encodeURIComponent(got.token)}`, { credentials: "omit" });
        const s = await r.json();
        org = s?.name || null;
        got.username = got.username || s?.user?.username || null;
      } catch { /* the name is a nicety */ }
      session = { portal: p.portal, ...got, org };
      p.resolve(who());
      changed();
    } catch (e) { p.reject(e); }
  }
  // Both ways back: the opener's message (same origin only), and a channel, for when the sign-in page cut the
  // popup's link to this one (some company sign-ins and phones do).
  win?.addEventListener?.("message", (e) => { if (e.origin === win.location.origin) onReturn(e.data); });
  try { const ch = new win.BroadcastChannel(CHANNEL); ch.onmessage = (e) => onReturn(e.data); } catch { /* no channel: the opener's message still works */ }

  return {
    who,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    waiting: () => !!pending,
    // Call straight from a click: the window opens at once (so it isn't blocked), then goes to ArcGIS's sign-in.
    begin(orgText) {
      const pf = portalFrom(orgText);
      if (pf.error) return Promise.reject(new SignInError(pf.error));
      if (pending) { clearTimeout(pending.timer); pending.reject(new SignInError("A new sign-in was started.", { cancelled: true })); pending = null; }
      const popup = win.open("", "tobler-arcgis-signin", "popup=yes,width=520,height=680");
      if (!popup) return Promise.reject(new SignInError("Your browser blocked the sign-in window. Allow pop-ups for this site and try again."));
      return new Promise((resolve, reject) => {
        pkcePair(cryptoObj).then(({ verifier, challenge, state }) => {
          const redirect = redirectFor(win.location);
          pending = { state, verifier, redirect, portal: pf.portal, resolve, reject, timer: setTimeout(() => { if (pending?.state === state) { pending = null; reject(new SignInError("The sign-in took too long. Try again.", { cancelled: true })); } }, timeoutMs) };
          popup.location.href = authorizeUrl({ portal: pf.portal, redirect, challenge, state });
        }).catch(() => { try { popup.close(); } catch { /* gone */ } reject(new SignInError("This browser can't do a secure sign-in here.")); });
      });
    },
    cancel() { if (pending) { clearTimeout(pending.timer); const p = pending; pending = null; p.reject(new SignInError("Cancelled.", { cancelled: true })); } },
    // The token for an address, refreshed if it's near its end; null if there's no sign-in or the address isn't
    // ArcGIS Online's own.
    async tokenFor(url) {
      if (!session || !tokenAllowed(url)) return null;
      if (session.expires - Date.now() > 60000) return session.token;
      if (session.refresh && (!session.refreshExpires || session.refreshExpires > Date.now())) {
        try {
          const got = await tokenCall(session.portal, { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: session.refresh }, fetchFn);
          if (session) { session.token = got.token; session.expires = got.expires; return session.token; }
        } catch { /* below */ }
      }
      session = null; changed();
      return null;
    },
    signOut() { session = null; changed(); },
  };
}
