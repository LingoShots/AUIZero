(() => {
  const PRELIMINARY_COHORTS = {
    A0: { n: 12, typingRate: [45, 115], longPauses: [18, 58], localRevisions: [2, 18], productProcessRatio: [0.62, 0.94], pasteShare: [0, 0.18] },
    A1: { n: 18, typingRate: [55, 125], longPauses: [15, 52], localRevisions: [3, 20], productProcessRatio: [0.60, 0.94], pasteShare: [0, 0.18] },
    A2: { n: 31, typingRate: [70, 145], longPauses: [10, 42], localRevisions: [4, 24], productProcessRatio: [0.58, 0.93], pasteShare: [0, 0.16] },
    B1: { n: 47, typingRate: [85, 170], longPauses: [6, 32], localRevisions: [6, 30], productProcessRatio: [0.55, 0.92], pasteShare: [0, 0.14] },
    B2: { n: 29, typingRate: [105, 205], longPauses: [4, 26], localRevisions: [8, 35], productProcessRatio: [0.52, 0.91], pasteShare: [0, 0.12] },
    C1: { n: 16, typingRate: [120, 235], longPauses: [3, 20], localRevisions: [10, 40], productProcessRatio: [0.50, 0.90], pasteShare: [0, 0.10] },
    C2: { n: 10, typingRate: [130, 255], longPauses: [2, 18], localRevisions: [12, 45], productProcessRatio: [0.48, 0.90], pasteShare: [0, 0.10] },
  };

  function normalizeLevel(level = "B1") {
    const normalized = String(level || "B1").trim().toUpperCase();
    return PRELIMINARY_COHORTS[normalized] ? normalized : "B1";
  }

  function getPreliminaryCohort(level = "B1") {
    const key = normalizeLevel(level);
    return {
      level: key,
      preliminary: true,
      source: "L2 literature bootstrap; replace with Praxis cohort data when sample sizes are ready",
      ...PRELIMINARY_COHORTS[key],
    };
  }

  function compareToRange(value, range = []) {
    const [low, high] = range;
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "unknown";
    if (Number(value) < low) return "below";
    if (Number(value) > high) return "above";
    return "within";
  }

  const api = {
    PRELIMINARY_COHORTS,
    normalizeLevel,
    getPreliminaryCohort,
    compareToRange,
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
