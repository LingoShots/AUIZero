(function () {
  function getAssignments() {
    const { state } = window.AppState;
    return state.assignments;
  }

  function getPublishedAssignments() {
    const { state, currentClassId } = window.AppState;
    return state.assignments.filter((a) => a.status === "published" && (!a.classId || a.classId === currentClassId));
  }

  function getSelectedAssignment() {
    const { state, ui } = window.AppState;
    return state.assignments.find((assignment) => assignment.id === ui.selectedAssignmentId) || null;
  }

  function getStudentAssignment() {
    const { state, ui, currentClassId } = window.AppState;
    return state.assignments.find((assignment) =>
      assignment.id === ui.selectedStudentAssignmentId &&
      assignment.status === "published" &&
      (!assignment.classId || assignment.classId === currentClassId)
    ) || null;
  }

  function getStudentSubmissionForAssignment(assignmentId, studentId) {
    const { state, ui } = window.AppState;
    const resolvedStudentId = studentId === undefined ? ui.activeUserId : studentId;
    if (!assignmentId || !resolvedStudentId) return null;
    return state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === resolvedStudentId) || null;
  }

  function getStudentAssignmentBuckets() {
    const publishedAssignments = getPublishedAssignments();
    const current = [];
    const submitted = [];
    publishedAssignments.forEach((assignment) => {
      const submission = getStudentSubmissionForAssignment(assignment.id);
      const status = submission?.status || "draft";
      const hasSubmitted = status !== "draft" && (SubmissionUtils.isSubmissionSubmitted(submission) || ["late", "missing"].includes(status));
      const bucketItem = {
        assignment,
        submission,
        status,
        isGraded: SubmissionUtils.isSubmissionGraded(submission),
      };
      if (hasSubmitted) {
        submitted.push(bucketItem);
      } else {
        current.push(bucketItem);
      }
    });

    return { current, submitted };
  }

  function getAssignmentSubmissions(assignmentId) {
    const { state } = window.AppState;
    return state.submissions.filter((submission) => submission.assignmentId === assignmentId);
  }

  function getSubmissionCountsForAssignment(assignmentId, roster) {
    const { currentClassMembers } = window.AppState;
    const resolvedRoster = roster === undefined ? currentClassMembers : roster;
    return SubmissionUtils.getAssignmentSubmissionCounts(getAssignmentSubmissions(assignmentId), resolvedRoster);
  }

  function getReviewRoster(assignmentId) {
    const { ui, currentClassMembers, currentProfile } = window.AppState;
    const { getUserById } = window;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedAssignmentId : assignmentId;
    if (currentClassMembers.length) {
      return currentClassMembers
        .filter((member) => member?.id !== currentProfile?.id)
        .map((member) => ({
          id: member.id,
          name: member.name || "Student",
        }));
    }

    const seen = new Set();
    return getAssignmentSubmissions(resolvedAssignmentId)
      .filter((submission) => {
        if (seen.has(submission.studentId)) return false;
        seen.add(submission.studentId);
        return true;
      })
      .map((submission) => ({
        id: submission.studentId,
        name: submission._studentName || getUserById(submission.studentId)?.name || "Student",
      }));
  }

  function getReviewSubmissionForStudent(studentId, assignmentId) {
    const { state, ui } = window.AppState;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedAssignmentId : assignmentId;
    return state.submissions.find((submission) => submission.assignmentId === resolvedAssignmentId && submission.studentId === studentId) || null;
  }

  function ensureTeacherReviewSubmission(assignmentId, studentId) {
    const { state, currentClassMembers } = window.AppState;
    const { createEmptySubmission, getUserById } = window;
    if (!assignmentId || !studentId) return null;
    const existing = getReviewSubmissionForStudent(studentId, assignmentId);
    if (existing) return existing;

    const placeholder = createEmptySubmission(assignmentId, studentId);
    placeholder.id = `pending-review-${assignmentId}-${studentId}`;
    placeholder.status = "not_started";
    placeholder.startedAt = null;
    placeholder.updatedAt = new Date().toISOString();
    placeholder._studentName = currentClassMembers.find((member) => member.id === studentId)?.name || getUserById(studentId)?.name || "Student";
    state.submissions.push(placeholder);
    return placeholder;
  }

  function getSelectedReviewStudent() {
    const { ui } = window.AppState;
    return getReviewRoster().find((student) => student.id === ui.selectedReviewStudentId) || null;
  }

  function getSelectedReviewSubmission() {
    const { state, ui } = window.AppState;
    if (ui.selectedReviewStudentId) {
      return ensureTeacherReviewSubmission(ui.selectedAssignmentId, ui.selectedReviewStudentId);
    }
    const selected = state.submissions.find((submission) => submission.id === ui.selectedReviewSubmissionId) || null;
    if (selected) {
      ui.selectedReviewStudentId = selected.studentId;
    }
    return selected;
  }

  function getStudentSubmission() {
    const { state, ui } = window.AppState;
    if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
      return null;
    }

    return state.submissions.find((submission) => submission.assignmentId === ui.selectedStudentAssignmentId && submission.studentId === ui.activeUserId) || null;
  }

  function rememberStudentStep(step, assignmentId) {
    const { ui } = window.AppState;
    const { clamp } = window;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedStudentAssignmentId : assignmentId;
    const previousStep = ui.studentStep;
    const nextStep = clamp(Number(step || 1), 1, 4);
    ui.studentStep = nextStep;
    if (!resolvedAssignmentId) return previousStep !== nextStep;
    ui.studentStepOverrides = ui.studentStepOverrides || {};
    const previousOverride = ui.studentStepOverrides[resolvedAssignmentId];
    ui.studentStepOverrides[resolvedAssignmentId] = nextStep;
    return previousStep !== nextStep || previousOverride !== nextStep;
  }

  function getRememberedStudentStep(assignmentId) {
    const { ui } = window.AppState;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedStudentAssignmentId : assignmentId;
    if (!resolvedAssignmentId) return null;
    const remembered = Number(ui.studentStepOverrides?.[resolvedAssignmentId] || 0);
    return remembered >= 1 && remembered <= 4 ? remembered : null;
  }

  function getStudentStepForSubmission(submission) {
    const { safeArray } = window;
    if (isStudentSubmissionLocked(submission)) return 4;
    const hasFinalWork = Boolean(
      submission?.finalText?.trim() ||
      submission?.reflections?.improved?.trim() ||
      safeArray(submission?.selfAssessment?.rowScores).length
    );
    if (hasFinalWork) return 3;
    const hasDraftWork = Boolean(
      submission?.draftText?.trim() ||
      safeArray(submission?.writingEvents).length ||
      safeArray(submission?.feedbackHistory).length
    );
    if (hasDraftWork) return 2;
    return 1;
  }

  function isStudentSubmissionLocked(submission) {
    const status = String(submission?.status || "").trim().toLowerCase();
    const isEditableStatus = status === "draft" || status === "returned" || status === "reopened";
    const isSubmittedStatus = status === "submitted";
    const hasSavedTeacherReview = Boolean(submission?.teacherReview?.savedAt);
    return !isEditableStatus && (isSubmittedStatus || hasSavedTeacherReview);
  }

  function reconcileStudentStepAfterSubmissionRefresh(submission) {
    const { ui } = window.AppState;
    if (!submission?.assignmentId || submission.studentId !== ui.activeUserId) return;
    if (isStudentSubmissionLocked(submission)) return;
    const status = String(submission.status || "").trim().toLowerCase();
    if (!["draft", "returned", "reopened"].includes(status)) return;
    const rememberedStep = getRememberedStudentStep(submission.assignmentId);
    if (rememberedStep === 4) {
      ui.studentStepOverrides = ui.studentStepOverrides || {};
      ui.studentStepOverrides[submission.assignmentId] = getStudentStepForSubmission(submission);
    }
    if (ui.selectedStudentAssignmentId === submission.assignmentId && ui.studentStep === 4) {
      ui.studentStep = getStudentStepForSubmission(submission);
    }
  }

  function ensureStudentSubmission() {
    const { state, ui } = window.AppState;
    const { createEmptySubmission, persistState } = window;
    const existing = getStudentSubmission();
    if (existing) {
      return existing;
    }

    if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
      return null;
    }

    const submission = createEmptySubmission(ui.selectedStudentAssignmentId, ui.activeUserId);
    state.submissions.push(submission);
    persistState();
    return submission;
  }

  function hydrateSelections() {
    const { state, ui } = window.AppState;
    const { clamp, getSavedStudentAssignmentId, saveStudentAssignmentId } = window;
    if (!state.assignments.some((assignment) => assignment.id === ui.selectedAssignmentId)) {
      ui.selectedAssignmentId = state.assignments[0]?.id || null;
    }

    const published = getPublishedAssignments();
    if (!published.some((assignment) => assignment.id === ui.selectedStudentAssignmentId)) {
      const buckets = getStudentAssignmentBuckets();
      const savedAssignmentId = getSavedStudentAssignmentId();
      const preferredCurrentId = buckets.current[0]?.assignment?.id || null;
      const preferredSubmittedId = buckets.submitted[0]?.assignment?.id || null;
      const nextAssignmentId = published.some((assignment) => assignment.id === savedAssignmentId)
        ? savedAssignmentId
        : (preferredCurrentId || preferredSubmittedId || published[0]?.id || null);
      ui.selectedStudentAssignmentId = nextAssignmentId;
    }

    if (ui.selectedStudentAssignmentId) {
      saveStudentAssignmentId(ui.selectedStudentAssignmentId);
    }

    ui.studentStep = clamp(ui.studentStep, 1, 4);
    const studentSubmission = ensureStudentSubmission();
    if (studentSubmission) {
      const rememberedStep = getRememberedStudentStep(ui.selectedStudentAssignmentId);
      const derivedStep = getStudentStepForSubmission(studentSubmission);
      ui.studentStep = isStudentSubmissionLocked(studentSubmission) ? derivedStep : (rememberedStep || derivedStep);
    }

    const reviewRoster = getReviewRoster(ui.selectedAssignmentId);
    if (!reviewRoster.some((student) => student.id === ui.selectedReviewStudentId)) {
      ui.selectedReviewStudentId = reviewRoster[0]?.id || null;
    }

    ui.selectedReviewSubmissionId = ui.selectedReviewStudentId
      ? getReviewSubmissionForStudent(ui.selectedReviewStudentId, ui.selectedAssignmentId)?.id || null
      : null;
  }

  function getSubmissionStatusDisplay(status) {
    const { titleCase } = window;
    const labels = {
      not_started: "Not started",
      draft: "In progress",
      submitted: "Submitted",
      late: "Late",
      missing: "Missing",
      graded: "Graded",
    };
    return labels[status] || titleCase(String(status || "").replaceAll("_", " "));
  }

  function canMarkLateOrMissing(assignment) {
    if (!assignment?.deadline) return false;
    return Date.now() > Date.parse(assignment.deadline);
  }

  function getNextReviewStudentId(currentStudentId, assignmentId) {
    const { ui } = window.AppState;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedAssignmentId : assignmentId;
    const roster = getReviewRoster(resolvedAssignmentId);
    const index = roster.findIndex((student) => student.id === currentStudentId);
    if (index === -1 || index === roster.length - 1) return null;
    return roster[index + 1]?.id || null;
  }

  function getPreviousReviewStudentId(currentStudentId, assignmentId) {
    const { ui } = window.AppState;
    const resolvedAssignmentId = assignmentId === undefined ? ui.selectedAssignmentId : assignmentId;
    const roster = getReviewRoster(resolvedAssignmentId);
    const index = roster.findIndex((student) => student.id === currentStudentId);
    if (index <= 0) return null;
    return roster[index - 1]?.id || null;
  }

  const StateSelectors = {
    getAssignments,
    getPublishedAssignments,
    getSelectedAssignment,
    getStudentAssignment,
    getStudentSubmissionForAssignment,
    getStudentAssignmentBuckets,
    getAssignmentSubmissions,
    getSubmissionCountsForAssignment,
    getReviewRoster,
    getReviewSubmissionForStudent,
    ensureTeacherReviewSubmission,
    getSelectedReviewStudent,
    getSelectedReviewSubmission,
    getStudentSubmission,
    rememberStudentStep,
    getRememberedStudentStep,
    getStudentStepForSubmission,
    isStudentSubmissionLocked,
    reconcileStudentStepAfterSubmissionRefresh,
    ensureStudentSubmission,
    hydrateSelections,
    getSubmissionStatusDisplay,
    canMarkLateOrMissing,
    getNextReviewStudentId,
    getPreviousReviewStudentId,
  };

  if (typeof window !== "undefined") {
    window.StateSelectors = StateSelectors;
    Object.assign(window, StateSelectors);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = StateSelectors;
  }
})();
