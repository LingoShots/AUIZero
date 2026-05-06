const TEACHER_SUBMISSION_ALLOWED_FIELDS = new Set([
  'idea_responses',
  'draft_text',
  'final_text',
  'reflections',
  'outline',
  'chat_history',
  'writing_events',
  'feedback_history',
  'focus_annotations',
  'teacher_review',
  'self_assessment',
  'status',
  'chat_started_at',
  'chat_skipped_at',
  'chat_expired_at',
  'chat_elapsed_ms',
  'started_at',
  'submitted_at',
  'keystroke_log',
  'fluency_summary',
  'final_unlocked',
]);

const STUDENT_SUBMISSION_ALLOWED_FIELDS = new Set([
  'idea_responses',
  'draft_text',
  'final_text',
  'reflections',
  'outline',
  'chat_history',
  'writing_events',
  'feedback_history',
  'focus_annotations',
  'self_assessment',
  'chat_started_at',
  'chat_skipped_at',
  'chat_expired_at',
  'chat_elapsed_ms',
  'started_at',
  'keystroke_log',
  'fluency_summary',
  'final_unlocked',
]);

function sanitizePayload(payload = {}, allowedFields = new Set()) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key, value]) => allowedFields.has(key) && value !== undefined)
  );
}

function sanitizeTeacherSubmissionPayload(payload = {}) {
  return sanitizePayload(payload, TEACHER_SUBMISSION_ALLOWED_FIELDS);
}

function sanitizeStudentSubmissionPayload(payload = {}) {
  return sanitizePayload(payload, STUDENT_SUBMISSION_ALLOWED_FIELDS);
}

module.exports = {
  sanitizeStudentSubmissionPayload,
  sanitizeTeacherSubmissionPayload,
  STUDENT_SUBMISSION_ALLOWED_FIELDS,
  TEACHER_SUBMISSION_ALLOWED_FIELDS,
};
