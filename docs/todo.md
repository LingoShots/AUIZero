# Praxis TODO

## 🐛 Bugs (do first — affects users now)
- [ ] Admin view counts assignments and submissions that have already been deleted (stale cache or query bug)
- [ ] Ghost account login bug — if you wait too long to log in, it logs you into a ghost account
- [ ] UI/integration test that completes a student submission against a 3-criteria/15-point rubric — guards against future code changes that could re-introduce a gate on rubric completeness.
- [ ] Add failed-submit protection test: student final work stays saved locally/server-queued when submit fails, and the UI does not show false success.
- [ ] Add draft persistence regression test: student draft survives refresh/reload after Save Draft/autosave.
- [ ] Add teacher-receives-submission regression test outside the skipped full-flow test.
- [ ] Add a 4-criteria / 20-point rubric regression test so the normal rubric path stays covered.
- [ ] Verify publish email fires only after server-confirmed publish and publish failure shows a clear failure message.

## ✨ UX polish (quick wins)
- [ ] Save assignment button: change to "Saving..." on click, then scroll up to created assignment in tray and highlight publish button + suggest the teacher publish when ready
- [ ] Make assignment brief more obvious and unmissable for students on the student assignment page
- [ ] Move "Grade with AI" button to just below the ▶ Planning chat with coach fold (rename done; relocation deferred to Codex due to multi-section DOM move)
- [ ] "1 paste flag" note in assignment tray should be clickable and take you to that student
- [ ] Writing fluency section: show all 5 items not just the first 3 (clarify which are weighted lower / not shown)
- [ ] Remove all mentions of "AUIZero" — replace with "praxis" throughout the app (UI text, page titles, emails, etc.). UI/branding only — don't rename the GitHub repo, Railway project, env vars, or `AUIZero-v1` localStorage keys without a migration plan.

## 🚀 Features (need design thought first)
- [ ] Two reusable Praxis-supported writing task models for every teacher when they set up a class — listed as "Demo task" or similar
- [ ] Toggle (like chatbot on/off) for the chat to auto-generate an outline after chat conversation, viewable on the drafting page
- [ ] Ability for teacher to accept or reject AI suggestions
- [ ] Attempt history — should re-submission create a new attempt record with separate grading, or continue updating the same submission as iteration? Needs product decision before implementation.
- [ ] Student side assignment tray is not clean. Should be separate sections for new, submitted, and graded assignments. Consider how Canvas or other LMS show/ organise students' assignments

## 🧱 Refactor / architecture
- [ ] Continue modularizing only after pilot-critical bugs/tests are stable.
- [ ] Consider `student-workflow.js` for step navigation, draft/final transitions, submit, and feedback request handlers.
- [ ] Consider `teacher-assignments.js` for create/edit/publish/delete assignment handlers.
- [ ] Consider `teacher-review.js` for grading handlers, annotation controls, and playback controls.
- [ ] Keep large render extraction for later; render functions are still tightly coupled to global state.
- [ ] Enable Anthropic prompt caching on AI calls (chat, draft feedback, grade suggestion). Requires restructuring prompt builders in app.js so static content (assignment context, rubric, system prompts) comes BEFORE dynamic content (student draft, chat history) — currently interleaved as template literals. Also requires updating /api/generate in server.js to support cache_control field. Estimated savings: 50-70% on input tokens for calls that hit cache (mostly grade suggestion + feedback during concurrent pilot use). Note: 2048-token minimum on Sonnet 4.6 means short chat turns may not qualify. Best done during the kraken refactor when prompt builders are being touched anyway. Revisit when AI costs exceed ~$50/month or as part of broader refactor work.

## ✅ Done
- [x] Delete test assignments + submission data so they don't skew real keystroke analytics
- [x] RLS recursion bug fix
- [x] Signup flow hardening with friendly error messages
- [x] Supabase admin/user client session separation (PR 115)
- [x] Playwright E2E test suite (auth ✅ teacher ✅ student ✅ full-flow skipped with reason)
- [x] Reopen submission flow: clears graded review fields server-side AND fixed `mergeStudentSubmission` so locally-cached graded state doesn't override server's cleared state on reopen
- [x] "Last saved" message after submit grade replaced with "Grade saved" persistent label + "Grade submitted to student" confirmation
- [x] AI buttons disable while thinking — prevents double-requests on assignment creation and student AI feedback
- [x] Regression test: pilot rubric mismatch (3 criteria / 15 points) does not block student submission
- [x] Remove skip chat button
- [x] Rename "Suggest rubric scores" → "Grade with AI" (clearer action label)
- [x] Submit grade button disables + shows "Submitting…" during request
- [x] Show "Grade submitted to student" confirmation in grading panel after submit
- [x] Optional reflection textarea on self-assessment screen (non-blocking for submit)

## To check / consider

Manual assignment creation needs its own save button as the save button at the top of the page is tied to format with AI.
There should be a notification message or something to let teacher know assignment has been created and ready to publish.
Remove student focus box from all workflows.
Add assignment type and min/max word limits to format with AI set up, as currently they only appear after format with AI.
- Also, if all the buttons show at the top, there will be no need for the manual set up section at all because you can just do manual set up at the top if you prefer. Only change needed is to remove the lock on the save button that requires you to format with AI before saving. That will give teachers the option to manual fill or fill with AI. Then, put the format with AI button right next to the Teacher Brief box so it's clearly the next step 1. Fill out teacher brief 2. Hit format with AI 3. Check all settings 4. Save.
- Verify AI provider rate limits and concurrent request capacity for pilot-scale usage (12+ students simultaneously).

[22/4/26, 21:41:28] Danny AUI New: Copy grade works well. Maybe it should be called "copy grade and feedback" instead though.
[22/4/26, 21:42:11] Danny AUI New: And maybe add a brief explanation of what it will do (e.g. it will copy the rubric grades and any comments you made on the assignment when grading it). Fix AI feedback.
