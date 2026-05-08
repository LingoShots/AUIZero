(() => {
  const ANALYSIS_VERSION = "writing-process-v1";
  const LARGE_PASTE_LIMIT = 220;
  const MIN_WORDS_FOR_STATUS = 80;

  const STATUS = {
    TYPICAL: "typical_process",
    REVIEW: "review_suggested",
    CLOSE: "close_review_needed",
    INSUFFICIENT: "not_enough_writing_data",
  };

  const STATUS_LABELS = {
    [STATUS.TYPICAL]: "Typical process",
    [STATUS.REVIEW]: "Review suggested",
    [STATUS.CLOSE]: "Close review needed",
    [STATUS.INSUFFICIENT]: "Not enough writing data",
  };

  const STATUS_REASONS = {
    [STATUS.TYPICAL]: "The writing process is broadly consistent with normal drafting and revision.",
    [STATUS.REVIEW]: "This submission includes one or more process patterns worth checking, such as a large paste or unusually little revision.",
    [STATUS.CLOSE]: "Several independent process signals are unusual together. Review the timeline, paste evidence, and playback before deciding what to do.",
    [STATUS.INSUFFICIENT]: "There is not enough typed writing here to interpret the process reliably.",
  };

  const PHASES = {
    COACH_OUTLINE: "coach_outline",
    DRAFT: "draft",
    FINAL: "final",
  };

  const METRIC_DEFINITIONS = {
    typingRate: {
      label: "Typing rate",
      help: "Characters typed per active minute. This is compared carefully because typing speed is affected by proficiency, keyboard skill, and device.",
    },
    longPauses: {
      label: "Long thinking pauses",
      help: "Pauses of 2 seconds or more per 100 words. L2 writers pause in different places depending on planning, vocabulary search, and sentence boundaries.",
    },
    localRevisions: {
      label: "Local revisions",
      help: "Medium edits per 100 words, such as deleting or rewriting part of a sentence. Authentic drafting usually includes some revision.",
    },
    productProcessRatio: {
      label: "Text survival",
      help: "Final characters divided by typed characters. A value near 1.00 means most typed text survived unchanged.",
    },
    pasteShare: {
      label: "Paste / bulk insert",
      help: "Share of final text that appears to come from paste or large bulk-entry events.",
    },
  };

  const api = {
    ANALYSIS_VERSION,
    LARGE_PASTE_LIMIT,
    MIN_WORDS_FOR_STATUS,
    STATUS,
    STATUS_LABELS,
    STATUS_REASONS,
    PHASES,
    METRIC_DEFINITIONS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.PraxisWritingProcess = {
      ...(window.PraxisWritingProcess || {}),
      ...api,
    };
  }
})();
