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

  function codeButtonCount(element) {
    return Array.from(element?.querySelectorAll?.("button") || [])
      .filter((btn) => CODE_RE.test((btn.textContent || "").trim()))
      .length;
  }

  function looksLikeAnnotationArea(element) {
    const text = (element?.textContent || "").toLowerCase();
    return text.includes("annotate")
      || text.includes("annotation")
      || text.includes("select text")
      || text.includes("student text")
      || text.includes("+ note")
      || text.includes("+ code")
      || codeButtonCount(element) >= 4;
  }

  function getCodeButtons({ includeHidden = false } = {}) {
    return Array.from(document.querySelectorAll("button"))
      .filter((button) => includeHidden || isVisible(button))
      .filter((button) => CODE_RE.test((button.textContent || "").trim()))
      .filter((button) => !button.matches("[data-annotation-proxy-code]"))
      .filter((button) => {
        let node = button.parentElement;
        let depth = 0;
        while (node && depth < 7) {
          if (looksLikeAnnotationArea(node)) return true;
          node = node.parentElement;
          depth += 1;
        }
        return false;
      });
  }

  function findToolbarContainer(buttons) {
    if (!buttons.length) return null;
    const candidateCounts = new Map();
    buttons.forEach((button) => {
      let node = button.parentElement;
      let depth = 0;
      while (node && depth < 7) {
        const count = codeButtonCount(node);
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

  function findOriginalCodeButton(code) {
    return getCodeButtons({ includeHidden: true })
      .find((button) => (button.textContent || "").trim() === code);
  }

  function hideOriginalCodeButtons(buttons) {
    buttons.forEach((button) => {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    });
  }

  function renderCodeStrip() {
    return CODES.map((entry) => `
      <button type="button" data-annotation-proxy-code="${entry.code}" title="${entry.code} — ${entry.label}: ${entry.explanation}" style="display:inline-flex;align-items:center;gap:5px;font-size:0.74rem;border:1px solid var(--line);border-radius:999px;padding:4px 9px;background:#fff;color:var(--ink);cursor:pointer;">
        <strong style="color:var(--accent-deep);">${entry.code}</strong>
        <span style="color:var(--muted);">${entry.label}</span>
      </button>
    `).join("");
  }

  function renderLegend() {
    return `
      <div id="annotation-code-help" class="teacher-ready-card" style="padding:12px 14px;margin:0 0 12px;border-color:var(--line);background:#fffefb;">
        <p class="mini-label" style="margin-bottom:4px;">Annotation tools</p>
        <p class="subtle" style="margin:0 0 10px;font-size:0.84rem;line-height:1.45;">Select part of the student's text, then choose a feedback code. Students see the code and your highlighted comment in the marked copy.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${renderCodeStrip()}
        </div>
        <details style="border-top:1px solid var(--line);padding-top:9px;">
          <summary style="cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--accent-deep);list-style-position:inside;">What do these codes mean?</summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:10px;">
            ${CODES.map((entry) => `
              <div style="display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-radius:10px;background:#fff;">
                <span style="font-size:0.76rem;font-weight:800;color:var(--accent-deep);border:1px solid var(--accent);background:#fffaf0;border-radius:8px;padding:2px 6px;min-width:38px;text-align:center;">${entry.code}</span>
                <span style="font-size:0.78rem;line-height:1.4;color:var(--ink);"><strong>${entry.label}:</strong> ${entry.explanation}</span>
              </div>
            `).join("")}
          </div>
        </details>
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
    if (!buttons.length && !document.getElementById("annotation-code-help")) return;

    addButtonTooltips(buttons);

    if (!document.getElementById("annotation-code-help")) {
      const toolbar = findToolbarContainer(buttons);
      if (!toolbar || !toolbar.parentElement) return;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderLegend().trim();
      toolbar.parentElement.insertBefore(wrapper.firstElementChild, toolbar);
    }

    hideOriginalCodeButtons(getCodeButtons());
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
    const proxy = event.target.closest("[data-annotation-proxy-code]");
    if (!proxy) return;
    const original = findOriginalCodeButton(proxy.dataset.annotationProxyCode);
    original?.click();
  });

  const observer = new MutationObserver(scheduleEnhancement);

  window.addEventListener("DOMContentLoaded", () => {
    enhanceAnnotationTools();
    const app = document.getElementById("app");
    if (app) observer.observe(app, { childList: true, subtree: true });
  });
})();
