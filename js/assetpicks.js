// What's planned at a site, as quick picks (the industry profile's "asset_picks", catalogue/industries/): the buttons shown when someone screens a
// place without saying. Pure, so it can be tested; the card itself is drawn in js/workspace.js.

// The picks that suit the setting, each resolved to one asset type: the first `first` as buttons, the rest for More….
export function picksFor(config, offshore) {
  const setting = offshore ? "offshore" : "onshore";
  const list = (config?.picks || [])
    .filter((p) => !p.only || p.only === setting)
    .map((p) => ({ label: p.label, type: p.type || p[setting] }))
    .filter((p) => p.type);
  const n = config?.first ?? 6;
  return { shown: list.slice(0, n), more: list.slice(n) };
}

// What the person sees as their message, and what the analyst reads with it.
export function pickMessage(placeName, pick) {
  if (!pick) {
    const text = `Screen ${placeName}: a general screen, nothing particular planned.`;
    return { text, forModel: `${text}\n[The person chose a general screen from your buttons: call screen_site now with asset_type "other" and assumed false.]` };
  }
  const what = pick.label.toLowerCase();
  const text = `Screen ${placeName} as ${/^[aeiou]/.test(what) ? "an" : "a"} ${what} site.`;
  const planned = pick.planned ? ` and planned "${pick.planned}"` : "";
  return { text, forModel: `${text}\n[The person picked this from your buttons: call screen_site now with asset_type "${pick.type}"${planned} and assumed false.]` };
}
