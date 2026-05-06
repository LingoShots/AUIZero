function getTeacherReviewSavedAt(review) {
  return String(review?.savedAt || review?.saved_at || "").trim();
}

function teacherReviewWasNewlySaved(previousReview, nextReview) {
  const nextSavedAt = getTeacherReviewSavedAt(nextReview);
  if (!nextSavedAt) return false;
  const previousSavedAt = getTeacherReviewSavedAt(previousReview);
  if (nextSavedAt !== previousSavedAt) return true;

  const previousStatus = String(previousReview?.status || "").toLowerCase();
  const nextStatus = String(nextReview?.status || "").toLowerCase();
  const previousScore = previousReview?.finalScore ?? previousReview?.final_score ?? "";
  const nextScore = nextReview?.finalScore ?? nextReview?.final_score ?? "";
  const previousNotes = String(previousReview?.finalNotes || previousReview?.final_notes || "");
  const nextNotes = String(nextReview?.finalNotes || nextReview?.final_notes || "");
  return nextStatus === "graded" && (
    previousStatus !== "graded" ||
    String(previousScore) !== String(nextScore) ||
    previousNotes !== nextNotes
  );
}

function submissionWasReopened(previousSubmission, nextSubmission) {
  const previousStatus = String(previousSubmission?.status || "").toLowerCase();
  const nextStatus = String(nextSubmission?.status || "").toLowerCase();
  return nextStatus === "draft" && previousStatus && previousStatus !== "draft";
}

function submissionPayloadWithGradedStatus(payload = {}) {
  const nextPayload = { ...(payload || {}) };
  const review = nextPayload.teacher_review || nextPayload.teacherReview || {};
  const reviewStatus = String(review?.status || "").toLowerCase();
  const savedAt = review?.savedAt || review?.saved_at;
  if (reviewStatus === "graded" && savedAt) {
    nextPayload.status = "graded";
  }
  return nextPayload;
}

function appendResetQuery(urlValue = "") {
  const raw = String(urlValue || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.searchParams.set("reset", "1");
    url.hash = "";
    return url.toString();
  } catch (_) {
    const stripped = raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
    return `${stripped}/?reset=1`;
  }
}

module.exports = {
  appendResetQuery,
  getTeacherReviewSavedAt,
  submissionWasReopened,
  submissionPayloadWithGradedStatus,
  teacherReviewWasNewlySaved,
};
