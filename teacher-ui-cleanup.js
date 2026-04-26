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

  function countLikelyStudents(container) {
    const studentNames = Array.from(container.querySelectorAll("button, li, [data-student-id], [data-user-id]"))
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean)
      .filter((text) => !/^\+|invite|copy|manage|class|assignment|create|save|delete|remove|settings/i.test(text));
    return Math.max(studentNames.length, 0);
  }

  function findRosterCard() {
    const candidates = Array.from(document.querySelectorAll("section, .panel, .teacher-ready-card, article, div"))
      .filter((element) => {
        if (element.id === "teacher-roster-collapse") return false;
        if (element.closest("#teacher-roster-collapse")) return false;
        const text = String(element.textContent || "").toLowerCase();
        if (!text.includes("student")) return false;
        if (text.includes("student text")) return false;
        if (text.includes("submission status")) return false;
        if (text.includes("annotation tools")) return false;
        const hasRosterWords = text.includes("class list") || text.includes("roster") || text.includes("invite") || text.includes("students");
        const hasAssignmentNoise = text.includes("teacher brief") || text.includes("assignment settings") || text.includes("student-facing task");
        return hasRosterWords && !hasAssignmentNoise;
      })
      .map((element) => ({ element, length: String(element.textContent || "").length }))
      .sort((a, b) => a.length - b.length);

    return candidates[0]?.element || null;
  }

  function collapseRosterIfUseful() {
    const existing = document.getElementById("teacher-roster-collapse");
    if (existing) return;

    const card = findRosterCard();
    if (!card || !card.parentElement) return;
    if (card.dataset.teacherRosterCollapsed === "true") return;

    const count = countLikelyStudents(card);
    if (count < 1) return;

    const wrapper = document.createElement("details");
    wrapper.id = "teacher-roster-collapse";
    wrapper.className = card.className || "teacher-ready-card";
    wrapper.style.cssText = card.getAttribute("style") || "";
    wrapper.style.padding = wrapper.style.padding || "14px";
    wrapper.style.marginBottom = wrapper.style.marginBottom || "12px";

    const summary = document.createElement("summary");
    summary.style.cursor = "pointer";
    summary.style.fontWeight = "700";
    summary.style.color = "var(--ink)";
    summary.style.listStylePosition = "inside";
    summary.textContent = `Class list · ${count} ${count === 1 ? "student" : "students"} · Manage roster`;

    card.dataset.teacherRosterCollapsed = "true";
    card.parentElement.insertBefore(wrapper, card);
    wrapper.appendChild(summary);
    wrapper.appendChild(card);
  }

  function enhance() {
    applyMicrocopy();
    collapseRosterIfUseful();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    enhance();
    const app = document.getElementById("app");
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  });
})();
