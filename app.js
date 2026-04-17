const STORAGE_KEY = "process-writing-assistant-v2";
const LARGE_PASTE_LIMIT = 220;

const ui = {
  role: "teacher",
  activeUserId: "teacher-1",
  teacherDraft: null,
  teacherAssist: null,
  selectedAssignmentId: null,
  selectedStudentAssignmentId: null,
  selectedReviewSubmissionId: null,
  activeFocusIdeaId: "",
  studentStep: 1,
  playback: {
    isPlaying: false,
    speed: 1,
    index: 0,
    timerId: null,
  },
  pendingPaste: null,
  notice: "",
  expandedContextCol: null,
};

let state = loadState();
let appEl = null;

document.addEventListener("DOMContentLoaded", () => {
  appEl = document.getElementById("app");
  ui.teacherDraft = createBlankTeacherDraft();
  hydrateSelections();
  bindEvents();
  render();
});

function bindEvents() {
  appEl.addEventListener("click", handleClick);
  appEl.addEventListener("change", handleChange);
  appEl.addEventListener("input", handleInput);
  appEl.addEventListener("paste", handlePaste, true);
}

function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;

 if (action === "generate-teacher-assist") {
    ui.notice = "AI is thinking...";
    render();

    // Try reaching the API at the same domain (relative path)
    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: `Create a student-ready writing assignment based on these notes: "${ui.teacherDraft.brief}". 
        Provide the output as a valid JSON object with the following keys: "title", "prompt", "assignmentType", "wordCountMin", "wordCountMax", "studentFocus" (as an array), and "rubric" (as an array of objects with "name", "description", and "points").` 
      })
    })
    .then(res => {
        if (!res.ok) throw new Error("Server returned " + res.status);
        return res.json();
    })
    .then(data => {
      let jsonStr = data.response.replace(/```json\n?|\n?```/g, "").trim();
      ui.teacherAssist = JSON.parse(jsonStr);
      ui.notice = "Assignment generated successfully!";
      render();
    })
    .catch(err => {
      console.error("Fetch Error:", err);
      ui.notice = "Error: Could not reach the AI. Check console.";
      render();
    });
    return;
  }

  if (action === "expand-context-col") {
    const col = target.dataset.col;
    ui.expandedContextCol = col || null;
    render();
    if (ui.expandedContextCol) {
      document.querySelector(".context-expanded-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }

  if (action === "save-draft") {
    persistState();
    ui.notice = "Draft saved.";
    render();
    return;
  }

  if (action === "reset-app") {
    stopPlayback();
    state = createBlankState();
    ui.teacherDraft = createBlankTeacherDraft();
    ui.teacherAssist = null;
    ui.notice = "Workspace cleared. Ready for a fresh pilot.";
    hydrateSelections();
    persistState();
    render();
    return;
  }

  if (action === "generate-teacher-assist") {
    ui.teacherAssist = generateTeacherAssist(ui.teacherDraft);
    ui.notice = "Your assignment has been turned into a student-ready version with a suggested rubric.";
    render();
    return;
  }

  if (action === "use-generated-assignment" && ui.teacherAssist) {
    applyTeacherAssistToDraft();
    ui.notice = "Generated assignment details copied into the draft.";
    render();
    return;
  }

  if (action === "save-assignment") {
    saveTeacherAssignment();
    return;
  }

  if (action === "delete-assignment") {
    const assignmentId = target.dataset.assignmentId;
    if (!confirm("Delete this assignment? This cannot be undone.")) return;
    state.assignments = state.assignments.filter((a) => a.id !== assignmentId);
    state.submissions = state.submissions.filter((s) => s.assignmentId !== assignmentId);
    if (ui.selectedAssignmentId === assignmentId) ui.selectedAssignmentId = state.assignments[0]?.id || null;
    if (ui.selectedStudentAssignmentId === assignmentId) ui.selectedStudentAssignmentId = state.assignments[0]?.id || null;
    ui.selectedReviewSubmissionId = null;
    ui.notice = "Assignment deleted.";
    persistState();
    render();
    return;
  }

  if (action === "select-assignment") {
    stopPlayback();
    ui.selectedAssignmentId = target.dataset.assignmentId;
    ui.selectedReviewSubmissionId = getAssignmentSubmissions(ui.selectedAssignmentId)[0]?.id || null;
    ui.notice = "Assignment opened in the review area.";
    render();
    return;
  }

  if (action === "student-next-step") {
    const nextStep = Number(target.dataset.step);
    if (canAdvanceToStep(nextStep)) {
      ui.studentStep = nextStep;
      ui.notice = "";
    } else {
      render();
    }
    render();
    return;
  }

  if (action === "student-prev-step") {
    ui.studentStep = Number(target.dataset.step);
    ui.notice = "";
    render();
    return;
  }

  if (action === "request-ideas") {
    handleIdeaRequest();
    return;
  }

  if (action === "request-feedback") {
    handleFeedbackRequest();
    return;
  }

  if (action === "submit-final") {
    handleSubmission();
    return;
  }

  if (action === "inspect-submission") {
    stopPlayback();
    ui.selectedReviewSubmissionId = target.dataset.submissionId;
    ui.playback.index = 0;
    ui.notice = "Student writing process opened.";
    render();
    return;
  }

  if (action === "playback-toggle") {
    const submission = getSelectedReviewSubmission();
    const frames = submission ? getPlaybackFrames(submission) : [];
    if (!frames.length) {
      return;
    }

    if (ui.playback.isPlaying) {
      stopPlayback();
    } else {
      startPlayback(frames);
    }
    render();
    return;
  }

  if (action === "playback-step") {
    const direction = Number(target.dataset.direction);
    stepPlayback(direction);
    render();
    return;
  }

  if (action === "generate-grade") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) {
      return;
    }

    submission.teacherReview = submission.teacherReview || {};
    submission.teacherReview.suggestedGrade = gradeSubmission(assignment, submission);
    ui.notice = "Suggested grading is ready to review.";
    persistState();
    render();
    return;
  }

  if (action === "accept-suggested-grade") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.suggestedGrade) {
      return;
    }

    submission.teacherReview.finalScore = submission.teacherReview.suggestedGrade.totalScore;
    submission.teacherReview.finalNotes = submission.teacherReview.suggestedGrade.justification;
    submission.teacherReview.acceptedAt = new Date().toISOString();
    ui.notice = "Suggested grade copied into the editable review.";
    persistState();
    render();
    return;
  }

  if (action === "ignore-suggested-grade") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview) {
      return;
    }

    submission.teacherReview.suggestedGrade = null;
    ui.notice = "Suggested grade cleared.";
    persistState();
    render();
    return;
  }

  if (action === "save-teacher-review") {
    const submission = getSelectedReviewSubmission();
    if (!submission) {
      return;
    }

    submission.teacherReview = submission.teacherReview || {};
    const scoreInput = document.getElementById("teacher-review-score");
    const notesInput = document.getElementById("teacher-review-notes");
    submission.teacherReview.finalScore = Number(scoreInput.value || 0);
    submission.teacherReview.finalNotes = notesInput.value.trim();
    submission.teacherReview.savedAt = new Date().toISOString();
    ui.notice = "Teacher review saved.";
    persistState();
    render();
    return;
  }

  if (action === "add-focus-note") {
    const submission = getStudentSubmission();
    if (!submission || !ui.activeFocusIdeaId) {
      ui.notice = "Choose one of your ideas first, then tag the paragraph you are working on.";
      render();
      return;
    }

    const idea = submission.ideaResponses.find((entry) => entry.id === ui.activeFocusIdeaId);
    submission.focusAnnotations.push({
      id: uid("focus"),
      timestamp: new Date().toISOString(),
      label: idea?.rewrittenIdea?.trim() || "Writing focus",
    });
    ui.notice = "Writing focus saved.";
    persistState();
    render();
  }
}

function handleChange(event) {
  const target = event.target;

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.value;
    return;
  }

  if (target.id === "role-select") {
    stopPlayback();
    ui.role = target.value;
    ui.activeUserId = ui.role === "teacher" ? "teacher-1" : getStudentUsers()[0]?.id || "";
    hydrateSelections();
    render();
    return;
  }

  if (target.id === "user-select") {
    ui.activeUserId = target.value;
    hydrateSelections();
    render();
    return;
  }

  if (target.id === "student-assignment-select") {
    ui.selectedStudentAssignmentId = target.value;
    ui.studentStep = 1;
    ensureStudentSubmission();
    render();
    return;
  }

  if (target.id === "review-submission-select") {
    stopPlayback();
    ui.selectedReviewSubmissionId = target.value;
    ui.playback.index = 0;
    render();
    return;
  }

  if (target.id === "playback-speed") {
    ui.playback.speed = Number(target.value);
    if (ui.playback.isPlaying) {
      const submission = getSelectedReviewSubmission();
      const frames = submission ? getPlaybackFrames(submission) : [];
      stopPlayback();
      startPlayback(frames);
    }
    render();
    return;
  }

  if (target.id === "playback-slider") {
    ui.playback.index = Number(target.value);
    renderPlaybackScreenOnly();
    return;
  }

  if (target.id === "focus-idea-select") {
    ui.activeFocusIdeaId = target.value;
    return;
  }
}

function handleInput(event) {
  const target = event.target;

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.value;
    return;
  }

  if (target.dataset.ideaField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    const idea = submission.ideaResponses.find((entry) => entry.id === target.dataset.ideaId);
    if (!idea) {
      return;
    }

    idea[target.dataset.ideaField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    return;
  }

  if (target.id === "draft-editor") {
    updateDraftSubmission(target.value);
    updateDraftMeters();
    return;
  }

  if (target.id === "final-editor") {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    submission.finalText = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    updateFinalMeters();
    return;
  }

  if (target.dataset.reflectionField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    submission.reflections[target.dataset.reflectionField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    return;
  }

  if (target.dataset.outlineField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    submission.outline[target.dataset.outlineField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    return;
  }
}

function handlePaste(event) {
  if (event.target.id !== "draft-editor") {
    return;
  }

  const pasted = event.clipboardData?.getData("text") || "";
  ui.pendingPaste = {
    content: pasted,
    timestamp: Date.now(),
  };
}

function render() {
  appEl.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
      ${ui.role === "teacher" ? renderTeacherWorkspace() : renderStudentWorkspace()}
    </div>
  `;
}

function renderTopbar() {
  const studentOptions = getStudentUsers()
    .map(
      (user) => `<option value="${user.id}" ${ui.activeUserId === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`
    )
    .join("");

  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">PW</div>
        <div>
          <h1>Process Writing Assistant</h1>
          <p>Visible writing steps for teachers and students.</p>
        </div>
      </div>
      <div class="toolbar">
        <select id="role-select" aria-label="Select workspace">
          <option value="teacher" ${ui.role === "teacher" ? "selected" : ""}>Teacher</option>
          <option value="student" ${ui.role === "student" ? "selected" : ""}>Student</option>
        </select>
        ${
          ui.role === "student"
            ? `<select id="user-select" aria-label="Select student">${studentOptions}</select>`
            : ""
        }
        <button class="button-secondary" data-action="load-demo">Reload Demo</button>
        <button class="button-ghost" data-action="reset-app">Reset Empty</button>
      </div>
    </header>
  `;
}

function renderHero() {
  return `
    <section class="hero hero-simple">
      <div class="hero-card">
        <div class="pill-row">
          <span class="pill">Simple teacher setup</span>
          <span class="pill">Student steps one at a time</span>
          <span class="pill">Letter-by-letter playback</span>
        </div>
        <h2>Build the task quickly. Guide the student clearly. Review the real writing process.</h2>
        <p class="subtle">This version keeps the teacher side lighter and turns the student side into a step-by-step path instead of one long page.</p>
      </div>
    </section>
  `;
}

function renderTeacherWorkspace() {
  const assignments = getAssignments();
  const selectedAssignment = getSelectedAssignment();
  const submissions = selectedAssignment ? getAssignmentSubmissions(selectedAssignment.id) : [];
  const selectedSubmission = getSelectedReviewSubmission();

  return `
    <section class="teacher-grid">
      <div class="panel panel-tight">
        <div class="panel-header">
          <div>
            <p class="mini-label">Teacher Setup</p>
            <h2 class="panel-title">Describe the assignment in plain English</h2>
          </div>
          <div class="toolbar">
            <button class="button-secondary" data-action="generate-teacher-assist">Format With AI</button>
            <button class="button" data-action="save-assignment" ${!ui.teacherDraft.title || !ui.teacherDraft.prompt ? "disabled title='Generate and apply the AI draft first'" : ""}>Save</button>
          </div>
        </div>
        <div class="field-stack">
          <div class="field">
            <label for="teacher-brief">Teacher brief</label>
            <textarea id="teacher-brief" data-teacher-field="brief" class="teacher-brief" placeholder="Example: My 7th grade students need a short opinion paragraph about whether school uniforms help learning. Keep the language simple, ask for one real example, and aim for 250 to 350 words. Give them 2 idea helps and 2 feedback checks.">${escapeHtml(ui.teacherDraft.brief)}</textarea>
          </div>
          <div class="field-grid compact-grid">
            <div class="field">
              <label for="teacher-idea-limit">Idea helps</label>
              <input id="teacher-idea-limit" data-teacher-field="ideaRequestLimit" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.ideaRequestLimit))}" />
            </div>
            <div class="field">
              <label for="teacher-feedback-limit">Feedback checks</label>
              <input id="teacher-feedback-limit" data-teacher-field="feedbackRequestLimit" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.feedbackRequestLimit))}" />
            </div>
            <div class="field">
              <label for="teacher-language-level">Student language level</label>
              <select id="teacher-language-level" data-teacher-field="languageLevel">
                ${["A0", "A1", "A2", "B1", "B2", "C1", "C2"].map((level) => `<option value="${level}" ${ui.teacherDraft.languageLevel === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>
        ${
          ui.teacherAssist
            ? `
              <div class="teacher-output">
                <div class="section-header">
                  <div>
                    <p class="mini-label">AI Draft</p>
                    <h2 class="panel-title">${escapeHtml(ui.teacherAssist.title)}</h2>
                  </div>
                  <button class="button-secondary" data-action="use-generated-assignment">Use This Version</button>
                </div>
                <div class="teacher-ready-card">
                  <p class="mini-label">Student instructions</p>
                  <p><strong>Task:</strong> ${escapeHtml(ui.teacherAssist.prompt)}</p>
                  <p><strong>Word target:</strong> ${ui.teacherAssist.wordCountMin}-${ui.teacherAssist.wordCountMax} words</p>
                  <p><strong>Assignment type:</strong> ${escapeHtml(titleCase(ui.teacherAssist.assignmentType))}</p>
                </div>
                <div class="teacher-ready-card">
                  <p class="mini-label">Student focus</p>
                  <ul class="focus-list">${ui.teacherAssist.studentFocus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                </div>
                <div class="teacher-ready-card">
                  <p class="mini-label">Suggested rubric</p>
                  <div class="review-stack">
                    ${ui.teacherAssist.rubric.map((item) => `
                      <div class="rubric-score">
                        <div>
                          <strong>${escapeHtml(item.name)}</strong>
                          <p class="rubric-description">${escapeHtml(item.description)}</p>
                        </div>
                        <strong>${item.points}</strong>
                      </div>
                    `).join("")}
                  </div>
                </div>
              </div>
            `
            : `
              <div class="empty-state compact-empty">
                <h3>Start with the assignment idea</h3>
                <p>Write a plain-English overview, then let the tool turn it into a clean student-facing assignment and rubric.</p>
              </div>
            `
        }
      </div>

      <div class="panel panel-tight">
        <div class="panel-header">
          <div>
            <p class="mini-label">Teacher Review</p>
            <h2 class="panel-title">Assignments</h2>
          </div>
        </div>
        ${
          !assignments.length
            ? `<div class="empty-state compact-empty"><h3>No assignments yet</h3><p>Create one on the left or reload the demo to explore the review flow.</p></div>`
            : `
              <div class="assignment-list">
                ${assignments.map((assignment) => `
                  <div class="assignment-card simple-card">
                    <div class="card-top">
                      <div>
                        <h3>${escapeHtml(assignment.title)}</h3>
                        <p>${escapeHtml(assignment.prompt)}</p>
                      </div>
                      <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button class="button-ghost" data-action="select-assignment" data-assignment-id="${assignment.id}">Open</button>
                        <button class="button-ghost" data-action="delete-assignment" data-assignment-id="${assignment.id}" style="color:var(--danger);border-color:var(--danger);">Delete</button>
                      </div>
                    </div>
                    <div class="pill-row">
                      <span class="pill">${escapeHtml(titleCase(assignment.assignmentType || "writing"))}</span>
                      <span class="pill">${assignment.wordCountMin}-${assignment.wordCountMax} words</span>
                    </div>
                  </div>
                `).join("")}
              </div>
            `
        }
      </div>
    </section>
    ${selectedAssignment ? renderTeacherReview(selectedAssignment, submissions, selectedSubmission) : ""}
  `;
}

function renderTeacherReview(assignment, submissions, selectedSubmission) {
  const metrics = selectedSubmission ? computeProcessMetrics(assignment, selectedSubmission) : null;
  const playback = selectedSubmission ? getPlaybackState(selectedSubmission) : null;
  const reviewScore = selectedSubmission?.teacherReview?.finalScore ?? "";
  const reviewNotes = selectedSubmission?.teacherReview?.finalNotes ?? "";

  return `
    <section class="panel review-shell">
      <div class="review-header">
        <div>
          <p class="mini-label">Reviewing</p>
          <h2>${escapeHtml(assignment.title)}</h2>
          <p class="subtle">${escapeHtml(assignment.prompt)}</p>
        </div>
        <div class="toolbar">
          <select id="review-submission-select" aria-label="Choose student submission">
            ${submissions.map((submission) => {
              const student = getUserById(submission.studentId);
              return `<option value="${submission.id}" ${selectedSubmission?.id === submission.id ? "selected" : ""}>${escapeHtml(student?.name || "Student")} • ${escapeHtml(titleCase(submission.status))}</option>`;
            }).join("")}
          </select>
          <button class="button-secondary" data-action="generate-grade" ${selectedSubmission ? "" : "disabled"}>Suggest Grade</button>
        </div>
      </div>
      <div class="review-grid">
        <div class="review-card">
          <div class="section-header">
            <div>
              <h2 class="panel-title">Students</h2>
              <p class="subtle">Simple status view for a tired teacher.</p>
            </div>
          </div>
          <div class="student-list">
            ${getStudentUsers().map((student) => {
              const submission = submissions.find((entry) => entry.studentId === student.id);
              if (!submission) {
                return `
                  <div class="submission-card simple-card">
                    <div class="card-top">
                      <div>
                        <h3>${escapeHtml(student.name)}</h3>
                        <p>No writing yet.</p>
                      </div>
                      <span class="warning-pill">No work</span>
                    </div>
                  </div>
                `;
              }
              const studentMetrics = computeProcessMetrics(assignment, submission);
              return `
                <div class="submission-card simple-card">
                  <div class="card-top">
                    <div>
                      <h3>${escapeHtml(student.name)}</h3>
                      <div class="submission-status">
                        <span class="status-pill">${escapeHtml(titleCase(submission.status))}</span>
                        ${studentMetrics.largePasteCount ? `<span class="warning-pill">${studentMetrics.largePasteCount} paste flag${studentMetrics.largePasteCount === 1 ? "" : "s"}</span>` : ""}
                      </div>
                    </div>
                    <button class="button-ghost" data-action="inspect-submission" data-submission-id="${submission.id}">Inspect</button>
                  </div>
                  <div class="pill-row">
                    <span class="pill">${studentMetrics.totalMinutes} min</span>
                    <span class="pill">${studentMetrics.revisionCount} edits</span>
                    <span class="pill">${studentMetrics.finalWordCount} words</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
        <div class="review-stack">
          ${
            selectedSubmission && metrics && playback
              ? `
                <div class="review-card">
                  <div class="stats-grid compact-stats">
                    <div class="stat-card">
                      <span class="stat-label">Writing time</span>
                      <strong class="stat-value">${metrics.totalMinutes} min</strong>
                    </div>
                    <div class="stat-card">
                      <span class="stat-label">Tracked edits</span>
                      <strong class="stat-value">${metrics.revisionCount}</strong>
                    </div>
                    <div class="stat-card">
                      <span class="stat-label">Paste flags</span>
                      <strong class="stat-value">${metrics.largePasteCount}</strong>
                    </div>
                    <div class="stat-card">
                      <span class="stat-label">Draft to final</span>
                      <strong class="stat-value">${metrics.improvementLabel}</strong>
                    </div>
                  </div>
                </div>
                <div class="review-card">
                  <div class="section-header">
                    <div>
                      <h2 class="panel-title">Letter-by-letter playback</h2>
                      <p class="subtle">Watch the writing appear, disappear, and change one character at a time.</p>
                    </div>
                    <div class="toolbar">
                      <button class="button-ghost" data-action="playback-step" data-direction="-1">Back</button>
                      <button class="button" data-action="playback-toggle">${ui.playback.isPlaying ? "Pause" : "Play"}</button>
                      <button class="button-ghost" data-action="playback-step" data-direction="1">Next</button>
                    </div>
                  </div>
                  <div class="playback-controls">
                    <input class="slider" id="playback-slider" type="range" min="0" max="${Math.max(playback.frames.length - 1, 0)}" value="${playback.index}" />
                    <div class="toolbar">
                      <span class="pill" id="playback-meta">Frame ${playback.index + 1} of ${Math.max(playback.frames.length, 1)}</span>
                      <span class="pill" id="playback-label">${escapeHtml(playback.label)}</span>
                      <select id="playback-speed" aria-label="Playback speed">
                        ${[1, 2, 5, 10, 20].map((speed) => `<option value="${speed}" ${ui.playback.speed === speed ? "selected" : ""}>${speed}x</option>`).join("")}
                      </select>
                    </div>
                  </div>
                  <div class="playback-screen" id="playback-screen"><pre>${escapeHtml(playback.text)}</pre></div>
                  <div class="timeline-list">
                    ${selectedSubmission.writingEvents.slice().reverse().slice(0, 8).map((entry) => `
                      <div class="timeline-card">
                        <strong>${escapeHtml(titleCase(entry.type))}</strong>
                        <p>${escapeHtml(renderEventSummary(entry))}</p>
                      </div>
                    `).join("")}
                  </div>
                </div>
                <div class="review-card">
                  <div class="section-header">
                    <div>
                      <h2 class="panel-title">Writing context</h2>
                      <p class="subtle">Ideas, draft, and final writing in one place.</p>
                    </div>
                  </div>
                  <div class="compare-grid">
                    <div class="compare-column">
                      <div class="compare-col-header">
                        <p class="mini-label">Ideas</p>
                        <button class="context-expand-btn" data-action="expand-context-col" data-col="ideas">⤢ Expand</button>
                      </div>
                      <div class="context-snippet">
                        ${
                          selectedSubmission.ideaResponses.length
                            ? `<ul class="focus-list">${selectedSubmission.ideaResponses.flatMap((idea) => idea.aiBullets).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                            : `<p class="subtle">No idea help used.</p>`
                        }
                      </div>
                    </div>
                    <div class="compare-column">
                      <div class="compare-col-header">
                        <p class="mini-label">Draft</p>
                        <button class="context-expand-btn" data-action="expand-context-col" data-col="draft">⤢ Expand</button>
                      </div>
                      <div class="context-snippet">
                        <p class="subtle-clamp">${escapeHtml(selectedSubmission.draftText || "No draft yet.")}</p>
                      </div>
                    </div>
                    <div class="compare-column">
                      <div class="compare-col-header">
                        <p class="mini-label">Final</p>
                        <button class="context-expand-btn" data-action="expand-context-col" data-col="final">⤢ Expand</button>
                      </div>
                      <div class="context-snippet">
                        <p class="subtle-clamp">${escapeHtml(selectedSubmission.finalText || "No final yet.")}</p>
                      </div>
                    </div>
                  </div>
                  ${ui.expandedContextCol ? `
                    <div class="context-expanded-panel">
                      <div class="context-expanded-header">
                        <strong>${ui.expandedContextCol === "ideas" ? "Ideas" : ui.expandedContextCol === "draft" ? "Draft" : "Final"}</strong>
                        <button class="context-expand-btn" data-action="expand-context-col" data-col="">✕ Close</button>
                      </div>
                      ${ui.expandedContextCol === "ideas" ? `
                        ${selectedSubmission.ideaResponses.length
                          ? selectedSubmission.ideaResponses.map((idea) => `
                              <div style="margin-bottom:18px;">
                                <ul class="focus-list">${idea.aiBullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                                <p style="margin-top:10px;"><strong>In my own words:</strong> ${escapeHtml(idea.rewrittenIdea || "Not answered yet")}</p>
                                <p><strong>I chose it because:</strong> ${escapeHtml(idea.whyChosen || "Not answered yet")}</p>
                              </div>`).join("")
                          : `<p class="subtle">No idea help used.</p>`}
                      ` : ui.expandedContextCol === "draft" ? `
                        <pre class="context-expanded-text">${escapeHtml(selectedSubmission.draftText || "No draft yet.")}</pre>
                      ` : `
                        <pre class="context-expanded-text">${escapeHtml(selectedSubmission.finalText || "No final yet.")}</pre>
                        <div class="muted-block" style="margin-top:14px;">
                          <strong>Outline plan:</strong> ${escapeHtml(renderOutlineSummary(assignment, selectedSubmission))}
                        </div>
                        <div class="muted-block" style="margin-top:10px;">
                          <strong>What I improved:</strong> ${escapeHtml(selectedSubmission.reflections.improved || "Not answered")}
                        </div>
                      `}
                    </div>
                  ` : ""}
                </div>
                <div class="review-card">
                  <div class="section-header">
                    <div>
                      <h2 class="panel-title">Suggested rubric score</h2>
                      <p class="subtle">Teacher remains in control.</p>
                    </div>
                  </div>
                  ${
                    selectedSubmission.teacherReview?.suggestedGrade
                      ? `
                        <div class="review-stack">
                          ${selectedSubmission.teacherReview.suggestedGrade.criteria.map((criterion) => `
                            <div class="rubric-score">
                              <div>
                                <strong>${escapeHtml(criterion.name)}</strong>
                                <p class="rubric-description">${escapeHtml(criterion.reason)}</p>
                              </div>
                              <strong>${criterion.score}/${criterion.points}</strong>
                            </div>
                          `).join("")}
                          <div class="muted-block">
                            <strong>Total:</strong> ${selectedSubmission.teacherReview.suggestedGrade.totalScore}/${selectedSubmission.teacherReview.suggestedGrade.maxScore}
                            <p style="margin-top:10px;">${escapeHtml(selectedSubmission.teacherReview.suggestedGrade.justification)}</p>
                          </div>
                          <div class="toolbar">
                            <button class="button-secondary" data-action="accept-suggested-grade">Use Suggested Score</button>
                            <button class="button-ghost" data-action="ignore-suggested-grade">Ignore</button>
                          </div>
                        </div>
                      `
                      : `<div class="empty-state compact-empty"><h3>No suggestion yet</h3><p>Click "Suggest Grade" for a rubric-based starting point.</p></div>`
                  }
                  <div class="review-edit" style="margin-top:18px;">
                    <div class="field">
                      <label for="teacher-review-score">Teacher score</label>
                      <input id="teacher-review-score" type="number" min="0" value="${escapeAttribute(String(reviewScore))}" />
                    </div>
                    <div class="field">
                      <label for="teacher-review-notes">Teacher notes</label>
                      <textarea id="teacher-review-notes">${escapeHtml(reviewNotes)}</textarea>
                    </div>
                    <button class="button" data-action="save-teacher-review">Save Review</button>
                  </div>
                </div>
              `
              : `<div class="empty-state"><h3>No submission selected</h3><p>Choose a student to inspect the writing process.</p></div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderStudentWorkspace() {
  const assignments = getAssignments();
  const student = getUserById(ui.activeUserId);
  const submission = getStudentSubmission();
  const assignment = getStudentAssignment();

  return `
    <section class="student-shell">
      <div class="panel student-panel">
        <div class="panel-header">
          <div>
            <p class="mini-label">Student View</p>
            <h2 class="panel-title">${escapeHtml(student?.name || "Student")} Writing Steps</h2>
          </div>
        </div>
        <div class="field">
          <label for="student-assignment-select">Choose assignment</label>
          <select id="student-assignment-select" aria-label="Select assignment">
            ${assignments.map((item) => `<option value="${item.id}" ${ui.selectedStudentAssignmentId === item.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}
          </select>
        </div>
        ${
          !assignment || !submission
            ? `<div class="empty-state"><h3>No assignment yet</h3><p>Switch to Teacher and create one first.</p></div>`
            : `
              <div class="student-progress">
                ${[1, 2, 3].map((step) => `
                  <div class="progress-step ${ui.studentStep === step ? "active" : ui.studentStep > step ? "done" : ""}">
                    <span>${step}</span>
                    <strong>${step === 1 ? "Get ideas" : step === 2 ? "Write draft" : "Finish and submit"}</strong>
                  </div>
                `).join("")}
              </div>
              <div class="student-card">
                <p class="mini-label">Your task</p>
                <h3>${escapeHtml(assignment.title)}</h3>
                <p class="student-task">${escapeHtml(assignment.prompt)}</p>
                <div class="pill-row">
                  <span class="pill">${assignment.wordCountMin}-${assignment.wordCountMax} words</span>
                  <span class="pill">${submission.ideaResponses.length}/${assignment.ideaRequestLimit} idea helps</span>
                  <span class="pill">${submission.feedbackHistory.length}/${assignment.feedbackRequestLimit} feedback checks</span>
                </div>
              </div>
              ${renderStudentStep(assignment, submission)}
            `
        }
      </div>
    </section>
  `;
}

function renderStudentStep(assignment, submission) {
  if (ui.studentStep === 1) {
    return renderStudentIdeasStep(assignment, submission);
  }

  if (ui.studentStep === 2) {
    return renderStudentDraftStep(assignment, submission);
  }

  return renderStudentFinalStep(assignment, submission);
}

function renderStudentIdeasStep(assignment, submission) {
  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">1</div>
          <h3>Get ideas</h3>
          <p class="subtle">Ask for short idea bullets. Then choose one and put it into your own words.</p>
        </div>
        <button class="button-secondary" data-action="request-ideas" ${submission.ideaResponses.length >= assignment.ideaRequestLimit ? "disabled" : ""}>Get Idea Help</button>
      </div>
      <div class="teacher-ready-card">
        <p class="mini-label">What to focus on</p>
        <ul class="focus-list">${assignment.studentFocus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="idea-list">
        ${
          submission.ideaResponses.length
            ? submission.ideaResponses.map((idea) => `
              <div class="idea-card">
                <ul>${idea.aiBullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                <div class="field-stack" style="margin-top:12px;">
                  <div class="field">
                    <label>Write one idea in your own words</label>
                    <textarea data-idea-field="rewrittenIdea" data-idea-id="${idea.id}" placeholder="My idea is...">${escapeHtml(idea.rewrittenIdea)}</textarea>
                  </div>
                  <div class="field">
                    <label>Why do you want to use this idea?</label>
                    <textarea data-idea-field="whyChosen" data-idea-id="${idea.id}" placeholder="I want to use it because...">${escapeHtml(idea.whyChosen)}</textarea>
                  </div>
                </div>
              </div>
            `).join("")
            : `<div class="empty-state compact-empty"><h3>No ideas yet</h3><p>Click "Get Idea Help" to start.</p></div>`
        }
      </div>
      <div class="wizard-nav">
        <span></span>
        <button class="button" data-action="student-next-step" data-step="2">Next: Write Draft</button>
      </div>
    </div>
  `;
}

function renderStudentDraftStep(assignment, submission) {
  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">2</div>
          <h3>Write your draft</h3>
          <p class="subtle">Write in your own words. The tool keeps track of your writing process while you work.</p>
        </div>
      </div>
      <div class="field-grid compact-grid">
        <div class="field inline-end">
          <button class="button-ghost" data-action="save-draft">Save Draft</button>
        </div>
        <div class="field inline-end">
          <button class="button-secondary" data-action="request-feedback" ${submission.feedbackHistory.length >= assignment.feedbackRequestLimit ? "disabled" : ""}>Check My Draft</button>
        </div>
      </div>
      <textarea id="draft-editor" class="draft-editor" placeholder="Start your draft here.">${escapeHtml(submission.draftText)}</textarea>
      <div class="pill-row">
        <span class="pill">Words: <strong id="draft-word-count">${wordCount(submission.draftText)}</strong></span>
        <span class="pill">Tracked edits: <strong id="draft-event-count">${submission.writingEvents.length}</strong></span>
      </div>
      <div class="feedback-list">
        ${
          submission.feedbackHistory.length
            ? submission.feedbackHistory.slice().reverse().map((entry) => `
              <div class="feedback-card">
                <strong>${escapeHtml(formatDateTime(entry.timestamp))}</strong>
                <ul>${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
            `).join("")
            : `<div class="empty-state compact-empty"><h3>No draft check yet</h3><p>When you click "Check My Draft," you will get short questions and reminders, not rewritten text.</p></div>`
        }
      </div>
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="1">Back</button>
        <button class="button" data-action="student-next-step" data-step="3">Next: Finish</button>
      </div>
    </div>
  `;
}

function renderStudentFinalStep(assignment, submission) {
  const outline = getOutlineConfig(assignment, submission);
  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">3</div>
          <h3>Plan, revise, and submit</h3>
          <p class="subtle">Use the guided outline to shape your final piece, then explain what you improved.</p>
        </div>
        <button class="button" data-action="submit-final" ${submission.status === "submitted" ? "disabled" : ""}>Submit Final</button>
      </div>
      ${submission.status === "submitted" ? `
        <div class="submitted-banner">
          <div class="submitted-icon">✓</div>
          <div>
            <strong>Submitted!</strong>
            <p>Your work was handed in on ${escapeHtml(formatDateTime(submission.submittedAt))}. Your teacher will review it soon.</p>
          </div>
        </div>
      ` : ""}
      <div class="teacher-ready-card">
        <p class="mini-label">Guided outline</p>
        <div class="field-stack">
          ${outline.fields.map((field) => `
            <div class="field">
              <label>${escapeHtml(field.label)}</label>
              <textarea class="reflection-input" data-outline-field="${field.key}" placeholder="${escapeAttribute(field.placeholder)}">${escapeHtml(submission.outline[field.key] || "")}</textarea>
            </div>
          `).join("")}
        </div>
      </div>
      <textarea id="final-editor" class="final-editor" placeholder="Revise your draft into your final writing.">${escapeHtml(submission.finalText || submission.draftText)}</textarea>
      <div class="pill-row">
        <span class="pill">Final words: <strong id="final-word-count">${wordCount(submission.finalText || submission.draftText)}</strong></span>
        <span class="pill">Status: ${escapeHtml(titleCase(submission.status))}</span>
      </div>
      <div class="field-stack">
        <div class="field">
          <label>What did you make better?</label>
          <textarea class="reflection-input" data-reflection-field="improved" placeholder="I made my writing better by...">${escapeHtml(submission.reflections.improved)}</textarea>
        </div>
      </div>
      <div class="teacher-ready-card">
        <p class="mini-label">Rubric</p>
        <div class="review-stack">
          ${assignment.rubric.map((item) => `
            <div class="rubric-score">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <p class="rubric-description">${escapeHtml(item.description)}</p>
              </div>
              <strong>${item.points}</strong>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="2">Back</button>
        <span></span>
      </div>
    </div>
  `;
}

function canAdvanceToStep(nextStep) {
  const submission = getStudentSubmission();
  if (!submission) {
    return false;
  }

  if (nextStep === 2) {
    const hasIdea = submission.ideaResponses.some(
      (idea) => idea.rewrittenIdea.trim() && idea.whyChosen.trim()
    );
    if (!hasIdea) {
      ui.notice = "Before you move on, get at least one idea and answer both questions about it.";
      return false;
    }
  }

  if (nextStep === 3) {
    if (!submission.draftText.trim()) {
      ui.notice = "Write a draft before moving to the final step.";
      return false;
    }
  }

  return true;
}

function applyTeacherAssistToDraft() {
  ui.teacherDraft.title = ui.teacherAssist.title;
  ui.teacherDraft.prompt = ui.teacherAssist.prompt;
  ui.teacherDraft.focus = ui.teacherAssist.focus;
  ui.teacherDraft.assignmentType = ui.teacherAssist.assignmentType;
  ui.teacherDraft.wordCountMin = ui.teacherAssist.wordCountMin;
  ui.teacherDraft.wordCountMax = ui.teacherAssist.wordCountMax;
  ui.teacherDraft.studentFocus = ui.teacherAssist.studentFocus.join("\n");
  ui.teacherDraft.rubric = ui.teacherAssist.rubric.map((item) => ({ ...item }));
}

function saveTeacherAssignment() {
  const draft = normalizeTeacherDraft(ui.teacherDraft);
  if (!draft.title || !draft.prompt) {
    ui.notice = "Generate the student-ready assignment first, then save it.";
    render();
    return;
  }

  const assignment = {
    id: uid("assignment"),
    title: draft.title,
    prompt: draft.prompt,
    focus: draft.focus,
    brief: draft.brief,
    assignmentType: draft.assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: draft.wordCountMin,
    wordCountMax: draft.wordCountMax,
    ideaRequestLimit: draft.ideaRequestLimit,
    feedbackRequestLimit: draft.feedbackRequestLimit,
    studentFocus: splitLines(draft.studentFocus),
    rubric: draft.rubric.filter((item) => item.name.trim()),
    createdBy: "teacher-1",
    createdAt: new Date().toISOString(),
  };

  if (!assignment.rubric.length) {
    assignment.rubric = rubricForType(assignment.assignmentType);
  }

  state.assignments.unshift(assignment);
  ui.selectedAssignmentId = assignment.id;
  ui.selectedStudentAssignmentId = assignment.id;
  ui.selectedReviewSubmissionId = null;
  ui.teacherDraft = createBlankTeacherDraft();
  ui.teacherAssist = null;
  ui.notice = "Assignment saved and ready for students.";
  persistState();
  render();
}

function handleIdeaRequest() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission) {
    return;
  }

  if (submission.ideaResponses.length >= assignment.ideaRequestLimit) {
    ui.notice = "You have used all your idea help for this assignment.";
    render();
    return;
  }

  submission.ideaResponses.push({
    id: uid("idea"),
    requestedAt: new Date().toISOString(),
    aiBullets: generateStudentIdeas(assignment, submission),
    rewrittenIdea: "",
    whyChosen: "",
  });
  submission.updatedAt = new Date().toISOString();
  ui.notice = "Short ideas added. Now pick one and explain it in your own words.";
  persistState();
  render();
}

function handleFeedbackRequest() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission) {
    return;
  }

  if (submission.feedbackHistory.length >= assignment.feedbackRequestLimit) {
    ui.notice = "You have used all your draft checks for this assignment.";
    render();
    return;
  }

  submission.feedbackHistory.push({
    id: uid("feedback"),
    timestamp: new Date().toISOString(),
    items: generateFeedback(assignment, submission),
  });
  submission.updatedAt = new Date().toISOString();
  ui.notice = "Draft check added. Use it to improve your own writing.";
  persistState();
  render();
}

function handleSubmission() {
  const submission = getStudentSubmission();
  const assignment = getStudentAssignment();
  const finalEditor = document.getElementById("final-editor");
  if (!submission || !finalEditor || !assignment) {
    return;
  }

  const finalText = finalEditor.value.trim();
  const improved = submission.reflections.improved.trim();

  if (!finalText || !improved || !isOutlineComplete(submission, assignment)) {
    ui.notice = "Before you submit, finish your guided outline, final draft, and revision reflection.";
    render();
    return;
  }

  submission.finalText = finalText;
  submission.status = "submitted";
  submission.submittedAt = new Date().toISOString();
  submission.updatedAt = submission.submittedAt;
  ui.notice = "Final work submitted.";
  persistState();
  render();
}

function updateDraftSubmission(nextText) {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  const previousText = submission.draftText || "";
  const now = new Date().toISOString();
  const operation = getTextOperation(previousText, nextText);
  if (!operation) {
    return;
  }

  const type = determineEventType(operation);
  const pasteContent = ui.pendingPaste?.content || "";
  submission.draftText = nextText;
  submission.updatedAt = now;
  submission.startedAt = submission.startedAt || now;
  submission.lastEditedAt = now;
  submission.writingEvents.push({
    id: uid("event"),
    timestamp: now,
    type,
    start: operation.start,
    end: operation.end,
    removedText: operation.removedText,
    insertedText: operation.insertedText,
    delta: operation.insertedText.length - operation.removedText.length,
    flagged: type === "paste" && pasteContent.length >= LARGE_PASTE_LIMIT,
    preview: trimTo(operation.insertedText || operation.removedText || nextText.slice(-40), 80),
  });
  ui.pendingPaste = null;
  persistState();
}

function determineEventType(operation) {
  if (ui.pendingPaste && Date.now() - ui.pendingPaste.timestamp < 1200) {
    return "paste";
  }
  if (operation.insertedText && operation.removedText) {
    return "replace";
  }
  if (operation.insertedText) {
    return "insert";
  }
  return "delete";
}

function getTextOperation(previousText, nextText) {
  if (previousText === nextText) {
    return null;
  }

  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1;
  }

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    end: previousEnd,
    removedText: previousText.slice(start, previousEnd),
    insertedText: nextText.slice(start, nextEnd),
  };
}

function renderPlaybackScreenOnly() {
  const submission = getSelectedReviewSubmission();
  const playbackScreen = document.getElementById("playback-screen");
  if (!submission || !playbackScreen) {
    return;
  }

  const playback = getPlaybackState(submission);
  playbackScreen.innerHTML = `<pre>${escapeHtml(playback.text)}</pre>`;
}

function startPlayback(frames) {
  if (!frames.length) {
    return;
  }

  stopPlayback();
  ui.playback.isPlaying = true;
  ui.playback.timerId = window.setInterval(() => {
    if (ui.playback.index >= frames.length - 1) {
      stopPlayback();
      render();
      return;
    }
    ui.playback.index += 1;
    syncPlaybackUi();
  }, Math.max(900 / ui.playback.speed, 50));
}

function stopPlayback() {
  ui.playback.isPlaying = false;
  if (ui.playback.timerId) {
    window.clearInterval(ui.playback.timerId);
    ui.playback.timerId = null;
  }
}

function stepPlayback(direction) {
  const submission = getSelectedReviewSubmission();
  const frames = submission ? getPlaybackFrames(submission) : [];
  if (!frames.length) {
    return;
  }

  stopPlayback();
  ui.playback.index = clamp(ui.playback.index + direction, 0, frames.length - 1);
  syncPlaybackUi();
}

function syncPlaybackUi() {
  const submission = getSelectedReviewSubmission();
  if (!submission) {
    return;
  }

  const playback = getPlaybackState(submission);
  const slider = document.getElementById("playback-slider");
  if (slider) {
    slider.value = String(playback.index);
  }

  const playbackScreen = document.getElementById("playback-screen");
  if (playbackScreen) {
    playbackScreen.innerHTML = `<pre>${escapeHtml(playback.text)}</pre>`;
  }

  const playbackMeta = document.getElementById("playback-meta");
  if (playbackMeta) {
    playbackMeta.textContent = `Frame ${playback.index + 1} of ${Math.max(playback.frames.length, 1)}`;
  }

  const playbackLabel = document.getElementById("playback-label");
  if (playbackLabel) {
    playbackLabel.textContent = playback.label;
  }
}

function updateDraftMeters() {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  updateTextContent("draft-word-count", String(wordCount(submission.draftText)));
  updateTextContent("draft-event-count", String(submission.writingEvents.length));
  updateTextContent(
    "draft-paste-count",
    String(submission.writingEvents.filter((entry) => entry.type === "paste" && entry.flagged).length)
  );
}

function updateFinalMeters() {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  updateTextContent("final-word-count", String(wordCount(submission.finalText || submission.draftText)));
}

function updateTextContent(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function getAssignments() {
  return state.assignments;
}

function getSelectedAssignment() {
  return state.assignments.find((assignment) => assignment.id === ui.selectedAssignmentId) || null;
}

function getStudentAssignment() {
  return state.assignments.find((assignment) => assignment.id === ui.selectedStudentAssignmentId) || null;
}

function getAssignmentSubmissions(assignmentId) {
  return state.submissions.filter((submission) => submission.assignmentId === assignmentId);
}

function getSelectedReviewSubmission() {
  return state.submissions.find((submission) => submission.id === ui.selectedReviewSubmissionId) || null;
}

function getStudentSubmission() {
  if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
    return null;
  }

  return state.submissions.find((submission) => submission.assignmentId === ui.selectedStudentAssignmentId && submission.studentId === ui.activeUserId) || null;
}

function ensureStudentSubmission() {
  const existing = getStudentSubmission();
  if (existing) {
    return existing;
  }

  if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
    return null;
  }

  const submission = createEmptySubmission(ui.selectedStudentAssignmentId, ui.activeUserId);
  state.submissions.push(submission);
  persistState();
  return submission;
}

function hydrateSelections() {
  if (!state.assignments.some((assignment) => assignment.id === ui.selectedAssignmentId)) {
    ui.selectedAssignmentId = state.assignments[0]?.id || null;
  }

  if (!state.assignments.some((assignment) => assignment.id === ui.selectedStudentAssignmentId)) {
    ui.selectedStudentAssignmentId = state.assignments[0]?.id || null;
  }

  ui.studentStep = clamp(ui.studentStep, 1, 3);
  ensureStudentSubmission();

  const assignmentSubmissionIds = new Set(
    getAssignmentSubmissions(ui.selectedAssignmentId).map((submission) => submission.id)
  );

  if (!assignmentSubmissionIds.has(ui.selectedReviewSubmissionId)) {
    ui.selectedReviewSubmissionId = getAssignmentSubmissions(ui.selectedAssignmentId)[0]?.id || null;
  }
}

function getPlaybackState(submission) {
  const frames = getPlaybackFrames(submission);
  const index = clamp(ui.playback.index, 0, Math.max(frames.length - 1, 0));
  ui.playback.index = index;
  const frame = frames[index] || { text: "", label: "No frames yet" };

  return {
    frames,
    index,
    text: frame.text,
    label: frame.label,
  };
}

function getPlaybackFrames(submission) {
  if (submission._playbackCache && submission._playbackCache.eventCount === safeArray(submission.writingEvents).length) {
    return submission._playbackCache.frames;
  }

  let text = "";
  const frames = [
    {
      text: "",
      label: "Start",
    },
  ];

  for (const event of safeArray(submission.writingEvents)) {
    const hasStructuredOp = typeof event.start === "number" && typeof event.end === "number";
    if (!hasStructuredOp) {
      text = submission.draftText || text;
      frames.push({
        text,
        label: `${titleCase(event.type)} • ${formatTime(event.timestamp)}`,
      });
      continue;
    }

    if (event.removedText) {
      for (let i = 0; i < event.removedText.length; i += 1) {
        const removeIndex = event.start;
        text = text.slice(0, removeIndex) + text.slice(removeIndex + 1);
        frames.push({
          text,
          label: `Delete • ${formatTime(event.timestamp)}`,
        });
      }
    }

    if (event.insertedText) {
      if (event.type === "paste") {
        text = text.slice(0, event.start) + event.insertedText + text.slice(event.start);
        frames.push({
          text,
          label: `Paste • ${formatTime(event.timestamp)}`,
        });
        continue;
      }

      for (let i = 0; i < event.insertedText.length; i += 1) {
        const char = event.insertedText[i];
        const insertIndex = event.start + i;
        text = text.slice(0, insertIndex) + char + text.slice(insertIndex);
        frames.push({
          text,
          label: `${titleCase(event.type)} • ${formatTime(event.timestamp)}`,
        });
      }
    }
  }

  if ((submission.draftText || "") !== text) {
    frames.push({
      text: submission.draftText || "",
      label: "Current draft",
    });
  }

  submission._playbackCache = {
    eventCount: safeArray(submission.writingEvents).length,
    frames,
  };
  return frames;
}

function computeProcessMetrics(assignment, submission) {
  const events = submission.writingEvents;
  const firstTimestamp = events[0]?.timestamp || submission.startedAt || submission.updatedAt || new Date().toISOString();
  const lastTimestamp = events[events.length - 1]?.timestamp || submission.submittedAt || submission.updatedAt || firstTimestamp;
  const totalMinutes = Math.max(1, Math.round((Date.parse(lastTimestamp) - Date.parse(firstTimestamp)) / 60000) || 1);
  const draftWordCount = wordCount(submission.draftText);
  const finalWordCount = wordCount(submission.finalText || submission.draftText);
  const improvement = finalWordCount - draftWordCount;
  const similarity = similarityRatio(submission.draftText, submission.finalText || submission.draftText);
  const improvementLabel =
    similarity < 0.55
      ? "major revision"
      : similarity < 0.8
        ? "clear revision"
        : improvement
          ? `${improvement > 0 ? "+" : ""}${improvement} words`
          : "light edit";

  return {
    totalMinutes,
    revisionCount: events.length,
    largePasteCount: events.filter((entry) => entry.type === "paste" && entry.flagged).length,
    draftWordCount,
    finalWordCount,
    improvementLabel,
    targetHit: finalWordCount >= assignment.wordCountMin && finalWordCount <= assignment.wordCountMax,
  };
}

function generateTeacherAssist(draft) {
  const brief = draft.brief.trim();
  const keywords = extractKeywords(brief);
  const assignmentType = detectAssignmentType(brief);
  const mainTopic = keywords[0] || "the topic";
  const title = buildTitleFromBrief(brief, assignmentType, mainTopic);
  const ranges = inferWordRange(brief, assignmentType);
  const studentFocus = focusForType(assignmentType, mainTopic);

  return {
    title,
    prompt: studentPromptForType(assignmentType, mainTopic, draft.languageLevel),
    focus: `Keep the student focused on ${studentFocus[0].toLowerCase()}.`,
    assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: ranges.min,
    wordCountMax: ranges.max,
    studentFocus,
    rubric: rubricForType(assignmentType),
  };
}

function detectAssignmentType(text) {
  const lower = text.toLowerCase();
  if (/\bargue\b|\bopinion\b|\bpersuade\b|\bshould\b/.test(lower)) {
    return "argument";
  }
  if (/\bnarrative\b|\bstory\b|\bpersonal\b|\bmemory\b/.test(lower)) {
    return "narrative";
  }
  if (/\bexplain\b|\binform\b|\bresearch\b|\bhow\b|\bwhy\b/.test(lower)) {
    return "informational";
  }
  return "response";
}

function rubricForType(type) {
  if (type === "argument") {
    return [
      { id: uid("rubric"), name: "Clear claim", description: "Takes a clear position and stays focused on it.", points: 4 },
      { id: uid("rubric"), name: "Reasons and evidence", description: "Gives strong reasons or examples and explains them.", points: 4 },
      { id: uid("rubric"), name: "Organization", description: "Ideas are ordered clearly and are easy to follow.", points: 4 },
      { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
    ];
  }
  if (type === "narrative") {
    return [
      { id: uid("rubric"), name: "Story focus", description: "Stays on one clear moment or event.", points: 4 },
      { id: uid("rubric"), name: "Details", description: "Uses details that help the reader picture what happened.", points: 4 },
      { id: uid("rubric"), name: "Sequence", description: "Events are in a clear order.", points: 4 },
      { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
    ];
  }
  if (type === "informational") {
    return [
      { id: uid("rubric"), name: "Main idea", description: "Clearly explains the topic.", points: 4 },
      { id: uid("rubric"), name: "Facts and examples", description: "Uses useful facts, details, or examples.", points: 4 },
      { id: uid("rubric"), name: "Clarity", description: "Explains ideas in a clear, easy-to-follow way.", points: 4 },
      { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
    ];
  }
  return [
    { id: uid("rubric"), name: "Task completion", description: "Answers the assignment clearly.", points: 4 },
    { id: uid("rubric"), name: "Support", description: "Uses examples or reasons to support the writing.", points: 4 },
    { id: uid("rubric"), name: "Clarity", description: "The writing is clear and easy to follow.", points: 4 },
    { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
  ];
}

function studentPromptForType(type, topic, languageLevel) {
  const levelIntro =
    ["A0", "A1"].includes(languageLevel)
      ? "Use very short, simple sentences."
      : languageLevel === "A2"
        ? "Write in clear, simple sentences."
        : languageLevel === "B1"
          ? "Write clearly and explain your thinking."
          : languageLevel === "B2"
            ? "Write clearly and develop your ideas with some detail."
            : "Write clearly, develop your ideas fully, and use precise language.";

  if (type === "argument") {
    return `${levelIntro} Write an opinion piece about ${topic}. Say what you believe, give at least one strong reason or example, and explain why it matters.`;
  }
  if (type === "narrative") {
    return `${levelIntro} Write about a real or imagined moment connected to ${topic}. Make the event clear, include details, and show why the moment matters.`;
  }
  if (type === "informational") {
    return `${levelIntro} Explain ${topic}. Teach the reader using clear facts, examples, or details.`;
  }
  return `${levelIntro} Write a clear response about ${topic}. Stay focused and support your ideas with examples or explanation.`;
}

function focusForType(type, topic) {
  if (type === "argument") {
    return [
      `a clear opinion about ${topic}`,
      "one strong reason or example",
      "explaining why that example supports the opinion",
      "fixing confusing sentences before submitting",
    ];
  }
  if (type === "narrative") {
    return [
      `one clear moment about ${topic}`,
      "details that help the reader picture it",
      "a clear beginning, middle, and end",
      "fixing places that feel rushed or confusing",
    ];
  }
  if (type === "informational") {
    return [
      `a clear explanation of ${topic}`,
      "facts or examples that teach the reader",
      "explaining one idea at a time",
      "checking that the writing is easy to understand",
    ];
  }
  return [
    `answering the question about ${topic}`,
    "using at least one helpful example",
    "explaining your thinking clearly",
    "improving the draft before submitting",
  ];
}

function inferWordRange(brief, assignmentType) {
  const match = brief.match(/(\d{2,4})\s*(?:to|-)\s*(\d{2,4})/);
  if (match) {
    return {
      min: Number(match[1]),
      max: Number(match[2]),
    };
  }

  if (assignmentType === "narrative") {
    return { min: 300, max: 500 };
  }
  return { min: 250, max: 400 };
}

function buildTitleFromBrief(brief, assignmentType, topic) {
  const cleaned = trimTo(brief.replace(/\s+/g, " ").trim(), 70);
  if (cleaned) {
    const firstSentence = cleaned.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 12) {
      return titleCase(trimTo(firstSentence, 46));
    }
  }
  return `${titleCase(assignmentType)} Writing: ${titleCase(topic)}`;
}

function generateStudentIdeas(assignment, submission) {
  const topic = extractKeywords(`${assignment.title} ${assignment.prompt}`)[0] || "the topic";
  const type = assignment.assignmentType || "response";
  const previousIdea = submission.ideaResponses.at(-1)?.rewrittenIdea || "";

  if (type === "argument") {
    return [
      `Choose one clear opinion about ${topic}.`,
      `Think of one real example that supports your opinion about ${topic}.`,
      "Add one sentence that explains why your example matters.",
      previousIdea ? "Try a different reason so you have another option." : "Think of another reason in case you want a backup idea.",
    ];
  }

  if (type === "narrative") {
    return [
      `Pick one moment connected to ${topic}.`,
      "Think about what you saw, heard, or felt.",
      "Decide how the moment begins and ends.",
      "Choose one small detail that will help the reader picture it.",
    ];
  }

  return [
    `Choose one main idea about ${topic}.`,
    "Think of one fact, example, or reason that fits.",
    "Explain the idea in a way a classmate would understand.",
    previousIdea ? "Try another angle if your first idea feels too broad." : "Keep your topic small and clear.",
  ];
}

function generateFeedback(assignment, submission) {
  const text = submission.draftText.trim();
  const words = wordCount(text);
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);

  if (!text) {
    return [
      "Start with one clear sentence that says what this piece will be about.",
      "Use one of your saved ideas to help you begin.",
    ];
  }

  // Primary checks — triggered by what's actually in the draft
  const primaryPool = [];

  if (words < assignment.wordCountMin * 0.7) {
    primaryPool.push("Your draft is still short. Can you add one more example or explanation?");
  }

  if (paragraphs.length < 2) {
    primaryPool.push("Could you split this into at least two parts so the reader can follow your thinking more easily?");
  }

  const longSentence = sentences.find((sentence) => wordCount(sentence) > 28);
  if (longSentence) {
    primaryPool.push("One sentence feels long. Where could you break it into two shorter sentences?");
  }

  if (!/\bbecause\b|\bfor example\b|\bfor instance\b|\bsuch as\b/i.test(text)) {
    primaryPool.push("Add a sentence that gives a reason or example so your writing feels stronger.");
  }

  if ((text.match(/\bthis\b|\bit\b|\bthey\b/gi) || []).length >= 5) {
    primaryPool.push("A few words like 'this' or 'it' may be unclear. Which one needs a more exact word?");
  }

  // Secondary checks — always available but only used when primary ones are exhausted or repeated
  const secondaryPool = [
    "Read your writing out loud. Where does it sound confusing or too quick?",
    "Check that each paragraph has one main job.",
    "Does your opening sentence tell the reader exactly what you are writing about?",
    "Is there one place where you could add a specific detail to make your point clearer?",
    "Look at your final sentence. Does it leave the reader with a clear idea of what you meant?",
    "Are there any words you have used more than twice in a row? Try swapping one for a different word.",
  ];

  // Collect all items already given in previous feedback rounds
  const previousItems = new Set(submission.feedbackHistory.flatMap((entry) => entry.items));

  // Filter each pool to only items not already given
  const freshPrimary = primaryPool.filter((item) => !previousItems.has(item));
  const freshSecondary = secondaryPool.filter((item) => !previousItems.has(item));

  const combined = [...freshPrimary, ...freshSecondary];

  if (!combined.length) {
    return [
      "You have worked through all the main checks. Read the full piece once more and look for any word that feels wrong.",
      "Ask yourself: does every sentence belong here? Remove anything that does not help your main idea.",
    ];
  }

  return combined.slice(0, 4);
}

function getOutlineConfig(assignment, submission) {
  const type = assignment.assignmentType || "response";
  const topic = extractKeywords(`${assignment.title} ${assignment.prompt}`)[0] || "your topic";
  const outline = submission.outline || {};

  if (type === "argument") {
    return {
      fields: [
        { key: "partOne", label: "My claim", placeholder: `I believe...` },
        { key: "partTwo", label: "My best reason or example", placeholder: `One strong reason or example is...` },
        { key: "partThree", label: "How I will explain it", placeholder: `This matters because...` },
      ],
      values: outline,
    };
  }

  if (type === "narrative") {
    return {
      fields: [
        { key: "partOne", label: "Beginning", placeholder: "At the start..." },
        { key: "partTwo", label: "Important moment", placeholder: "The key moment is..." },
        { key: "partThree", label: "Ending or meaning", placeholder: "At the end, the reader should understand..." },
      ],
      values: outline,
    };
  }

  return {
    fields: [
      { key: "partOne", label: "Main idea", placeholder: `I am explaining ${topic} by saying...` },
      { key: "partTwo", label: "Example or fact", placeholder: "One example or fact is..." },
      { key: "partThree", label: "Why it matters", placeholder: "This matters because..." },
    ],
    values: outline,
  };
}

function isOutlineComplete(submission, assignment) {
  const outline = getOutlineConfig(assignment, submission);
  return outline.fields.every((field) => String(submission.outline?.[field.key] || "").trim());
}

function renderOutlineSummary(assignment, submission) {
  const outline = getOutlineConfig(assignment, submission);
  const parts = outline.fields
    .map((field) => String(submission.outline?.[field.key] || "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(" | ") : "No outline completed";
}

function gradeSubmission(assignment, submission) {
  const rubric = assignment.rubric.length ? assignment.rubric : rubricForType(assignment.assignmentType);
  const metrics = computeProcessMetrics(assignment, submission);
  const finalText = submission.finalText || "";
  const paragraphs = splitParagraphs(finalText);
  const evidenceSignals = (finalText.match(/\bfor example\b|\bbecause\b|\bfor instance\b|\bsuch as\b/gi) || []).length;
  const revisionStrength = 1 - similarityRatio(submission.draftText, submission.finalText || submission.draftText);
  const reflectionsComplete = Boolean(submission.reflections.improved.trim());
  const outlineComplete = isOutlineComplete(submission, assignment);
  const flaggedPasteCount = safeArray(submission.writingEvents).filter((entry) => entry.type === "paste" && entry.flagged).length;

  const criteria = rubric.map((criterion) => {
    let scoreRatio = 0.65;
    const name = `${criterion.name} ${criterion.description}`.toLowerCase();

    if (name.includes("claim") || name.includes("opinion") || name.includes("main idea") || name.includes("task")) {
      scoreRatio = clamp01((metrics.targetHit ? 0.25 : 0.15) + (paragraphs.length >= 2 ? 0.25 : 0.12) + (hasOpeningClaim(finalText) ? 0.3 : 0.18));
    } else if (name.includes("reason") || name.includes("evidence") || name.includes("example") || name.includes("detail") || name.includes("support")) {
      scoreRatio = clamp01(0.25 + Math.min(evidenceSignals, 3) * 0.18 + (wordCount(finalText) >= assignment.wordCountMin ? 0.2 : 0.1));
    } else if (name.includes("organization") || name.includes("clarity") || name.includes("sequence")) {
      scoreRatio = clamp01(0.25 + (paragraphs.length >= 3 ? 0.25 : 0.12) + (averageSentenceLength(finalText) < 24 ? 0.25 : 0.1) + (metrics.revisionCount > 6 ? 0.15 : 0.08));
    } else {
      scoreRatio = clamp01(0.22 + revisionStrength * 0.28 + (reflectionsComplete ? 0.14 : 0.05) + (outlineComplete ? 0.14 : 0.04) + (submission.feedbackHistory.length ? 0.08 : 0.03) - Math.min(flaggedPasteCount, 2) * 0.08);
    }

    return {
      name: criterion.name,
      points: criterion.points,
      score: Math.round(scoreRatio * criterion.points),
      reason: buildCriterionReason(criterion.name, metrics, revisionStrength, reflectionsComplete, evidenceSignals),
    };
  });

  const totalScore = criteria.reduce((sum, item) => sum + item.score, 0);
  const maxScore = criteria.reduce((sum, item) => sum + item.points, 0);

  return {
    generatedAt: new Date().toISOString(),
    criteria,
    totalScore,
    maxScore,
    justification: buildGradeJustification(assignment, submission, metrics, totalScore, maxScore),
  };
}

function buildCriterionReason(name, metrics, revisionStrength, reflectionsComplete, evidenceSignals) {
  const lower = name.toLowerCase();
  const pasteConcern = metrics.largePasteCount ? ` The process also shows ${metrics.largePasteCount} large paste event${metrics.largePasteCount === 1 ? "" : "s"}, so authorship confidence should be checked.` : "";
  if (lower.includes("claim") || lower.includes("opinion") || lower.includes("main idea") || lower.includes("task")) {
    return (metrics.targetHit ? "The final piece stays on task and fits the assignment range." : "The piece answers the task, but the central idea could be clearer or fuller.") + pasteConcern;
  }
  if (lower.includes("reason") || lower.includes("evidence") || lower.includes("example") || lower.includes("detail") || lower.includes("support")) {
    return (evidenceSignals ? "The writing includes examples or explanation cues that support the main idea." : "The piece would be stronger with a clearer example or more explanation.") + pasteConcern;
  }
  if (lower.includes("organization") || lower.includes("clarity") || lower.includes("sequence")) {
    return (metrics.revisionCount >= 2 ? "The writing process shows some reworking, which supports a clearer final structure." : "The final piece is readable, though the revision process appears light.") + pasteConcern;
  }
  return reflectionsComplete ? `The student completed the reflection, and the draft-to-final change suggests ${revisionStrength > 0.35 ? "meaningful" : "some"} revision.${pasteConcern}` : `The process is visible, but the reflection is incomplete or thin.${pasteConcern}`;
}

function buildGradeJustification(assignment, submission, metrics, totalScore, maxScore) {
  const reflectionComplete = submission.reflections.improved.trim();
  const outlineComplete = isOutlineComplete(submission, assignment);
  const pasteFlags = metrics.largePasteCount;
  const authorshipNote = pasteFlags
    ? ` The process log includes ${pasteFlags} large paste event${pasteFlags === 1 ? "" : "s"}, so the teacher should question whether parts were pasted instead of written live.`
    : " The process log does not show large paste concerns.";
  return `Suggested score: ${totalScore}/${maxScore}. The final piece is ${metrics.targetHit ? "within" : "outside"} the target word range, shows ${metrics.improvementLabel}, and includes ${submission.writingEvents.length} tracked edit events. ${outlineComplete ? "The guided outline was completed." : "The guided outline was not fully completed."} ${reflectionComplete ? "The student also explained what they improved." : "The revision reflection is still weak or incomplete."}${authorshipNote}`;
}

function createBlankTeacherDraft() {
  return {
    brief: "",
    title: "",
    prompt: "",
    focus: "",
    assignmentType: "response",
    languageLevel: "B1",
    wordCountMin: 250,
    wordCountMax: 400,
    ideaRequestLimit: 3,
    feedbackRequestLimit: 2,
    studentFocus: "",
    rubric: [],
  };
}

function normalizeTeacherDraft(draft) {
  return {
    brief: draft.brief.trim(),
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    focus: draft.focus.trim(),
    assignmentType: draft.assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: Number(draft.wordCountMin || 0),
    wordCountMax: Number(draft.wordCountMax || 0),
    ideaRequestLimit: Number(draft.ideaRequestLimit || 0),
    feedbackRequestLimit: Number(draft.feedbackRequestLimit || 0),
    studentFocus: draft.studentFocus.trim(),
    rubric: draft.rubric.map((item) => ({
      ...item,
      name: item.name.trim(),
      description: item.description.trim(),
      points: Number(item.points || 0),
    })),
  };
}

function createEmptySubmission(assignmentId, studentId) {
  return {
    id: uid("submission"),
    assignmentId,
    studentId,
    ideaResponses: [],
    draftText: "",
    finalText: "",
    reflections: {
      improved: "",
    },
    outline: {
      partOne: "",
      partTwo: "",
      partThree: "",
    },
    feedbackHistory: [],
    writingEvents: [],
    focusAnnotations: [],
    teacherReview: {
      suggestedGrade: null,
      finalScore: "",
      finalNotes: "",
    },
    status: "draft",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    submittedAt: null,
  };
}

function createBlankState() {
  return {
    users: [
      { id: "teacher-1", name: "Ms. Rivera", role: "teacher" },
      { id: "student-1", name: "Jordan Lee", role: "student" },
      { id: "student-2", name: "Amina Patel", role: "student" },
      { id: "student-3", name: "Eli Brooks", role: "student" },
    ],
    assignments: [],
    submissions: [],
  };
}

function normalizeState(rawState) {
  const fallback = createBlankState();
  const users = safeArray(rawState?.users).length ? rawState.users : fallback.users;
  const assignments = safeArray(rawState?.assignments).map(normalizeAssignment);
  const submissions = safeArray(rawState?.submissions).map(normalizeSubmission);

  return {
    users: users.map((user) => ({
      id: user.id || uid("user"),
      name: user.name || "User",
      role: user.role || "student",
    })),
    assignments,
    submissions,
  };
}

function normalizeAssignment(assignment) {
  const assignmentType = assignment?.assignmentType || detectAssignmentType(`${assignment?.brief || ""} ${assignment?.prompt || ""}`);
  const languageLevel = assignment?.languageLevel || "middle school";
  const ranges = {
    min: Number(assignment?.wordCountMin || 250),
    max: Number(assignment?.wordCountMax || 400),
  };

  return {
    id: assignment?.id || uid("assignment"),
    title: assignment?.title || buildTitleFromBrief(assignment?.brief || assignment?.prompt || "", assignmentType, "topic"),
    prompt: assignment?.prompt || studentPromptForType(assignmentType, "the topic", languageLevel),
    focus: assignment?.focus || "",
    brief: assignment?.brief || "",
    assignmentType,
    languageLevel,
    wordCountMin: ranges.min,
    wordCountMax: Math.max(ranges.max, ranges.min),
    ideaRequestLimit: Number(assignment?.ideaRequestLimit ?? 3),
    feedbackRequestLimit: Number(assignment?.feedbackRequestLimit ?? 2),
    studentFocus: safeArray(assignment?.studentFocus).length ? assignment.studentFocus : focusForType(assignmentType, "the topic"),
    rubric: safeArray(assignment?.rubric).length ? assignment.rubric.map(normalizeRubricRow) : rubricForType(assignmentType),
    createdBy: assignment?.createdBy || "teacher-1",
    createdAt: assignment?.createdAt || new Date().toISOString(),
  };
}

function normalizeRubricRow(item) {
  return {
    id: item?.id || uid("rubric"),
    name: item?.name || "Criterion",
    description: item?.description || "",
    points: Number(item?.points || 4),
  };
}

function normalizeSubmission(submission) {
  return {
    id: submission?.id || uid("submission"),
    assignmentId: submission?.assignmentId || "",
    studentId: submission?.studentId || "",
    ideaResponses: safeArray(submission?.ideaResponses).map((idea) => ({
      id: idea?.id || uid("idea"),
      requestedAt: idea?.requestedAt || new Date().toISOString(),
      aiBullets: safeArray(idea?.aiBullets),
      rewrittenIdea: idea?.rewrittenIdea || "",
      whyChosen: idea?.whyChosen || "",
    })),
    draftText: submission?.draftText || "",
    finalText: submission?.finalText || "",
    reflections: {
      improved: submission?.reflections?.improved || "",
    },
    outline: {
      partOne: submission?.outline?.partOne || "",
      partTwo: submission?.outline?.partTwo || "",
      partThree: submission?.outline?.partThree || "",
    },
    feedbackHistory: safeArray(submission?.feedbackHistory).map((entry) => ({
      id: entry?.id || uid("feedback"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      items: safeArray(entry?.items),
    })),
    writingEvents: safeArray(submission?.writingEvents).map((entry) => ({
      id: entry?.id || uid("event"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      type: entry?.type || "insert",
      start: typeof entry?.start === "number" ? entry.start : null,
      end: typeof entry?.end === "number" ? entry.end : null,
      removedText: entry?.removedText || "",
      insertedText: entry?.insertedText || "",
      delta: Number(entry?.delta || 0),
      flagged: Boolean(entry?.flagged),
      preview: entry?.preview || "",
    })),
    focusAnnotations: safeArray(submission?.focusAnnotations).map((entry) => ({
      id: entry?.id || uid("focus"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      label: entry?.label || "Writing focus",
    })),
    teacherReview: {
      suggestedGrade: submission?.teacherReview?.suggestedGrade || null,
      finalScore: submission?.teacherReview?.finalScore ?? "",
      finalNotes: submission?.teacherReview?.finalNotes || "",
    },
    status: submission?.status || "draft",
    startedAt: submission?.startedAt || null,
    updatedAt: submission?.updatedAt || new Date().toISOString(),
    submittedAt: submission?.submittedAt || null,
  };
}

function createDemoState() {
  const state = createBlankState();

  const assignment = {
    id: "assignment-demo-1",
    title: "Should Schools Require Uniforms",
    prompt: "Write an opinion piece about school uniforms. Say what you believe, give at least one strong reason or example, and explain why it matters.",
    focus: "Keep the student focused on a clear opinion.",
    brief: "My middle school students need a short opinion piece about whether school uniforms help learning.",
    assignmentType: "argument",
    languageLevel: "middle school",
    wordCountMin: 300,
    wordCountMax: 450,
    ideaRequestLimit: 3,
    feedbackRequestLimit: 2,
    studentFocus: [
      "a clear opinion about uniforms",
      "one strong reason or example",
      "explaining why that example supports the opinion",
      "fixing confusing sentences before submitting",
    ],
    rubric: rubricForType("argument"),
    createdBy: "teacher-1",
    createdAt: "2026-04-17T08:00:00.000Z",
  };

  const submissionOne = createEmptySubmission(assignment.id, "student-1");
  submissionOne.id = "submission-demo-1";
  submissionOne.ideaResponses = [
    {
      id: "idea-demo-1",
      requestedAt: "2026-04-17T08:15:00.000Z",
      aiBullets: [
        "Choose one clear opinion about uniforms.",
        "Think of one real example that supports your opinion.",
        "Add one sentence that explains why your example matters.",
      ],
      rewrittenIdea: "I think uniforms help students focus because people compare clothes less.",
      whyChosen: "It feels realistic and easy to explain with a school example.",
    },
  ];
  submissionOne.draftText = "School uniforms can help students focus on learning because they reduce pressure to compete over clothes. In many schools, students notice brands and outfits before class even starts. That can make some students feel left out or distracted.\n\nFor example, a student who cannot afford popular clothes might spend the morning worrying about what others think instead of paying attention in class. Uniforms do not erase every social problem, but they can lower one daily distraction. Schools should require them if the goal is to create a calmer learning environment.";
  submissionOne.finalText = "Schools should require uniforms because they help students focus more on learning and less on showing status through clothing. When everyone arrives dressed in a similar way, there is less pressure to compare brands, trends, or how much money a family can spend on outfits.\n\nFor example, a student who cannot afford popular clothes may spend the morning feeling self-conscious in the hallway before class begins. That attention is then pulled away from learning. Uniforms do not solve every social problem in a school, but they remove one common distraction that affects confidence and concentration.\n\nSome people argue that uniforms limit self-expression. However, students still have many ways to show personality through their ideas, friendships, and activities. A school is mainly a place for learning, so a dress policy that reduces daily pressure is a reasonable tradeoff. Uniforms should be required because they support a calmer and more focused school environment.";
  submissionOne.reflections = {
    improved: "I added a counterargument and explained my example more clearly.",
    feedbackUsed: "I used the feedback about making my example clearer and putting the counterargument in its own paragraph.",
  };
  submissionOne.feedbackHistory = [
    {
      id: "feedback-demo-1",
      timestamp: "2026-04-17T08:32:00.000Z",
      items: [
        "Your example is useful, but explain more clearly why it supports your main idea.",
        "Could you put your counterargument in its own paragraph?",
      ],
    },
  ];
  submissionOne.writingEvents = [
    {
      id: "e1",
      timestamp: "2026-04-17T08:18:00.000Z",
      type: "insert",
      start: 0,
      end: 0,
      removedText: "",
      insertedText: "School uniforms can help students focus on learning because they reduce pressure to compete over clothes.",
      delta: 102,
      flagged: false,
      preview: "School uniforms can help students focus",
    },
    {
      id: "e2",
      timestamp: "2026-04-17T08:23:00.000Z",
      type: "insert",
      start: 102,
      end: 102,
      removedText: "",
      insertedText: " In many schools, students notice brands and outfits before class even starts. That can make some students feel left out or distracted.\n\nFor example, a student who cannot afford popular clothes might spend the morning worrying about what others think instead of paying attention in class.",
      delta: 303,
      flagged: false,
      preview: "In many schools, students notice brands",
    },
    {
      id: "e3",
      timestamp: "2026-04-17T08:28:00.000Z",
      type: "insert",
      start: 405,
      end: 405,
      removedText: "",
      insertedText: " Uniforms do not erase every social problem, but they can lower one daily distraction. Schools should require them if the goal is to create a calmer learning environment.",
      delta: 173,
      flagged: false,
      preview: "Uniforms do not erase every social problem",
    },
  ];
  submissionOne.focusAnnotations = [
    { id: "f1", timestamp: "2026-04-17T08:20:00.000Z", label: "clear opinion about uniforms" },
    { id: "f2", timestamp: "2026-04-17T08:25:00.000Z", label: "one strong reason or example" },
  ];
  submissionOne.status = "submitted";
  submissionOne.startedAt = "2026-04-17T08:18:00.000Z";
  submissionOne.updatedAt = "2026-04-17T08:39:00.000Z";
  submissionOne.submittedAt = "2026-04-17T08:39:00.000Z";

  const submissionTwo = createEmptySubmission(assignment.id, "student-2");
  submissionTwo.id = "submission-demo-2";
  submissionTwo.ideaResponses = [
    {
      id: "idea-demo-2",
      requestedAt: "2026-04-17T09:02:00.000Z",
      aiBullets: [
        "Choose one clear opinion about uniforms.",
        "Think of one real example that supports your opinion.",
        "Add one sentence that explains why your example matters.",
      ],
      rewrittenIdea: "I think uniforms save time in the morning.",
      whyChosen: "It is practical and easy to explain.",
    },
  ];
  submissionTwo.draftText = "Uniforms can save students time in the morning because they do not have to choose what to wear every day. This can make school mornings less stressful.\n\nSome students may not like wearing the same style often, but schools can still set reasonable options.";
  submissionTwo.feedbackHistory = [
    {
      id: "feedback-demo-2",
      timestamp: "2026-04-17T09:14:00.000Z",
      items: [
        "Add one real example instead of staying general.",
        "Can you explain why the counterpoint does not change your opinion?",
      ],
    },
  ];
  submissionTwo.writingEvents = [
    {
      id: "e4",
      timestamp: "2026-04-17T09:03:00.000Z",
      type: "insert",
      start: 0,
      end: 0,
      removedText: "",
      insertedText: "Uniforms can save students time in the morning because they do not have to choose what to wear every day.",
      delta: 106,
      flagged: false,
      preview: "Uniforms can save students time",
    },
    {
      id: "e5",
      timestamp: "2026-04-17T09:09:00.000Z",
      type: "paste",
      start: 106,
      end: 106,
      removedText: "",
      insertedText: " This can make school mornings less stressful.\n\nSome students may not like wearing the same style often, but schools can still set reasonable options.",
      delta: 147,
      flagged: true,
      preview: "This can make school mornings less stressful",
    },
  ];
  submissionTwo.focusAnnotations = [
    { id: "f3", timestamp: "2026-04-17T09:05:00.000Z", label: "one strong reason or example" },
  ];
  submissionTwo.startedAt = "2026-04-17T09:03:00.000Z";
  submissionTwo.updatedAt = "2026-04-17T09:14:00.000Z";

  state.assignments.push(assignment);
  state.submissions.push(submissionOne, submissionTwo);
  return state;
}

function loadState() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = createDemoState();
    const normalized = normalizeState(seeded);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  try {
    const normalized = normalizeState(JSON.parse(stored));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    const seeded = createDemoState();
    const normalized = normalizeState(seeded);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }
}

function persistState() {
  const cloned = JSON.parse(JSON.stringify(state));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloned));
}

function getStudentUsers() {
  return state.users.filter((user) => user.role === "student");
}

function getUserById(id) {
  return state.users.find((user) => user.id === id) || null;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function wordCount(text) {
  return (String(text || "").trim().match(/\b[\w'-]+\b/g) || []).length;
}

function splitLines(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function splitParagraphs(text) {
  return String(text || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function splitSentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function extractKeywords(text) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "into", "have", "will",
    "about", "should", "because", "students", "student", "write", "using", "need", "short",
    "piece", "grade", "clear", "simple", "their", "them", "give",
  ]);
  const counts = {};
  const matches = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  for (const word of matches) {
    if (!stopWords.has(word)) {
      counts[word] = (counts[word] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
}

function titleCase(text) {
  return String(text || "").replace(/\b\w/g, (char) => char.toUpperCase());
}

function trimTo(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderEventSummary(entry) {
  const core = `${formatTime(entry.timestamp)} • ${entry.delta >= 0 ? "+" : ""}${entry.delta} chars`;
  if (entry.type === "paste") {
    return `${core}. ${entry.flagged ? "Large paste flagged." : "Paste captured."} ${entry.preview}`;
  }
  return `${core}. ${entry.preview || "Draft updated."}`;
}

function similarityRatio(a, b) {
  const wordsA = new Set((String(a || "").toLowerCase().match(/[a-z']+/g) || []).filter(Boolean));
  const wordsB = new Set((String(b || "").toLowerCase().match(/[a-z']+/g) || []).filter(Boolean));
  const union = new Set([...wordsA, ...wordsB]);
  if (!union.size) {
    return 1;
  }
  let intersection = 0;
  union.forEach((word) => {
    if (wordsA.has(word) && wordsB.has(word)) {
      intersection += 1;
    }
  });
  return intersection / union.size;
}

function averageSentenceLength(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return 0;
  }
  return wordCount(text) / sentences.length;
}

function hasOpeningClaim(text) {
  const firstParagraph = splitParagraphs(text)[0] || text;
  return wordCount(firstParagraph) >= 12;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
