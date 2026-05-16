const test = require("node:test");
const assert = require("node:assert/strict");

function loadApiServiceWithFetch(apiFetch) {
  delete require.cache[require.resolve("../api-service.js")];
  globalThis.CoreUtils = { safeArray: (value) => Array.isArray(value) ? value : [] };
  globalThis.Auth = { apiFetch };
  return require("../api-service.js");
}

function createSubmission(overrides = {}) {
  return {
    id: "submission-local",
    assignmentId: "assignment-1",
    draftText: "Draft text",
    ...overrides,
  };
}

test("syncStudentSubmission loads the student row before patching a local submission", async () => {
  const calls = [];
  const apiService = loadApiServiceWithFetch(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/assignments/assignment-1/my-submission") {
      return { submission: { id: "server-1", assignment_id: "assignment-1", student_id: "student-1" } };
    }
    if (path === "/api/submissions/server-1") {
      return {
        submission: {
          id: "server-1",
          assignment_id: "assignment-1",
          student_id: "student-1",
          draft_text: "Draft text",
        },
      };
    }
    throw new Error(`Unexpected path: ${path}`);
  });

  const result = await apiService.syncStudentSubmission(createSubmission());

  assert.equal(result.id, "server-1");
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/assignments/assignment-1/my-submission",
    "/api/submissions/server-1",
  ]);
});

test("syncStudentSubmission retries with a refreshed server id when the cached id fails", async () => {
  const calls = [];
  const apiService = loadApiServiceWithFetch(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/submissions/stale-server-id") {
      return { error: "Submission not found" };
    }
    if (path === "/api/assignments/assignment-1/my-submission") {
      return { submission: { id: "server-2", assignment_id: "assignment-1", student_id: "student-1" } };
    }
    if (path === "/api/submissions/server-2") {
      return {
        submission: {
          id: "server-2",
          assignment_id: "assignment-1",
          student_id: "student-1",
          draft_text: "Draft text",
        },
      };
    }
    throw new Error(`Unexpected path: ${path}`);
  });

  const result = await apiService.syncStudentSubmission(createSubmission({ id: "stale-server-id" }));

  assert.equal(result.id, "server-2");
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/submissions/stale-server-id",
    "/api/assignments/assignment-1/my-submission",
    "/api/submissions/server-2",
  ]);
});
