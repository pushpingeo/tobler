// Coordinate reference tools, read from the EPSG Geodetic Parameter Dataset (IOGP) through the Worker's /epsg route.
// The method is in skills/coordinate-reference/SKILL.md; these tools do the lookups and the choosing in code, so the
// analyst never picks a transformation from memory. EPSG is evergreen: nothing here is a copied table.
//
// host.epsg({ path, query }) → parsed JSON (or text for exports). host.transformationChoice() → "choose" | "ask".
// locate(ref) → [lon, lat] for a candidate id, place name or "lon,lat".

import { canApply, METHODS, applyTransformation, readParameters, unitCodes, ellipsoidFromRecord, shiftMetres } from "./transform.js";

export const ASK_ABOVE_M = 25; // "choose for me" still asks when the best option is worse than this (skill, section 4)
const MAX_POINTS = 200;
const MAX_CANDIDATES = 40;
const MAX_POLYGONS = 6;

export const EPSG_TOOL_DEFS = [
  {
    name: "crs_lookup",
    description: "Look up a coordinate reference system in the EPSG registry: by code (e.g. 27700, 'EPSG:4230') or by words (e.g. 'ED50 UTM 31', 'Nigeria Minna'). Returns its name, kind (geographic, projected…), base geographic CRS and datum, axes and units, area of use with its bounding box, and whether it's deprecated (and what replaces it). Use it before trusting a CRS you were told or guessed. Load the coordinate-reference skill first.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "An EPSG code, e.g. '27700' or 'EPSG:23031'" },
        search: { type: "string", description: "Words to search for when there's no code, e.g. 'ED50 UTM zone 31'" },
      },
    },
  },
  {
    name: "transformation_options",
    description: "Which datum transformation to use between two CRSs at a given place, from the EPSG registry, chosen in code. Keeps only transformations whose area of use contains the place (its outline, not just its name), drops deprecated ones, and ranks by stated accuracy, then by smaller area. Returns the options, the recommended one, whether it can be applied here, and, depending on the person's setting, either the one chosen for them or a note that they want to be asked. Projected CRSs are resolved to their base geographic CRS. Load the coordinate-reference skill first and follow its section 4.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "EPSG code of the CRS the data is in, e.g. '27700' or '4230'" },
        target: { type: "string", description: "EPSG code to change to; usually '4326' (WGS 84)" },
        at: { type: "string", description: "Where: a candidate id or place from this conversation, or coordinates (read like typed coordinates). For a town or area not yet found, call find_place first and pass its candidate id." },
      },
      required: ["source", "at"],
    },
  },
  {
    name: "transform",
    description: "Apply a datum transformation to coordinates, in code, from the EPSG record's own parameters (geocentric translations, Position Vector, Coordinate Frame, Molodensky). Use the operation transformation_options chose (or the person picked); never an unnamed default. Gives the transformed latitude and longitude, how far each point moved, whether it lies inside the operation's area of use, and the operation code, stated accuracy and EPSG dataset version to record. Coordinates are latitude and longitude in degrees in the source CRS: pass the coordinates the person typed as `at` (their candidate id from find_place), or as numbers in `points` copied exactly as given. Grid-based transformations (OSTN15, NTv2, NADCON) can't be applied here.",
    input_schema: {
      type: "object",
      properties: {
        operation: { type: "string", description: "EPSG code of the transformation, e.g. '1311'" },
        source: { type: "string", description: "EPSG code of the geographic CRS the coordinates are in, e.g. '4230' (ED50)" },
        target: { type: "string", description: "EPSG code to change to; usually '4326' (WGS 84)" },
        at: { type: "string", description: "Candidate id of coordinates the person typed (from find_place), read as being in the source CRS" },
        points: { type: "array", description: "Or: points as [latitude, longitude] or [latitude, longitude, ellipsoidal height in m], in degrees, exactly as given", items: { type: "array", items: { type: "number" } } },
      },
      required: ["operation", "source"],
    },
  },
];

const codeOf = (v) => {
  const m = String(v ?? "").trim().match(/^(?:epsg\s*:\s*)?(\d{3,6})$/i);
  return m ? +m[1] : null;
};

// Ray casting on a GeoJSON Polygon or MultiPolygon in degrees; holes respected. Good enough for "is the site inside".
export function pointInGeoJSON([x, y], g) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (rings) => inRing(rings[0]) && !rings.slice(1).some(inRing);
  if (g?.type === "Polygon") return inPoly(g.coordinates);
  if (g?.type === "MultiPolygon") return g.coordinates.some(inPoly);
  if (g?.type === "GeometryCollection") return g.geometries.some((part) => pointInGeoJSON([x, y], part));
  return false;
}

// Bounding boxes in EPSG can cross the antimeridian (west > east).
export function inBox([lon, lat], e) {
  const s = e.BoundingBoxSouthBoundLatitude, n = e.BoundingBoxNorthBoundLatitude;
  const w = e.BoundingBoxWestBoundLongitude, ea = e.BoundingBoxEastBoundLongitude;
  if ([s, n, w, ea].some((v) => typeof v !== "number")) return false;
  if (lat < s || lat > n) return false;
  return w <= ea ? lon >= w && lon <= ea : lon >= w || lon <= ea;
}
const boxArea = (e) => {
  const w = e.BoundingBoxWestBoundLongitude, ea = e.BoundingBoxEastBoundLongitude;
  return ((w <= ea ? ea - w : 360 - w + ea) * (e.BoundingBoxNorthBoundLatitude - e.BoundingBoxSouthBoundLatitude)) || Infinity;
};
const boxOf = (e) => [e.BoundingBoxWestBoundLongitude, e.BoundingBoxSouthBoundLatitude, e.BoundingBoxEastBoundLongitude, e.BoundingBoxNorthBoundLatitude];

// Rank: contains the place, then best stated accuracy (unknown last), then current before superseded, then the
// smaller area, then the higher code (newer records). Exported for tests.
export function rankOptions(opts) {
  return [...opts].sort((a, b) =>
    (b.contains === true) - (a.contains === true)
    || (a.accuracy_m ?? Infinity) - (b.accuracy_m ?? Infinity)
    || !!a.superseded_by - !!b.superseded_by
    || (a._area ?? Infinity) - (b._area ?? Infinity)
    || b.code - a.code);
}

// What to do with the ranked options, given the setting. Exported for tests.
export function decide(ranked, setting) {
  const usable = ranked.filter((o) => o.contains === true);
  const best = usable.find((o) => o.can_apply) || null;
  const top = usable[0] || null;
  const out = { recommended: top?.code ?? null, setting };
  if (!top) return { ...out, chosen: null, ask: true, why: "No transformation in the registry covers this place." };
  if (setting === "ask") return { ...out, chosen: null, ask: true, why: "The person chose to pick transformations themselves." };
  if (!best) return { ...out, chosen: null, ask: true, why: `The best option (${top.name}) needs a grid file this page can't apply; the others are less accurate.` };
  if (best.accuracy_m == null || best.accuracy_m > ASK_ABOVE_M) return { ...out, chosen: null, ask: true, why: `The best option that can be applied here is only ${best.accuracy_m == null ? "of unknown accuracy" : `good to about ${best.accuracy_m} m`}, worse than the ${ASK_ABOVE_M} m accepted without asking.` };
  const note = best.code !== top.code ? ` (${top.name}, ${top.accuracy_m ?? "?"} m, is better but needs a grid file this page can't apply)` : "";
  return { ...out, chosen: best.code, ask: false, why: `Chosen for the person: ${best.name}, good to about ${best.accuracy_m} m here${note}. Chosen, not yet applied: coordinates move only when transform runs with operation ${best.code}.` };
}

// typedAt(ref) → [lon, lat] only for coordinates the person typed (their numbers, before any datum is assumed).
export function createEpsgTools(host, locate, typedAt = () => null) {
  const epsg = host.epsg;
  const missing = { not_checked: "The EPSG registry isn't connected here." };
  const get = (path, query) => epsg({ path, query });

  // A few calls at a time: the Worker caches, but EPSG is a shared public service.
  async function mapLimited(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ _error: String(e.message || e) })); }
    }));
    return out;
  }

  async function describeCrs(code) {
    const c = await get(`CoordRefSystem/${code}`);
    const kind = c.Kind || "";
    let base = null, datum = null, projection = null;
    if (kind === "projected") {
      const p = await get(`ProjectedCoordRefSystem/${code}`);
      base = p.BaseCoordRefSystem ? { code: p.BaseCoordRefSystem.Code, name: p.BaseCoordRefSystem.Name } : null;
      projection = p.Projection?.Name || null;
    }
    const geoCode = base?.code ?? (/^geo/.test(kind) ? code : null);
    if (geoCode) {
      const gcrs = await get(`GeodeticCoordRefSystem/${geoCode}`).catch(() => null);
      const d = gcrs?.Datum || gcrs?.DatumEnsemble;
      if (d) datum = { code: d.Code, name: d.Name, ensemble: !!gcrs.DatumEnsemble || /ensemble/i.test(d.Name || "") };
    }
    const ext = c.Usage?.[0]?.Extent;
    const area = ext ? await get(`Extent/${ext.Code}`).catch(() => null) : null;
    const dep = c.Deprecations?.[0];
    return {
      code, name: c.Name, kind, base, projection, datum,
      axes: c.CoordSys?.Name || null,
      area_of_use: area ? { code: ext.Code, name: area.Name, description: area.Description, bbox: boxOf(area) } : (ext ? { code: ext.Code, name: ext.Name } : null),
      deprecated: !!dep,
      ...(dep ? { replaced_by: dep.Replacement ? { code: dep.Replacement.Code, name: dep.Replacement.Name } : null, deprecation_reason: dep.Reason || null } : {}),
      source: `EPSG:${code}, EPSG Geodetic Parameter Dataset (IOGP)`,
    };
  }

  // The EPSG dataset version in force (the last VersionHistory entry), once per session.
  let versionP = null;
  const epsgVersion = () => (versionP ||= (async () => {
    const first = await get("VersionHistory", { pageSize: 1 });
    const n = first.TotalResults;
    const last = n > 1 ? await get("VersionHistory", { pageSize: 1, page: n - 1 }) : first;
    const v = last.Results?.[0];
    return v ? { version: v.Name, date: (v.RevisionDate || "").slice(0, 10) } : null;
  })().catch(() => null));

  const unitCache = new Map();
  const unit = (code) => {
    if (!unitCache.has(code)) unitCache.set(code, get(`Unit/${code}`).catch(() => null));
    return unitCache.get(code);
  };
  // A geographic CRS → its datum's ellipsoid (in metres) and prime meridian, from the registry.
  async function ellipsoidOfCrs(code) {
    const g = await get(`GeodeticCoordRefSystem/${code}`);
    const dref = g.Datum || g.DatumEnsemble;
    if (!dref) throw new Error(`EPSG:${code} has no geodetic datum (is it geographic?).`);
    const d = await get(`Datum/${dref.Code}`);
    if (!d.Ellipsoid) throw new Error(`Datum ${dref.Name} has no ellipsoid in the record.`);
    if (d.PrimeMeridian && d.PrimeMeridian.Code !== 8901) {
      const pm = await get(`PrimeMeridian/${d.PrimeMeridian.Code}`);
      if (pm.GreenwichLongitude) throw new Error(`Datum ${dref.Name} uses the ${pm.Name} prime meridian, which this tool doesn't handle yet.`);
    }
    const e = await get(`Ellipsoid/${d.Ellipsoid.Code}`);
    const u = e.Unit?.Code != null ? await unit(e.Unit.Code) : null;
    return { datum: { code: dref.Code, name: dref.Name }, ellipsoid: { code: e.Code, name: e.Name }, E: ellipsoidFromRecord(e, u) };
  }

  // An EPSG transformation, read once and ready to apply to any number of points ([lat, lon] in degrees). Used by
  // transform and by site files (js/fileimport.js), so both go through the same registry records and maths.
  async function prepareOperation(op, src, tgt) {
    let rec;
    try { rec = await get(`Transformation/${op}`); }
    catch (e) { return { error: `EPSG:${op}: ${e.message}`, hint: "Is it a transformation code? Use transformation_options to find one." }; }
    const mcode = rec.Method?.Code;
    const grid = (rec.ParameterValues || []).some((p) => p.ParamValueFileRef);
    if (grid || !canApply(mcode)) return { error: `EPSG:${op} (${rec.Name}) uses ${rec.Method?.Name || "a method"} ${grid ? "with a grid file" : ""}, which can't be applied here.`, can_apply: false, applied: false };
    const rs = rec.SourceCrs?.Code, rt = rec.TargetCrs?.Code;
    let reverse;
    if (rs === src && rt === tgt) reverse = false;
    else if (rs === tgt && rt === src) reverse = true;
    else return { error: `EPSG:${op} runs between EPSG:${rs} (${rec.SourceCrs?.Name}) and EPSG:${rt} (${rec.TargetCrs?.Name}), not ${src} and ${tgt}. For a projected CRS give its base geographic CRS (crs_lookup says which).` };
    if (reverse && (rec.ParameterValues || []).some((p) => p.SignReversible === false)) return { error: `EPSG:${op} isn't reversible, so it can't be run from ${src} to ${tgt}.` };
    let params, from, to, version, extent;
    try {
      const units = Object.fromEntries((await Promise.all(unitCodes(rec.ParameterValues).map(async (c) => [c, await unit(c)]))).filter(([, u]) => u));
      params = readParameters(rec.ParameterValues, units);
      [from, to, version, extent] = await Promise.all([ellipsoidOfCrs(rs), ellipsoidOfCrs(rt), epsgVersion(),
        rec.Usage?.[0]?.Extent?.Code ? get(`Extent/${rec.Usage[0].Extent.Code}`).catch(() => null) : null]);
    } catch (e) { return { error: `Couldn't read what EPSG:${op} needs: ${e.message}`, applied: false }; }
    return {
      rec, mcode, from, to, reverse, version, extent,
      apply: (pts) => applyTransformation(pts, { method: mcode, params, from: from.E, to: to.E, reverse }),
      record: { code: op, name: rec.Name, accuracy_m: typeof rec.Accuracy === "number" ? rec.Accuracy : null, direction: reverse ? "reverse" : "forward",
        area_of_use: extent ? extent.Name : rec.Usage?.[0]?.Extent?.Name || null, epsg_version: version?.version ?? null },
    };
  }

  // What to do with data in EPSG:source at lonlat, as the skill's section 4 says, all in code: no change needed,
  // a transformation chosen and ready to apply, or a decision for the person (the analyst asks). For site files.
  async function plan({ source, lonlat }) {
    const r = await tools.transformation_options({ source: String(source), target: "4326", lonlat });
    if (r.not_checked || r.error) throw new Error(r.not_checked || r.error);
    if (r.same_base) return { kind: "none", source: r.source };
    const options = (r.options || []).slice(0, 5).map((o) => ({ code: o.code, name: o.name, accuracy_m: o.accuracy_m, can_apply: o.can_apply, area: o.area }));
    if (r.ask || !r.chosen) return { kind: "ask", source: r.source, why: r.why, recommended: r.recommended, options };
    const prep = await prepareOperation(r.chosen, r.source.base, r.target.base);
    if (prep.error) return { kind: "ask", source: r.source, why: prep.error, recommended: r.recommended, options };
    return { kind: "apply", source: r.source, apply: prep.apply, operation: prep.record, why: r.why, options };
  }
  // One the person chose (from the options, or any applicable code between the same CRSs).
  async function useOperation({ source, operation }) {
    const base = await baseOf(source);
    const prep = await prepareOperation(+operation, base.base, 4326);
    if (prep.error) throw new Error(prep.error);
    return { kind: "apply", source: base, apply: prep.apply, operation: prep.record };
  }
  async function baseOf(c) {
    c = codeOf(c);
    const r = await get(`CoordRefSystem/${c}`);
    if (r.Kind === "projected") { const p = await get(`ProjectedCoordRefSystem/${c}`); return { given: c, given_name: r.Name, base: p.BaseCoordRefSystem.Code, base_name: p.BaseCoordRefSystem.Name }; }
    return { given: c, given_name: r.Name, base: c, base_name: r.Name };
  }
  // A CRS by name, for .prj files that carry no EPSG code: only an exact name match (spaces and underscores aside) counts.
  async function findByName(name) {
    const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const j = await get("CoordRefSystem", { keywords: String(name).replace(/_/g, " "), pageSize: 12 });
    const hit = (j.Results || []).find((r) => !r.Deprecated && norm(r.Name) === norm(name));
    return hit ? { code: hit.Code, name: hit.Name } : null;
  }

  const tools = {
    async transform({ operation, source, target = "4326", at, points }) {
      if (!epsg) return missing;
      const op = codeOf(operation), src = codeOf(source), tgt = codeOf(target);
      if (!op) return { error: "Give the EPSG code of the transformation to apply (from transformation_options)." };
      if (!src || !tgt) return { error: "source and target must be EPSG codes of geographic CRSs." };
      // The coordinates: the person's own numbers, never a place already in WGS 84.
      let pts = [];
      if (at) {
        const ll = typedAt(at);
        if (!ll) return { error: `"${at}" isn't coordinates the person typed. transform takes the person's own numbers (their find_place candidate, or points), never a place already on the map.` };
        pts = [[ll[1], ll[0]]];
      } else if (Array.isArray(points)) {
        pts = points.filter((p) => Array.isArray(p) && p.length >= 2 && p.every((x) => typeof x === "number" && Number.isFinite(x)));
      }
      if (!pts.length) return { error: "No coordinates: give at (a typed-coordinates candidate) or points as [latitude, longitude]." };
      if (pts.length > MAX_POINTS) return { error: `At most ${MAX_POINTS} points at a time.` };
      const bad = pts.find(([la, lo]) => Math.abs(la) > 90 || Math.abs(lo) > 180);
      if (bad) return { error: `${bad[0]}, ${bad[1]} isn't a latitude and longitude in degrees. Projected coordinates (eastings, northings) need converting first.` };

      const prep = await prepareOperation(op, src, tgt);
      if (prep.error) return prep;
      const { rec, mcode, from, to, reverse, version, extent } = prep;
      const out = prep.apply(pts);
      const Eout = reverse ? from.E : to.E;
      const r8 = (x) => Math.round(x * 1e8) / 1e8, r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
      const rows = pts.map((p, i) => {
        const o = out[i];
        const inside = extent ? inBox([p[1], p[0]], extent) : null;
        return {
          input: { lat: p[0], lon: p[1], ...(p[2] != null ? { h: p[2] } : {}) },
          output: { lat: r8(o[0]), lon: r8(o[1]), ...(o[2] != null ? { h: r3(o[2]) } : {}) },
          moved_m: Math.round(shiftMetres(p, o, Eout) * 10) / 10,
          ...(inside === false ? { outside_area_of_use: true } : {}),
        };
      });
      const outside = rows.filter((r) => r.outside_area_of_use).length;
      const domain = METHODS[mcode].domain;
      const operationRec = {
        code: op, name: rec.Name, method: rec.Method?.Name, method_code: mcode, accuracy_m: typeof rec.Accuracy === "number" ? rec.Accuracy : null,
        direction: reverse ? "reverse" : "forward", version: rec.CoordTfmVersion || null,
        area_of_use: extent ? extent.Name : rec.Usage?.[0]?.Extent?.Name || null,
      };
      const fromCrs = reverse ? rec.TargetCrs : rec.SourceCrs, toCrs = reverse ? rec.SourceCrs : rec.TargetCrs;
      return {
        applied: true,
        from: { code: fromCrs.Code, name: fromCrs.Name, datum: (reverse ? to : from).datum.name, ellipsoid: (reverse ? to : from).ellipsoid.name },
        to: { code: toCrs.Code, name: toCrs.Name, datum: (reverse ? from : to).datum.name, ellipsoid: (reverse ? from : to).ellipsoid.name },
        operation: operationRec,
        epsg_version: version ? `EPSG Dataset ${version.version} (${version.date})` : "EPSG dataset version not read",
        points: rows,
        ...(domain === "geog2D" ? { heights: "A 2D method: heights aren't carried through." } : {}),
        ...(outside ? { warning: `${outside} of ${rows.length} point${rows.length > 1 ? "s lie" : " lies"} outside the operation's area of use (${operationRec.area_of_use}): its stated accuracy doesn't hold there, and those positions aren't reliable.` } : {}),
        record: { operation: `EPSG:${op}`, name: rec.Name, accuracy_m: operationRec.accuracy_m, direction: operationRec.direction, epsg_version: version?.version ?? null, applied_in: "Tobler (js/transform.js), from the EPSG record's parameters" },
        note: `Applied in code with EPSG:${op} (${rec.Name}), stated accuracy ${operationRec.accuracy_m ?? "unknown"} m.`,
      };
    },

    async crs_lookup({ code, search }) {
      if (!epsg) return missing;
      const c = codeOf(code);
      if (c) {
        try { return await describeCrs(c); }
        catch (e) { return { error: `EPSG:${c}: ${e.message}`, hint: /404|no such/i.test(e.message) ? "No such code in the EPSG registry." : undefined }; }
      }
      const words = String(search || code || "").trim();
      if (!words) return { error: "Give a code or some words to search for." };
      const j = await get("CoordRefSystem", { keywords: words, pageSize: 12 });
      return {
        query: words,
        results: (j.Results || []).map((r) => ({ code: r.Code, name: r.Name, kind: r.Type, area: r.Area, deprecated: !!r.Deprecated })),
      };
    },

    async transformation_options({ source, target = "4326", at, lonlat: given }) {
      if (!epsg) return missing;
      let src = codeOf(source), tgt = codeOf(target);
      if (!src || !tgt) return { error: "source and target must be EPSG codes. Use crs_lookup to find one by name." };
      let lonlat = given;
      if (!lonlat) { try { lonlat = locate(at); } catch (e) { return { error: e.message }; } }
      if (!lonlat) return { error: `Couldn't place "${at}".` };

      // Transformations are between geographic CRSs: a projected CRS goes through its base.
      const resolved = {};
      for (const [k, c] of [["source", src], ["target", tgt]]) {
        const r = await get(`CoordRefSystem/${c}`);
        if (r.Kind === "projected") {
          const p = await get(`ProjectedCoordRefSystem/${c}`);
          resolved[k] = { given: c, given_name: r.Name, base: p.BaseCoordRefSystem.Code, base_name: p.BaseCoordRefSystem.Name };
        } else resolved[k] = { given: c, given_name: r.Name, base: c, base_name: r.Name };
      }
      src = resolved.source.base; tgt = resolved.target.base;
      if (src === tgt) return { source: resolved.source, target: resolved.target, same_base: true, note: "Same geographic CRS: only a conversion (projection) is needed, no datum transformation and no loss of accuracy." };

      // EPSG's search finds transformations between the two CRSs whichever way round they're stored, so one search
      // does; each record's own source CRS says which way it runs (most are reversible).
      const found = await get("Transformation/crs", { sourceCRSCode: src, targetCRSCode: tgt }).catch(() => ({ Results: [] }));
      const listed = [...new Map((found.Results || []).map((r) => [+r.Code, r])).values()];
      const live = listed.filter((r) => !r.Deprecated);
      const dropped = listed.length - live.length;
      if (!live.length) return { source: resolved.source, target: resolved.target, at: lonlat, options: [], ...decide([], host.transformationChoice?.() || "choose"), deprecated_dropped: dropped };

      const details = await mapLimited(live.slice(0, MAX_CANDIDATES), 6, (r) => get(`Transformation/${r.Code}`));
      const extentCodes = [...new Set(details.flatMap((d) => (d.Usage || []).map((u) => u.Extent?.Code)).filter(Boolean))];
      const extents = Object.fromEntries((await mapLimited(extentCodes, 6, (c) => get(`Extent/${c}`))).map((e, i) => [extentCodes[i], e]));

      let opts = details.map((d, i) => {
        if (d._error) return null;
        const usages = (d.Usage || []).map((u) => ({ code: u.Extent?.Code, scope: u.Scope?.Name, e: extents[u.Extent?.Code] })).filter((u) => u.e && !u.e._error);
        const hit = usages.filter((u) => inBox(lonlat, u.e));
        const grid = (d.ParameterValues || []).some((p) => p.ParamValueFileRef);
        const u = hit[0] || usages[0];
        return {
          code: d.Code, name: d.Name, accuracy_m: typeof d.Accuracy === "number" ? d.Accuracy : null,
          method: d.Method?.Name, method_code: d.Method?.Code,
          can_apply: !grid && canApply(d.Method?.Code),
          ...(grid ? { grid_file: (d.ParameterValues || []).find((p) => p.ParamValueFileRef)?.ParamValueFileRef } : {}),
          reversed: d.SourceCrs?.Code != null ? d.SourceCrs.Code !== src : false,
          ...(d.Supersessions?.[0]?.SupersededBy ? { superseded_by: { code: d.Supersessions[0].SupersededBy.Code, name: d.Supersessions[0].SupersededBy.Name, year: d.Supersessions[0].Year ?? null } } : {}),
          area: u ? u.e.Name : null, area_description: u ? u.e.Description : null, area_bbox: u ? boxOf(u.e) : null,
          scope: u?.scope || null,
          contains: hit.length ? "box" : false,
          _area: hit.length ? Math.min(...hit.map((h) => boxArea(h.e))) : Infinity,
          _hits: hit.map((h) => h.code),
          remark: (d.Remark || "").slice(0, 240) || null,
        };
      }).filter(Boolean);

      // Boxes overlap (Scotland's box reaches into England): settle with the outlines when it matters.
      const inBoxes = opts.filter((o) => o.contains === "box");
      const needPoly = inBoxes.length > 1 ? [...new Set(inBoxes.flatMap((o) => o._hits))] : [];
      const polys = {};
      if (needPoly.length) {
        const got = await mapLimited(needPoly.slice(0, MAX_POLYGONS), 3, (c) => get(`Extent/${c}/polygon`));
        needPoly.slice(0, MAX_POLYGONS).forEach((c, i) => { polys[c] = got[i]; });
      }
      let outlineChecked = 0;
      opts = opts.map((o) => {
        if (o.contains !== "box") return o;
        if (inBoxes.length === 1) return { ...o, contains: true, checked_by: "bounding box (the only candidate)" };
        const checked = o._hits.filter((c) => polys[c] && !polys[c]._error);
        if (!checked.length) return { ...o, contains: true, checked_by: "bounding box only (outline not fetched)" };
        outlineChecked++;
        const inside = checked.some((c) => pointInGeoJSON(lonlat, typeof polys[c] === "string" ? JSON.parse(polys[c]) : polys[c]));
        return { ...o, contains: inside, checked_by: "area-of-use outline" };
      });

      const ranked = rankOptions(opts);
      const setting = host.transformationChoice?.() || "choose";
      const verdict = decide(ranked, setting);
      const covering = ranked.filter((o) => o.contains === true);
      const clean = (o) => { const { _area, _hits, ...rest } = o; return rest; };
      return {
        source: resolved.source, target: resolved.target, at: lonlat,
        options: covering.slice(0, 8).map(clean),
        not_covering: ranked.filter((o) => o.contains !== true).map((o) => `${o.name} (${o.area || "?"})`).slice(0, 12),
        ...verdict,
        listed: listed.length, deprecated_dropped: dropped, ...(live.length > MAX_CANDIDATES ? { only_first: MAX_CANDIDATES } : {}),
        outlines_checked: outlineChecked,
        ...(tgt === 4326 ? { wgs84_note: "WGS 84 (EPSG:4326) is a datum ensemble good to about 2 m; for screening that's below notice." } : {}),
        source_note: "EPSG Geodetic Parameter Dataset (IOGP), apps.epsg.org, read live.",
      };
    },
  };
  // For site files only (not a tool the analyst sees): kept off the enumerable keys so it isn't copied into the tools.
  Object.defineProperty(tools, "fileGeodesy", { value: { plan, useOperation, findByName, available: !!epsg }, enumerable: false });
  return tools;
}
