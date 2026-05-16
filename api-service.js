// api-service.js
// Frontend service boundary for server/API work.
//
// Phase 16 starts by creating this namespace before migrating app.js call sites.
// Keep these helpers UI-agnostic: accept explicit arguments, call Auth.apiFetch,
// and return mapped data. app.js should continue to own UI state and render calls.

(function (root) {
  const { safeArray } = root.CoreUtils;

  function apiFetch(path, options = {}) {
  const authClient = root.Auth || (typeof Auth === "undefined" ? null : Auth);
  if (authClient?.apiFetch) {
    return authClient.apiFetch(path, options);
  }
  throw new Error("ApiService missing dependency: Auth.apiFetch");
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
      ideaResponses: safeArray(record.ideaResponses ?? record.idea_responses),
      status: record.status || "draft",
      outline: record.outline || {},
      draftText: record.draftText ?? record.draft_text ?? "",
      finalText: record.finalText ?? record.final_text ?? "",
      finalUnlocked: Boolean(record.finalUnlocked ?? record.final_unlocked ?? false),
      reflections: record.reflections || { improved: "" },
      chatHistory: safeArray(record.chatHistory ?? record.chat_history),
      feedbackHistory: safeArray(record.feedbackHistory ?? record.feedback_history),
      writingEvents: safeArray(record.writingEvents ?? record.writing_events),
      focusAnnotations: safeArray(record.focusAnnotations ?? record.focus_annotations),
      selfAssessment: record.selfAssessment ?? record.self_assessment ?? {},
      teacherReview: record.teacherReview ?? record.teacher_review ?? null,
      chatStartedAt: record.chatStartedAt ?? record.chat_started_at ?? null,
      chatSkippedAt: record.chatSkippedAt ?? record.chat_skipped_at ?? null,
      chatExpiredAt: record.chatExpiredAt ?? record.chat_expired_at ?? null,
      chatElapsedMs: Number(record.chatElapsedMs ?? record.chat_elapsed_ms ?? 0),
      startedAt: record.startedAt ?? record.started_at ?? null,
      submittedAt: record.submittedAt ?? record.submitted_at ?? null,
      gradedAt: record.gradedAt ?? record.graded_at ?? null,
      _studentName: record._studentName ?? record.profiles?.name ?? "",
      keystrokeLog: safeArray(record.keystrokeLog ?? record.keystroke_log),
      fluencySummary: record.fluencySummary ?? record.fluency_summary ?? {},
      createdAt: record.createdAt ?? record.created_at ?? null,
      updatedAt: record.updatedAt ?? record.updated_at ?? null,
    };
  }

  function buildSubmissionServerPayload(submission = {}, overrides = {}) {
    return {
      idea_responses: safeArray(submission.ideaResponses),
      status: submission.status || "draft",
      outline: submission.outline || {},
      draft_text: submission.draftText || "",
      final_text: submission.finalText || "",
      final_unlocked: Boolean(submission.finalUnlocked),
      reflections: submission.reflections || { improved: "" },
      chat_history: safeArray(submission.chatHistory),
      feedback_history: safeArray(submission.feedbackHistory),
      writing_events: safeArray(submission.writingEvents),
      focus_annotations: safeArray(submission.focusAnnotations),
      self_assessment: submission.selfAssessment || {},
      chat_started_at: submission.chatStartedAt || null,
      chat_skipped_at: submission.chatSkippedAt || null,
      chat_expired_at: submission.chatExpiredAt || null,
      chat_elapsed_ms: Math.max(0, Math.round(Number(submission.chatElapsedMs || 0))),
      started_at: submission.startedAt || null,
      submitted_at: submission.submittedAt || null,
      graded_at: submission.gradedAt || null,
      keystroke_log: safeArray(submission.keystrokeLog),
      fluency_summary: submission.fluencySummary || {},
      ...overrides,
    };
  }
function buildAssignmentServerPayload(assignment = {}, overrides = {}) {
  return {
    title: assignment.title,
    prompt: assignment.prompt,
    focus: assignment.focus,
    brief: assignment.brief,
    assignment_type: assignment.assignmentType,
    language_level: assignment.languageLevel,
    word_count_min: assignment.wordCountMin,
    word_count_max: assignment.wordCountMax,
    feedback_request_limit: assignment.feedbackRequestLimit,
    student_focus: assignment.studentFocus,
    rubric: assignment.rubricSchema || assignment.rubric,
    deadline: assignment.deadline || null,
    chat_time_limit: assignment.chatTimeLimit,
    uploaded_rubric_text: assignment.uploadedRubricText,
    status: assignment.status || "draft",
    ...overrides,
  };
}

async function saveAssignment(classId, assignment = {}, editingAssignmentId = null) {
  if (!classId) {
    throw new Error("Missing class for assignment save.");
  }

  const payload = buildAssignmentServerPayload(assignment);
  const result = editingAssignmentId
    ? await apiFetch(`/api/assignments/${editingAssignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
    : await apiFetch(`/api/classes/${classId}/assignments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

  if (result?.error) throw new Error(result.error);
  if (!result?.assignment) throw new Error("Server did not return the saved assignment.");
  return mapServerAssignment(result.assignment);
}

async function patchAssignment(assignmentId, payload = {}) {
  if (!assignmentId) {
    throw new Error("Missing assignment for update.");
  }

  const result = await apiFetch(`/api/assignments/${assignmentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  if (result?.error) throw new Error(result.error);
  return result?.assignment ? mapServerAssignment(result.assignment) : result;
}

async function setAssignmentStatus(assignmentId, status) {
  return patchAssignment(assignmentId, { status });
}

async function deleteAssignment(assignmentId) {
  if (!assignmentId) {
    throw new Error("Missing assignment for delete.");
  }

  const result = await apiFetch(`/api/assignments/${assignmentId}`, {
    method: "DELETE",
  });

  if (result?.error) throw new Error(result.error);
  return result;
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

  async function loadMySubmission(assignmentId) {
    const result = await apiFetch(`/api/assignments/${assignmentId}/my-submission`);
    if (result?.error) throw new Error(result.error);
    return result?.submission ? mapServerSubmission(result.submission) : null;
  }

  async function loadStudentSubmissions(assignmentIds = []) {
    const ids = safeArray(assignmentIds).filter(Boolean);
    if (!ids.length) return [];
    const params = new URLSearchParams({ assignmentIds: ids.join(",") });
    const result = await apiFetch(`/api/student/submissions?${params.toString()}`);
    if (result?.error) throw new Error(result.error);
    return safeArray(result?.submissions).map(mapServerSubmission);
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

  async function syncStudentSubmission(submission) {
    if (!submission?.assignmentId) {
      throw new Error("Missing assignment for submission sync.");
    }

    let serverId = hasServerId(submission.id) ? submission.id : null;
    if (!serverId) {
      const existing = await loadMySubmission(submission.assignmentId);
      serverId = existing?.id || null;
      if (!serverId) {
        throw new Error("Submission record was not created on the server.");
      }
    }

    const payload = buildSubmissionServerPayload(submission);
    try {
      return await patchSubmission(serverId, payload);
    } catch (error) {
      if (!hasServerId(submission.id)) {
        throw error;
      }

      const existing = await loadMySubmission(submission.assignmentId);
      if (!existing?.id) {
        throw error;
      }
      return patchSubmission(existing.id, payload);
    }
  }

  async function submitStudentSubmission(assignmentId, submission, overrides = {}) {
    const result = await apiFetch(`/api/assignments/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify(buildSubmissionServerPayload(submission, overrides)),
    });
    if (result?.error) throw new Error(result.error);
    if (!result?.submission) throw new Error("Server did not return the submitted work.");
    return mapServerSubmission(result.submission);
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
    loadMySubmission,
    loadStudentSubmissions,
    upsertStudentSubmission,
    patchSubmission,
    syncStudentSubmission,
    submitStudentSubmission,
    saveTeacherReviewSubmission,
    buildAssignmentServerPayload,
    saveAssignment,
    patchAssignment,
    setAssignmentStatus,
    deleteAssignment,
  };

  root.ApiService = ApiService;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ApiService;
  }
})(typeof window === "undefined" ? globalThis : window);
