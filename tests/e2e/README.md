# AUIZero Playwright E2E Tests

These tests check the most important praxis user journeys in a real browser against production:

- `auth.spec.js` checks teacher login, student login, wrong-password errors, and logout.
- `teacher.spec.js` checks that a teacher can load the dashboard, open the test class, create an assignment, publish it, and see the assignment list.
- `student.spec.js` checks that a student can load the dashboard, see published assignments, and open one.
- `full-flow.spec.js` checks the full journey: teacher creates and publishes an assignment, student chats/drafts/gets feedback/submits, then teacher suggests and submits a grade.

## Add GitHub Secrets

The tests do not store passwords in the repo. Add these four secrets in GitHub:

1. Open the repo on GitHub.
2. Go to `Settings`.
3. Go to `Secrets and variables`.
4. Choose `Actions`.
5. Click `New repository secret`.
6. Add each secret:

- `TEACHER_EMAIL`
- `TEACHER_PASSWORD`
- `STUDENT_EMAIL`
- `STUDENT_PASSWORD`

## Run Tests Manually

The workflow only runs when you start it manually.

1. Open the repo on GitHub.
2. Click the `Actions` tab.
3. Choose `Playwright E2E Tests`.
4. Click `Run workflow`.
5. Pick `auth`, `teacher`, `student`, `full-flow`, or `all`.
6. Click the green `Run workflow` button.

## View Results

After the run finishes:

1. Open the workflow run.
2. Scroll to `Artifacts`.
3. Download the HTML report, screenshots/videos, or raw Playwright output.
4. Open `index.html` inside the HTML report folder.

If a test fails, start with the HTML report. It shows which step failed. If there is a video, watch it to see exactly what happened. If there is a trace, open it with Playwright Trace Viewer to inspect clicks, network calls, and screenshots.

## Pre-Test Checklist

- The production app is deployed and reachable at `https://auizero-production.up.railway.app`.
- The teacher test account exists.
- The student test account exists.
- The student is enrolled in the teacher's test class.
- GitHub secrets are set correctly.
- You are comfortable leaving test assignments/submissions in production for manual inspection.

## Important Note About Test Data

These tests do not clean up after themselves. Each full-flow or teacher run creates new production test data with a timestamped title. That is intentional so failed runs can be inspected later. Clean up old E2E assignments manually when you no longer need them.
