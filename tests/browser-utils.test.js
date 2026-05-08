const test = require("node:test");
const assert = require("node:assert/strict");

const deadlineUtils = require("../deadline-utils.js");
const storageUtils = require("../storage-utils.js");
const aiAssistUtils = require("../ai-assist-utils.js");
const lineNumberUtils = require("../line-number-utils.js");
const notificationUtils = require("../notification-utils.js");
const submissionUtils = require("../submission-utils.js");
const submissionSanitizer = require("../submission-sanitizer.js");
const canonicalUrlUtils = require("../canonical-url-utils.js");
const adminUtils = require("../admin-utils.js");
const writingProcessTypes = require("../writing-process/types.js");
const writingProcessEvents = require("../writing-process/events.js");
const writingProcessAnalyze = require("../writing-process/analyze.js");
const writingProcessAdmin = require("../writing-process/admin.js");
const submissionRegressionFixture = require("./fixtures/submission-regression-fixture.js");

global.window = global.window || {};
require("../rubric-utils.js");
require("../review-utils.js");
require("../paste-evidence-utils.js");

const rubricUtils = global.window.RubricUtils;
const reviewUtils = global.window.ReviewUtils;
const pasteEvidenceUtils = global.window.PasteEvidenceUtils;

function repeatedWords(seed, count) {
  return Array.from({ length: count }, (_, index) => `${seed}${index}`).join(" ");
}

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

test("admin class detail signatures change when roster or assignments change", () => {
  const original = adminUtils.getAdminClassDetailSignature({
    members: [{ id: "student-1", name: "Student One", is_test_account: false }],
    assignments: [{ id: "assignment-1", title: "Original", status: "published" }],
    submissions: [{ id: "submission-1", assignment_id: "assignment-1", student_id: "student-1", status: "submitted" }],
  });
  const changed = adminUtils.getAdminClassDetailSignature({
    members: [{ id: "student-1", name: "Student One", is_test_account: true }],
    assignments: [{ id: "assignment-2", title: "Replacement", status: "published" }],
    submissions: [],
  });

  assert.notEqual(original, changed);
});

test("writing process events tag draft, final, and coach outline phases", () => {
  const draftEvent = writingProcessEvents.createWritingEvent({
    previousText: "",
    nextText: "First draft sentence.",
    phase: writingProcessTypes.PHASES.DRAFT,
    field: "draftText",
    idFactory: () => "draft-event",
  });
  const finalEvent = writingProcessEvents.createWritingEvent({
    previousText: "First draft sentence.",
    nextText: "First final sentence.",
    phase: writingProcessTypes.PHASES.FINAL,
    field: "finalText",
    idFactory: () => "final-event",
  });
  const outlineEvent = writingProcessEvents.createWritingEvent({
    previousText: "",
    nextText: "My first idea is about practice.",
    phase: writingProcessTypes.PHASES.COACH_OUTLINE,
    field: "partOne",
    idFactory: () => "outline-event",
  });

  assert.equal(draftEvent.phase, "draft");
  assert.equal(finalEvent.phase, "final");
  assert.equal(outlineEvent.phase, "coach_outline");
  assert.equal(outlineEvent.field, "partOne");
});

test("writing process analysis uses review language and gates short submissions", () => {
  const analysis = writingProcessAnalyze.analyzeSubmission({
    finalText: "Too short.",
    writingEvents: [],
  }, {
    languageLevel: "B1",
  });

  assert.equal(analysis.status, writingProcessTypes.STATUS.INSUFFICIENT);
  assert.equal(analysis.statusLabel, "Not enough writing data");
  const teacherFacingText = [
    ...Object.values(writingProcessTypes.STATUS_LABELS),
    ...Object.values(writingProcessTypes.STATUS_REASONS),
  ].join(" ").toLowerCase();
  assert.doesNotMatch(teacherFacingText, /cheating|plagiarism|suspicious|inauthentic|detected/);
});

test("large external paste contributes evidence while own-outline paste is separated", () => {
  const outlineText = "My plan is to explain healthy eating, daily exercise, and enough sleep with simple examples.";
  const pastedEssayText = repeatedWords("health", 120);
  const outlinePasteAnalysis = writingProcessAnalyze.analyzeSubmission({
    outline: { partOne: outlineText, partTwo: "", partThree: "" },
    finalText: `${outlineText} ${repeatedWords("draft", 90)}`,
    writingEvents: [{
      id: "own-outline-paste",
      timestamp: "2026-05-08T10:00:00.000Z",
      type: "paste",
      phase: "draft",
      field: "draftText",
      start: 0,
      end: 0,
      insertedText: outlineText,
      removedText: "",
      delta: outlineText.length,
      flagged: true,
    }],
  }, { languageLevel: "B1" });

  assert.equal(outlinePasteAnalysis.pasteEvidence[0].source, "own_outline");
  assert.equal(outlinePasteAnalysis.evidence.some((item) => item.code === "large_paste_or_bulk_insert"), false);

  const externalPasteAnalysis = writingProcessAnalyze.analyzeSubmission({
    finalText: pastedEssayText,
    writingEvents: [{
      id: "external-paste",
      timestamp: "2026-05-08T10:00:00.000Z",
      type: "paste",
      phase: "draft",
      field: "draftText",
      start: 0,
      end: 0,
      insertedText: pastedEssayText,
      removedText: "",
      delta: pastedEssayText.length,
      flagged: true,
    }],
  }, { languageLevel: "B1" });

  assert.equal(externalPasteAnalysis.pasteEvidence[0].source, "external_or_unknown");
  assert.equal(externalPasteAnalysis.evidence.some((item) => item.code === "large_paste_or_bulk_insert"), true);
  assert.equal(externalPasteAnalysis.status, writingProcessTypes.STATUS.CLOSE);
});

test("writing process admin summary excludes test accounts and flagged submissions", () => {
  const summary = writingProcessAdmin.summarizeProcessDataPool({
    members: [
      { id: "student-1", name: "Test Student", is_test_account: true },
      { id: "student-2", name: "Live Student", is_test_account: false },
    ],
    submissions: [
      { id: "submission-1", studentId: "student-1", writingEvents: [{ id: "event-1" }] },
      {
        id: "submission-2",
        studentId: "student-2",
        writingEvents: [{ id: "event-2" }],
        teacherReview: { writingBehaviourExcluded: true },
      },
      { id: "submission-3", studentId: "student-2", writingEvents: [{ id: "event-3" }] },
    ],
  });

  assert.equal(summary.includedSubmissions, 1);
  assert.equal(summary.excludedSubmissions, 2);
  assert.equal(summary.excludedByTestAccount, 1);
  assert.equal(summary.excludedBySubmissionFlag, 1);
});

test("notification utils normalize password reset redirects", () => {
  assert.equal(
    notificationUtils.appendResetQuery("https://auizero-production.up.railway.app/?reset=1"),
    "https://auizero-production.up.railway.app/?reset=1"
  );
  assert.equal(
    notificationUtils.appendResetQuery("https://auizero-production.up.railway.app"),
    "https://auizero-production.up.railway.app/?reset=1"
  );
});

test("canonical URL utils redirect old public hosts to configured app domain", () => {
  assert.equal(
    canonicalUrlUtils.getCanonicalRedirectTarget({
      method: "GET",
      host: "auizero-production.up.railway.app",
      originalUrl: "/class?x=1",
      configuredBase: "https://praxiswrite.com",
    }),
    "https://praxiswrite.com/class?x=1"
  );

  assert.equal(
    canonicalUrlUtils.getCanonicalRedirectTarget({
      method: "GET",
      host: "praxiswrite.com",
      originalUrl: "/class?x=1",
      configuredBase: "https://praxiswrite.com",
    }),
    ""
  );

  assert.equal(
    canonicalUrlUtils.getCanonicalRedirectTarget({
      method: "GET",
      host: "auizero-production.up.railway.app",
      originalUrl: "/api/auth/me",
      configuredBase: "https://praxiswrite.com",
    }),
    ""
  );

  assert.equal(
    canonicalUrlUtils.getCanonicalRedirectTarget({
      method: "GET",
      host: "localhost:3000",
      originalUrl: "/",
      configuredBase: "https://praxiswrite.com",
    }),
    ""
  );
});

test("notification utils detect grade saves and reopened submissions", () => {
  assert.equal(
    notificationUtils.teacherReviewWasNewlySaved(
      { savedAt: "2026-05-01T09:00:00.000Z" },
      { savedAt: "2026-05-01T10:00:00.000Z" }
    ),
    true
  );
  assert.equal(
    notificationUtils.teacherReviewWasNewlySaved(
      { savedAt: "2026-05-01T09:00:00.000Z" },
      { savedAt: "2026-05-01T09:00:00.000Z" }
    ),
    false
  );
  assert.equal(
    notificationUtils.teacherReviewWasNewlySaved(
      { status: "graded", savedAt: "2026-05-01T09:00:00.000Z", finalScore: 5 },
      { status: "graded", savedAt: "2026-05-01T09:00:00.000Z", finalScore: 6 }
    ),
    true
  );
  assert.equal(
    notificationUtils.submissionWasReopened({ status: "submitted" }, { status: "draft" }),
    true
  );
  assert.equal(
    notificationUtils.submissionWasReopened({ status: "draft" }, { status: "draft" }),
    false
  );
  assert.equal(
    notificationUtils.submissionPayloadWithGradedStatus({
      status: "draft",
      teacher_review: { status: "graded", savedAt: "2026-05-06T11:19:34.707Z" },
    }).status,
    "graded"
  );
  assert.equal(
    notificationUtils.submissionPayloadWithGradedStatus({
      status: "graded",
      teacher_review: { status: "draft", savedAt: null, finalScore: "" },
    }).status,
    "draft"
  );
});

test("student submission writes cannot overwrite teacher-owned review state", () => {
  const sanitized = submissionSanitizer.sanitizeStudentSubmissionPayload({
    draft_text: "Student draft",
    final_text: "Student final",
    status: "graded",
    submitted_at: "2026-05-01T10:00:00.000Z",
    teacher_review: {
      status: "graded",
      savedAt: "2026-05-01T10:00:00.000Z",
      finalScore: 20,
    },
  });

  assert.equal(sanitized.draft_text, "Student draft");
  assert.equal(sanitized.final_text, "Student final");
  assert.equal(Object.hasOwn(sanitized, "status"), false);
  assert.equal(Object.hasOwn(sanitized, "submitted_at"), false);
  assert.equal(Object.hasOwn(sanitized, "teacher_review"), false);
});

test("teacher submission writes can update review status and teacher review", () => {
  const sanitized = submissionSanitizer.sanitizeTeacherSubmissionPayload({
    status: "graded",
    submitted_at: "2026-05-01T10:00:00.000Z",
    teacher_review: {
      status: "graded",
      savedAt: "2026-05-01T10:00:00.000Z",
      finalScore: 20,
    },
  });

  assert.equal(sanitized.status, "graded");
  assert.equal(sanitized.submitted_at, "2026-05-01T10:00:00.000Z");
  assert.equal(sanitized.teacher_review.finalScore, 20);
});

test("student-visible reopened submissions cannot expose stale graded review data", () => {
  const visible = submissionSanitizer.normalizeStudentVisibleSubmission({
    id: "submission-1",
    status: "draft",
    teacher_review: {
      status: "graded",
      savedAt: "2026-05-01T10:00:00.000Z",
      finalScore: 20,
      finalNotes: "Old grade",
      annotations: [{ id: "old-note" }],
    },
  });

  assert.equal(visible.status, "draft");
  assert.equal(visible.teacher_review.status, "ungraded");
  assert.equal(visible.teacher_review.savedAt, null);
  assert.equal(visible.teacher_review.finalScore, "");
  assert.deepEqual(visible.teacher_review.annotations, []);
});

test("student-visible split graded status with open review is treated as editable", () => {
  const visible = submissionSanitizer.normalizeStudentVisibleSubmission({
    id: "submission-1",
    status: "graded",
    teacher_review: {
      status: "draft",
      savedAt: null,
      finalScore: "",
      finalNotes: "",
      rowScores: [],
      annotations: [],
    },
  });

  assert.equal(visible.status, "draft");
  assert.equal(visible.teacher_review.status, "ungraded");
  assert.equal(visible.teacher_review.savedAt, null);
});

test("submitted student payload clears old review data for resubmission", () => {
  const openReview = submissionSanitizer.createOpenTeacherReview({
    status: "graded",
    savedAt: "2026-05-01T10:00:00.000Z",
    finalScore: 20,
    finalNotes: "Old grade",
  });

  assert.equal(openReview.status, "ungraded");
  assert.equal(openReview.savedAt, null);
  assert.equal(openReview.finalScore, "");
  assert.equal(openReview.finalNotes, "");
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

test("annotation short labels preserve custom wording", () => {
  assert.equal(reviewUtils.formatAnnotationShortLabel("Missing word"), "Missing word");
  assert.equal(reviewUtils.formatAnnotationShortLabel("Wrong word form"), "Wrong word form");
  assert.equal(reviewUtils.formatAnnotationShortLabel("Missing word: add an article"), "Missing word");
});

test("playback operation counts keep paste and delete atomic", () => {
  assert.equal(reviewUtils.getPlaybackOperationCount({ type: "paste", insertedText: "x".repeat(300) }), 1);
  assert.equal(reviewUtils.getPlaybackOperationCount({ type: "delete", removedText: "x".repeat(120) }), 1);
  assert.equal(reviewUtils.getPlaybackOperationCount({ type: "insert", insertedText: "x".repeat(300) }), 1);
  assert.equal(reviewUtils.getPlaybackOperationCount({ type: "insert", insertedText: "abc" }), 3);
  assert.equal(reviewUtils.getPlaybackOperationCount({ type: "replace", removedText: "old", insertedText: "new" }), 4);
});

test("paste evidence excerpts show a concise start preview", () => {
  const text = `Start ${"middle ".repeat(80)} End`;
  const excerpt = pasteEvidenceUtils.buildStartExcerpt(text, { excerptLength: 40 });
  assert.equal(excerpt.truncated, true);
  assert.match(excerpt.preview, /^Start middle/);
  assert.match(excerpt.preview, /\.\.\.$/);

  const shortExcerpt = pasteEvidenceUtils.buildStartExcerpt("Short pasted text", { excerptLength: 40 });
  assert.equal(shortExcerpt.truncated, false);
  assert.equal(shortExcerpt.preview, "Short pasted text");
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
  assert.deepEqual(reopenedReview.annotations, []);
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
