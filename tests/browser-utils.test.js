const test = require("node:test");
const assert = require("node:assert/strict");

const deadlineUtils = require("../deadline-utils.js");
const storageUtils = require("../storage-utils.js");
const aiAssistUtils = require("../ai-assist-utils.js");
const lineNumberUtils = require("../line-number-utils.js");
const submissionUtils = require("../submission-utils.js");
const submissionRegressionFixture = require("./fixtures/submission-regression-fixture.js");

global.window = global.window || {};
require("../rubric-utils.js");
require("../review-utils.js");

const rubricUtils = global.window.RubricUtils;
const reviewUtils = global.window.ReviewUtils;

function createMemoryStorage({ failFirstWrite = false } = {}) {
  const store = new Map();
  let writes = 0;
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      writes += 1;
      if (failFirstWrite && writes === 1) {
        const error = new Error("Quota full");
        error.name = "QuotaExceededError";
        throw error;
      }
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("deadline utils split and combine deadline parts", () => {
  assert.equal(deadlineUtils.getDeadlineDatePart("2026-04-23T09:30:00"), "2026-04-23");
  assert.equal(deadlineUtils.getDeadlineTimePart("2026-04-23T09:30:00"), "09:30");
  assert.equal(deadlineUtils.combineDeadlineParts("2026-04-23", "09:30"), "2026-04-23T09:30:00");
  assert.match(deadlineUtils.buildDeadlineTimeOptions("09:00"), /option value="09:00" selected/);
});

test("AI assist utils parse fenced JSON responses", () => {
  const parsed = aiAssistUtils.parseJsonResponse("```json\n[\"one\", \"two\"]\n```", []);
  assert.deepEqual(parsed, ["one", "two"]);
});

test("AI action buttons are disabled while requests are pending", () => {
  assert.deepEqual(aiAssistUtils.getTeacherGenerateButtonState({ loading: true }), {
    disabled: true,
    label: "Generating…",
  });
  assert.deepEqual(aiAssistUtils.getTeacherGenerateButtonState({ loading: false }), {
    disabled: false,
    label: "Create student-ready version →",
  });

  assert.deepEqual(aiAssistUtils.getStudentFeedbackButtonState({
    loading: true,
    feedbackUsed: 0,
    feedbackLimit: 2,
  }), {
    disabled: true,
    label: "Checking…",
  });
  assert.deepEqual(aiAssistUtils.getStudentFeedbackButtonState({
    loading: false,
    feedbackUsed: 2,
    feedbackLimit: 2,
  }), {
    disabled: true,
    label: "Get AI feedback (2/2)",
  });
  assert.deepEqual(aiAssistUtils.getStudentFeedbackButtonState({
    loading: false,
    feedbackUsed: 1,
    feedbackLimit: 2,
  }), {
    disabled: false,
    label: "Get AI feedback (1/2)",
  });
});

test("rubric mismatch regression uses parsed criteria total instead of stale declared total", () => {
  const parsedRubric = rubricUtils.normalizeRubricSchema({
    title: "Pilot mismatch rubric",
    totalPoints: 20,
    preserveCriteria: true,
    criteria: [
      {
        id: "ideas",
        name: "Ideas",
        maxScore: 5,
        levels: [{ id: "ideas-excellent", label: "Excellent", score: 5, description: "Clear ideas" }],
      },
      {
        id: "organization",
        name: "Organization",
        maxScore: 5,
        levels: [{ id: "organization-excellent", label: "Excellent", score: 5, description: "Logical order" }],
      },
      {
        id: "language",
        name: "Language",
        maxScore: 5,
        levels: [{ id: "language-excellent", label: "Excellent", score: 5, description: "Accurate language" }],
      },
    ],
  });

  assert.equal(parsedRubric.criteria.length, 3);
  assert.equal(parsedRubric.totalPoints, 15);
  assert.equal(parsedRubric.criteriaTotalPoints, 15);
  assert.equal(parsedRubric.declaredTotalPoints, 20);

  const matrixRubric = rubricUtils.rubricSchemaToMatrixData(parsedRubric, "Pilot mismatch rubric");
  assert.equal(matrixRubric.rows.length, 3);
  assert.equal(matrixRubric.rows.reduce((sum, row) => sum + Number(row.points || 0), 0), 15);

  const submission = {
    selfAssessment: {
      rowScores: parsedRubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        bandId: criterion.levels[0].id,
        points: Number(criterion.levels[0].score || 0),
        maxPoints: Number(criterion.maxScore || 0),
      })),
    },
  };
  const selfAssessmentMap = reviewUtils.getStudentSelfAssessmentRowScoreMap(submission);
  const selfAssessmentScore = Array.from(selfAssessmentMap.values()).reduce((sum, row) => sum + Number(row.points || 0), 0);

  assert.equal(selfAssessmentMap.size, 3);
  assert.equal(selfAssessmentScore, 15);
});

test("self-assessment completion requires every parsed criterion without checking total points", () => {
  const parsedRubric = rubricUtils.normalizeRubricSchema({
    title: "Three criterion rubric",
    totalPoints: 20,
    preserveCriteria: true,
    criteria: [
      {
        id: "ideas",
        name: "Ideas",
        maxScore: 5,
        levels: [{ id: "ideas-good", label: "Good", score: 5, description: "Clear ideas" }],
      },
      {
        id: "organization",
        name: "Organization",
        maxScore: 5,
        levels: [{ id: "organization-good", label: "Good", score: 5, description: "Logical order" }],
      },
      {
        id: "language",
        name: "Language",
        maxScore: 5,
        levels: [{ id: "language-good", label: "Good", score: 5, description: "Accurate language" }],
      },
    ],
  });

  const partialSubmission = {
    selfAssessment: {
      rowScores: [
        { criterionId: "ideas", bandId: "ideas-good", points: 5 },
        { criterionId: "organization", bandId: "organization-good", points: 5 },
      ],
    },
  };
  const partialCompletion = reviewUtils.getStudentSelfAssessmentCompletion(parsedRubric, partialSubmission);
  assert.equal(partialCompletion.requiredCount, 3);
  assert.equal(partialCompletion.selectedCount, 2);
  assert.equal(partialCompletion.isComplete, false);

  const completeSubmission = {
    selfAssessment: {
      rowScores: [
        ...partialSubmission.selfAssessment.rowScores,
        { criterionId: "language", bandId: "language-good", points: 5 },
      ],
    },
  };
  const completeCompletion = reviewUtils.getStudentSelfAssessmentCompletion(parsedRubric, completeSubmission);
  assert.equal(completeCompletion.requiredCount, 3);
  assert.equal(completeCompletion.selectedCount, 3);
  assert.equal(completeCompletion.isComplete, true);
  assert.equal(parsedRubric.totalPoints, 15);
});

test("reopened submissions must clear active graded-review lock fields", () => {
  const reopenedReview = reviewUtils.resetTeacherReviewForReopen({
    status: "graded",
    rubricType: "matrix",
    rowScores: [{ criterionId: "ideas", points: 4 }],
    suggestedRowScores: [{ criterionId: "ideas", points: 4 }],
    suggestedGrade: { totalScore: 4 },
    finalScore: 4,
    finalNotes: "Old feedback",
    annotations: [{ id: "note-1", selectedText: "sample", note: "old note" }],
    savedAt: "2026-05-03T10:00:00.000Z",
    acceptedAt: "2026-05-03T10:01:00.000Z",
  });

  assert.equal(reopenedReview.status, "draft");
  assert.equal(reopenedReview.savedAt, null);
  assert.equal(reopenedReview.finalScore, "");
  assert.deepEqual(reopenedReview.rowScores, []);
  assert.deepEqual(reopenedReview.suggestedRowScores, []);
  assert.equal(reopenedReview.suggestedGrade, null);
  assert.equal(reopenedReview.annotations.length, 1);
});

test("storage snapshot strips teacher assignments, submissions, and extra users", () => {
  const snapshot = storageUtils.buildStateSnapshot({
    users: [
      { id: "teacher-1", name: "Teacher" },
      { id: "student-1", name: "Student" },
    ],
    assignments: [{ id: "assignment-1", title: "Essay" }],
    submissions: [{ id: "submission-1", assignmentId: "assignment-1", studentId: "student-1" }],
  }, {
    id: "teacher-1",
    role: "teacher",
  });

  assert.deepEqual(snapshot.users, []);
  assert.deepEqual(snapshot.submissions, []);
  assert.deepEqual(snapshot.assignments, []);
});

test("storage snapshot keeps only the active student submission", () => {
  const snapshot = storageUtils.buildStateSnapshot({
    users: [
      { id: "student-1", name: "Student One" },
      { id: "student-2", name: "Student Two" },
    ],
    assignments: [],
    submissions: [
      { id: "submission-1", assignmentId: "assignment-1", studentId: "student-1" },
      { id: "submission-2", assignmentId: "assignment-2", studentId: "student-2" },
    ],
  }, {
    id: "student-1",
    role: "student",
  });

  assert.deepEqual(snapshot.users, [{ id: "student-1", name: "Student One" }]);
  assert.deepEqual(snapshot.submissions, [{ id: "submission-1", assignmentId: "assignment-1", studentId: "student-1" }]);
});

test("persistStateSnapshot falls back to a smaller backup when quota is exceeded", () => {
  global.localStorage = createMemoryStorage({ failFirstWrite: true });
  const result = storageUtils.persistStateSnapshot({
    state: {
      users: [{ id: "student-1", name: "Student One" }],
      assignments: [{ id: "assignment-1", title: "Essay" }],
      submissions: [{
        id: "submission-1",
        assignmentId: "assignment-1",
        studentId: "student-1",
        writingEvents: [{ id: "event-1" }],
        chatHistory: [{ role: "assistant", content: "Hi" }],
        focusAnnotations: [{ id: "focus-1" }],
        teacherReview: { finalScore: 12, status: "graded" },
      }],
    },
    currentProfile: { id: "student-1", role: "student" },
    storageKey: "primary",
    backupKey: "backup",
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "fallback");
  const stored = JSON.parse(global.localStorage.getItem("primary"));
  assert.deepEqual(stored.submissions[0].writingEvents, []);
  assert.deepEqual(stored.submissions[0].chatHistory, []);
  assert.equal(stored.submissions[0].teacherReview.savedAt, null);
});

test("fallback storage preserves graded submission review metadata", () => {
  global.localStorage = createMemoryStorage({ failFirstWrite: true });
  const result = storageUtils.persistStateSnapshot({
    state: {
      users: [{ id: "student-1", name: "Student One" }],
      assignments: [{ id: "assignment-1", title: "Essay" }],
      submissions: [{
        id: "submission-1",
        assignmentId: "assignment-1",
        studentId: "student-1",
        writingEvents: [{ id: "event-1" }],
        chatHistory: [{ role: "assistant", content: "Hi" }],
        teacherReview: {
          finalScore: 12,
          finalNotes: "Solid work.",
          annotations: [{ id: "ann-1", code: "SP" }],
          savedAt: "2026-04-28T12:00:00.000Z",
          status: "graded",
        },
      }],
    },
    currentProfile: { id: "student-1", role: "student" },
    storageKey: "primary",
    backupKey: "backup",
  });

  assert.equal(result.ok, true);
  const stored = JSON.parse(global.localStorage.getItem("primary"));
  assert.deepEqual(stored.submissions[0].writingEvents, []);
  assert.equal(stored.submissions[0].teacherReview.finalScore, 12);
  assert.equal(stored.submissions[0].teacherReview.finalNotes, "Solid work.");
  assert.equal(stored.submissions[0].teacherReview.savedAt, "2026-04-28T12:00:00.000Z");
  assert.deepEqual(stored.submissions[0].teacherReview.annotations, [{ id: "ann-1", code: "SP" }]);
});

test("line number utils ignore a trailing newline when numbering visible lines", () => {
  const entries = lineNumberUtils.buildWrappedLineEntries(
    "Line one\nLine two\nLine three\nLine four\n",
    { width: 999 },
    (value) => String(value || "").length
  );

  assert.deepEqual(entries.map((entry) => entry.number), [1, 2, 3, 4]);
});

test("line number utils still count intentional blank lines inside the text", () => {
  const entries = lineNumberUtils.buildWrappedLineEntries(
    "Line one\n\nLine two",
    { width: 999 },
    (value) => String(value || "").length
  );

  assert.deepEqual(
    entries.map((entry) => ({ number: entry.number, text: entry.text })),
    [
      { number: 1, text: "Line one" },
      { number: 2, text: "" },
      { number: 3, text: "Line two" },
    ]
  );
});

test("submission counts use one shared status model across refreshed assignments", () => {
  const { assignments, roster, submissions } = submissionRegressionFixture;
  const firstAssignmentCounts = submissionUtils.getAssignmentSubmissionCounts(
    submissions.filter((submission) => submissionUtils.getSubmissionAssignmentId(submission) === assignments[0].id),
    roster
  );
  const secondAssignmentCounts = submissionUtils.getAssignmentSubmissionCounts(
    submissions.filter((submission) => submissionUtils.getSubmissionAssignmentId(submission) === assignments[1].id),
    roster
  );
  const thirdAssignmentCounts = submissionUtils.getAssignmentSubmissionCounts(
    submissions.filter((submission) => submissionUtils.getSubmissionAssignmentId(submission) === assignments[2].id),
    roster
  );

  assert.deepEqual(firstAssignmentCounts, {
    total: 3,
    submitted: 1,
    graded: 0,
    missing: 1,
    late: 0,
    notSubmitted: 2,
  });
  assert.deepEqual(secondAssignmentCounts, {
    total: 3,
    submitted: 2,
    graded: 1,
    missing: 0,
    late: 0,
    notSubmitted: 1,
  });
  assert.deepEqual(thirdAssignmentCounts, {
    total: 3,
    submitted: 0,
    graded: 0,
    missing: 0,
    late: 1,
    notSubmitted: 3,
  });
});

test("submission counts dedupe duplicate student rows toward reviewed or submitted data", () => {
  const counts = submissionUtils.getAssignmentSubmissionCounts([
    {
      id: "draft-row",
      assignmentId: "assignment-1",
      studentId: "student-1",
      status: "draft",
      updatedAt: "2026-04-28T14:00:00.000Z",
    },
    {
      id: "graded-row",
      assignmentId: "assignment-1",
      studentId: "student-1",
      status: "submitted",
      submittedAt: "2026-04-28T13:30:00.000Z",
      updatedAt: "2026-04-28T13:45:00.000Z",
      teacherReview: {
        finalScore: 12,
        savedAt: "2026-04-28T13:50:00.000Z",
      },
    },
  ], [{ id: "student-1", name: "Ada" }]);

  assert.equal(counts.submitted, 1);
  assert.equal(counts.graded, 1);
  assert.equal(counts.notSubmitted, 0);
});

test("submission utilities tolerate missing submission objects during hydration", () => {
  assert.equal(submissionUtils.isSubmissionSubmitted(null), false);
  assert.equal(submissionUtils.isSubmissionGraded(null), false);
  assert.equal(submissionUtils.getSubmissionStatus(null), "");
  assert.equal(submissionUtils.getSubmissionAssignmentId(null), "");
});
