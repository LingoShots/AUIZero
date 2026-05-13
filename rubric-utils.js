(() => {
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
      : coalesceSharedRubricCriteria(rawCriteria, requestedTotalPoints, { mergeAdjacentSharedParts: true });
    const criteriaTotalPoints = criteria.reduce((sum, criterion) => sum + Number(criterion.maxScore || 0), 0);
    // The clickable rubric can only score the criteria that actually parsed.
    // If an uploaded rubric declares 20 points but only 3 x 5-point criteria parsed,
    // use 15 for scoring so students are not blocked by stale rubric metadata.
    const totalPoints = Number(criteriaTotalPoints || requestedTotalPoints || 0);
    const totalMismatch = requestedTotalPoints > 0
      && totalPoints > 0
      && Math.abs(requestedTotalPoints - totalPoints) > 0.001;

    return {
      title: String(schema?.title || fallbackName || "Uploaded rubric").trim(),
      subtitle: String(schema?.subtitle || "").trim(),
      totalPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
      declaredTotalPoints: totalMismatch ? requestedTotalPoints : null,
      criteriaTotalPoints: Number.isFinite(criteriaTotalPoints) ? criteriaTotalPoints : 0,
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
      rows: normalized.criteria.map(rubricCriterionToMatrixRow),
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
