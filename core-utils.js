// core-utils.js
// Pure primitive helpers shared across all modules.
// Loaded first in index.html so every module can use these as bare globals.
// Exposes window.CoreUtils plus each function directly on window for back-compat.

(function (root) {
  let fallbackUidCounter = 0;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function titleCase(text) {
    return String(text || "").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function uid(prefix) {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
      return `${prefix}-${cryptoApi.randomUUID().slice(0, 8)}`;
    }
    if (cryptoApi?.getRandomValues) {
      const bytes = new Uint8Array(4);
      cryptoApi.getRandomValues(bytes);
      return `${prefix}-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
    }
    fallbackUidCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${fallbackUidCounter.toString(36)}`;
  }

  function isAsciiAlphaNumeric(char) {
    const code = String(char || "").codePointAt(0);
    return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
  }

  function trimHyphens(value) {
    let start = 0;
    let end = value.length;
    while (start < end && value[start] === "-") start += 1;
    while (end > start && value.endsWith("-", end)) end -= 1;
    return value.slice(start, end);
  }

  function slugifyRubricId(text, fallback = "criterion") {
    let slug = "";
    for (const char of String(text || "").toLowerCase()) {
      if (isAsciiAlphaNumeric(char)) {
        slug += char;
      } else if (!slug.endsWith("-")) {
        slug += "-";
      }
    }
    const cleaned = trimHyphens(slug);
    return cleaned || fallback;
  }

  function cleanRubricLevelLabel(label = "") {
    const raw = String(label || "").trim();
    const separators = [" - ", " – "];
    for (const separator of separators) {
      const index = raw.lastIndexOf(separator);
      if (index < 0) continue;
      const suffix = raw.slice(index + separator.length).trim();
      if (suffix && Number.isFinite(Number(suffix))) return raw.slice(0, index).trim();
    }
    return raw;
  }

  const SHARED_RUBRIC_PART_RE = /\b(topic sentence|supporting (?:sentence|sentences|idea|ideas|detail|details)|concluding sentence|transitions?|unity|coherence)\b/i;

  function rubricScoreSignature(criterion = {}) {
    return safeArray(criterion?.levels)
      .map((level) => Number(level?.score ?? level?.points ?? 0))
      .join("|");
  }

  function criterionLooksLikeSharedPart(criterion = {}) {
    const haystack = [
      criterion?.name,
      ...safeArray(criterion?.levels).map((level) => level?.description),
    ].join(" ");
    return SHARED_RUBRIC_PART_RE.test(String(haystack || ""));
  }

  function findMatchingCriterionLevel(criterion = {}, targetLevel = {}, fallbackIndex = 0) {
    const levels = safeArray(criterion?.levels);
    return levels.find((level) => Number(level?.score ?? level?.points ?? 0) === Number(targetLevel?.score ?? targetLevel?.points ?? 0))
      || levels[fallbackIndex]
      || null;
  }

  function deriveMergedCriterionName(group = []) {
    const names = group.map((criterion) => String(criterion?.name || "").trim()).filter(Boolean);
    const joined = names.join(" ").toLowerCase();
    if (
      /topic sentence/.test(joined) &&
      /supporting (sentence|sentences|idea|ideas|detail|details)/.test(joined) &&
      /concluding sentence/.test(joined)
    ) {
      return "Organization, unity and coherence";
    }
    return names.join(" / ") || "Combined criterion";
  }

  function mergeSharedRubricCriterionGroup(group = []) {
    if (!group.length) return null;
    if (group.length === 1) return group[0];

    const template = group[0];
    const name = deriveMergedCriterionName(group);
    return {
      id: slugifyRubricId(name, template.id || "criterion"),
      name,
      minScore: template.minScore,
      maxScore: template.maxScore,
      levels: safeArray(template.levels).map((level, levelIndex) => {
        const description = group
          .map((criterion) => {
            const matchedLevel = findMatchingCriterionLevel(criterion, level, levelIndex);
            const descriptor = String(matchedLevel?.description || "").trim();
            if (!descriptor) return "";
            const partName = String(criterion?.name || "").trim();
            return partName ? `${partName}: ${descriptor}` : descriptor;
          })
          .filter(Boolean)
          .join("\n");

        return {
          ...level,
          description: description || level.description,
        };
      }),
    };
  }

  function coalesceSharedRubricCriteria(criteria = [], totalPoints = 0, { mergeAdjacentSharedParts = false } = {}) {
    const merged = [];
    for (let index = 0; index < criteria.length; index += 1) {
      const current = criteria[index];
      const signature = rubricScoreSignature(current);
      const group = [current];

      while (index + 1 < criteria.length) {
        const next = criteria[index + 1];
        const totalWouldOverflow = totalPoints > 0 && merged
          .concat(group)
          .concat(next)
          .reduce((sum, criterion) => sum + Number(criterion?.maxScore || 0), 0) > totalPoints;
        if (
          signature &&
          signature === rubricScoreSignature(next) &&
          criterionLooksLikeSharedPart(current) &&
          criterionLooksLikeSharedPart(next) &&
          (totalWouldOverflow || mergeAdjacentSharedParts)
        ) {
          group.push(next);
          index += 1;
          continue;
        }
        break;
      }

      merged.push(mergeSharedRubricCriterionGroup(group));
    }
    return merged.filter(Boolean);
  }

  function rubricCriterionLevelToMatrixLevel(level = {}) {
    return {
      id: level.id,
      label: `${level.label} – ${level.score}`,
      points: Number(level.score || 0),
      description: level.description,
    };
  }

  function rubricCriterionToMatrixRow(criterion = {}) {
    const minScore = Number(criterion.minScore || 0);
    const maxScore = Number(criterion.maxScore || 0);
    const name = criterion.name;
    const pointsLabel = minScore !== maxScore ? `${minScore} – ${maxScore} points` : `${maxScore} points`;
    return {
      id: criterion.id,
      name,
      subcriterion: name,
      points: maxScore,
      pointsLabel,
      levels: safeArray(criterion.levels).map(rubricCriterionLevelToMatrixLevel),
      section: "",
      description: "",
    };
  }

  function wordCount(text) {
    return (String(text || "").trim().match(/\b[\w'-]+\b/g) || []).length;
  }

  function trimTo(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  const CoreUtils = {
    escapeHtml,
    escapeAttribute,
    titleCase,
    uid,
    isAsciiAlphaNumeric,
    trimHyphens,
    slugifyRubricId,
    cleanRubricLevelLabel,
    rubricScoreSignature,
    criterionLooksLikeSharedPart,
    findMatchingCriterionLevel,
    deriveMergedCriterionName,
    mergeSharedRubricCriterionGroup,
    coalesceSharedRubricCriteria,
    rubricCriterionLevelToMatrixLevel,
    rubricCriterionToMatrixRow,
    wordCount,
    trimTo,
    clamp,
    clamp01,
    formatDateTime,
    formatTime,
    safeArray,
  };

  root.CoreUtils = CoreUtils;
  Object.assign(root, CoreUtils);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CoreUtils;
  }
})(typeof window !== "undefined" ? window : globalThis);
