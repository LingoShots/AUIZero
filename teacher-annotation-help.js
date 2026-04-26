(() => {
  const CODES = [
    { code: "CS",  label: "Comma splice", explanation: "Two complete sentences joined with only a comma." },
    { code: "RO",  label: "Run-on", explanation: "Two or more sentences run together without correct punctuation." },
    { code: "FR",  label: "Fragment", explanation: "An incomplete sentence, usually missing a subject, verb, or complete idea." },
    { code: "P",   label: "Punctuation", explanation: "A period, comma, apostrophe, or other punctuation mark needs attention." },
    { code: "VT",  label: "Verb tense", explanation: "The verb tense does not match the time or tense of the surrounding text." },
    { code: "WF",  label: "Word form", explanation: "The word is in the wrong form, such as an adjective where an adverb is needed." },
    { code: "AGR", label: "Agreement", explanation: "Parts of the sentence do not agree, such as subject–verb or noun–pronoun agreement." },
    { code: "SP",  label: "Spelling", explanation: "A spelling error or typo." },
  ];

  const CODE_MAP = new Map(CODES.map((entry) => [entry.code, entry]));
  const CODE_RE = /^(CS|RO|FR|P|VT|WF|AGR|SP)$/;
  let enhanceScheduled = false;

  function isVisible(element) {
    return Boolean(element && element.offsetParent !== null);
  }

  function getCodeButtons() {
    return Array.from(document.querySelectorAll("button"))
      .filter(isVisible)
      .filter((button) => CODE_RE.test((button.textContent || "").trim()))
      .filter((button) => {
        const area = button.closest(".panel, .teacher-ready-card, section, article, div");
        const text = (area?.textContent || "").toLowerCase();
        return text.includes("annotation") || text.includes("select") || text.includes("student text") || text.includes("comment");
      });
  }

  function findToolbarContainer(buttons) {
    if (!buttons.length) return null;
    const candidateCounts = new Map();
    buttons.forEach((button) => {
      let node = button.parentElement;
      let depth = 0;
      while (node && depth < 5) {
        const count = Array.from(node.querySelectorAll("button"))
          .filter((btn) => CODE_RE.test((btn.textContent || "").trim()))
          .length;
        if (count >= Math.min(3, buttons.length)) {
          candidateCounts.set(node, count);
        }
        node = node.parentElement;
        depth += 1;
      }
    });

    return Array.from(candidateCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([node]) => node)[0] || buttons[0].parentElement;
  }

  function renderLegend() {
    return `
      <div id="annotation-code-help" class="teacher-ready-card" style="padding:12px 14px;margin:0 0 12px;border-color:var(--line);background:#fffefb;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div>
            <p class="mini-label" style="margin-bottom:4px;">Annotation tools</p>
            <p class="subtle" style="margin:0;font-size:0.84rem;line-height:1.45;">Select part of the student's text, then choose a feedback code. Students see the code and your highlighted comment in the marked copy.</p>
          </div>
          <button class="button-secondary" type="button" data-toggle-annotation-help style="font-size:0.78rem;padding:6px 10px;">What do these codes mean?</button>
        </div>
        <div data-annotation-help-body style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:10px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">
            ${CODES.map((entry) => `
              <div style="display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-radius:10px;background:#fff;">
                <span style="font-size:0.76rem;font-weight:800;color:var(--accent-deep);border:1px solid var(--accent);background:#fffaf0;border-radius:8px;padding:2px 6px;min-width:38px;text-align:center;">${entry.code}</span>
                <span style="font-size:0.78rem;line-height:1.4;color:var(--ink);"><strong>${entry.label}:</strong> ${entry.explanation}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function addButtonTooltips(buttons) {
    buttons.forEach((button) => {
      const code = (button.textContent || "").trim();
      const entry = CODE_MAP.get(code);
      if (!entry) return;
      button.title = `${code} — ${entry.label}: ${entry.explanation}`;
      button.setAttribute("aria-label", `${code}: ${entry.label}. ${entry.explanation}`);
    });
  }

  function enhanceAnnotationTools() {
    const buttons = getCodeButtons();
    if (!buttons.length) return;

    addButtonTooltips(buttons);

    if (document.getElementById("annotation-code-help")) return;

    const toolbar = findToolbarContainer(buttons);
    if (!toolbar || !toolbar.parentElement) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderLegend().trim();
    toolbar.parentElement.insertBefore(wrapper.firstElementChild, toolbar);
  }

  function scheduleEnhancement() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    window.requestAnimationFrame(() => {
      enhanceScheduled = false;
      enhanceAnnotationTools();
    });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-annotation-help]");
    if (!toggle) return;
    const body = document.querySelector("[data-annotation-help-body]");
    if (!body) return;
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "block";
    toggle.textContent = isOpen ? "What do these codes mean?" : "Hide code guide";
  });

  const observer = new MutationObserver(scheduleEnhancement);

  window.addEventListener("DOMContentLoaded", () => {
    enhanceAnnotationTools();
    const app = document.getElementById("app");
    if (app) observer.observe(app, { childList: true, subtree: true });
  });
})();
