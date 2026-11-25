// Licence classes, from the licence text as the publisher states it (quoted verbatim by the atlas).
// Rule (Rob, 17 Nov): Tobler doesn't use data under Esri's Master License Agreement unless the person says they hold
// an Esri licence; open licences are preferred; data whose licence isn't stated can be used but is flagged.
//   open          CC BY, CC0, OGL, ODbL, public domain, US government works, NASA open data…
//   esri-mla      Esri Master License Agreement (Living Atlas copies): excluded by default
//   non-commercial  stated as non-commercial only (e.g. WDPA): excluded by default, like Esri's; the person can switch
//                 it on in settings if their use allows it (Rob, 18 Nov)
//   unknown       not stated
//   stated        stated but not recognised: shown verbatim, check before commercial use
const OPEN = /creative commons|\bcc[- ]?by\b|\bcc0\b|\bcc-?zero\b|open government licen[cs]e|\bOGL\b|\bODbL\b|open database licen[cs]e|public domain|no (known )?restrictions|U\.?S\.? government work|work of the U\.?S\.? federal government|NASA.{0,40}open|open data (policy|licen[cs]e)|licence ouverte|etalab|datenlizenz deutschland|\bDL-DE\b|\bPDDL\b|free and open/i;
const ESRI_MLA = /esri master licen[cs]e agreement|esri master agreement/i;
const NONCOMM = /non-?commercial|not for commercial|no commercial use|commercial use (is )?(not permitted|prohibited|not allowed)|\bNC\b(?=[- ]|$)|cc[- ]by[- ]nc/i;

export function classifyLicence(text) {
  const t = String(text || "").trim();
  if (!t || /^(not stated|unknown|none|n\/a|-)$/i.test(t)) return { class: "unknown", short: "licence not stated" };
  if (ESRI_MLA.test(t)) return { class: "esri-mla", short: "Esri Master License Agreement" };
  if (NONCOMM.test(t)) return { class: "non-commercial", short: shorten(t) };
  if (OPEN.test(t)) return { class: "open", short: shorten(t) };
  return { class: "stated", short: shorten(t) };
}

const shorten = (t) => (t.length > 140 ? t.slice(0, 139) + "…" : t);

// What the analyst is told about each class.
export const LICENCE_NOTE = {
  open: "open licence",
  "esri-mla": "Esri Master License Agreement: only for people who hold an Esri licence",
  "non-commercial": "non-commercial use only: used because the person switched on non-commercial data; never in commercial work",
  unknown: "licence not stated by the publisher",
  stated: "licence stated but not a standard open one: not confirmed for commercial use",
};

// Whether a licence class may be used, given the person's settings: { esri: bool, nonCommercial: bool }.
// Returns null when allowed, or the reason it's left out.
export function licenceBlock(cls, allow = {}) {
  if (cls === "esri-mla" && !allow.esri) return "Esri Master License Agreement: only for people who hold an Esri licence (a setting)";
  if (cls === "non-commercial" && !allow.nonCommercial) return "non-commercial licence (e.g. WDPA): left out unless switched on in settings for non-commercial use";
  return null;
}
