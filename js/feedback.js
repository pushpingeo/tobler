// Feedback on the analyst's replies and run cards (Rob, 22 Nov): a thumbs up or down, and a "Something's wrong?" box.
// Each piece of feedback is one entry in the shared session log, beside the turn it's about, so the weekly digest
// reads it with the conversation. Nothing changes the product automatically. Respects the "Share my sessions" switch.

const MAX_NOTE = 1000;

// The log entry for one piece of feedback. Pure, so it can be tested.
export function feedbackEntry({ on, rating = null, note = "", turnAt = null, run = null, excerpt = "", at = new Date().toISOString() }) {
  const clean = String(note || "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  return {
    at,
    feedback: {
      on: on === "run" ? "run" : "reply",
      ...(rating === "up" || rating === "down" ? { rating } : {}),
      ...(clean ? { note: clean } : {}),
      ...(turnAt ? { turn_at: turnAt } : {}),
      ...(run ? { run } : {}),
      ...(excerpt ? { about: String(excerpt).replace(/\s+/g, " ").trim().slice(0, 200) } : {}),
    },
  };
}

// The row under a reply or a run card. `send(entry)` shares it and returns false when sharing is switched off.
export function feedbackRow({ on, turnAt = null, run = null, excerpt = "", send }) {
  const row = document.createElement("div");
  row.className = "feedback";
  let rating = null;
  const button = (text, label, cls) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text; b.setAttribute("aria-label", label); b.title = label;
    return b;
  };
  const up = button("👍", "Good answer", "fb-up");
  const down = button("👎", "Not right", "fb-down");
  const wrong = button("Something's wrong?", "Tell us what's wrong", "fb-wrong");
  const said = document.createElement("span");
  said.className = "fb-said";
  said.setAttribute("aria-live", "polite");
  const box = document.createElement("form");
  box.className = "fb-box";
  box.hidden = true;
  const text = document.createElement("textarea");
  text.rows = 2; text.maxLength = MAX_NOTE; text.placeholder = "What's wrong or missing? (optional)";
  text.setAttribute("aria-label", "What's wrong or missing");
  const go = button("Send", "Send feedback", "fb-send");
  go.type = "submit";
  box.append(text, go);

  const share = (entry) => {
    const ok = send(entry);
    said.textContent = ok === false ? "Session sharing is off in Settings, so this wasn't sent." : "Thanks.";
    return ok !== false;
  };
  const rate = (value) => {
    rating = value;
    up.setAttribute("aria-pressed", String(value === "up"));
    down.setAttribute("aria-pressed", String(value === "down"));
    share(feedbackEntry({ on, rating, turnAt, run, excerpt }));
    if (value === "down") { box.hidden = false; text.focus(); }
  };
  up.addEventListener("click", () => rate("up"));
  down.addEventListener("click", () => rate("down"));
  wrong.addEventListener("click", () => { box.hidden = false; text.focus(); });
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!text.value.trim()) { text.focus(); return; }
    if (share(feedbackEntry({ on, rating, note: text.value, turnAt, run, excerpt }))) {
      box.hidden = true;
      said.textContent = "Thanks, that's sent.";
    }
  });
  row.append(up, down, wrong, said, box);
  return row;
}
