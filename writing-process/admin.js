(() => {
  const types = typeof require === "function" ? require("./types.js") : (typeof window === "undefined" ? {} : window.PraxisWritingProcess);

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getSubmissionReview(submission = {}) {
    return submission.teacher_review || submission.teacherReview || {};
  }

  function isSubmissionExcluded(submission = {}) {
    const review = getSubmissionReview(submission);
    return Boolean(review.writingBehaviourExcluded);
  }

  function summarizeProcessDataPool(detail = {}) {
    const members = safeArray(detail.members);
    const submissions = safeArray(detail.submissions);
    const testStudentIds = new Set(members.filter((member) => member?.is_test_account).map((member) => member.id));
    const summary = {
      students: members.length,
      testAccounts: testStudentIds.size,
      submissions: submissions.length,
      includedSubmissions: 0,
      includedProcessSubmissions: 0,
      excludedSubmissions: 0,
      excludedByTestAccount: 0,
      excludedBySubmissionFlag: 0,
      submissionsWithWritingEvents: 0,
      analysisVersion: types.ANALYSIS_VERSION || "writing-process-v2",
    };

    submissions.forEach((submission) => {
      const studentId = submission.student_id || submission.studentId;
      const byTestAccount = testStudentIds.has(studentId);
      const bySubmissionFlag = isSubmissionExcluded(submission);
      const hasWritingEvents = safeArray(submission.writing_events || submission.writingEvents).length > 0;
      if (hasWritingEvents) {
        summary.submissionsWithWritingEvents += 1;
      }
      if (byTestAccount || bySubmissionFlag) {
        summary.excludedSubmissions += 1;
        if (byTestAccount) summary.excludedByTestAccount += 1;
        if (bySubmissionFlag) summary.excludedBySubmissionFlag += 1;
      } else {
        summary.includedSubmissions += 1;
        if (hasWritingEvents) summary.includedProcessSubmissions += 1;
      }
    });

    return summary;
  }

  function renderAdminDataQualityPanel(detail = {}, escapeHtml = (value) => String(value || "")) {
    const summary = summarizeProcessDataPool(detail);
    return `
      <div class="process-admin-panel">
        <div>
          <p class="mini-label" style="margin:0 0 4px;">Writing process data pool</p>
          <h3 style="margin:0;">${escapeHtml(String(summary.includedProcessSubmissions))} included process submissions</h3>
          <p class="subtle" style="margin:6px 0 0;">Test accounts and teacher-flagged submissions stay visible for review, but are excluded from future cohort/reference data.</p>
        </div>
        <div class="process-admin-grid">
          <span><strong>${escapeHtml(String(summary.includedSubmissions))}</strong> included total</span>
          <span><strong>${escapeHtml(String(summary.submissionsWithWritingEvents))}</strong> with events</span>
          <span><strong>${escapeHtml(String(summary.excludedSubmissions))}</strong> excluded</span>
          <span><strong>${escapeHtml(String(summary.excludedByTestAccount))}</strong> test-account exclusions</span>
          <span><strong>${escapeHtml(String(summary.excludedBySubmissionFlag))}</strong> submission flags</span>
          <span><strong>${escapeHtml(summary.analysisVersion)}</strong> analysis version</span>
        </div>
      </div>
    `;
  }

  const api = {
    summarizeProcessDataPool,
    renderAdminDataQualityPanel,
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
