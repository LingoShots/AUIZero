(function initAiAssistUtils(global, factory) {
  function findJsonStart(raw) {
    const arrayStart = raw.indexOf("[");
    const objectStart = raw.indexOf("{");
    const candidates = [arrayStart, objectStart].filter((value) => value >= 0);
    return candidates.length ? Math.min(...candidates) : -1;
  }

  function updateJsonScanState(state, char) {
    if (state.escapeNext) {
      state.escapeNext = false;
      return;
    }
    if (char === "\\") {
      state.escapeNext = true;
      return;
    }
    if (char === "\"") {
      state.inString = !state.inString;
    }
  }

  const utils = factory({ findJsonStart, updateJsonScanState });
  if (global) {
    global.AiAssistUtils = utils;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  }
})(
  typeof window === "undefined" ? globalThis : window,
  function aiAssistUtilsFactory({ findJsonStart, updateJsonScanState }) {
  function stripCodeFence(text = "") {
    const raw = String(text || "").trim();
    if (!raw.startsWith("```") || !raw.endsWith("```")) return raw;
    let start = 3;
    while (start < raw.length && raw[start] !== "\n" && raw[start] !== "\r") {
      start += 1;
    }
    if (start >= raw.length) return raw;
    while (start < raw.length && (raw[start] === "\n" || raw[start] === "\r")) {
      start += 1;
    }
    return raw.slice(start, -3).trim();
  }

  function findJsonEnd(raw, start, openChar, closeChar) {
    const state = { depth: 0, inString: false, escapeNext: false };
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      updateJsonScanState(state, char);
      if (state.escapeNext || char === "\\" || char === "\"") continue;
      if (state.inString) continue;
      if (char === openChar) state.depth += 1;
      if (char === closeChar) state.depth -= 1;
      if (state.depth === 0) return index;
    }
    return -1;
  }

  function extractJsonBlock(text = "") {
    const raw = stripCodeFence(text);
    const start = findJsonStart(raw);
    if (start < 0) return raw;
    const openChar = raw[start];
    const closeChar = openChar === "[" ? "]" : "}";
    const end = findJsonEnd(raw, start, openChar, closeChar);
    return end >= 0 ? raw.slice(start, end + 1) : raw.slice(start);
  }

  function parseJsonResponse(text, fallback = null) {
    try {
      return JSON.parse(extractJsonBlock(text));
    } catch (_) {
      return fallback;
    }
  }

  function stringifyLinesWithMarkers(lines = []) {
    return lines.map((line) => {
      const marker = line?.pasted ? "[PASTED]" : "[STUDENT]";
      return `${marker} Line ${line.number}: ${line.text}`;
    }).join("\n");
  }

  function getTeacherGenerateButtonState({ loading = false } = {}) {
    return {
      disabled: Boolean(loading),
      label: loading ? "Generating…" : "Create student-ready version →",
    };
  }

  function getStudentFeedbackButtonState({
    loading = false,
    feedbackUsed = 0,
    feedbackLimit = 0,
  } = {}) {
    const used = Number(feedbackUsed || 0);
    const limit = Number(feedbackLimit || 0);
    return {
      disabled: Boolean(loading) || used >= limit,
      label: loading ? "Checking…" : `Get AI feedback (${used}/${limit})`,
    };
  }

  return {
    extractJsonBlock,
    getStudentFeedbackButtonState,
    getTeacherGenerateButtonState,
    parseJsonResponse,
    stringifyLinesWithMarkers,
    stripCodeFence,
  };
  }
);
