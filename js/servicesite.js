// A site from a map or feature service (plan item 1, second half; Rob's spec, 26 Nov: claude/site-from-service-spec.md).
// The person pastes an ArcGIS REST address, picks the feature(s) that are their site in a panel, and Tobler keeps the
// geometry and drops the service. Requests go straight from the browser to the service, never through Tobler's
// Worker; a token the person gives stays in memory here and is never saved, logged or sent to the model or the atlas.
// The feature is fetched in the service's own coordinates and converted by Tobler's file pipeline (js/fileimport.js),
// so the datum is chosen from the EPSG registry as for a dropped file, not trusted to the server.
// No DOM: js/workspace.js does the panel.

// An ArcGIS REST address in what the person typed: a MapServer or FeatureServer, the service or one layer.
// Returns { url, base, kind, layerId, host, token } or null. A token in the address is taken out of it.
const REST = /https?:\/\/[^\s"'<>]+?\/rest\/services\/[^\s"'<>]+?\/(MapServer|FeatureServer)(?:\/(\d+))?(?=[/?#\s"'<>]|$)[^\s"'<>]*/i;
export function findServiceUrl(text) {
  const m = String(text || "").match(REST);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  const token = u.searchParams.get("token") || null;
  const path = u.pathname.replace(/\/+$/, "");
  const at = path.search(/\/(MapServer|FeatureServer)(\/\d+)?(\/.*)?$/i);
  const kind = /FeatureServer/i.test(m[1]) ? "FeatureServer" : "MapServer";
  const base = `${u.origin}${path.slice(0, at)}/${kind}`;
  const layerId = m[2] != null ? +m[2] : null;
  return { base, url: layerId != null ? `${base}/${layerId}` : base, kind, layerId, host: u.host, token, typed: m[0] };
}

// What the person's message becomes in the log and the conversation: the address isn't kept (it may be private).
export const redactService = (text) => String(text || "").replace(REST, "[a service address]");

const TOKEN_ERRORS = new Set([498, 499, 401, 403]);
export class ServiceError extends Error {
  constructor(message, { needsSignIn = false, blocked = false } = {}) { super(message); this.needsSignIn = needsSignIn; this.blocked = blocked; }
}

// A JSON request to the service. Tries a plain request first; when the service wants a sign-in, tries again sending
// the browser's own login (a company network's single sign-on), then with the person's token if they gave one.
// state: { token, credentialed } (kept by the caller, in memory only); it records what worked.
// state.proxy: Tobler's Worker address, once the person has agreed to read a public service through it (it doesn't let
// web pages read it). Then every request goes there, and never with a token or the browser's login.
export const proxied = (proxy, target) => `${proxy.replace(/\/+$/, "")}/arcgis?url=${encodeURIComponent(target)}`;
export async function serviceJson(url, params, state, { fetchFn = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const q = new URLSearchParams({ ...params, f: params.f || "json" });
  if (state.proxy) {
    if (state.token) throw new ServiceError("A secured service isn't read through Tobler's server.");
    let r;
    try { r = await fetchFn(proxied(state.proxy, `${url}?${q}`), { credentials: "omit" }); }
    catch { throw new ServiceError("Tobler's server couldn't be reached."); }
    let body = null;
    try { body = await r.json(); } catch { /* below */ }
    if (!r.ok) throw new ServiceError(body?.message || `Tobler's server couldn't read it (HTTP ${r.status}).`);
    if (body?.error) throw new ServiceError(TOKEN_ERRORS.has(+body.error.code) ? "The service needs a sign-in, so it isn't public: Tobler's server can't read it. Paste a token instead, or drop an exported file." : `The service said: ${String(body.error.message || "an error").slice(0, 160)}.`, { needsSignIn: TOKEN_ERRORS.has(+body.error.code) });
    state.secured = false;
    return body;
  }
  const tries = [];
  if (state.token) tries.push({ token: true });
  else { tries.push({}); tries.push({ credentials: true }); }
  let last = null;
  for (const t of state.credentialed && !state.token ? [{ credentials: true }] : tries) {
    const qp = new URLSearchParams(q);
    if (t.token) qp.set("token", state.token);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      r = await fetchFn(`${url}?${qp}`, { signal: ctl.signal, ...(t.credentials ? { credentials: "include" } : { credentials: "omit" }) });
    } catch (e) {
      // A browser that refuses the request (no CORS headers, or a login the service won't share with this site)
      // throws a TypeError with no detail.
      last = new ServiceError(t.credentials
        ? "The service didn't answer this page with your login. Your organisation's portal has to list asktobler.com as an allowed origin (in ArcGIS Enterprise: Portal Administrator → Security → Allowed origins, and the server's CORS setting)."
        : "The service didn't answer this page. It may not allow requests from other websites (CORS), or it may need a sign-in.", { blocked: true });
      continue;
    } finally { clearTimeout(timer); }
    if (TOKEN_ERRORS.has(r.status)) { last = new ServiceError("The service needs a sign-in.", { needsSignIn: true }); continue; }
    if (!r.ok) { last = new ServiceError(`The service answered with an error (HTTP ${r.status}).`); continue; }
    let body;
    try { body = await r.json(); } catch { last = new ServiceError("The service's answer wasn't readable."); continue; }
    if (body?.error) {
      const code = +body.error.code;
      if (TOKEN_ERRORS.has(code)) { last = new ServiceError(code === 498 ? "The token was refused (it may have expired)." : "The service needs a sign-in.", { needsSignIn: true }); continue; }
      last = new ServiceError(`The service said: ${String(body.error.message || "an error").slice(0, 160)}.`);
      continue;
    }
    if (t.credentials) state.credentialed = true;
    state.secured = !!(t.credentials || t.token) || !!state.secured;
    return body;
  }
  throw last || new ServiceError("The service couldn't be reached.");
}

// The spatial reference of a layer or service: its well-known id (latestWkid first: 102100 is 3857).
export function wkidOf(info) {
  const sr = info?.sourceSpatialReference || info?.extent?.spatialReference || info?.spatialReference || info?.fullExtent?.spatialReference || null;
  const w = sr?.latestWkid || sr?.wkid || null;
  return w === 102100 || w === 102113 ? 3857 : w === 102700 ? null : w;
}

// What the service is, for the panel: its layers (feature layers only, with their geometry) or the one layer asked for.
// Returns { name, kind, layers: [{ id, name, geometry, wkid, maxRecords }], wkid, copyright, extent4326? }.
const GEOM = { esriGeometryPolygon: "polygon", esriGeometryPolyline: "line", esriGeometryPoint: "point", esriGeometryMultipoint: "point" };
export async function describeService(svc, state, opts = {}) {
  const info = await serviceJson(svc.url, {}, state, opts);
  const asLayer = (l) => ({ id: l.id, name: l.name || `Layer ${l.id}`, geometry: GEOM[l.geometryType] || null, wkid: wkidOf(l), maxRecords: l.maxRecordCount || 1000, idField: l.objectIdField || null });
  if (svc.layerId != null) {
    if (info.type && !/Feature Layer|Table/i.test(info.type) && !info.geometryType) throw new ServiceError(`Layer ${svc.layerId} is a ${info.type}, not a layer of features.`);
    return { name: info.name || `Layer ${svc.layerId}`, kind: svc.kind, layers: [asLayer(info)].filter((l) => l.geometry), wkid: wkidOf(info), copyright: info.copyrightText || "", description: info.description || "" };
  }
  // A whole service: its feature layers. A MapServer lists them without geometry, so each is asked once.
  const list = (info.layers || []).filter((l) => !l.subLayerIds?.length);
  const detail = await Promise.all(list.slice(0, 20).map((l) => (l.geometryType ? l : serviceJson(`${svc.base}/${l.id}`, {}, state, opts).catch(() => l))));
  const layers = detail.map(asLayer).filter((l) => l.geometry);
  if (!layers.length) throw new ServiceError("The service has no layers of features to pick from.");
  return { name: info.documentInfo?.Title || info.mapName || info.serviceDescription?.slice(0, 60) || svc.base.split("/").slice(-2, -1)[0], kind: svc.kind, layers, wkid: wkidOf(info), copyright: info.copyrightText || "", description: info.description || info.serviceDescription || "" };
}

// The features of one layer at a clicked point (WGS84 lon/lat), within tolerance_m, in the service's own coordinates
// (Esri JSON, so nothing is converted by the server). Returns { features: [{ id, attributes, geometry (Esri) }],
// idField, wkid }.
export async function featuresAt(svc, layer, [lon, lat], tolerance_m, state, opts = {}) {
  const url = `${svc.base}/${layer.id}/query`;
  const body = await serviceJson(url, {
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(Math.max(1, Math.round(tolerance_m))), units: "esriSRUnit_Meter", outFields: "*", returnGeometry: "true", resultRecordCount: "20",
  }, state, opts);
  const idField = body.objectIdFieldName || layer.idField || (body.fields || []).find((f) => f.type === "esriFieldTypeOID")?.name || "OBJECTID";
  return {
    idField, wkid: wkidOf(body) || layer.wkid,
    features: (body.features || []).filter((f) => f.geometry).map((f) => ({ id: f.attributes?.[idField] ?? null, attributes: f.attributes || {}, geometry: f.geometry })),
  };
}

// The same features again by id, in WGS84 as the server converts them: for drawing only (highlighting a pick), and
// the fallback when Tobler can't convert the service's own coordinates (said on the place).
export async function featuresWgs84(svc, layer, ids, state, opts = {}) {
  if (!ids.length) return [];
  const body = await serviceJson(`${svc.base}/${layer.id}/query`, { objectIds: ids.join(","), outFields: "*", returnGeometry: "true", outSR: "4326" }, state, opts);
  return (body.features || []).filter((f) => f.geometry).map((f) => ({ attributes: f.attributes || {}, geometry: esriToGeoJSON(f.geometry) })).filter((f) => f.geometry);
}

// What's on the layer in a box (WGS84), for drawing a FeatureServer layer in the panel: server-converted, display only.
export async function featuresInBox(svc, layer, bbox, state, opts = {}) {
  const body = await serviceJson(`${svc.base}/${layer.id}/query`, {
    geometry: bbox.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: layer.idField || "*", returnGeometry: "true", outSR: "4326", resultRecordCount: String(Math.min(layer.maxRecords || 1000, 1000)),
    maxAllowableOffset: String((bbox[2] - bbox[0]) / 1500),
  }, state, opts);
  return { features: (body.features || []).map((f) => ({ type: "Feature", properties: { oid: f.attributes?.[body.objectIdFieldName || layer.idField] ?? null }, geometry: esriToGeoJSON(f.geometry) })).filter((f) => f.geometry),
    capped: !!body.exceededTransferLimit };
}

// Esri JSON geometry to GeoJSON (same coordinates). Polygon rings: clockwise rings are outer, anticlockwise are holes
// of the outer ring that holds them (Esri's rule).
export function esriToGeoJSON(g) {
  if (!g) return null;
  if (g.x != null && g.y != null) return Number.isFinite(+g.x) && Number.isFinite(+g.y) ? { type: "Point", coordinates: [+g.x, +g.y] } : null;
  if (g.points) return g.points.length === 1 ? { type: "Point", coordinates: g.points[0].slice(0, 2) } : { type: "MultiPoint", coordinates: g.points.map((p) => p.slice(0, 2)) };
  if (g.paths) { const p = g.paths.map((l) => l.map((c) => c.slice(0, 2))); return p.length === 1 ? { type: "LineString", coordinates: p[0] } : { type: "MultiLineString", coordinates: p }; }
  if (g.rings) {
    const rings = g.rings.map((r) => r.map((c) => c.slice(0, 2))).filter((r) => r.length >= 4);
    const signed = (r) => r.reduce((a, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + (x1 * y2 - x2 * y1); }, 0) / 2;
    const inside = ([x, y], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const outers = rings.filter((r) => signed(r) < 0).map((r) => [r]);
    const holes = rings.filter((r) => signed(r) >= 0);
    if (!outers.length) return holes.length ? { type: "Polygon", coordinates: [holes[0].slice().reverse()] } : null; // wound the wrong way: use the first as outer
    for (const h of holes) { const home = outers.find((o) => inside(h[0], o[0])); if (home) home.push(h); }
    // GeoJSON (RFC 7946) winds outer rings anticlockwise and holes clockwise: reverse both.
    const polys = outers.map((p) => p.map((r) => r.slice().reverse()));
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

// The picked features as a GeoJSON file in the service's own coordinates, naming its EPSG code, for the file pipeline
// (readFiles). Without a code Tobler can convert, the server's WGS84 copy is used and that's said.
export function asFile(layer, picked, wkid, name) {
  const fc = {
    type: "FeatureCollection",
    ...(wkid && wkid !== 4326 ? { crs: { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${wkid}` } } } : {}),
    features: picked.map((f) => ({ type: "Feature", properties: f.attributes, geometry: f.geojson })),
  };
  return { name: `${name}.geojson`, bytes: new TextEncoder().encode(JSON.stringify(fc)) };
}

// The place's origin, from the file pipeline's (placesFromFile) and what came from the service. The service isn't
// kept; the record says where the site came from. A secured service is the person's or their organisation's own data.
export function serviceOrigin(fileOrigin, meta) {
  const secured = !!meta.secured;
  return {
    ...fileOrigin,
    method: "service",
    service: {
      url: meta.url, host: meta.host, layer: meta.layer, layer_id: meta.layerId, kind: meta.kind, feature_ids: meta.ids,
      retrieved_at: meta.at, native_wkid: meta.wkid || null, secured, licence: secured ? "your own or your organisation's data" : meta.licence || "unknown",
      ...(meta.serverConverted ? { converted_by: "the publisher's server (Tobler couldn't convert its own coordinates)" } : {}),
      ...(meta.via ? { read_through: meta.via } : {}),
    },
    file: undefined,
    role_why: fileOrigin.role === "footprint" ? `the outline from ${secured ? "your organisation's" : "the"} service layer ${meta.layer}` : fileOrigin.role_why.replace(/from your file$/, `from the service layer ${meta.layer}`),
  };
}

// One line for the card, the project summary and the run record. A secured service's address and host aren't in it:
// this line reaches the model.
export function serviceOriginText(o) {
  if (o?.method !== "service") return null;
  const s = o.service || {};
  const which = o.features?.length === 1 ? `"${o.features[0].label}"` : `${o.features?.length} features`;
  const from = s.secured ? `your organisation's secured service, layer ${s.layer}` : `the layer ${s.layer} on ${s.host}`;
  return `from ${from} (${which}${o.buffer_m ? `, ${o.buffer_m} m round it` : ""}), fetched ${String(s.retrieved_at || "").slice(0, 10)}; ${o.crs?.how || "coordinates as given"}${s.converted_by ? `; converted by ${s.converted_by}` : ""}`;
}

export const BUFFERS_M = [10, 30, 50, 100];
