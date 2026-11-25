// For browser checks and tests with a scripted model: since 25 Nov a flag cites evidence by id (E7, or a check's id),
// so a scripted result written with evidence names is turned into ids by finding each name in what the run showed
// the model (a tool result's "ref", or "E7 Name" in the checks' lines). A name the run never showed stays a name,
// and so stays untraced, as it would from a real model.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function texts(body) {
  return (body?.messages || []).flatMap((m) => (typeof m.content === "string" ? [m.content]
    : (m.content || []).flatMap((b) => (b.type === "tool_result" ? [typeof b.content === "string" ? b.content : JSON.stringify(b.content)] : b.type === "text" ? [b.text] : []))));
}

export function refIn(body, name) {
  for (const t of texts(body)) {
    const m = t.match(new RegExp(`"ref":"(E\\d+)"[^{}]*?"name":"${esc(name)}"`, "i")) || t.match(new RegExp(`\\b(E\\d+) ${esc(name)}\\b`, "i"));
    if (m) return m[1];
  }
  return name;
}

// A scripted result (summary, then a ```json block) with each evidence { name } swapped for its id.
export function cite(result, body) {
  return result.replace(/```json\n([\s\S]*?)\n```/, (all, j) => {
    let o;
    try { o = JSON.parse(j); } catch { return all; }
    for (const f of o.flags || []) f.evidence = (f.evidence || []).map((e) => (e && typeof e === "object" && e.name ? refIn(body, e.name) : e));
    return "```json\n" + JSON.stringify(o) + "\n```";
  });
}
