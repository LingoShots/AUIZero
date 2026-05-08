(() => {
  const types = typeof require === "function" ? require("./types.js") : (typeof window !== "undefined" ? window.PraxisWritingProcess : {});
  const cohorts = typeof require === "function" ? require("./cohorts.js") : (typeof window !== "undefined" ? window.PraxisWritingProcess : {});
  const eventsApi = typeof require === "function" ? require("./events.js") : (typeof window !== "undefined" ? window.PraxisWritingProcess : {});

  const {
    ANALYSIS_VERSION,
    MIN_WORDS_FOR_STATUS,
    STATUS,
    STATUS_LABELS,
    STATUS_REASONS,
    PHASES,
  } = types;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function wordCount(text = "") {
    const words = String(text || "").trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value || 0)));
  }

  function round(value, places = 1) {
    if (!Number.isFinite(Number(value))) return 0;
    const factor = 10 ** places;
    return Math.round(Number(value) * factor) / factor;
  }

  function getEventTimeMs(event = {}) {
    const parsed = Date.parse(event.timestamp || "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getFinalText(submission = {}) {
    return String(submission.finalText || submission.final_text || submission.draftText || submission.draft_text || "");
  }

  function getDraftText(submission = {}) {
    return String(submission.draftText || submission.draft_text || "");
  }

  function normalizeEvents(submission = {}) {
    return safeArray(submission.writingEvents || submission.writing_events)
      .map((event) => eventsApi.normalizeWritingEvent ? eventsApi.normalizeWritingEvent(event) : event)
      .sort((a, b) => (getEventTimeMs(a) || 0) - (getEventTimeMs(b) || 0));
  }

  function getEssayEvents(submission = {}) {
    return normalizeEvents(submission)
      .filter((event) => event.phase !== PHASES.COACH_OUTLINE);
  }

  function normalizeProcessEvents(submission = {}) {
    return safeArray(submission.processEvents || submission.process_events)
      .map((event) => eventsApi.normalizeWritingEvent ? eventsApi.normalizeWritingEvent(event) : event)
      .sort((a, b) => (getEventTimeMs(a) || 0) - (getEventTimeMs(b) || 0));
  }

  function getInsertedCharacters(events = []) {
    return events.reduce((sum, event) => sum + String(event.insertedText || "").length, 0);
  }

  function getRemovedCharacters(events = []) {
    return events.reduce((sum, event) => sum + String(event.removedText || "").length, 0);
  }

  function getPasteEvents(events = []) {
    return events.filter((event) => eventsApi.isPasteLikeWritingEvent
      ? eventsApi.isPasteLikeWritingEvent(event)
      : event.type === "paste" || event.flagged);
  }

  function normalizeMatchText(text = "") {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function getOutlineText(submission = {}) {
    const outline = submission.outline || {};
    return [
      outline.partOne,
      outline.partTwo,
      outline.partThree,
      outline.topicSentence,
      outline.concludingSentence,
    ].filter(Boolean).join(" ");
  }

  function isOwnOutlinePaste(event = {}, submission = {}) {
    const inserted = normalizeMatchText(event.insertedText || "");
    const outline = normalizeMatchText(getOutlineText(submission));
    if (inserted.length < 20 || outline.length < 20) return false;
    return outline.includes(inserted) || inserted.includes(outline);
  }

  function groupDeletionEvents(events = []) {
    const groups = [];
    let current = null;
    for (const event of events) {
      if (event.type !== "delete" && event.type !== "replace") continue;
      const eventTime = getEventTimeMs(event) || 0;
      const gap = current ? eventTime - current.lastTime : Infinity;
      const sameArea = current && Math.abs(Number(event.start || 0) - Number(current.lastStart || 0)) <= 3;
      if (current && gap < 700 && sameArea) {
        current.totalChars += String(event.removedText || "").length || Math.abs(Number(event.delta || 0));
        current.lastTime = eventTime;
        current.lastStart = event.start;
      } else {
        if (current) groups.push(current);
        current = {
          firstTime: eventTime,
          lastTime: eventTime,
          firstStart: event.start,
          lastStart: event.start,
          totalChars: String(event.removedText || "").length || Math.abs(Number(event.delta || 0)),
        };
      }
    }
    if (current) groups.push(current);
    return groups;
  }

  function calculateRevisionMetrics(events = [], finalWords = 0) {
    const deletionGroups = groupDeletionEvents(events);
    const words = Math.max(1, finalWords);
    const microCorrections = deletionGroups.filter((group) => group.totalChars > 0 && group.totalChars <= 3).length;
    const localRevisions = deletionGroups.filter((group) => group.totalChars >= 4 && group.totalChars <= 50).length;
    const substantiveRevisions = deletionGroups.filter((group) => group.totalChars > 50).length;
    return {
      deletionEvents: deletionGroups.length,
      deletionChars: deletionGroups.reduce((sum, group) => sum + group.totalChars, 0),
      microCorrections,
      microCorrectionsPer100w: round((microCorrections / words) * 100),
      localRevisions,
      localRevisionsPer100w: round((localRevisions / words) * 100),
      substantiveRevisions,
      substantiveRevisionsPer100w: round((substantiveRevisions / words) * 100),
    };
  }

  function calculatePauseMetrics(submission = {}, finalWords = 0) {
    const keystrokes = safeArray(submission.keystrokeLog || submission.keystroke_log);
    const gaps = keystrokes
      .map((entry) => Number(entry.gap || 0))
      .filter((gap) => Number.isFinite(gap) && gap > 0);
    const longPauses = gaps.filter((gap) => gap >= 2000);
    const shortPauses = gaps.filter((gap) => gap >= 200);
    const words = Math.max(1, finalWords);
    return {
      shortPauseCount: shortPauses.length,
      longPauseCount: longPauses.length,
      longPausesPer100w: round((longPauses.length / words) * 100),
      meanLongPauseMs: longPauses.length ? Math.round(longPauses.reduce((sum, gap) => sum + gap, 0) / longPauses.length) : 0,
    };
  }

  function calculateTimeline(events = [], submission = {}, bucketCount = 12) {
    const times = events.map(getEventTimeMs).filter((time) => Number.isFinite(time));
    const fallbackStart = Date.parse(submission.startedAt || submission.started_at || submission.updatedAt || submission.updated_at || "");
    const fallbackEnd = Date.parse(submission.submittedAt || submission.submitted_at || submission.updatedAt || submission.updated_at || "");
    const start = times[0] ?? (Number.isFinite(fallbackStart) ? fallbackStart : Date.now());
    const end = times[times.length - 1] ?? (Number.isFinite(fallbackEnd) ? fallbackEnd : start);
    const duration = Math.max(1, end - start);
    const count = Math.max(1, bucketCount);
    const buckets = Array.from({ length: count }, (_, index) => ({
      index,
      startMs: start + (duration * index / count),
      endMs: start + (duration * (index + 1) / count),
      typedChars: 0,
      removedChars: 0,
      pasteChars: 0,
      eventCount: 0,
      phase: "",
    }));

    events.forEach((event) => {
      const time = getEventTimeMs(event);
      const index = !Number.isFinite(time) ? 0 : Math.min(count - 1, Math.max(0, Math.floor(((time - start) / duration) * count)));
      const bucket = buckets[index];
      const insertedLength = String(event.insertedText || "").length;
      bucket.typedChars += insertedLength;
      bucket.removedChars += String(event.removedText || "").length;
      bucket.eventCount += 1;
      bucket.phase = bucket.phase || event.phase || PHASES.DRAFT;
      if (getPasteEvents([event]).length) bucket.pasteChars += insertedLength;
    });

    const maxTyped = Math.max(1, ...buckets.map((bucket) => bucket.typedChars));
    return buckets.map((bucket) => ({
      ...bucket,
      intensity: round(bucket.typedChars / maxTyped, 2),
      label: `${Math.round((bucket.startMs - start) / 60000)}-${Math.round((bucket.endMs - start) / 60000)} min`,
    }));
  }

  function getCoachMotorBaseline(submission = {}) {
    const outlineEvents = [
      ...normalizeEvents(submission),
      ...normalizeProcessEvents(submission),
    ].filter((event) => event.phase === PHASES.COACH_OUTLINE);
    if (!outlineEvents.length) {
      return {
        available: false,
        typedChars: 0,
        typingRate: null,
        localRevisionsPer100w: null,
      };
    }
    const first = getEventTimeMs(outlineEvents[0]) || 0;
    const last = getEventTimeMs(outlineEvents[outlineEvents.length - 1]) || first;
    const activeMinutes = Math.max(0.25, (last - first) / 60000);
    const typedChars = getInsertedCharacters(outlineEvents);
    const text = outlineEvents.map((event) => event.insertedText || "").join(" ");
    const words = wordCount(text);
    const revisions = calculateRevisionMetrics(outlineEvents, words);
    return {
      available: typedChars >= 80 || words >= 15,
      typedChars,
      wordCount: words,
      typingRate: Math.round(typedChars / activeMinutes),
      localRevisionsPer100w: revisions.localRevisionsPer100w,
    };
  }

  function buildEvidence(metrics = {}, pasteEvents = []) {
    const evidence = [];
    const largestPasteChars = Math.max(0, ...pasteEvents.map((event) => String(event.insertedText || "").length));
    if (largestPasteChars >= 220 || metrics.pasteShare >= 0.3) {
      evidence.push({
        code: "large_paste_or_bulk_insert",
        label: "Large paste or bulk entry",
        severity: metrics.pasteShare >= 0.6 ? 2 : 1,
        detail: `${largestPasteChars} characters inserted in the largest paste-like event.`,
      });
    }
    if (metrics.productProcessRatio >= 0.92 && metrics.localRevisionsPer100w < 1 && metrics.finalWords >= 120) {
      evidence.push({
        code: "linear_low_revision",
        label: "Very little revision",
        severity: 1,
        detail: "Most typed text appears to survive into the final version with few local revisions.",
      });
    }
    if (metrics.meanBurstLength >= 220 && metrics.finalWords >= 120) {
      evidence.push({
        code: "long_fluent_run",
        label: "Long fluent run",
        severity: 1,
        detail: "The process includes a long run of text entry without much interruption.",
      });
    }
    if (metrics.longPausesPer100w < 1 && metrics.finalWords >= 150) {
      evidence.push({
        code: "few_long_pauses",
        label: "Few long pauses",
        severity: 1,
        detail: "There are very few longer thinking pauses for the length of the final text.",
      });
    }
    return evidence;
  }

  function chooseStatus(finalWords, evidence = []) {
    if (finalWords < MIN_WORDS_FOR_STATUS) return STATUS.INSUFFICIENT;
    const severity = evidence.reduce((sum, item) => sum + Number(item.severity || 1), 0);
    if (severity >= 3 || evidence.length >= 3) return STATUS.CLOSE;
    if (severity >= 1) return STATUS.REVIEW;
    return STATUS.TYPICAL;
  }

  function analyzeSubmission(submission = {}, assignment = {}, options = {}) {
    const events = getEssayEvents(submission);
    const processEvents = normalizeProcessEvents(submission);
    const finalText = getFinalText(submission);
    const draftText = getDraftText(submission);
    const finalWords = wordCount(finalText);
    const finalChars = finalText.length;
    const insertedChars = getInsertedCharacters(events);
    const removedChars = getRemovedCharacters(events);
    const pasteEvents = getPasteEvents(events).map((event) => ({
      ...event,
      source: isOwnOutlinePaste(event, submission) ? "own_outline" : "external_or_unknown",
    }));
    const externalPasteEvents = pasteEvents.filter((event) => event.source !== "own_outline");
    const pasteChars = externalPasteEvents.reduce((sum, event) => sum + String(event.insertedText || "").length, 0);
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const firstMs = getEventTimeMs(firstEvent) || Date.parse(submission.startedAt || submission.started_at || submission.updatedAt || submission.updated_at || "") || Date.now();
    const lastMs = getEventTimeMs(lastEvent) || Date.parse(submission.submittedAt || submission.submitted_at || submission.updatedAt || submission.updated_at || "") || firstMs;
    const activeMinutes = Math.max(0.25, (lastMs - firstMs) / 60000);
    const revisionMetrics = calculateRevisionMetrics(events, finalWords);
    const pauseMetrics = calculatePauseMetrics(submission, finalWords);
    const meanBurstLength = pauseMetrics.longPauseCount
      ? Math.round(insertedChars / (pauseMetrics.longPauseCount + 1))
      : insertedChars;
    const typingRate = Math.round(insertedChars / activeMinutes);
    const productProcessRatio = insertedChars ? round(finalChars / insertedChars, 2) : 0;
    const pasteShare = finalChars ? round(Math.min(1, pasteChars / finalChars), 2) : 0;

    const metrics = {
      finalWords,
      finalChars,
      draftWords: wordCount(draftText),
      insertedChars,
      removedChars,
      typingRate,
      activeMinutes: round(activeMinutes),
      productProcessRatio,
      pasteShare,
      pasteEventCount: pasteEvents.length,
      externalPasteEventCount: externalPasteEvents.length,
      meanBurstLength,
      ...revisionMetrics,
      ...pauseMetrics,
    };
    const evidence = buildEvidence(metrics, externalPasteEvents);
    const status = chooseStatus(finalWords, evidence);
    const level = cohorts.normalizeLevel ? cohorts.normalizeLevel(assignment.languageLevel || assignment.language_level || "B1") : "B1";
    const cohort = cohorts.getPreliminaryCohort ? cohorts.getPreliminaryCohort(level) : {};
    const coachBaseline = getCoachMotorBaseline({ ...submission, processEvents });
    const excludedSources = safeArray(options.exclusionSources);
    const excludedFromAnalytics = Boolean(options.excludedFromAnalytics || excludedSources.length);

    return {
      analysisVersion: ANALYSIS_VERSION,
      status,
      statusLabel: STATUS_LABELS[status],
      reason: STATUS_REASONS[status],
      calculatedAt: new Date().toISOString(),
      excludedFromAnalytics,
      exclusionSources: excludedSources,
      metrics,
      evidence,
      timeline: calculateTimeline(events, submission),
      pasteEvidence: pasteEvents.map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        chars: String(event.insertedText || "").length,
        preview: String(event.insertedText || "").replace(/\s+/g, " ").trim().slice(0, 180),
        phase: event.phase || PHASES.DRAFT,
        detectionReason: event.detectionReason || "",
        source: event.source,
      })),
      coachBaseline,
      cohortComparison: {
        level,
        preliminary: true,
        n: cohort.n || 0,
        ranges: {
          typingRate: cohort.typingRate,
          longPauses: cohort.longPauses,
          localRevisions: cohort.localRevisions,
          productProcessRatio: cohort.productProcessRatio,
          pasteShare: cohort.pasteShare,
        },
        positions: {
          typingRate: cohorts.compareToRange ? cohorts.compareToRange(metrics.typingRate, cohort.typingRate) : "unknown",
          longPauses: cohorts.compareToRange ? cohorts.compareToRange(metrics.longPausesPer100w, cohort.longPauses) : "unknown",
          localRevisions: cohorts.compareToRange ? cohorts.compareToRange(metrics.localRevisionsPer100w, cohort.localRevisions) : "unknown",
          productProcessRatio: cohorts.compareToRange ? cohorts.compareToRange(metrics.productProcessRatio, cohort.productProcessRatio) : "unknown",
          pasteShare: cohorts.compareToRange ? cohorts.compareToRange(metrics.pasteShare, cohort.pasteShare) : "unknown",
        },
      },
    };
  }

  const api = {
    analyzeSubmission,
    wordCount,
    calculateRevisionMetrics,
    calculatePauseMetrics,
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
