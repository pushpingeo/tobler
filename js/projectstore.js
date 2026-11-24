// Projects kept in this browser (IndexedDB): a project is its places and its screening runs, saved as they change and
// put back on reload. Nothing leaves the browser (invariant 7). Several projects: starting a new one keeps the old,
// which can be opened again. No DOM; js/workspace.js does the saving and restoring.
//
// A project: { id, name, created_at, updated_at, places: [place snapshot], runs: [run record], counts }

const DB = "tobler", STORE = "projects", VERSION = 1;

function open(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error("This browser can't keep projects (no IndexedDB)."));
    const req = idb.open(DB, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = async (mode, fn, idb) => {
  const db = await open(idb);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
};

export const saveProject = (project, idb) => tx("readwrite", (s) => s.put(project), idb);
export const loadProject = (id, idb) => tx("readonly", (s) => s.get(id), idb);
// Newest first, without the heavy parts: for the list of earlier projects.
export async function listProjects(idb) {
  const all = await tx("readonly", (s) => s.getAll(), idb);
  return (all || []).map((p) => ({ id: p.id, name: p.name, updated_at: p.updated_at, sites: p.places?.length || 0, screens: p.runs?.length || 0 }))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// What of a place is kept: everything needed to put it back as it was (its id too, so runs still point at it).
const PLACE_KEYS = ["id", "name", "alias", "given", "former", "kind", "feature", "status", "origin", "edits", "scale", "scaleFrom", "extraParts"];
export function placeSnapshot(p) {
  const out = {};
  for (const k of PLACE_KEYS) if (p[k] !== undefined) out[k] = p[k];
  return JSON.parse(JSON.stringify(out));
}

// A default name: the first site's name, or the date.
export function projectName(places, when = new Date()) {
  const first = places.find((p) => p.status !== "proposed") || places[0];
  return first ? first.name : `Project, ${when.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

export const newProjectId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
