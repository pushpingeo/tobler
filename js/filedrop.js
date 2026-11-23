// Dropping files anywhere on the page, or picking them, for site boundaries (js/fileimport.js reads them). A
// browser only hands a page the files the person actually drops, never their neighbours, so a shapefile arrives as
// a folder, as its files together, or as a zip. Folders are walked here. Nothing leaves the browser.

// Every file under a dropped item, with its path inside the folder. Must start inside the drop event.
async function walk(entry, path = "") {
  if (!entry) return [];
  if (entry.isFile) return [await new Promise((res, rej) => entry.file((f) => res({ file: f, name: path + f.name }), rej))];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader(), out = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); // up to 100 at a time
    if (!batch.length) break;
    for (const e of batch) out.push(...(await walk(e, `${path}${entry.name}/`)));
  }
  return out;
}
const toBytes = async (list) => Promise.all(list.map(async ({ file, name }) => ({ name, bytes: new Uint8Array(await file.arrayBuffer()) })));
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

// onFiles([{ name, bytes }]) is called once per drop or pick. overlay: the element shown while something is dragged over.
export function setupFileDrop({ overlay, input, onFiles, onError = () => {} }) {
  let depth = 0;
  const show = (on) => overlay?.classList.toggle("on", on);
  addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(true); });
  addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; show(false);
    // Entries have to be taken before the first await, or the browser forgets them.
    const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === "file");
    const entries = items.map((i) => i.webkitGetAsEntry?.() || null);
    const plain = [...(e.dataTransfer.files || [])];
    try {
      let list;
      if (entries.length && entries.every(Boolean)) list = (await Promise.all(entries.map((en) => walk(en)))).flat();
      else list = plain.map((f) => ({ file: f, name: f.name }));
      if (list.length) onFiles(await toBytes(list));
    } catch (err) { onError(err); }
  });
  input?.addEventListener("change", async () => {
    const list = [...input.files].map((f) => ({ file: f, name: f.webkitRelativePath || f.name }));
    input.value = "";
    try { if (list.length) onFiles(await toBytes(list)); } catch (err) { onError(err); }
  });
}
