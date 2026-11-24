// Sites and runs, like a desktop GIS project's folders (Rob, 24 Nov): each site with the screens run on it, newest
// first, old runs beside new ones and marked when they're out of date. Discreet: a closed strip under the header
// that says how many of each, opening into the tree. Built from plain data (js/workspace.js supplies it and the
// clicks), so it can be tested without the map.
//
// model: [{ id, name, size, kind, runs: [{ id, time, flags, decision, outdated, replacedBy, shown }] }]
// on: { site(id), run(id) }; project: { earlier: [{ id, name, updated_at, sites, screens }], onNew(), onOpen(id) }

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function treeSummary(model) {
  const runs = model.reduce((a, s) => a + s.runs.length, 0);
  return `${plural(model.length, "site")}${runs ? ` · ${plural(runs, "screen")}` : ""}`;
}

// One line for a run: id, time, then its state (out of date first, because that's what the person must notice).
export function runLine(run) {
  const state = run.replacedBy ? `Replaced by ${run.replacedBy}` : run.outdated ? "Out of date: site edited" : [
    run.flags != null ? plural(run.flags, "flag") : "", run.decision ? cap(run.decision) : "",
  ].filter(Boolean).join(" · ");
  return { id: run.id, time: run.time, state, stale: !!(run.replacedBy || run.outdated) };
}

export function buildTree(model, on, { open = false, project = null } = {}) {
  const box = document.createElement("details");
  box.className = "sitetree";
  box.open = open;
  const sum = document.createElement("summary");
  sum.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z"/></svg>';
  sum.append(Object.assign(document.createElement("span"), { textContent: "Sites and screens" }),
    Object.assign(document.createElement("span"), { className: "count", textContent: treeSummary(model) }));
  box.append(sum);
  const ul = document.createElement("ul");
  ul.className = "sites";
  for (const s of model) {
    const li = document.createElement("li");
    li.className = "site-node";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "site-row";
    b.dataset.site = s.id;
    b.append(Object.assign(document.createElement("span"), { className: "name", textContent: s.name }),
      ...(s.size ? [Object.assign(document.createElement("span"), { className: "size", textContent: s.size })] : []));
    b.addEventListener("click", () => on.site?.(s.id));
    li.append(b);
    const runs = document.createElement("ul");
    runs.className = "runs";
    if (!s.runs.length) runs.append(Object.assign(document.createElement("li"), { className: "none", textContent: "Not screened yet" }));
    for (const r of s.runs) {
      const line = runLine(r);
      const rl = document.createElement("li");
      const rb = document.createElement("button");
      rb.type = "button";
      rb.className = `run-row${line.stale ? " stale" : ""}${r.shown ? " shown" : ""}`;
      rb.dataset.run = r.id;
      if (r.shown) rb.setAttribute("aria-current", "true");
      rb.append(Object.assign(document.createElement("b"), { textContent: r.id }),
        Object.assign(document.createElement("span"), { className: "time", textContent: r.time }),
        Object.assign(document.createElement("span"), { className: "state", textContent: line.state }));
      rb.addEventListener("click", () => on.run?.(r.id));
      rl.append(rb);
      runs.append(rl);
    }
    li.append(runs);
    ul.append(li);
  }
  box.append(ul);
  if (project) box.append(projectFoot(project));
  return box;
}

// Kept in this browser: start a new project (the current one stays), or open an earlier one.
function projectFoot({ earlier = [], onNew, onOpen }) {
  const foot = document.createElement("div");
  foot.className = "project-foot";
  const kept = Object.assign(document.createElement("p"), { className: "kept", textContent: "Kept in this browser only." });
  const nb = Object.assign(document.createElement("button"), { type: "button", className: "new-project", textContent: "Start a new project" });
  nb.addEventListener("click", () => onNew?.());
  foot.append(kept, nb);
  if (earlier.length) {
    const d = document.createElement("details");
    d.className = "earlier";
    d.append(Object.assign(document.createElement("summary"), { textContent: `Earlier projects (${earlier.length})` }));
    const ol = document.createElement("ul");
    for (const p of earlier.slice(0, 20)) {
      const li = document.createElement("li");
      const b = Object.assign(document.createElement("button"), { type: "button", className: "open-project" });
      b.dataset.project = p.id;
      const when = p.updated_at ? new Date(p.updated_at).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
      b.append(Object.assign(document.createElement("span"), { className: "name", textContent: p.name }),
        Object.assign(document.createElement("span"), { className: "time", textContent: [plural(p.sites, "site"), p.screens ? plural(p.screens, "screen") : "", when].filter(Boolean).join(" · ") }));
      b.addEventListener("click", () => onOpen?.(p.id));
      li.append(b);
      ol.append(li);
    }
    d.append(ol);
    foot.append(d);
  }
  return foot;
}
