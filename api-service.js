// api-service.js
// Frontend service boundary for server/API work.
//
// Phase 16 starts by creating this namespace before migrating app.js call sites.
// Keep these helpers UI-agnostic: accept explicit arguments, call Auth.apiFetch,
// and return mapped data. app.js should continue to own UI state and render calls.

(function (root) {
  const { safeArray } = root.CoreUtils;

  function apiFetch(path, options = {}) {
    if (!root.Auth?.apiFetch) {
      throw new Error("ApiService missing dependency: window.Auth.apiFetch");
    }
    return root.Auth.apiFetch(path, options);
  }

  function hasServerId(id) {
    return Boolean(id) && !String(id).startsWith("submission-") && !String(id).startsWith("pending-review-");
  }

  function normalizeId(value) {
    return value === undefined || value === null ? null : value;
  }

  function mapServerAssignment(record = {}) {
    if (!record || typeof record !== "object") return record;
    return {
      ...record,
      id: normalizeId(record.id),
      classId: record.classId ?? record.class_id ?? null,
      teacherId: record.teacherId ?? record.teacher_id ?? null,
      title: record.title || "Untitled assignment",
      prompt: record.prompt || "",
      brief: record.brief || "",
      focus: record.focus || "",
      status: record.status || "draft",
      assignmentType: record.assignmentType ?? record.assignment_type ?? "response",
      languageLevel: record.languageLevel ?? record.language_level ?? "B1",
      totalPoints: Number(record.totalPoints ?? record.total_points ?? record.rubricSchema?.totalPoints ?? 20),
      wordCountMin: Number(record.wordCountMin ?? record.word_count_min ?? 250),
      wordCountMax: Number(record.wordCountMax ?? record.word_count_max ?? 400),
      ideaRequestLimit: Number(record.ideaRequestLimit ?? record.idea_request_limit ?? 3),
      feedbackRequestLimit: Number(record.feedbackRequestLimit ?? record.feedback_request_limit ?? 2),
      chatTimeLimit: Number(record.chatTimeLimit ?? record.chat_time_limit ?? 0),
      disableChatbot: Boolean(record.disableChatbot ?? record.disable_chatbot ?? false),
      deadline: record.deadline || "",
      studentFocus: record.studentFocus ?? record.student_focus ?? [],
      rubric: record.rubric || [],
      rubricSchema: record.rubricSchema ?? record.rubric_schema ?? null,
      uploadedRubricText: record.uploadedRubricText ?? record.uploaded_rubric_text ?? "",
      uploadedRubricName: record.uploadedRubricName ?? record.uploaded_rubric_name ?? "",
      uploadedRubricData: record.uploadedRubricData ?? record.uploaded_rubric_data ?? null,
      uploadedRubricSchema: record.uploadedRubricSchema ?? record.uploaded_rubric_schema ?? null,
      createdAt: record.createdAt ?? record.created_at ?? null,
      updatedAt: record.updatedAt ?? record.updated_at ?? null,
    };
  }

  function mapServerSubmission(record = {}) {
    if (!record || typeof record !== "object") return record;
    return {
      ...record,
      id: normalizeId(record.id),
      assignmentId: record.assignmentId ?? record.assignment_id ?? null,
      studentId: record.studentId ?? record.student_id ?? record.profile_id ?? null,
      status: record.status || "draft",
      outline: record.outline || {},
      draftText: record.draftText ?? record.draft_text ?? "",
      finalText: record.finalText ?? record.final_text ?? "",
      chatHistory: record.chatHistory ?? record.chat_history ?? [],
      feedbackHistory: record.feedbackHistory ?? record.feedback_history ?? [],
      writingEvents: record.writingEvents ?? record.writing_events ?? [],
      selfAssessment: record.selfAssessment ?? record.self_assessment ?? {},
      teacherReview: record.teacherReview ?? record.teacher_review ?? null,
      submittedAt: record.submittedAt ?? record.submitted_at ?? null,
      gradedAt: record.gradedAt ?? record.graded_at ?? null,
      createdAt: record.createdAt ?? record.created_at ?? null,
      updatedAt: record.updatedAt ?? record.updated_at ?? null,
    };
  }

  function buildSubmissionServerPayload(submission = {}, overrides = {}) {
    return {
      status: submission.status,
      outline: submission.outline || {},
      draft_text: submission.draftText || "",
      final_text: submission.finalText || "",
      chat_history: safeArray(submission.chatHistory),
      feedback_history: safeArray(submission.feedbackHistory),
      writing_events: safeArray(submission.writingEvents),
      self_assessment: submission.selfAssessment || {},
      submitted_at: submission.submittedAt || null,
      graded_at: submission.gradedAt || null,
      ...overrides,
    };
  }

  async function loadClassAssignments(classId) {
    const result = await apiFetch(`/api/classes/${classId}/assignments`);
    return safeArray(result?.assignments).map(mapServerAssignment);
  }

  async function loadAssignmentSubmissions(assignmentId) {
    const result = await apiFetch(`/api/assignments/${assignmentId}/submissions`);
    return safeArray(result?.submissions).map(mapServerSubmission);
  }

  async function loadStudentSubmission(assignmentId, studentId) {
    const result = await apiFetch(`/api/assignments/${assignmentId}/students/${studentId}/submission`);
    return result?.submission ? mapServerSubmission(result.submission) : null;
  }

  async function upsertStudentSubmission(assignmentId, studentId, submission, overrides = {}) {
    const result = await apiFetch(`/api/assignments/${assignmentId}/students/${studentId}/submission`, {
      method: "PUT",
      body: JSON.stringify(buildSubmissionServerPayload(submission, overrides)),
    });
    if (result?.error) throw new Error(result.error);
    if (!result?.submission) throw new Error("Server did not return the saved submission.");
    return mapServerSubmission(result.submission);
  }

  async function patchSubmission(submissionId, payload) {
    const result = await apiFetch(`/api/submissions/${submissionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload || {}),
    });
    if (result?.error) throw new Error(result.error);
    return result?.submission ? mapServerSubmission(result.submission) : result;
  }

  async function saveTeacherReviewSubmission(assignment, submission) {
    if (!assignment?.id || !submission?.studentId) {
      throw new Error("Missing assignment or student for review save.");
    }

    if (hasServerId(submission.id)) {
      return patchSubmission(submission.id, {
        status: submission.status,
        teacher_review: submission.teacherReview,
      });
    }

    return upsertStudentSubmission(assignment.id, submission.studentId, submission, {
      teacher_review: submission.teacherReview,
    });
  }

  const ApiService = {
    apiFetch,
    hasServerId,
    mapServerAssignment,
    mapServerSubmission,
    buildSubmissionServerPayload,
    loadClassAssignments,
    loadAssignmentSubmissions,
    loadStudentSubmission,
    upsertStudentSubmission,
    patchSubmission,
    saveTeacherReviewSubmission,
  };

  root.ApiService = ApiService;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ApiService;
  }
})(typeof window !== "undefined" ? window : globalThis);
