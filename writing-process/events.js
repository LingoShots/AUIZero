(() => {
  const root = typeof window === "undefined" ? {} : window.PraxisWritingProcess || {};
  const LARGE_PASTE_LIMIT = root.LARGE_PASTE_LIMIT || 220;
  const PHASES = root.PHASES || { DRAFT: "draft", FINAL: "final", COACH_OUTLINE: "coach_outline" };
  let fallbackEventIdCounter = 0;

  function getTextOperation(previousText = "", nextText = "") {
    const previous = String(previousText || "");
    const next = String(nextText || "");
    if (previous === next) return null;

    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) {
      start += 1;
    }

    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
      previousEnd -= 1;
      nextEnd -= 1;
    }

    return {
      start,
      end: previousEnd,
      removedText: previous.slice(start, previousEnd),
      insertedText: next.slice(start, nextEnd),
    };
  }

  function classifyTextOperation(operation, pendingPaste) {
    if (pendingPaste && Date.now() - Number(pendingPaste.timestamp || 0) < 1200) {
      return "paste";
    }
    if (operation?.insertedText && operation?.removedText) return "replace";
    if (operation?.insertedText) return "insert";
    return "delete";
  }

  function isPasteLikeWritingEvent(event = {}) {
    const insertedLength = String(event.insertedText || "").length;
    return event.type === "paste" ||
      event.detectionReason === "large_single_insert_without_paste_event" ||
      Boolean(event.flagged && insertedLength >= LARGE_PASTE_LIMIT);
  }

  function randomIdSegment() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().slice(0, 12);
    if (cryptoApi?.getRandomValues) {
      const bytes = new Uint8Array(6);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
    }
    fallbackEventIdCounter += 1;
    return `${Date.now().toString(36)}-${fallbackEventIdCounter.toString(36)}`;
  }

  function createWritingEvent({
    previousText = "",
    nextText = "",
    pendingPaste = null,
    phase = PHASES.DRAFT,
    field = "",
    idFactory = null,
    timestamp = new Date().toISOString(),
    largePasteLimit = LARGE_PASTE_LIMIT,
  } = {}) {
    const operation = getTextOperation(previousText, nextText);
    if (!operation) return null;

    const type = classifyTextOperation(operation, pendingPaste);
    const pasteContent = pendingPaste?.content || "";
    const insertedText = type === "paste" ? pasteContent : operation.insertedText;
    const insertedLength = String(insertedText || "").length;
    const isLargeSingleInsert = !pasteContent && insertedLength >= largePasteLimit && !operation.removedText;
    const flagged = (type === "paste" && insertedLength >= largePasteLimit) || isLargeSingleInsert;

    return {
      id: idFactory ? idFactory() : `event-${Date.now()}-${randomIdSegment()}`,
      timestamp,
      type,
      phase,
      field,
      start: operation.start,
      end: operation.end,
      removedText: operation.removedText,
      insertedText,
      delta: operation.insertedText.length - operation.removedText.length,
      flagged,
      detectionReason: isLargeSingleInsert ? "large_single_insert_without_paste_event" : "",
      preview: String(insertedText || operation.removedText || nextText).slice(0, 80),
    };
  }

  function normalizeWritingEvent(entry = {}) {
    return {
      id: entry.id || `event-${Date.now()}-${randomIdSegment()}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      type: entry.type || "insert",
      phase: entry.phase || PHASES.DRAFT,
      field: entry.field || "",
      start: typeof entry.start === "number" ? entry.start : null,
      end: typeof entry.end === "number" ? entry.end : null,
      removedText: entry.removedText || "",
      insertedText: entry.insertedText || "",
      delta: Number(entry.delta || 0),
      flagged: Boolean(entry.flagged),
      detectionReason: entry.detectionReason || "",
      preview: entry.preview || "",
    };
  }

  const api = {
    getTextOperation,
    classifyTextOperation,
    createWritingEvent,
    normalizeWritingEvent,
    isPasteLikeWritingEvent,
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
