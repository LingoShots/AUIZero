const { test, expect } = require("@playwright/test");
const {
  hasCredentials,
  login,
  openFirstStudentAssignment,
  selectStudentTestClass,
  collectPageErrors,
} = require("./helpers");

test.describe("Student workflow", () => {
  test.skip(!hasCredentials("student"), "Set STUDENT_EMAIL and STUDENT_PASSWORD to run student tests.");

  test("student dashboard loads after login", async ({ page }) => {
    const { getErrors } = collectPageErrors(page);
    await login(page, "student");

    await expect(page.getByText(/student view/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/select assignment/i)).toBeVisible();
    expect(getErrors(), "no JS errors on student dashboard").toEqual([]);
  });

  test("student can see published assignments in their class", async ({ page }) => {
    const { getErrors } = collectPageErrors(page);
    await login(page, "student");

    // VERIFY: The student may belong to more than one class, so helper switches to
    // the known E2E class when the dropdown exists.
    await selectStudentTestClass(page);
    const assignmentSelect = page.getByLabel(/select assignment/i);
    await expect(assignmentSelect).toBeVisible();

    const assignmentCount = await assignmentSelect.locator("option[value]:not([value=''])").count();
    expect(assignmentCount).toBeGreaterThan(0);
    expect(getErrors(), "no JS errors when listing student assignments").toEqual([]);
  });

  test("student can open an assignment", async ({ page }) => {
    const { getErrors } = collectPageErrors(page);
    await login(page, "student");
    await openFirstStudentAssignment(page);

    await expect(page.getByText(/your task/i).first()).toBeVisible();
    // VERIFY: Opening an assignment exercises the student workspace renderer,
    // step-state restoration, and assignment data loading. A regression in any
    // of those paths typically surfaces as an uncaught JS error here.
    expect(getErrors(), "no JS errors when opening a student assignment").toEqual([]);
  });
});
