(function initAdminUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AdminUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildAdminUtils() {
  function getAdminClassDetailSignature(detail) {
    if (!detail) return "";
    try {
      return JSON.stringify({
        members: safeArray(detail.members).map((member) => ({
          id: member?.id,
          name: member?.name,
          isTestAccount: Boolean(member?.is_test_account),
        })),
        assignments: safeArray(detail.assignments).map((assignment) => ({
          id: assignment?.id,
          title: assignment?.title,
          status: assignment?.status,
          updatedAt: assignment?.updated_at || assignment?.updatedAt,
        })),
        submissions: safeArray(detail.submissions).map((submission) => ({
          id: submission?.id,
          assignmentId: submission?.assignment_id,
          studentId: submission?.student_id,
          status: submission?.status,
          updatedAt: submission?.updated_at || submission?.updatedAt,
          reviewStatus: submission?.teacher_review?.status,
          reviewSavedAt: submission?.teacher_review?.savedAt,
        })),
      });
    } catch (_) {
      return "";
    }
  }

  return {
    getAdminClassDetailSignature,
  };
});
