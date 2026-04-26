(() => {
  const FALLBACK_CODES = [
    { code: "CS", label: "Comma splice" },
    { code: "RO", label: "Run-on" },
    { code: "FR", label: "Fragment" },
    { code: "P", label: "Punctuation" },
    { code: "VT", label: "Verb tense" },
    { code: "WF", label: "Word form" },
    { code: "AGR", label: "Agreement" },
    { code: "SP", label: "Spelling" },
  ];

  let scheduled = false;

  function readCodes() {
    try {
      if (typeof getErrorCodes === "function") {
        const codes = getErrorCodes();
        if (Array.isArray(codes) && codes.length) return codes;
      }
    } catch (_) {}
    return FALLBACK_CODES;
  }

  function cleanCodes() {
    const seen = new Set();
    return readCodes()
      .map((entry) => ({
        code: String(entry?.code || "").trim().toUpperCase().slice(0, 8),
        label: String(entry?.label || "Custom code").trim(),
      }))
      .filter((entry) => entry.code && entry.label)
      .filter((entry) => {
        if (seen.has(entry.code)) return false;
        seen.add(entry.code);
        return true;
      });
  }

  function shortLabel(label) {
    return String(label || "Custom code")
      .split(":")[0]
      .replace(/^Wrong\s+/i, "")
      .replace(/^Missing\s+/i, "")
      .trim();
  }

  function isVisible(element) {
    return Boolean(element && element.offsetParent !== null);
  }

  function codeSet() {
    return new Set(cleanCodes().map((entry) => entry.code));
  }

  function isOriginalCodeButton(button) {
    if (!button || button.matches("[data-annotation-proxy-code]")) return false;
    return codeSet().has(String(button.textContent || "").trim().toUpperCase());
  }

  function findAnnotateActionButton() {
    return Array.from(document.querySelectorAll("button"))
      .filter(isVisible)
      .find((button) => {
        const text = String(button.textContent || "").trim().toLowerCase();
        return text === "+ note" || text === "+ code";
      }) || null;
  }

  function findAnnotateRow() {
    const actionButton = findAnnotateActionButton();
    if (!actionButton) return null;

    let node = actionButton.parentElement;
    let best = actionButton.parentElement;
    for (let i = 0; node && i < 8; i += 1) {
      const text = String(node.textContent || "").toLowerCase();
      if (text.includes("annotate:") || text.includes("annotate")) {
        best = node;
        if (text.includes("+ note") && text.includes("+ code")) break;
      }
      node = node.parentElement;
    }
    return best;
  }

  function renderGuide(codes) {
    const signature = codes.map((entry) => `${entry.code}:${entry.label}`).join("|");
    return `
      <div id="annotation-code-help" data-code-signature="${signature}" class="teacher-ready-card" style="padding:12px 14px;margin:0 0 12px;border-color:var(--line);background:#fffefb;display:block;">
        <p class="mini-label" style="margin-bottom:4px;">Annotation tools</p>
        <p class="subtle" style="margin:0 0 10px;font-size:0.84rem;line-height:1.45;">Select part of the student's text, then choose a feedback code.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${codes.map((entry) => `
            <button type="button" data-annotation-proxy-code="${entry.code}" title="${entry.label}" style="display:inline-flex;align-items:center;gap:5px;font-size:0.74rem;border:1px solid var(--line);border-radius:999px;padding:4px 9px;background:#fff;color:var(--ink);cursor:pointer;">
              <strong style="color:var(--accent-deep);">${entry.code}</strong>
              <span style="color:var(--muted);">${shortLabel(entry.label)}</span>
            </button>
          `).join("")}
        </div>
        <details style="border-top:1px solid var(--line);padding-top:9px;">
          <summary style="cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--accent-deep);list-style-position:inside;">What do these codes mean?</summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:10px;">
            ${codes.map((entry) => `
              <div style="display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-radius:10px;background:#fff;">
                <span style="font-size:0.76rem;font-weight:800;color:var(--accent-deep);border:1px solid var(--accent);background:#fffaf0;border-radius:8px;padding:2px 6px;min-width:38px;text-align:center;">${entry.code}</span>
                <span style="font-size:0.78rem;line-height:1.4;color:var(--ink);"><strong>${shortLabel(entry.label)}:</strong> ${entry.label}</span>
              </div>
            `).join("")}
          </div>
        </details>
      </div>
    `;
  }

  function insertOrUpdateGuide() {
    const codes = cleanCodes();
    const signature = codes.map((entry) => `${entry.code}:${entry.label}`).join("|");
    const row = findAnnotateRow();
    let guide = document.getElementById("annotation-code-help");

    if (!guide) {
      if (!row || !row.parentElement) return false;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderGuide(codes).trim();
      guide = wrapper.firstElementChild;
      row.parentElement.insertBefore(guide, row);
      return true;
    }

    guide.style.display = "block";
    if (guide.dataset.codeSignature !== signature) {
      const open = Boolean(guide.querySelector("details")?.open);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderGuide(codes).trim();
      const next = wrapper.firstElementChild;
      const details = next.querySelector("details");
      if (details) details.open = open;
      guide.replaceWith(next);
    }
    return true;
  }

  function hideOriginalCodeButtons() {
    Array.from(document.querySelectorAll("button"))
      .filter(isOriginalCodeButton)
      .forEach((button) => {
        button.style.display = "none";
        button.tabIndex = -1;
        button.setAttribute("aria-hidden", "true");
      });
  }

  function findOriginalCodeButton(code) {
    return Array.from(document.querySelectorAll("button"))
      .filter(isOriginalCodeButton)
      .find((button) => String(button.textContent || "").trim().toUpperCase() === code);
  }

  function enhance() {
    const inserted = insertOrUpdateGuide();
    if (inserted) hideOriginalCodeButtons();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener("click", (event) => {
    const proxy = event.target.closest("[data-annotation-proxy-code]");
    if (!proxy) return;
    const original = findOriginalCodeButton(proxy.dataset.annotationProxyCode);
    original?.click();
  });

  window.addEventListener("DOMContentLoaded", () => {
    enhance();
    const app = document.getElementById("app");
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  });
})();
