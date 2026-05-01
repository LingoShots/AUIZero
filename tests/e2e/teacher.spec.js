const { test, expect } = require("@playwright/test");
const {
  hasCredentials,
  login,
  selectTeacherTestClass,
  createAndPublishAssignment,
} = require("./helpers");

test.describe("Teacher workflow", () => {
  test.skip(!hasCredentials("teacher"), "Set TEACHER_EMAIL and TEACHER_PASSWORD to run teacher tests.");

  test("teacher dashboard loads after login", async ({ page }) => {
    await login(page, "teacher");

    await expect(page.getByText(/teacher review/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/current class:/i)).toBeVisible();
  });

  test("teacher can navigate to the existing test class", async ({ page }) => {
    await login(page, "teacher");
    await selectTeacherTestClass(page);

    await expect(page.getByText(/assignments/i)).toBeVisible();
  });

  test("teacher can create and publish a new assignment", async ({ page }) => {
    const title = `E2E Teacher Assignment ${Date.now()}`;

    await login(page, "teacher");
    await createAndPublishAssignment(page, title);

    await expect(page.locator(".assignment-card").filter({ hasText: title }).first()).toContainText(/published/i);
  });

  test("teacher can view their assignments list", async ({ page }) => {
    await login(page, "teacher");
    await selectTeacherTestClass(page);

    // TODO: add data-testid="assignment-list" to avoid relying on the CSS class.
    await expect(page.locator(".assignment-list")).toBeVisible({ timeout: 20_000 });
  });
});
