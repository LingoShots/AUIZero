const { test, expect } = require("@playwright/test");
const {
  hasCredentials,
  login,
  openFirstStudentAssignment,
  selectStudentTestClass,
} = require("./helpers");

test.describe("Student workflow", () => {
  test.skip(!hasCredentials("student"), "Set STUDENT_EMAIL and STUDENT_PASSWORD to run student tests.");

  test("student dashboard loads after login", async ({ page }) => {
    await login(page, "student");

    await expect(page.getByText(/student view/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/select assignment/i)).toBeVisible();
  });

  test("student can see published assignments in their class", async ({ page }) => {
    await login(page, "student");

    // VERIFY: The student may belong to more than one class, so helper switches to
    // the known E2E class when the dropdown exists.
    await selectStudentTestClass(page);
    const assignmentSelect = page.getByLabel(/select assignment/i);
    await expect(assignmentSelect).toBeVisible();

    const assignmentCount = await assignmentSelect.locator("option[value]:not([value=''])").count();
    expect(assignmentCount).toBeGreaterThan(0);
  });

  test("student can open an assignment", async ({ page }) => {
    await login(page, "student");
    await openFirstStudentAssignment(page);

    await expect(page.getByText(/your task/i)).toBeVisible();
  });
});
