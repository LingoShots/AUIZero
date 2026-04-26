(() => {
  const EXACT_TEXT_REPLACEMENTS = new Map([
    ["Suggest Grade", "Suggest rubric scores"],
    ["Copy Grade", "Copy grade summary"],
    ["Writing process & heatmap", "Writing process evidence"],
    ["Letter-by-letter playback", "Replay writing process"],
    ["Coaching chat", "Planning chat with coach"],
    ["Teacher Review", "Class work"],
  ]);

  const PARTIAL_TEXT_REPLACEMENTS = [
    [/^▶\s*Writing process & heatmap$/i, "▶ Writing process evidence"],
    [/^▶\s*Letter-by-letter playback$/i, "▶ Replay writing process"],
    [/^▶\s*Coaching chat/i, (text) => text.replace(/Coaching chat/i, "Planning chat with coach")],
  ];

  let scheduled = false;

  function replaceTextContent(element, replacement) {
    if (!element || element.dataset.teacherUiCleaned === "true") return;
    element.textContent = replacement;
    element.dataset.teacherUiCleaned = "true";
  }

  function applyMicrocopy() {
    document.querySelectorAll("button, summary, h1, h2, h3, h4, p, span, strong").forEach((element) => {
      const text = String(element.textContent || "").trim();
      if (!text) return;

      if (EXACT_TEXT_REPLACEMENTS.has(text)) {
        replaceTextContent(element, EXACT_TEXT_REPLACEMENTS.get(text));
        return;
      }

      for (const [pattern, replacement] of PARTIAL_TEXT_REPLACEMENTS) {
        if (!pattern.test(text)) continue;
        const nextText = typeof replacement === "function" ? replacement(text) : replacement;
        replaceTextContent(element, nextText);
        return;
      }
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyMicrocopy();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    applyMicrocopy();
    const app = document.getElementById("app");
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  });
})();
