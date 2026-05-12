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
  } else if (
    nextPayload.status === "graded" &&
    ["", "draft", "ungraded", "returned", "reopened"].includes(reviewStatus) &&
    !savedAt
  ) {
    nextPayload.status = "draft";
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
    let stripped = raw;
    const queryIndex = stripped.indexOf("?");
    const hashIndex = stripped.indexOf("#");
    const cutIndex = [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (cutIndex >= 0) stripped = stripped.slice(0, cutIndex);
    while (stripped.endsWith("/")) stripped = stripped.slice(0, -1);
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
