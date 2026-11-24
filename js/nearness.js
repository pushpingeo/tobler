// Shortest distance between two shapes, fast enough for thousands of features against a detailed site (Mallard Pass,
// 24 Nov: a 4,688-vertex red line with 28 holes took ~90 ms a feature the old way, and a run froze the page for
// minutes). Both shapes are projected to a local equal-area plane centred on the first one (js/siterole.js laea);
// their edges go into a bounding-box tree, so each vertex is measured only against the few edges near it. The
// nearest pair found is then measured geodesically (turf), so the reported distance is a true one (invariant 2).
// Exact on the edges, holes and all: 0 when the shapes touch, cross or one lies inside the other; a feature in a
// hole of the site is outside it. The first shape is prepared once and cached, as it's the site on every call.
// No DOM.
import * as turf from "./vendor/turf.js";
import { laea } from "./siterole.js";

const LEAF = 8;

// A bounding-box tree over segments [x1, y1, x2, y2, lon1, lat1, lon2, lat2], split on the longer side.
function build(items) {
  if (!items.length) return null;
  const box = (n, list) => {
    n.minX = Infinity; n.minY = Infinity; n.maxX = -Infinity; n.maxY = -Infinity;
    for (const s of list) {
      if (s[0] < n.minX) n.minX = s[0]; if (s[2] < n.minX) n.minX = s[2];
      if (s[1] < n.minY) n.minY = s[1]; if (s[3] < n.minY) n.minY = s[3];
      if (s[0] > n.maxX) n.maxX = s[0]; if (s[2] > n.maxX) n.maxX = s[2];
      if (s[1] > n.maxY) n.maxY = s[1]; if (s[3] > n.maxY) n.maxY = s[3];
    }
    return n;
  };
  const rec = (list) => {
    const n = box({}, list);
    if (list.length <= LEAF) { n.items = list; return n; }
    const ax = n.maxX - n.minX >= n.maxY - n.minY ? 0 : 1;
    list.sort((a, b) => a[ax] + a[ax + 2] - b[ax] - b[ax + 2]);
    const m = list.length >> 1;
    n.left = rec(list.slice(0, m)); n.right = rec(list.slice(m));
    return n;
  };
  return rec(items);
}

const boxGap = (n, x, y) => Math.hypot(Math.max(n.minX - x, 0, x - n.maxX), Math.max(n.minY - y, 0, y - n.maxY));
// Distance from (x, y) to a segment, with where along it (0..1).
function toSeg(x, y, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
  return [Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy)), t];
}
// Nearest segment to (x, y): branch and bound, closer child first.
function nearest(node, x, y, best) {
  if (!node || boxGap(node, x, y) >= best.d) return;
  if (node.items) {
    for (const s of node.items) { const [d, t] = toSeg(x, y, s); if (d < best.d) { best.d = d; best.seg = s; best.t = t; } }
    return;
  }
  const [a, b] = boxGap(node.left, x, y) <= boxGap(node.right, x, y) ? [node.left, node.right] : [node.right, node.left];
  nearest(a, x, y, best); nearest(b, x, y, best);
}
function crosses(p, q) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const A = [p[0], p[1]], B = [p[2], p[3]], C = [q[0], q[1]], D = [q[2], q[3]];
  const o1 = o(A, B, C), o2 = o(A, B, D), o3 = o(C, D, A), o4 = o(C, D, B);
  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear and overlapping: touching counts as touching.
  const on = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return (o1 === 0 && on(A, B, C)) || (o2 === 0 && on(A, B, D)) || (o3 === 0 && on(C, D, A)) || (o4 === 0 && on(C, D, B));
}
function anyCross(node, s) {
  if (!node) return false;
  const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]), y0 = Math.min(s[1], s[3]), y1 = Math.max(s[1], s[3]);
  if (x1 < node.minX || x0 > node.maxX || y1 < node.minY || y0 > node.maxY) return false;
  if (node.items) return node.items.some((q) => crosses(s, q));
  return anyCross(node.left, s) || anyCross(node.right, s);
}
// Inside, by counting edge crossings of a ray to the east over every ring (outer rings and holes): even-odd, so a
// point in a hole is outside.
function rayCount(node, x, y) {
  if (!node || node.maxY < y || node.minY > y || node.maxX < x) return 0;
  if (node.items) {
    let c = 0;
    for (const s of node.items) if ((s[1] > y) !== (s[3] > y) && x < ((s[2] - s[0]) * (y - s[1])) / (s[3] - s[1]) + s[0]) c++;
    return c;
  }
  return rayCount(node.left, x, y) + rayCount(node.right, x, y);
}
// Segments whose boxes meet a box, for their end points.
function inBox(node, b, out) {
  if (!node || b[2] < node.minX || b[0] > node.maxX || b[3] < node.minY || b[1] > node.maxY) return out;
  if (node.items) { for (const s of node.items) out.push(s); return out; }
  inBox(node.left, b, out); inBox(node.right, b, out);
  return out;
}

// A shape in the plane: its edges in a tree, its points (for point shapes), whether it's an area, and one vertex per
// part (to test whether one shape lies wholly inside the other once no edges cross).
function prepare(g, P) {
  const segs = [], pts = [], firsts = [];
  const pr = (c) => { const [x, y] = P(c); return [x, y, c[0], c[1]]; };
  const line = (cs) => { const q = cs.map(pr); for (let i = 0; i < q.length - 1; i++) segs.push([q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], q[i][2], q[i][3], q[i + 1][2], q[i + 1][3]]); if (q.length) firsts.push(q[0]); };
  const t = g.type;
  if (t === "Point") { const p = pr(g.coordinates); pts.push(p); firsts.push(p); }
  else if (t === "MultiPoint") for (const c of g.coordinates) { const p = pr(c); pts.push(p); firsts.push(p); }
  else if (t === "LineString") line(g.coordinates);
  else if (t === "MultiLineString") g.coordinates.forEach(line);
  else if (t === "Polygon") g.coordinates.forEach(line);
  else if (t === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(line));
  else return null;
  // For areas, only the outer ring's first vertex of each part is a test point (a hole's vertex is outside the part).
  const outer = t === "Polygon" ? [g.coordinates[0]] : t === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : null;
  const tree = build(segs);
  // Every vertex of a line or area, so the other shape can be measured to it.
  const verts = segs.length ? segs.flatMap((s) => [[s[0], s[1], s[4], s[5]], [s[2], s[3], s[6], s[7]]]) : pts;
  return { tree, segs, pts, verts, areal: /Polygon/.test(t), firsts: outer ? outer.filter((r) => r?.length).map((r) => pr(r[0])) : firsts };
}

const inside = (S, p) => S.areal && rayCount(S.tree, p[0], p[1]) % 2 === 1;
// The nearest point of shape S to (x, y), as [planar distance, lon, lat].
function closest(S, x, y) {
  if (S.tree) {
    const best = { d: Infinity };
    nearest(S.tree, x, y, best);
    if (!best.seg) return null;
    const s = best.seg;
    return [best.d, s[4] + best.t * (s[6] - s[4]), s[5] + best.t * (s[7] - s[5])];
  }
  let b = null;
  for (const p of S.pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (!b || d < b[0]) b = [d, p[2], p[3]]; }
  return b;
}

// The first shape (the site) is prepared once per geometry object and kept while it's in use.
const cache = new WeakMap();
function site(g) {
  let s = cache.get(g);
  if (s) return s;
  const bb = turf.bbox({ type: "Feature", properties: {}, geometry: g });
  // Very wide shapes (a continent) or ones across the antimeridian: leave to the slower measure.
  if (!(bb[2] - bb[0] <= 60 && bb[3] - bb[1] <= 30)) return null;
  const P = laea([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]);
  s = prepare(g, P);
  if (!s) return null;
  s.P = P;
  cache.set(g, s);
  return s;
}

// Shortest distance in km between two geometries (0 if they touch or overlap), or null if it can't be measured here
// (the caller then uses its own measure). Geodesic between the nearest pair found in the plane.
export function nearestKm(a, b) {
  if (!a?.coordinates || !b?.coordinates) return null;
  const A = site(a);
  if (!A) return null;
  const B = prepare(b, A.P);
  if (!B || (!B.segs.length && !B.pts.length)) return null;
  // Edges that cross or touch.
  if (A.tree && B.tree) {
    const [few, many] = B.segs.length <= A.segs.length ? [B.segs, A.tree] : [A.segs, B.tree];
    for (const s of few) if (anyCross(many, s)) return 0;
  }
  // One wholly inside the other (no edges cross, so one vertex per part decides it).
  if (A.areal && B.firsts.some((p) => inside(A, p))) return 0;
  if (B.areal && A.firsts.some((p) => inside(B, p))) return 0;
  // Nearest pair: each vertex of B to A, then A's vertices that could be nearer, to B.
  let best = null;
  for (const v of B.verts) {
    const c = closest(A, v[0], v[1]);
    if (c && (!best || c[0] < best.d)) best = { d: c[0], p: [v[2], v[3]], q: [c[1], c[2]] };
  }
  if (!best) return null;
  let near;
  if (A.tree) {
    const r = best.d, bx = [Infinity, Infinity, -Infinity, -Infinity];
    for (const v of B.verts) { if (v[0] < bx[0]) bx[0] = v[0]; if (v[1] < bx[1]) bx[1] = v[1]; if (v[0] > bx[2]) bx[2] = v[0]; if (v[1] > bx[3]) bx[3] = v[1]; }
    near = inBox(A.tree, [bx[0] - r, bx[1] - r, bx[2] + r, bx[3] + r], []).flatMap((s) => [[s[0], s[1], s[4], s[5]], [s[2], s[3], s[6], s[7]]]);
  } else near = A.pts;
  for (const v of near) {
    const c = closest(B, v[0], v[1]);
    if (c && c[0] < best.d) best = { d: c[0], p: [v[2], v[3]], q: [c[1], c[2]] };
  }
  // Under a millimetre is touching (a vertex on the other shape's edge, give or take rounding).
  return best.d < 1e-6 ? 0 : turf.distance(best.p, best.q, { units: "kilometers" });
}
