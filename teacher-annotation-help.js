(() => {
  const BASE_CODES = [
    { code: "CS",  label: "Comma splice", explanation: "Two complete sentences joined with only a comma." },
    { code: "RO",  label: "Run-on", explanation: "Two or more sentences run together without correct punctuation." },
    { code: "FR",  label: "Fragment", explanation: "An incomplete sentence, usually missing a subject, verb, or complete idea." },
    { code: "P",   label: "Punctuation", explanation: "A period, comma, apostrophe, or other punctuation mark needs attention." },
    { code: "VT",  label: "Verb tense", explanation: "The verb tense does not match the time or tense of the surrounding text." },
    { code: "WF",  label: "Word form", explanation: "The word is in the wrong form, such as an adjective where an adverb is needed." },
    { code: "AGR", label: "Agreement", explanation: "Parts of the sentence do not agree, such as subject–verb or noun–pronoun agreement." },
    { code: "SP",  label: "Spelling", explanation: "A spelling error or typo." },
  ];

  const BASE_CODE_MAP = new Map(BASE_CODES.map((entry) => [entry.code, entry]));
  const CODE_TEXT_RE = /^[A-Z0-9]{1,8}$/;
  let enhanceScheduled = false;

  function isVisible(element) {
    return Boolean(element && element.offsetParent !== null);
  }

  function isProxyButton(button) {
    return button?.matches?.("[data-annotation-proxy-code]");
  }

  function getButtonCode(button) {
    const text = String(button?.textContent || "").trim().toUpperCase();
    if (!text || text.startsWith("+")) return "";
    if (!CODE_TEXT_RE.test(text)) return "";
    return text;
  }

  function codeButtonCount(element) {
    return Array.from(element?.querySelectorAll?.("button") || [])
      .filter((btn) => getButtonCode(btn) && !isProxyButton(btn))
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
      .filter((button) => getButtonCode(button))
      .filter((button) => !isProxyButton(button))
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
      .find((button) => getButtonCode(button) === code);
  }

  function getEntryForButton(button) {
    const code = getButtonCode(button);
    const base = BASE_CODE_MAP.get(code);
    if (base) return base;

    const title = String(button?.title || button?.getAttribute?.("aria-label") || "").trim();
    const cleanedTitle = title
      .replace(new RegExp(`^${code}\\s*[—:-]\\s*`, "i"), "")
      .trim();

    return {
      code,
      label: cleanedTitle || "Custom code",
      explanation: cleanedTitle || "Custom teacher-defined feedback code.",
      custom: true,
    };
  }

  function getCodeEntries() {
    const seen = new Set();
    return getCodeButtons({ includeHidden: true })
      .map(getEntryForButton)
      .filter((entry) => {
        if (!entry.code || seen.has(entry.code)) return false;
        seen.add(entry.code);
        return true;
      });
  }

  function getEntrySignature(entries) {
    return entries.map((entry) => `${entry.code}:${entry.label}:${entry.explanation}`).join("|");
  }

  function hideOriginalCodeButtons(buttons) {
    buttons.forEach((button) => {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    });
  }

  function renderCodeStrip(entries) {
    return entries.map((entry) => `
      <button type="button" data-annotation-proxy-code="${entry.code}" title="${entry.code} — ${entry.label}: ${entry.explanation}" style="display:inline-flex;align-items:center;gap:5px;font-size:0.74rem;border:1px solid var(--line);border-radius:999px;padding:4px 9px;background:#fff;color:var(--ink);cursor:pointer;">
        <strong style="color:var(--accent-deep);">${entry.code}</strong>
        <span style="color:var(--muted);">${entry.label}</span>
      </button>
    `).join("");
  }

  function renderLegend(entries) {
    return `
      <div id="annotation-code-help" data-code-signature="${getEntrySignature(entries)}" class="teacher-ready-card" style="padding:12px 14px;margin:0 0 12px;border-color:var(--line);background:#fffefb;">
        <p class="mini-label" style="margin-bottom:4px;">Annotation tools</p>
        <p class="subtle" style="margin:0 0 10px;font-size:0.84rem;line-height:1.45;">Select part of the student's text, then choose a feedback code. Students see the code and your highlighted comment in the marked copy.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${renderCodeStrip(entries)}
        </div>
        <details style="border-top:1px solid var(--line);padding-top:9px;">
          <summary style="cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--accent-deep);list-style-position:inside;">What do these codes mean?</summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:10px;">
            ${entries.map((entry) => `
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
      const entry = getEntryForButton(button);
      if (!entry.code) return;
      button.title = `${entry.code} — ${entry.label}: ${entry.explanation}`;
      button.setAttribute("aria-label", `${entry.code}: ${entry.label}. ${entry.explanation}`);
    });
  }

  function enhanceAnnotationTools() {
    const buttons = getCodeButtons({ includeHidden: true });
    if (!buttons.length && !document.getElementById("annotation-code-help")) return;

    addButtonTooltips(buttons);

    const entries = getCodeEntries();
    const signature = getEntrySignature(entries);
    let help = document.getElementById("annotation-code-help");

    if (!help) {
      const visibleButtons = getCodeButtons();
      const toolbar = findToolbarContainer(visibleButtons.length ? visibleButtons : buttons);
      if (!toolbar || !toolbar.parentElement) return;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderLegend(entries).trim();
      help = wrapper.firstElementChild;
      toolbar.parentElement.insertBefore(help, toolbar);
    } else if (help.dataset.codeSignature !== signature) {
      const wasOpen = Boolean(help.querySelector("details")?.open);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderLegend(entries).trim();
      const nextHelp = wrapper.firstElementChild;
      const details = nextHelp.querySelector("details");
      if (details) details.open = wasOpen;
      help.replaceWith(nextHelp);
      help = nextHelp;
    }

    hideOriginalCodeButtons(getCodeButtons({ includeHidden: true }));
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
