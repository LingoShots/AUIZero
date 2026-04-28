const test = require("node:test");
const assert = require("node:assert/strict");

const deadlineUtils = require("../deadline-utils.js");
const storageUtils = require("../storage-utils.js");
const aiAssistUtils = require("../ai-assist-utils.js");
const lineNumberUtils = require("../line-number-utils.js");

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

test("storage snapshot strips teacher submissions and extra users", () => {
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
  assert.equal(snapshot.assignments.length, 1);
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
