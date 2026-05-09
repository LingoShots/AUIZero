// rich-text-render.js
// Rich-text rendering, prompt formatting helpers, and small text utilities
// extracted from app.js (Phase 4 refactor).
//
// Exposes window.RichTextRender plus legacy globals (renderRichTextHtml,
// stripPromptFormatting, truncateText, focusChatInput,
// applyPromptFormattingToTextarea, renderPromptFormattingToolbar) for
// backward compatibility with existing app.js call sites.
//
// escapeHtml is read lazily from window so this module can load before
// app.js wires it up.

(function () {
  function _escapeHtml(value) {
    if (typeof window !== "undefined" && typeof window.escapeHtml === "function") {
      return window.escapeHtml(value);
    }
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderRichTextHtml(text = "") {
    return _escapeHtml(String(text || ""))
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\+\+([^+]+)\+\+/g, "<u>$1</u>")
      .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\n+/g, "<br>");
  }

  function stripPromptFormatting(text = "") {
    return String(text || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\+\+([^+]+)\+\+/g, "$1")
      .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  }

  function truncateText(text = "", maxLength = 140) {
    const normalized = String(text || "").trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength).trimEnd()}…`;
  }

  function focusChatInput() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const textarea = document.getElementById("chat-input");
      if (!textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      if (typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(cursor, cursor);
      }
    });
  }

  function applyPromptFormattingToTextarea(textarea, format) {
    if (!textarea) return;
    const wrappers = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      underline: ["++", "++"],
    };
    const [open, close] = wrappers[format] || ["", ""];
    if (!open) return;

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const selected = textarea.value.slice(start, end);
    const nextValue = `${textarea.value.slice(0, start)}${open}${selected}${close}${textarea.value.slice(end)}`;
    textarea.value = nextValue;
    const cursorStart = start + open.length;
    const cursorEnd = cursorStart + selected.length;
    textarea.focus();
    textarea.setSelectionRange(cursorStart, cursorEnd);
  }

  function renderPromptFormattingToolbar(targetId) {
    return `
      <div class="pill-row" style="margin-bottom:8px;gap:8px;">
        <span class="mini-label" style="margin:0;align-self:center;">Formatting</span>
        <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="bold" style="min-height:34px;padding:0 12px;"><strong>B</strong></button>
        <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="italic" style="min-height:34px;padding:0 12px;"><em>I</em></button>
        <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="underline" style="min-height:34px;padding:0 12px;"><u>U</u></button>
      </div>
    `;
  }

  const RichTextRender = {
    renderRichTextHtml,
    stripPromptFormatting,
    truncateText,
    focusChatInput,
    applyPromptFormattingToTextarea,
    renderPromptFormattingToolbar,
  };

  if (typeof window !== "undefined") {
    window.RichTextRender = RichTextRender;
    Object.entries(RichTextRender).forEach(([name, fn]) => {
      if (typeof window[name] !== "function") {
        window[name] = fn;
      }
    });
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = RichTextRender;
  }
})();