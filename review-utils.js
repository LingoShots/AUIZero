(() => {
  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanLevelLabel(label = "") {
    if (typeof window.cleanRubricLevelLabel === "function") {
      return window.cleanRubricLevelLabel(label);
    }
    return String(label || "").replace(/\s+[–-]\s+\d+(?:\.\d+)?$/, "").trim();
  }

  function createScoreBandsForPoints(maxPoints) {
    const ceiling = Math.max(1, Number(maxPoints || 0));
    const labels = ["Excellent", "Good", "Satisfactory", "Developing", "Needs work"];
    const rawPoints = [
      ceiling,
      Math.max(ceiling - 1, 0),
      Math.max(Math.round(ceiling * 0.65), 0),
      Math.max(Math.round(ceiling * 0.4), 0),
      0,
    ];
    const uniquePoints = [...new Set(rawPoints)].sort((a, b) => b - a);

    return uniquePoints.map((points, index) => ({
      id: `band-${ceiling}-${points}-${index}`,
      label: labels[index] || `Band ${index + 1}`,
      points,
      description: `${labels[index] || `Band ${index + 1}`} (${points})`,
    }));
  }

  function getCriterionBands(criterion) {
    const levels = safeArray(criterion?.levels);
    if (levels.length) return levels;
    const bands = safeArray(criterion?.bands);
    if (bands.length) return bands;
    return createScoreBandsForPoints(Number(criterion?.points || 0));
  }

  function buildTeacherReviewRowScore(criterion, band) {
    return {
      criterionId: criterion.id,
      criterionName: criterion.name || "Criterion",
      bandId: band.id || `band-${criterion.id}-${band.points}`,
      label: cleanLevelLabel(band.label || `${band.points}`),
      description: String(band.description || "").trim(),
      points: Number(band.points ?? 0),
      maxPoints: Number(criterion.points || 0),
    };
  }

  function getTeacherReviewRowScoreMap(rowScores) {
    return new Map(
      safeArray(rowScores)
        .filter((entry) => entry?.criterionId)
        .map((entry) => [entry.criterionId, entry])
    );
  }

  function getStudentSelfAssessmentRowScoreMap(submission) {
    return new Map(
      safeArray(submission?.selfAssessment?.rowScores)
        .filter((entry) => entry?.criterionId)
        .map((entry) => [entry.criterionId, entry])
    );
  }

  function getStudentSelfAssessmentCompletion(rubricSchema, submission) {
    const criteria = safeArray(rubricSchema?.criteria).filter((criterion) => criterion?.id);
    const rowScoreMap = getStudentSelfAssessmentRowScoreMap(submission);
    const missingCriteria = criteria.filter((criterion) => !rowScoreMap.has(criterion.id));
    return {
      requiredCount: criteria.length,
      selectedCount: criteria.length - missingCriteria.length,
      missingCriteria,
      isComplete: criteria.length === 0 || missingCriteria.length === 0,
    };
  }

  function findClosestBand(criterion, desiredPoints) {
    const bands = getCriterionBands(criterion);
    if (!bands.length) return null;
    const target = Number(desiredPoints ?? 0);
    return bands.reduce((best, band) => {
      if (!best) return band;
      const bestDistance = Math.abs(Number(best.points ?? 0) - target);
      const bandDistance = Math.abs(Number(band.points ?? 0) - target);
      if (bandDistance < bestDistance) return band;
      if (bandDistance === bestDistance && Number(band.points ?? 0) > Number(best.points ?? 0)) return band;
      return best;
    }, null);
  }

  function calculateTeacherReviewSummary(assignment, submission, rowScores = submission?.teacherReview?.rowScores, options = {}) {
    const fallbackRubric = typeof options.rubricForType === "function"
      ? options.rubricForType(assignment?.assignmentType)
      : [];
    const rubric = safeArray(assignment?.rubric).length ? assignment.rubric : fallbackRubric;
    const rowScoreMap = getTeacherReviewRowScoreMap(rowScores);
    const maxScore = rubric.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0);
    const selectedCount = rubric.filter((criterion) => rowScoreMap.has(criterion.id)).length;
    const totalScore = rubric.reduce((sum, criterion) => {
      const entry = rowScoreMap.get(criterion.id);
      return sum + Number(entry?.points ?? 0);
    }, 0);
    const fallbackScore = selectedCount === 0 && submission?.teacherReview?.finalScore !== ""
      ? Number(submission.teacherReview.finalScore || 0)
      : totalScore;

    return {
      rubric,
      rowScoreMap,
      totalScore: fallbackScore,
      maxScore,
      selectedCount,
      isComplete: rubric.length > 0 && selectedCount === rubric.length,
    };
  }

  function buildCriterionAnalytics(assignment, submissions) {
    const rubric = safeArray(assignment?.rubric);
    if (!rubric.length) return [];

    return rubric.map((criterion) => {
      const bands = getCriterionBands(criterion)
        .slice()
        .sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0));
      const counts = new Map(bands.map((band) => [band.id || `${criterion.id}-${band.points}`, 0]));
      let gradedCount = 0;
      let totalPoints = 0;

      safeArray(submissions).forEach((submission) => {
        const rowMap = getTeacherReviewRowScoreMap(submission?.teacherReview?.rowScores);
        const entry = rowMap.get(criterion.id);
        if (!entry) return;
        gradedCount += 1;
        totalPoints += Number(entry.points ?? 0);
        const matchingBand = bands.find((band) => (band.id || `${criterion.id}-${band.points}`) === entry.bandId)
          || findClosestBand(criterion, entry.points);
        if (matchingBand) {
          const key = matchingBand.id || `${criterion.id}-${matchingBand.points}`;
          counts.set(key, Number(counts.get(key) || 0) + 1);
        }
      });

      const distribution = bands.map((band) => {
        const key = band.id || `${criterion.id}-${band.points}`;
        const count = Number(counts.get(key) || 0);
        return {
          id: key,
          label: cleanLevelLabel(band.label || `${band.points}`),
          points: Number(band.points ?? 0),
          count,
          share: gradedCount ? count / gradedCount : 0,
        };
      });

      return {
        criterionId: criterion.id,
        criterionName: criterion.name || "Criterion",
        gradedCount,
        averageScore: gradedCount ? (totalPoints / gradedCount) : 0,
        maxPoints: Number(criterion.points || 0),
        distribution,
      };
    });
  }

  window.ReviewUtils = {
    createScoreBandsForPoints,
    getCriterionBands,
    buildTeacherReviewRowScore,
    getTeacherReviewRowScoreMap,
    getStudentSelfAssessmentRowScoreMap,
    getStudentSelfAssessmentCompletion,
    findClosestBand,
    calculateTeacherReviewSummary,
    buildCriterionAnalytics,
  };
})();
