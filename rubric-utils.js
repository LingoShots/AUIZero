(() => {
  function safeArrayFallback(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeArray(value) {
    return typeof window.safeArray === "function" ? window.safeArray(value) : safeArrayFallback(value);
  }

  function slugifyRubricId(text, fallback = "criterion") {
    const cleaned = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return cleaned || fallback;
  }

  function cleanRubricLevelLabel(label = "") {
    return String(label || "").replace(/\s+[–-]\s+\d+(?:\.\d+)?$/, "").trim();
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

  function coalesceSharedRubricCriteria(criteria = [], totalPoints = 0) {
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
          (totalWouldOverflow || criterionLooksLikeSharedPart(next))
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

  function normalizeRubricSchema(schema = {}, fallbackName = "Uploaded rubric") {
    const rawCriteria = safeArray(schema?.criteria)
      .map((criterion, criterionIndex) => {
        const rawLevels = safeArray(criterion?.levels);
        const levels = rawLevels
          .map((level, levelIndex) => ({
            id: level?.id || `${slugifyRubricId(criterion?.id || criterion?.name || `criterion-${criterionIndex + 1}`, `criterion-${criterionIndex + 1}`)}-level-${levelIndex + 1}`,
            label: String(level?.label || "").trim() || `Level ${levelIndex + 1}`,
            score: Number(level?.score ?? level?.points ?? 0),
            description: String(level?.description || "").trim(),
          }))
          .filter((level) => level.label || level.description || Number.isFinite(level.score))
          .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

        if (!levels.length) return null;

        const maxScore = Number(
          criterion?.maxScore ??
          Math.max(...levels.map((level) => Number(level.score || 0)), 0)
        );
        const minScore = Number(
          criterion?.minScore ??
          Math.min(...levels.map((level) => Number(level.score || 0)), maxScore)
        );

        return {
          id: String(criterion?.id || slugifyRubricId(criterion?.name || `criterion-${criterionIndex + 1}`, `criterion-${criterionIndex + 1}`)).trim(),
          name: String(criterion?.name || `Criterion ${criterionIndex + 1}`).trim(),
          minScore,
          maxScore,
          levels,
        };
      })
      .filter(Boolean);

    const requestedTotalPoints = Number(schema?.totalPoints || 0);
    const criteria = schema?.preserveCriteria
      ? rawCriteria
      : coalesceSharedRubricCriteria(rawCriteria, requestedTotalPoints);
    const totalPoints = Number(requestedTotalPoints || criteria.reduce((sum, criterion) => sum + Number(criterion.maxScore || 0), 0));

    return {
      title: String(schema?.title || fallbackName || "Uploaded rubric").trim(),
      subtitle: String(schema?.subtitle || "").trim(),
      totalPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
      notes: safeArray(schema?.notes).map((note) => String(note || "").trim()).filter(Boolean),
      criteria,
      attribution: String(schema?.attribution || "").trim(),
    };
  }

  function rubricSchemaToMatrixData(schema = {}, fallbackName = "Uploaded rubric") {
    const normalized = normalizeRubricSchema(schema, fallbackName);
    if (!normalized.criteria.length) return null;

    return {
      kind: "matrix",
      name: normalized.title || fallbackName || "Uploaded rubric",
      headers: safeArray(normalized.criteria[0]?.levels).map((level) => `${level.label} – ${level.score}`),
      notes: [
        normalized.subtitle,
        ...safeArray(normalized.notes),
        normalized.attribution,
      ].filter(Boolean),
      rows: normalized.criteria.map((criterion) => ({
        id: criterion.id,
        section: "",
        subcriterion: criterion.name,
        name: criterion.name,
        description: "",
        points: Number(criterion.maxScore || 0),
        pointsLabel: criterion.minScore !== criterion.maxScore
          ? `${criterion.minScore} – ${criterion.maxScore} points`
          : `${criterion.maxScore} points`,
        levels: safeArray(criterion.levels).map((level) => ({
          id: level.id,
          label: `${level.label} – ${level.score}`,
          points: Number(level.score || 0),
          description: level.description,
        })),
      })),
    };
  }

  const api = {
    slugifyRubricId,
    cleanRubricLevelLabel,
    rubricScoreSignature,
    criterionLooksLikeSharedPart,
    findMatchingCriterionLevel,
    deriveMergedCriterionName,
    mergeSharedRubricCriterionGroup,
    coalesceSharedRubricCriteria,
    normalizeRubricSchema,
    rubricSchemaToMatrixData,
  };

  window.RubricUtils = Object.assign({}, window.RubricUtils || {}, api);

  Object.entries(api).forEach(([name, fn]) => {
    if (typeof window[name] !== "function") {
      window[name] = fn;
    }
  });
})();
