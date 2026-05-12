# Phase 16 — API / server-sync extraction plan

## Purpose

Phase 16 moves server/API responsibilities out of `app.js` into a clear frontend service boundary before the next large extractions.

This phase should reduce `app.js` authority without changing UI behaviour. The goal is not to create a perfect service architecture in one PR; the goal is to create a safe, testable boundary that later AI, writing-session, and event-handler modules can call.

## Why this phase comes next

Phase 15 hardened dependency boundaries in the first extracted modules. The next most valuable unlock is to remove network/server-sync responsibilities from `app.js` before splitting AI logic or role event handlers.

If event handlers are extracted first, they will drag server calls, payload mapping, state mutation, and UI state with them. If the API/service boundary exists first, the later event modules can stay thin.

Recommended sequence:

1. `api-service.js` extraction
2. AI request/prompt extraction
3. writing/submission lifecycle extraction
4. role event-handler extraction

## Scope rules

Phase 16 should follow these rules:

- No UI changes.
- No endpoint changes.
- No database/schema changes.
- No auth behaviour changes.
- No deletion of old helpers unless each call site has been migrated and tested.
- Prefer one small PR per cluster.
- Keep `app.js` responsible for UI state, render calls, and event dispatch until later phases.
- Keep service functions explicit: pass IDs/data in; return server data or mapped objects out.
- Avoid `ApiService` reading from `window.AppState` unless there is no safe alternative.

## Proposed file

Create:

```text
api-service.js
```

Load order in `index.html`:

```text
auth.js
...utilities...
api-service.js
app.js
```

`api-service.js` should expose:

```js
window.ApiService = {
  // grouped methods here
};
```

For compatibility during migration, do not assign every method directly onto `window`. Prefer explicit calls such as:

```js
window.ApiService.loadClassAssignments(classId)
```

## Service boundary design

### Good service function shape

```js
async function loadClassAssignments(classId) {
  const result = await Auth.apiFetch(`/api/classes/${classId}/assignments`);
  return safeArray(result?.assignments).map(mapServerAssignment);
}
```

### Avoid this shape where possible

```js
async function loadClassAssignmentsFromCurrentState() {
  const { currentClassId, state, ui } = window.AppState;
  // service mutates state directly
}
```

The first shape is easier to test and safer for later extraction. `app.js` can still decide how to store the result.

## Candidate clusters in `app.js`

The exact function names should be verified in the extraction PR, but the remaining server/API responsibilities appear to group into these clusters.

### Cluster A — server mapping and payload builders

These are good early extraction targets because they are mostly pure transformations.

Likely candidates:

- `mapServerAssignment(...)`
- `mapServerSubmission(...)`
- `mapServerProfile(...)` / profile mapping helpers if present
- `buildSubmissionServerPayload(...)`
- assignment payload builders
- teacher review payload builders

Recommended PR:

```text
Phase 16a: create api-service.js and move pure server mapping / payload helpers
```

Risk: low to medium.

Expected benefit: service file created, future network extraction becomes easier.

### Cluster B — assignment API calls

Likely candidates:

- load assignments for a class
- create/save assignment
- update assignment
- publish assignment
- delete assignment
- reload teacher assignment tray

Recommended PR:

```text
Phase 16b: move assignment fetch/save/publish/delete calls into ApiService
```

Risk: medium.

Manual checks:

- Teacher can create an assignment with AI-assisted setup.
- Teacher can save a manual assignment if supported by current UI.
- Teacher can publish an assignment.
- Teacher assignment tray refreshes after save/publish.

### Cluster C — submission API calls

Likely candidates:

- load student submission for assignment
- load teacher submissions for assignment(s)
- save draft/final submission
- submit assignment
- reopen submission if API call exists
- merge/replace submission result after server response

Recommended PR:

```text
Phase 16c: move submission load/save/submit calls into ApiService
```

Risk: medium-high because this touches student work preservation.

Manual checks:

- Student draft saves.
- Student final text saves.
- Student submit still works.
- Failed submit does not show false success.
- Teacher sees submitted work after refresh.

Automated tests to prefer before/after this PR:

- student opens assignment
- student draft/final flow
- teacher review list sees submitted work

### Cluster D — teacher review / grading API calls

Likely candidates:

- load review data for assignment
- save teacher review
- submit grade
- patch `teacher_review`
- mark late/missing if present
- reopen/clear review if present

Recommended PR:

```text
Phase 16d: move teacher-review sync calls into ApiService
```

Risk: medium-high because grading state is sensitive.

Manual checks:

- Teacher opens review list.
- Teacher opens grading view.
- Teacher saves a grade.
- Suggested grade can still be accepted and submitted.
- Reopen/late/missing flows still work if present.

### Cluster E — admin API calls

Likely candidates:

- load admin teacher list
- load admin class detail
- recompute writing-process analytics
- toggle test-student flag
- refresh admin class detail

Recommended PR:

```text
Phase 16e: move admin API calls into ApiService
```

Risk: medium.

Manual checks:

- Admin teacher list loads.
- Admin class detail loads.
- Test-account flag toggles.
- Process analytics refresh status still renders.

### Cluster F — email/debug/status API calls

This should be last because it is peripheral and easy to break accidentally.

Likely candidates:

- publish email debug helpers
- email debug status loaders
- submission debug loaders
- any diagnostic-only fetches

Recommended PR:

```text
Phase 16f: move debug/email helper API calls into ApiService
```

Risk: low to medium.

## Recommended Phase 16 PR order

### PR 16a — Service shell + pure mapping helpers

Create `api-service.js`, expose `window.ApiService`, move pure mapping/payload functions only.

Why first:

- Lowest behavioural risk.
- Creates the service namespace.
- Makes the next PRs smaller.

### PR 16b — Assignment API calls

Move teacher assignment load/save/publish/delete server calls.

Why second:

- High impact.
- Well-covered by teacher smoke tests.
- Less risky than student submission preservation.

### PR 16c — Submission API calls

Move student submission load/save/submit calls.

Why third:

- High impact but higher risk.
- Should be done after `ApiService` pattern is established.

### PR 16d — Teacher review / grading API calls

Move grading/review sync calls.

Why fourth:

- Important, but should follow submission extraction because grading depends on submissions.

### PR 16e — Admin API calls

Move admin-only API calls.

Why fifth:

- Admin is important but less central to student/teacher core flows.

### PR 16f — Debug/email helpers

Move peripheral diagnostic calls.

Why last:

- Lower product impact.
- Easier after core API shape is stable.

## What should stay in `app.js` for now

Do not move these in Phase 16 unless a function is inseparable from the API call being moved:

- event handlers (`handleClick`, `handleInput`, `handleChange`, etc.)
- render orchestration
- UI flags and loading state
- selected IDs and active role/class/profile state
- AI prompt/request logic
- writing-event/session tracking
- annotation interaction handlers

These belong to later phases.

## Test strategy

The GitHub workflow already runs smoke tests after pushes to `main`. For each extraction PR, keep the manual checklist targeted to the moved cluster.

Minimum checks per PR:

- Syntax review for changed JS files.
- No unrelated UI changes.
- No endpoint path changes unless explicitly documented.
- Existing auth/teacher/student smoke tests should remain green after merge.

Suggested manual checks by phase:

- 16a: page loads, no console errors.
- 16b: teacher create/save/publish assignment.
- 16c: student draft save, final save, submit.
- 16d: teacher review/grading save.
- 16e: admin teacher/class detail load.
- 16f: debug/email panels still render when enabled.

## Completion criteria

Phase 16 is complete when:

- server/API calls are no longer scattered through `app.js`;
- `app.js` calls `window.ApiService.*` for network work;
- service functions do not own UI state or rendering;
- assignment, submission, review, and admin flows still pass smoke/manual checks;
- later AI/event-handler extraction can call a stable API boundary.

## Expected result

This should remove a meaningful chunk from `app.js`, but the larger win is architectural:

```text
app.js = UI orchestration + state + event dispatch
api-service.js = server communication + server payload mapping
```

That separation should make Phase 17 AI extraction and Phase 19 event-handler extraction much safer.
