(function initAiAssistUtils(global, factory) {
  const utils = factory();
  if (global) {
    global.AiAssistUtils = utils;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  }
})(
  typeof window !== "undefined" ? window : globalThis,
  function aiAssistUtilsFactory() {
  function stripCodeFence(text = "") {
    const raw = String(text || "").trim();
    const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : raw;
  }

  function extractJsonBlock(text = "") {
    const raw = stripCodeFence(text);
    const arrayStart = raw.indexOf("[");
    const objectStart = raw.indexOf("{");
    const candidates = [arrayStart, objectStart].filter((value) => value >= 0);
    if (!candidates.length) return raw;
    const start = Math.min(...candidates);
    const openChar = raw[start];
    const closeChar = openChar === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === openChar) depth += 1;
      if (char === closeChar) depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }

    return raw.slice(start);
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

  return {
    extractJsonBlock,
    parseJsonResponse,
    stringifyLinesWithMarkers,
    stripCodeFence,
  };
  }
);
