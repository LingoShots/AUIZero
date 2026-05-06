function getTeacherReviewSavedAt(review) {
  return String(review?.savedAt || review?.saved_at || "").trim();
}

function teacherReviewWasNewlySaved(previousReview, nextReview) {
  const nextSavedAt = getTeacherReviewSavedAt(nextReview);
  if (!nextSavedAt) return false;
  return nextSavedAt !== getTeacherReviewSavedAt(previousReview);
}

function submissionWasReopened(previousSubmission, nextSubmission) {
  const previousStatus = String(previousSubmission?.status || "").toLowerCase();
  const nextStatus = String(nextSubmission?.status || "").toLowerCase();
  return nextStatus === "draft" && previousStatus && previousStatus !== "draft";
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
  teacherReviewWasNewlySaved,
};
