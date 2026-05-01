const { test, expect } = require("@playwright/test");
const { hasCredentials, login, logout, getCredentials } = require("./helpers");

test.describe("Authentication", () => {
  test("teacher can log in successfully", async ({ page }) => {
    test.skip(!hasCredentials("teacher"), "Set TEACHER_EMAIL and TEACHER_PASSWORD to run this test.");

    await login(page, "teacher");
    await expect(page.getByText(/class work/i).first()).toBeVisible();
  });

  test("student can log in successfully", async ({ page }) => {
    test.skip(!hasCredentials("student"), "Set STUDENT_EMAIL and STUDENT_PASSWORD to run this test.");

    await login(page, "student");
    await expect(page.getByText(/student view/i).first()).toBeVisible();
  });

  test("login with wrong password shows an error", async ({ page }) => {
    test.skip(!hasCredentials("teacher"), "Set TEACHER_EMAIL and TEACHER_PASSWORD to run this test.");

    const { email } = getCredentials("teacher");
    await page.goto("/");
    await page.getByPlaceholder("Email").first().fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill("definitely-not-the-real-password-123");

    // VERIFY: This scopes the click to the visible sign-in form, not the auth tab.
    await page.locator("#auth-signin-form").getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.locator("#auth-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#auth-error")).toContainText(/invalid|wrong|password|email|credentials|login/i);
  });

  test("logged-in user can log out", async ({ page }) => {
    test.skip(!hasCredentials("teacher"), "Set TEACHER_EMAIL and TEACHER_PASSWORD to run this test.");

    await login(page, "teacher");
    await logout(page);
  });
});
