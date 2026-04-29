(function initSubmissionUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SubmissionUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildSubmissionUtils() {
  const SUBMITTED_STATUSES = new Set(["submitted", "graded"]);
  const CLOSED_STATUSES = new Set(["graded", "late", "missing"]);

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeSubmission(submission) {
    return submission && typeof submission === "object" ? submission : {};
  }

  function getTeacherReview(submission = {}) {
    const source = safeSubmission(submission);
    return source.teacherReview || source.teacher_review || {};
  }

  function getSubmissionStatus(submission = {}) {
    const source = safeSubmission(submission);
    const review = getTeacherReview(submission);
    return String(source.status || review.status || "").trim().toLowerCase();
  }

  function getSubmittedAt(submission = {}) {
    const source = safeSubmission(submission);
    return source.submittedAt || source.submitted_at || null;
  }

  function hasSubmissionContent(submission = {}) {
    const source = safeSubmission(submission);
    return Boolean(
      String(source.finalText || source.final_text || "").trim() ||
      String(source.draftText || source.draft_text || "").trim() ||
      safeArray(source.writingEvents || source.writing_events).length ||
      safeArray(source.keystrokeLog || source.keystroke_log).length
    );
  }

  function hasSavedTeacherReview(submission = {}) {
    const review = getTeacherReview(submission);
    return Boolean(
      review.savedAt ||
      review.saved_at ||
      (review.finalScore !== undefined && review.finalScore !== null && review.finalScore !== "") ||
      (review.final_score !== undefined && review.final_score !== null && review.final_score !== "") ||
      String(review.finalNotes || review.final_notes || "").trim() ||
      safeArray(review.rowScores || review.row_scores).length ||
      safeArray(review.annotations).length
    );
  }

  function isSubmissionSubmitted(submission = {}) {
    const status = getSubmissionStatus(submission);
    if (status === "missing") return false;
    if (SUBMITTED_STATUSES.has(status)) return true;
    if (status === "late") return Boolean(getSubmittedAt(submission) || hasSubmissionContent(submission));
    return Boolean(getSubmittedAt(submission));
  }

  function isSubmissionGraded(submission = {}) {
    const status = getSubmissionStatus(submission);
    const reviewStatus = String(getTeacherReview(submission).status || "").trim().toLowerCase();
    return status === "graded" || reviewStatus === "graded" || hasSavedTeacherReview(submission);
  }

  function getSubmissionStudentId(submission = {}) {
    const source = safeSubmission(submission);
    return source.studentId || source.student_id || "";
  }

  function getSubmissionUpdatedAt(submission = {}) {
    const source = safeSubmission(submission);
    return source.updatedAt || source.updated_at || source.submittedAt || source.submitted_at || "";
  }

  function getSubmissionAssignmentId(submission = {}) {
    const source = safeSubmission(submission);
    return source.assignmentId || source.assignment_id || "";
  }

  function getSubmissionRank(submission = {}) {
    return [
      isSubmissionGraded(submission) ? 32 : 0,
      isSubmissionSubmitted(submission) ? 16 : 0,
      getSubmittedAt(submission) ? 8 : 0,
      hasSubmissionContent(submission) ? 4 : 0,
      CLOSED_STATUSES.has(getSubmissionStatus(submission)) ? 2 : 0,
      Date.parse(getSubmissionUpdatedAt(submission) || 0) || 0,
    ];
  }

  function choosePreferredSubmission(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;
    const currentRank = getSubmissionRank(current);
    const candidateRank = getSubmissionRank(candidate);
    for (let index = 0; index < candidateRank.length; index += 1) {
      if (candidateRank[index] > currentRank[index]) return candidate;
      if (candidateRank[index] < currentRank[index]) return current;
    }
    return candidate;
  }

  function dedupeSubmissionsByStudent(submissions = []) {
    const byStudent = new Map();
    safeArray(submissions).forEach((submission) => {
      const studentId = getSubmissionStudentId(submission);
      if (!studentId) return;
      byStudent.set(studentId, choosePreferredSubmission(byStudent.get(studentId), submission));
    });
    return byStudent;
  }

  function getAssignmentSubmissionCounts(submissions = [], roster = []) {
    const byStudent = dedupeSubmissionsByStudent(submissions);
    const rosterIds = safeArray(roster).map((member) => member?.id).filter(Boolean);
    const studentIds = rosterIds.length ? rosterIds : Array.from(byStudent.keys());
    let submitted = 0;
    let graded = 0;
    let missing = 0;
    let late = 0;

    studentIds.forEach((studentId) => {
      const submission = byStudent.get(studentId);
      if (!submission) return;
      const status = getSubmissionStatus(submission);
      if (isSubmissionSubmitted(submission)) submitted += 1;
      if (isSubmissionGraded(submission)) graded += 1;
      if (status === "missing") missing += 1;
      if (status === "late") late += 1;
    });

    return {
      total: studentIds.length,
      submitted,
      graded,
      missing,
      late,
      notSubmitted: Math.max(0, studentIds.length - submitted),
    };
  }

  return {
    getAssignmentSubmissionCounts,
    getSubmissionAssignmentId,
    getSubmissionStatus,
    getSubmissionStudentId,
    hasSavedTeacherReview,
    hasSubmissionContent,
    isSubmissionGraded,
    isSubmissionSubmitted,
    dedupeSubmissionsByStudent,
  };
});
