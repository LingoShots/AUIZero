(() => {
  function compactWhitespace(text = "") {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function buildStartExcerpt(text = "", options = {}) {
    const compact = compactWhitespace(text);
    const excerptLength = Math.max(80, Number(options.excerptLength || 180));
    if (!compact) {
      return {
        preview: "",
        truncated: false,
      };
    }

    if (compact.length <= excerptLength) {
      return {
        preview: compact,
        truncated: false,
      };
    }

    return {
      preview: `${compact.slice(0, excerptLength).trim()}...`,
      truncated: true,
    };
  }

  function getEvidenceKindLabel(kind) {
    return kind === "paste" ? "Paste event" : "Large single insert";
  }

  function getEvidenceStatusLabel(foundExact) {
    return foundExact ? "Still found in final text" : "Edited or removed";
  }

  window.PasteEvidenceUtils = {
    buildStartExcerpt,
    compactWhitespace,
    getEvidenceKindLabel,
    getEvidenceStatusLabel,
  };
})();
