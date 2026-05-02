const { expect } = require("@playwright/test");

const TEST_CLASS_ID = "1bd11112-fb3b-4fa3-8317-e30dda9881bc";

function getCredentials(role) {
  const prefix = role.toUpperCase();
  return {
    email: process.env[`${prefix}_EMAIL`] || "",
    password: process.env[`${prefix}_PASSWORD`] || "",
  };
}

function hasCredentials(role) {
  const { email, password } = getCredentials(role);
  return Boolean(email && password);
}

function hasAllCredentials() {
  return hasCredentials("teacher") && hasCredentials("student");
}

async function login(page, role) {
  const { email, password } = getCredentials(role);

  await page.goto("/");

  // The sign-in form uses placeholder text rather than visible labels.
  await page.getByPlaceholder("Email").first().fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);

  // VERIFY: This scopes the button to the sign-in form because the auth tabs also
  // contain visible "Sign in" text.
  await page.locator("#auth-signin-form").getByRole("button", { name: /^sign in$/i }).click();

  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 30_000 });
}

async function logout(page) {
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page.getByRole("button", { name: /^sign in$/i }).last()).toBeVisible({ timeout: 15_000 });
}

async function selectTeacherTestClass(page) {
  // VERIFY: The production test class is selected by its database id. This is more
  // stable than relying on a class name that may be renamed in the UI.
  const classSelect = page.locator(`select:has(option[value="${TEST_CLASS_ID}"])`).first();
  if (await classSelect.count()) {
    await classSelect.selectOption(TEST_CLASS_ID);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  await expect(page.getByRole("banner").getByText(/current class:/i)).toBeVisible({ timeout: 20_000 });
}

async function selectStudentTestClass(page) {
  // Student accounts may belong to more than one class, so switch explicitly when
  // the class dropdown is present.
  const studentClassSelect = page.getByLabel(/switch class/i);
  if (await studentClassSelect.count()) {
    await studentClassSelect.selectOption(TEST_CLASS_ID);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

async function createAiAssistedAssignment(page, title) {
  const brief = [
    "Write one paragraph about a learning goal that matters to you.",
    "Aim for 250 to 400 words.",
    "Give one feedback check.",
    "Include a simple rubric that scores ideas, organization, and language.",
  ].join(" ");

  await page.locator("#teacher-brief").fill(brief);
  console.log("[TEACHER FLOW CHECKPOINT] AI brief filled");
  await page.getByRole("button", { name: /create student-ready version/i }).click();
  console.log("[TEACHER FLOW CHECKPOINT] AI generation started");

  const generatedAssignment = page.locator("#teacher-generated-assignment");
  const generatedTitleInput = generatedAssignment.locator('[data-assist-field="title"]').first();
  await expect(generatedTitleInput).toBeVisible({ timeout: 90_000 });
  console.log("[TEACHER FLOW CHECKPOINT] AI generation completed");
  await generatedTitleInput.fill(title);
  console.log("[TEACHER FLOW CHECKPOINT] generated title overridden");

  // The generated path must include rubric rows so the student self-assessment step works.
  await expect(generatedAssignment.locator('[data-rubric-field="name"]').first()).toBeVisible({ timeout: 30_000 });
  console.log("[TEACHER FLOW CHECKPOINT] generated rubric visible");

  const saveButton = generatedAssignment.getByRole("button", { name: /^save assignment$/i });
  await expect(saveButton).toBeEnabled({ timeout: 60_000 });
  await saveButton.click();
  console.log("[TEACHER FLOW CHECKPOINT] generated assignment saved");

  // TODO: add data-testid="assignment-card" to assignment cards for stability.
  const assignmentCard = page.locator(".assignment-card").filter({ hasText: title }).first();
  await expect(assignmentCard).toBeVisible({ timeout: 30_000 });
  console.log("[TEACHER FLOW CHECKPOINT] assignment card visible");
}

async function publishAssignment(page, title) {
  // TODO: add data-testid="assignment-card" and data-testid="publish-assignment"
  // so this can stop relying on card text plus button text.
  const assignmentCard = page.locator(".assignment-card").filter({ hasText: title }).first();
  await expect(assignmentCard).toBeVisible({ timeout: 30_000 });

  const publishButton = assignmentCard.getByRole("button", { name: /^publish$/i });
  if (await publishButton.count()) {
    await publishButton.click();
  }

  await expect(assignmentCard.locator(".pill", { hasText: /^published$/i })).toBeVisible({ timeout: 30_000 });
}

async function createAndPublishAssignment(page, title) {
  await selectTeacherTestClass(page);
  await createAiAssistedAssignment(page, title);
  await publishAssignment(page, title);
}

async function openStudentAssignment(page, title) {
  await selectStudentTestClass(page);

  const assignmentSelect = page.getByLabel(/select assignment/i);
  await expect(assignmentSelect).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () => assignmentSelect.locator("option").evaluateAll((options, targetTitle) => {
        return options.some((option) => option.textContent.trim() === targetTitle);
      }, title),
      { timeout: 60_000 },
    )
    .toBeTruthy();

  await assignmentSelect.selectOption({ label: title });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
}

async function openFirstStudentAssignment(page) {
  await selectStudentTestClass(page);

  const assignmentSelect = page.getByLabel(/select assignment/i);
  await expect(assignmentSelect).toBeVisible({ timeout: 20_000 });

  const firstAssignment = await assignmentSelect.locator("option[value]:not([value=''])").first().getAttribute("value");
  expect(firstAssignment, "student should have at least one published assignment").toBeTruthy();

  await assignmentSelect.selectOption(firstAssignment);
  await expect(page.getByText(/your task/i).first()).toBeVisible({ timeout: 20_000 });
}

async function sendChatMessage(page, message) {
  await page.getByPlaceholder(/type your answer here/i).fill(message);
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(page.getByText(message).first()).toBeVisible();

  // VERIFY: The loading dots use a CSS class rather than an accessible label.
  await expect(page.locator(".chat-loading")).toHaveCount(0, { timeout: 60_000 });
}

async function completeStudentDraftFlow(page) {
  const draftText = [
    "My learning goal is to become more confident when I write in English.",
    "This goal matters to me because I want people to understand my ideas without confusion.",
    "At the moment I can explain simple opinions, but sometimes my sentences are too short or not connected well.",
    "I will improve by planning before I write, checking my verbs, and adding examples after each main point.",
    "If I keep practising, I think my writing will become clearer and more organized.",
  ].join(" ");

  console.log("[STUDENT FLOW CHECKPOINT] starting chat");
  await sendChatMessage(page, "Hello, I have a question about the prompt");
  console.log("[STUDENT FLOW CHECKPOINT] first chat message sent");
  await sendChatMessage(page, "Thanks for the help");
  console.log("[STUDENT FLOW CHECKPOINT] second chat message sent");

  await page.getByRole("button", { name: /next:\s*write draft/i }).click();
  await expect(page.getByRole("heading", { name: /write your draft/i })).toBeVisible();
  console.log("[STUDENT FLOW CHECKPOINT] draft step opened");

  await page.getByPlaceholder(/start your draft here/i).fill(draftText);
  console.log("[STUDENT FLOW CHECKPOINT] draft filled");
  await page.getByRole("button", { name: /^next$/i }).click();
  console.log("[STUDENT FLOW CHECKPOINT] draft next clicked");
  const feedbackModalButton = page.getByRole("button", { name: /yes, get ai feedback/i });
  const feedbackModalAppeared = await feedbackModalButton.waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (feedbackModalAppeared) {
    console.log("[STUDENT FLOW CHECKPOINT] draft feedback modal visible");
    await feedbackModalButton.click();
    console.log("[STUDENT FLOW CHECKPOINT] feedback modal accepted");
  } else {
    console.log("[STUDENT FLOW CHECKPOINT] draft feedback modal not shown");
  }
  await expect(page.getByRole("heading", { name: /review feedback and write your final version/i })).toBeVisible({ timeout: 30_000 });
  console.log("[STUDENT FLOW CHECKPOINT] feedback/final step opened");

  const feedbackCard = page.locator(".feedback-card");
  if (!feedbackModalAppeared) {
    const feedbackButton = page.getByRole("button", { name: /get ai feedback/i }).first();
    await expect(feedbackButton).toBeEnabled({ timeout: 10_000 });
    await feedbackButton.click();
    console.log("[STUDENT FLOW CHECKPOINT] manual feedback button clicked");
  }

  // TODO: add data-testid="feedback-card" so this waits on a stable element.
  await expect(feedbackCard).toHaveCount(1, { timeout: 90_000 });
  console.log("[STUDENT FLOW CHECKPOINT] AI feedback received");

  const finalEditor = page.getByPlaceholder(/write your final version here/i);
  await expect(finalEditor).toBeVisible();
  await finalEditor.fill(`${draftText} I also checked that my conclusion connects back to my main idea.`);
  console.log("[STUDENT FLOW CHECKPOINT] final text filled");

  // VERIFY: There are several "Next" buttons across the wizard; this one is scoped
  // by the current step's data-action because the visible label is intentionally simple.
  await page.locator('button[data-action="student-next-step"][data-step="4"]').click();
  await expect(page.getByRole("heading", { name: /rate yourself and submit/i })).toBeVisible();
  console.log("[STUDENT FLOW CHECKPOINT] self-assessment step opened");

  // TODO: add data-testid="self-assessment-rubric-option" to the rubric cells.
  await page.locator('button[data-action="select-self-assessment-band"]').first().click();
  console.log("[STUDENT FLOW CHECKPOINT] rubric option selected");
  await page.getByRole("button", { name: /submit assignment/i }).click();
  console.log("[STUDENT FLOW CHECKPOINT] submit clicked");

  await expect(page.getByText(/submitted!/i).first()).toBeVisible({ timeout: 45_000 });
  console.log("[STUDENT FLOW CHECKPOINT] submission confirmed");
}

async function gradeSubmittedAssignment(page, title) {
  await selectTeacherTestClass(page);

  // Refresh the teacher view so the submission created in the student context is loaded.
  await page.reload();
  await selectTeacherTestClass(page);

  const assignmentCard = page.locator(".assignment-card").filter({ hasText: title }).first();
  await expect(assignmentCard).toBeVisible({ timeout: 30_000 });
  await assignmentCard.getByRole("button", { name: /review students/i }).click();

  // TODO: add data-testid="submitted-student-card". For now, open the first card
  // with a Submitted status in this assignment's review list.
  const submittedCard = page.locator(".submission-card").filter({ hasText: /submitted/i }).first();
  await expect(submittedCard).toBeVisible({ timeout: 30_000 });
  await submittedCard.getByRole("button", { name: /grade/i }).click();

  await expect(page.getByText(/student text/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /suggest rubric scores/i }).click();

  await expect(page.getByText(/ai suggested grade/i).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: /use this score/i }).click();
  await page.getByRole("button", { name: /submit grade/i }).click();

  await expect(page.getByText(/last saved/i).first()).toBeVisible({ timeout: 30_000 });
}

module.exports = {
  TEST_CLASS_ID,
  getCredentials,
  hasCredentials,
  hasAllCredentials,
  login,
  logout,
  selectTeacherTestClass,
  selectStudentTestClass,
  createAndPublishAssignment,
  openFirstStudentAssignment,
  openStudentAssignment,
  completeStudentDraftFlow,
  gradeSubmittedAssignment,
};
