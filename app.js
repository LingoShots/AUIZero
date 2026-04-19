const STORAGE_KEY = "AUIZero-v1";
const LARGE_PASTE_LIMIT = 220;

// App state — now server-backed
let currentProfile = null;
let currentClasses = [];
let currentClassId = null;

const ERROR_CODES = [
  { code: "CS",  label: "Comma splice: two complete sentences joined with only a comma" },
  { code: "RO",  label: "Run-on: two or more sentences run together without correct punctuation" },
  { code: "FR",  label: "Fragment: incomplete sentence — missing a subject or verb" },
  { code: "P",   label: "Missing punctuation: a period, comma, or other mark is needed here" },
  { code: "VT",  label: "Wrong verb tense: doesn't match the tense of the rest of the text" },
  { code: "WF",  label: "Wrong word form: e.g. adjective used where an adverb is needed" },
  { code: "AGR", label: "Agreement error: subject and verb, or noun and pronoun, don't agree" },
  { code: "SP",  label: "Spelling error" },
];

const ui = {
  role: "student",
  activeUserId: "",
  pin: "",
  showInvitePanel: false,
  inviteText: "",
  inviteMailto: "",
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
  chatInput: "",
  chatLoading: false,
};

let state = loadState();
let appEl = null;

document.addEventListener("DOMContentLoaded", async () => {
  appEl = document.getElementById("app");
  ui.teacherDraft = createBlankTeacherDraft();

  // Show loading screen while checking session
  appEl.innerHTML = `<div style="display:grid;place-items:center;min-height:60vh;"><p>Loading...</p></div>`;

  const profile = await Auth.restoreSession();
  if (!profile) {
    renderAuthScreen();
    return;
  }

  await bootApp(profile);
});

async function bootApp(profile) {
  currentProfile = profile;
  ui.role = profile.role;
  ui.activeUserId = profile.id;

  // Auto-join class if arriving via invite link
  await Auth.joinClassIfInvited();

  if (profile.role === 'teacher') {
    const data = await Auth.apiFetch('/api/classes');
    currentClasses = data.classes || [];
    currentClassId = currentClasses[0]?.id || null;
  } else {
    const data = await Auth.apiFetch('/api/student/classes');
    currentClasses = data.classes || [];
    currentClassId = currentClasses[0]?.id || null;
  }

  bindEvents();
  hydrateSelections();
  render();
}

let autoSaveTimer = null;

function bindEvents() {
  appEl.addEventListener("click", handleClick);
  appEl.addEventListener("change", handleChange);
  appEl.addEventListener("input", handleInput);
  appEl.addEventListener("paste", handlePaste, true);
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const submission = getStudentSubmission();
    if (!submission) return;
    persistState();
    const indicator = document.getElementById("autosave-indicator");
    if (indicator) {
      indicator.textContent = "Saved";
      indicator.style.opacity = "1";
      setTimeout(() => { indicator.style.opacity = "0"; }, 2000);
    }
  }, 30000);
}

async function handleClick(event) {
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
        prompt: `Create a student-ready writing assignment based on these teacher notes: "${ui.teacherDraft.brief}".

Rules:
- Student CEFR level: ${ui.teacherDraft.languageLevel}. Adjust the prompt language complexity accordingly.
- Total assignment points: ${ui.teacherDraft.totalPoints}. The rubric criteria points must add up to exactly ${ui.teacherDraft.totalPoints}.
- If the teacher's notes mention specific rubric criteria or assessment areas, use those. Otherwise create 4 appropriate criteria for the assignment type.
- Keep rubric criteria names short (2-4 words). Descriptions should be one clear sentence a student can understand.

Respond with ONLY a valid JSON object, no extra text, with these exact keys: "title" (string), "prompt" (string for students), "assignmentType" (one of: argument, narrative, informational, response), "wordCountMin" (number), "wordCountMax" (number), "studentFocus" (array of 3-4 short strings), "rubric" (array of objects each with "name", "description", "points").`
      })
    })
    .then(res => {
        if (!res.ok) throw new Error("Server returned " + res.status);
        return res.json();
    })
    .then(data => {
      let jsonStr = data.response.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      parsed.rubric = (parsed.rubric || []).map((item) => ({ id: uid("rubric"), ...item }));
      ui.teacherAssist = parsed;
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

  if (action === "add-rubric-row" && ui.teacherAssist) {
    const defaultPts = Math.max(1, Math.floor(ui.teacherDraft.totalPoints / (ui.teacherAssist.rubric.length + 1)));
    ui.teacherAssist.rubric.push({ id: uid("rubric"), name: "", description: "", points: defaultPts });
    render();
    return;
  }

  if (action === "remove-rubric-row" && ui.teacherAssist) {
    const rubricId = target.dataset.rubricId;
    ui.teacherAssist.rubric = ui.teacherAssist.rubric.filter((r) => r.id !== rubricId);
    render();
    return;
  }

  if (action === "add-annotation") {
    const submission = getSelectedReviewSubmission();
    if (!submission) return;
    const code = target.dataset.code;
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    if (!selectedText) {
      alert("Please select some text in the student text box first, then click a code.");
      return;
    }
    let note = "";
    if (code === "NOTE") {
      note = prompt("Add a note for this selection:") || "";
      if (!note) return;
    }
    submission.teacherReview = submission.teacherReview || {};
    submission.teacherReview.annotations = submission.teacherReview.annotations || [];
    submission.teacherReview.annotations.push({ id: uid("ann"), code, selectedText, note });
    persistState();
    render();
    return;
  }

  if (action === "remove-annotation") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.annotations) return;
    const index = Number(target.dataset.annotationIndex);
    submission.teacherReview.annotations.splice(index, 1);
    persistState();
    render();
    return;
  }

  if (action === "insert-error-code") {
    const code = target.dataset.code;
    const textarea = document.getElementById("teacher-review-notes");
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + " " + code + " " + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + code.length + 2;
    textarea.focus();
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

if (action === "create-class") {
    const name = prompt("Class name:");
    if (!name) return;
    const data = await Auth.apiFetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    if (data.class) {
      currentClasses.unshift(data.class);
      currentClassId = data.class.id;
      ui.notice = `Class "${name}" created. Now add students with the "+ Add student" button.`;
    } else {
      ui.notice = `Could not create class: ${data.error || "unknown error"}`;
    }
    render();
    return;
  }

  if (action === "invite-student") {
    if (!currentClassId) { alert("Select a class first."); return; }
    const email = prompt("Student's email address:");
    if (!email) return;
    const data = await Auth.apiFetch(`/api/classes/${currentClassId}/members`, {
      method: 'POST',
      body: JSON.stringify({ studentEmail: email.trim() })
    });
    if (data.ok) {
      ui.notice = "Student added. They can now log in and see published assignments for this class.";
    } else {
      ui.notice = `Could not add student: ${data.error || "unknown error"}`;
    }
    render();
    return;
  }

  if (action === "invite-by-email") {
    if (!currentClassId) { alert("Select a class first."); return; }
    const currentClass = currentClasses.find(c => c.id === currentClassId);
    const className = currentClass?.name || "your class";
    const appUrl = window.location.origin;
    const subject = encodeURIComponent(`You have been invited to join ${className} on AUIZero`);
    const body = encodeURIComponent(`Hello,\n\nYou have been invited to join ${className} on AUIZero.\n\nTo get started:\n1. Go to ${appUrl}\n2. Click "Create account"\n3. Sign up with this email address as a student\n4. Your teacher will then add you to the class\n\nSee you there!`);
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    const copyText = `You have been invited to join ${className} on AUIZero.\n\nTo get started:\n1. Go to ${appUrl}\n2. Click "Create account"\n3. Sign up with this email address as a student\n4. Your teacher will then add you to the class`;
   ui.showInvitePanel = true;
    render();
    return;
  }

  if (action === "copy-invite-text") {
    const textarea = document.getElementById("invite-textarea");
    const text = textarea ? textarea.value : "";
    navigator.clipboard.writeText(text).then(() => {
      ui.notice = "Invite message copied to clipboard.";
      ui.showInvitePanel = false;
      render();
    });
    return;
  }

  if (action === "close-invite-panel") {
    ui.showInvitePanel = false;
    render();
    return;
  }
if (action === "sign-out") {
    await Auth.signOut();
    currentProfile = null;
    currentClasses = [];
    currentClassId = null;
    renderAuthScreen();
    return;
  }
  
  if (action === "focus-brief") {
    const brief = document.getElementById("teacher-brief");
    if (brief) {
      brief.focus();
      brief.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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

 if (action === "publish-assignment") {
    const assignmentId = target.dataset.assignmentId;
    const assignment = state.assignments.find((a) => a.id === assignmentId);
    if (!assignment) return;
    if (!currentClassId) {
      ui.notice = "Select a class first before publishing.";
      render();
      return;
    }
    assignment.classId = currentClassId;
    assignment.status = assignment.status === "published" ? "draft" : "published";
    ui.notice = assignment.status === "published"
      ? "Assignment published — only students in this class can see it."
      : "Assignment moved back to draft.";
    persistState();
    render();
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

  if (action === "download-work") {
    const submission = getStudentSubmission();
    const assignment = getStudentAssignment();
    if (submission && assignment) downloadStudentWork(assignment, submission);
    return;
  }

  if (action === "send-chat-message") {
    const submission = getStudentSubmission();
    const assignment = getStudentAssignment();
    if (!submission || !assignment || ui.chatLoading) return;
    const textarea = document.getElementById("chat-input");
    const text = (textarea ? textarea.value : ui.chatInput).trim();
    if (!text) return;

    // Start timer on first message
    if (!submission.chatStartedAt) {
      submission.chatStartedAt = new Date().toISOString();
    }

    submission.chatHistory = submission.chatHistory || [];
    submission.chatHistory.push({ role: "user", content: text, timestamp: new Date().toISOString() });
    ui.chatInput = "";
    ui.chatLoading = true;
    persistState();
    render();

    // Scroll chat to bottom
    setTimeout(() => {
      const win = document.getElementById("chatbot-window");
      if (win) win.scrollTop = win.scrollHeight;
    }, 50);

    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: getChatbotSystemPrompt(assignment),
        messages: submission.chatHistory.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
      .then((res) => { if (!res.ok) throw new Error("Server " + res.status); return res.json(); })
      .then((data) => {
        submission.chatHistory.push({ role: "assistant", content: data.response, timestamp: new Date().toISOString() });
        submission.updatedAt = new Date().toISOString();
        ui.chatLoading = false;
        persistState();
        render();
        setTimeout(() => {
          const win = document.getElementById("chatbot-window");
          if (win) win.scrollTop = win.scrollHeight;
        }, 50);
      })
      .catch((err) => {
        console.error("Chat error:", err);
        submission.chatHistory.push({ role: "assistant", content: "Sorry, I couldn't connect. Please try again.", timestamp: new Date().toISOString() });
        ui.chatLoading = false;
        persistState();
        render();
      });
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

  if (action === "use-suggested-comment") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.suggestedGrade?.studentComment) return;
    const textarea = document.getElementById("teacher-review-notes");
    if (textarea) {
      textarea.value = submission.teacherReview.suggestedGrade.studentComment;
      textarea.focus();
    }
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

async function handleChange(event) {
  const target = event.target;

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.value;
    return;
  }

  if (target.dataset.assistField && ui.teacherAssist) {
    ui.teacherAssist[target.dataset.assistField] = target.value;
    return;
  }

if (target.id === "class-select") {
    if (target.value === "__new__") {
      const name = prompt("Class name:");
      if (!name) { render(); return; }
      const data = await Auth.apiFetch('/api/classes', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      if (data.class) {
        currentClasses.unshift(data.class);
        currentClassId = data.class.id;
      }
    } else {
      currentClassId = target.value;
    }
    render();
    return;
  }
  
  if (target.id === "role-select") {
    const newRole = target.value;
    if (newRole === "teacher") {
      const entered = prompt("Enter teacher PIN to continue (default: 1234):");
      if (entered !== "1234") {
        ui.notice = "Incorrect PIN.";
        render();
        return;
      }
    }
    stopPlayback();
    ui.role = newRole;
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

  if (target.id === "chat-input") {
    ui.chatInput = target.value;
    return;
  }

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.value;
    return;
  }

  if (target.dataset.assistField && ui.teacherAssist) {
    if (target.dataset.assistField === "studentFocusText") {
      ui.teacherAssist.studentFocus = target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      ui.teacherAssist[target.dataset.assistField] = target.type === "number" ? Number(target.value) : target.value;
    }
    return;
  }

  if (target.dataset.rubricId && target.dataset.rubricField && ui.teacherAssist) {
    const item = ui.teacherAssist.rubric.find((r) => r.id === target.dataset.rubricId);
    if (item) item[target.dataset.rubricField] = target.type === "number" ? Number(target.value) : target.value;
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
    scheduleAutoSave();
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

  if (target.dataset.saKey) {
    const submission = getStudentSubmission();
    if (!submission) return;
    submission.selfAssessment = submission.selfAssessment || {};
    submission.selfAssessment[target.dataset.saKey] = target.value;
    submission.updatedAt = new Date().toISOString();
    // Update visual selection without full re-render
    document.querySelectorAll(`[name="${target.dataset.saKey}"]`).forEach(el => {
      el.closest(".sa-option").classList.toggle("sa-selected", el === target);
    });
    persistState();
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
    ${renderInvitePanel()}
  `;
}

function renderAuthScreen() {
  appEl.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:20px;">
      <div style="width:100%;max-width:400px;background:rgba(255,253,249,0.94);border:1px solid rgba(221,210,194,0.9);border-radius:18px;padding:32px;box-shadow:0 12px 30px rgba(62,41,26,0.08);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;">
          <div style="display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#a55233,#844125);color:white;font-weight:700;letter-spacing:0.08em;">AU</div>
          <div>
            <h1 style="margin:0;font-family:'Iowan Old Style','Palatino Linotype',serif;font-size:1.3rem;letter-spacing:-0.02em;">AUIZero</h1>
            <p style="margin:0;color:#667063;font-size:0.85rem;">Visible writing steps</p>
          </div>
        </div>
        <div style="display:flex;gap:0;margin-bottom:24px;border:1px solid #ddd2c2;border-radius:10px;overflow:hidden;">
          <button id="auth-tab-signin" onclick="showAuthTab('signin')" style="flex:1;padding:10px;border:none;background:#fff;font-weight:700;cursor:pointer;color:#a55233;">Sign in</button>
          <button id="auth-tab-signup" onclick="showAuthTab('signup')" style="flex:1;padding:10px;border:none;background:#f4efe6;font-weight:700;cursor:pointer;color:#667063;">Create account</button>
        </div>
        <div id="auth-signin-form">
          <div style="display:grid;gap:12px;">
            <input id="auth-email" type="email" placeholder="Email" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-password" type="password" placeholder="Password" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <button onclick="handleSignIn()" style="background:linear-gradient(135deg,#a55233,#844125);color:white;border:none;border-radius:999px;padding:12px 24px;font:inherit;font-weight:700;cursor:pointer;">Sign in</button>
            <p id="auth-error" style="color:#b34949;font-size:0.85rem;margin:0;display:none;"></p>
          </div>
        </div>
        <div id="auth-signup-form" style="display:none;">
          <div style="display:grid;gap:12px;">
            <input id="auth-signup-name" type="text" placeholder="Full name" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-signup-email" type="email" placeholder="Email" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-signup-password" type="password" placeholder="Password (min 6 characters)" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <div style="display:flex;gap:8px;">
              <button onclick="setSignupRole('student')" id="role-btn-student" style="flex:1;padding:10px;border:2px solid #a55233;border-radius:10px;background:#f4e0d4;font:inherit;font-weight:700;cursor:pointer;color:#844125;">Student</button>
              <button onclick="setSignupRole('teacher')" id="role-btn-teacher" style="flex:1;padding:10px;border:1px solid #ddd2c2;border-radius:10px;background:#fff;font:inherit;font-weight:700;cursor:pointer;color:#667063;">Teacher</button>
            </div>
            <button onclick="handleSignUp()" style="background:linear-gradient(135deg,#a55233,#844125);color:white;border:none;border-radius:999px;padding:12px 24px;font:inherit;font-weight:700;cursor:pointer;">Create account</button>
            <p id="auth-signup-error" style="color:#b34949;font-size:0.85rem;margin:0;display:none;"></p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Inline auth functions — attached to window so onclick works
  window.signupRole = 'student';

  window.showAuthTab = (tab) => {
    document.getElementById('auth-signin-form').style.display = tab === 'signin' ? 'block' : 'none';
    document.getElementById('auth-signup-form').style.display = tab === 'signup' ? 'block' : 'none';
    document.getElementById('auth-tab-signin').style.background = tab === 'signin' ? '#fff' : '#f4efe6';
    document.getElementById('auth-tab-signin').style.color = tab === 'signin' ? '#a55233' : '#667063';
    document.getElementById('auth-tab-signup').style.background = tab === 'signup' ? '#fff' : '#f4efe6';
    document.getElementById('auth-tab-signup').style.color = tab === 'signup' ? '#a55233' : '#667063';
  };

  window.setSignupRole = (role) => {
    window.signupRole = role;
    document.getElementById('role-btn-student').style.border = role === 'student' ? '2px solid #a55233' : '1px solid #ddd2c2';
    document.getElementById('role-btn-student').style.background = role === 'student' ? '#f4e0d4' : '#fff';
    document.getElementById('role-btn-student').style.color = role === 'student' ? '#844125' : '#667063';
    document.getElementById('role-btn-teacher').style.border = role === 'teacher' ? '2px solid #a55233' : '1px solid #ddd2c2';
    document.getElementById('role-btn-teacher').style.background = role === 'teacher' ? '#f4e0d4' : '#fff';
    document.getElementById('role-btn-teacher').style.color = role === 'teacher' ? '#844125' : '#667063';
  };

  window.handleSignIn = async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';
    try {
      const profile = await Auth.signIn(email, password);
      await bootApp(profile);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  };

  window.handleSignUp = async () => {
    const name = document.getElementById('auth-signup-name').value.trim();
    const email = document.getElementById('auth-signup-email').value.trim();
    const password = document.getElementById('auth-signup-password').value;
    const errEl = document.getElementById('auth-signup-error');
    errEl.style.display = 'none';
    if (!name || !email || !password) {
      errEl.textContent = 'Please fill in all fields.';
      errEl.style.display = 'block';
      return;
    }
    try {
      const profile = await Auth.signUp(email, password, name, window.signupRole);
      await bootApp(profile);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  };
}

function renderInvitePanel() {
  if (!ui.showInvitePanel) return "";
  const appUrl = window.location.origin;
  const inviteLink = `${appUrl}?join=${currentClassId}`;
  const currentClass = currentClasses.find(c => c.id === currentClassId);
  const className = currentClass?.name || "your class";
  const inviteText = `You have been invited to join ${className} on AUIZero.\n\nClick this link to join:\n${inviteLink}\n\nYou will be asked to create an account if you don't have one. Once signed in you will be added to the class automatically.`;

  return `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:999;display:grid;place-items:center;padding:20px;">
      <div style="background:#fffdf9;border-radius:18px;padding:28px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.15);">
        <h3 style="margin:0 0 6px;">Invite students to ${escapeHtml(className)}</h3>
        <p style="color:var(--muted);font-size:0.88rem;margin:0 0 16px;">Copy this message and paste it into your own email to send to students. When they click the link and sign up, they will be added to this class automatically.</p>
        <textarea id="invite-textarea" style="width:100%;min-height:160px;font-size:0.88rem;line-height:1.6;border:1px solid var(--line);border-radius:10px;padding:12px;font-family:inherit;box-sizing:border-box;background:#f8f3ea;" readonly>${escapeHtml(inviteText)}</textarea>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
          <button class="button" data-action="copy-invite-text">Copy message</button>
          <button class="button-ghost" data-action="close-invite-panel">Close</button>
        </div>
      </div>
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
        <div class="brand-mark">AZ</div>
        <div>
          <h1>AUIZero</h1>
          <p>Visible writing steps for teachers and students.</p>
        </div>
      </div>
      <div class="toolbar">
        ${currentProfile ? `<span style="font-size:0.85rem;color:var(--muted);">${escapeHtml(currentProfile.name)} · ${escapeHtml(currentProfile.role)}</span>` : ""}
       ${ui.role === "teacher" ? `
          ${currentClasses.length === 0 ? `
            <button class="button-secondary" data-action="create-class">+ Create first class</button>
          ` : `
            <select id="class-select" aria-label="Select class">
              ${currentClasses.map(c => `<option value="${c.id}" ${currentClassId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              <option value="__new__">+ New class</option>
            </select>
           <button class="button-ghost" data-action="invite-student">+ Add by email</button>
            <button class="button-secondary" data-action="invite-by-email">✉ Invite link</button>
          `}
        ` : ""}
        <button class="button-ghost" data-action="sign-out">Sign out</button>
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
            <button class="button" data-action="save-assignment" ${!ui.teacherAssist && !ui.teacherDraft.title ? "disabled" : ""}>Save</button>
          </div>
        </div>
        <div class="field-stack">
          <div class="field">
            <label for="teacher-brief">Teacher brief</label>
            <textarea id="teacher-brief" data-teacher-field="brief" class="teacher-brief" placeholder="Example: My 7th grade students need a short opinion paragraph about whether school uniforms help learning. Keep the language simple, ask for one real example, and aim for 250 to 350 words. Give them 2 idea helps and 2 feedback checks.">${escapeHtml(ui.teacherDraft.brief)}</textarea>
          </div>
          <div class="field-grid compact-grid">
            <div class="field">
              <label for="teacher-feedback-limit">Feedback checks</label>
              <input id="teacher-feedback-limit" data-teacher-field="feedbackRequestLimit" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.feedbackRequestLimit))}" />
            </div>
            <div class="field">
              <label for="teacher-total-points">Total points</label>
              <input id="teacher-total-points" data-teacher-field="totalPoints" type="number" min="4" value="${escapeAttribute(String(ui.teacherDraft.totalPoints))}" />
            </div>
            <div class="field">
              <label for="teacher-chat-limit">Chat time limit (mins, 0 = unlimited)</label>
              <input id="teacher-chat-limit" data-teacher-field="chatTimeLimit" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.chatTimeLimit))}" />
            </div>
            <div class="field">
              <label for="teacher-deadline">Deadline</label>
              <input id="teacher-deadline" data-teacher-field="deadline" type="datetime-local" value="${escapeAttribute(ui.teacherDraft.deadline)}" />
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
                    <p class="mini-label">AI Draft — edit anything before saving</p>
                    <input class="assist-title-input" data-assist-field="title" value="${escapeAttribute(ui.teacherAssist.title)}" placeholder="Assignment title" />
                  </div>
                </div>
                <div class="teacher-ready-card">
                  <p class="mini-label">Student instructions</p>
                  <div class="field" style="margin-bottom:10px;">
                    <label>Task prompt</label>
                    <textarea data-assist-field="prompt">${escapeHtml(ui.teacherAssist.prompt)}</textarea>
                  </div>
                  <div class="field-grid" style="margin-bottom:10px;">
                    <div class="field">
                      <label>Min words</label>
                      <input type="number" data-assist-field="wordCountMin" value="${ui.teacherAssist.wordCountMin}" />
                    </div>
                    <div class="field">
                      <label>Max words</label>
                      <input type="number" data-assist-field="wordCountMax" value="${ui.teacherAssist.wordCountMax}" />
                    </div>
                  </div>
                  <div class="field">
                    <label>Assignment type</label>
                    <select data-assist-field="assignmentType">
                      ${["argument", "narrative", "informational", "process", "definition", "compare", "response", "other"].map((t) => `<option value="${t}" ${ui.teacherAssist.assignmentType === t ? "selected" : ""}>${titleCase(t)}</option>`).join("")}
                    </select>
                  </div>
                </div>
                <div class="teacher-ready-card">
                  <p class="mini-label">Student focus</p>
                  <textarea data-assist-field="studentFocusText" placeholder="One focus point per line" style="min-height:240px;">${escapeHtml((ui.teacherAssist.studentFocus || []).join("\n"))}</textarea>
                  <p class="subtle" style="font-size:0.82rem;margin-top:6px;">One focus point per line</p>
                </div>
                <div class="teacher-ready-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <p class="mini-label">Rubric</p>
                    <span class="pill">${ui.teacherAssist.rubric.reduce((s, r) => s + Number(r.points || 0), 0)} / ${ui.teacherDraft.totalPoints} pts</span>
                  </div>
                  <div class="review-stack">
                    ${ui.teacherAssist.rubric.map((item) => `
                      <div class="rubric-edit-row">
                        <div class="rubric-edit-fields">
                          <input data-rubric-id="${item.id}" data-rubric-field="name" value="${escapeAttribute(item.name)}" placeholder="Criterion name" style="font-weight:700;" />
                          <input data-rubric-id="${item.id}" data-rubric-field="description" value="${escapeAttribute(item.description)}" placeholder="Description" />
                        </div>
                        <div class="rubric-edit-right">
                          <input type="number" data-rubric-id="${item.id}" data-rubric-field="points" value="${item.points}" min="1" style="width:60px;text-align:center;" />
                          <span class="subtle" style="font-size:0.82rem;">pts</span>
                          <button class="button-ghost" data-action="remove-rubric-row" data-rubric-id="${item.id}" style="color:var(--danger);border-color:var(--danger);padding:0 10px;min-height:36px;">✕</button>
                        </div>
                      </div>
                    `).join("")}
                  </div>
                  <button class="button-ghost" data-action="add-rubric-row" style="margin-top:10px;">+ Add criterion</button>
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
            ? `<div class="empty-state" style="padding:36px 28px;">
                <div style="font-size:2.5rem;margin-bottom:12px;">✏️</div>
                <h3 style="margin:0 0 8px;">Welcome to AUIZero</h3>
                <p style="margin:0 0 20px;max-width:320px;margin-inline:auto;">Describe your assignment in plain English on the left, then click <strong>Format With AI</strong> to generate a student-ready task in seconds.</p>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                  <button class="button" data-action="focus-brief">Start your first assignment</button>
                  <button class="button-ghost" data-action="load-demo">Explore the demo</button>
                </div>
              </div>`
            : `
              <div class="assignment-list">
                ${assignments.map((assignment) => `
                  <div class="assignment-card simple-card">
                    <div class="card-top">
                      <div>
                        <h3>${escapeHtml(assignment.title)}</h3>
                        <p>${escapeHtml(assignment.prompt)}</p>
                      </div>
                      <div style="display:flex;gap:8px;flex-shrink:0;flex-direction:column;align-items:flex-end;">
                        <div style="display:flex;gap:8px;">
                          <button class="button-ghost" data-action="select-assignment" data-assignment-id="${assignment.id}">Open</button>
                          <button class="button-ghost" data-action="delete-assignment" data-assignment-id="${assignment.id}" style="color:var(--danger);border-color:var(--danger);">Delete</button>
                        </div>
                        <button class="${assignment.status === "published" ? "button-ghost" : "button"}" data-action="publish-assignment" data-assignment-id="${assignment.id}" style="${assignment.status === "published" ? "color:var(--sage);border-color:var(--sage);" : ""}">
                          ${assignment.status === "published" ? "✓ Published — click to unpublish" : "Publish to students"}
                        </button>
                      </div>
                    </div>
                    <div class="pill-row">
                      <span class="${assignment.status === "published" ? "pill" : "warning-pill"}">${assignment.status === "published" ? "Published" : "Draft"}</span>
                      <span class="pill">${escapeHtml(titleCase(assignment.assignmentType || "writing"))}</span>
                      <span class="pill">${assignment.wordCountMin}-${assignment.wordCountMax} words</span>
                      ${assignment.deadline ? `<span class="pill">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"}))}</span>` : ""}
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
            ${(() => {
              const total = getStudentUsers().length;
              const submitted = submissions.filter((s) => s.status === "submitted").length;
              const graded = submissions.filter((s) => s.teacherReview?.savedAt).length;
              const flagged = submissions.filter((s) => computeProcessMetrics(assignment, s).largePasteCount > 0).length;
              return `
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
                  <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:700;">${submitted}/${total}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">Submitted</div>
                  </div>
                  <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:700;">${graded}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">Graded</div>
                  </div>
                  <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:700;">${total - submitted}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">Not submitted</div>
                  </div>
                  <div style="background:${flagged ? "#fff3cd" : "var(--surface)"};border:1px solid ${flagged ? "#e0c84a" : "var(--line)"};border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:1.4rem;font-weight:700;">${flagged}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">Paste flags</div>
                  </div>
                </div>
              `;
            })()}
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
              const isGraded = Boolean(submission.teacherReview?.savedAt);
              return `
                <div class="submission-card simple-card">
                  <div class="card-top">
                    <div>
                      <h3>${escapeHtml(student.name)}</h3>
                      <div class="submission-status">
                        <span class="status-pill">${escapeHtml(titleCase(submission.status))}</span>
                        ${isGraded ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ Graded</span>` : ""}
                        ${studentMetrics.largePasteCount ? `<span class="warning-pill">${studentMetrics.largePasteCount} paste flag${studentMetrics.largePasteCount === 1 ? "" : "s"}</span>` : ""}
                      </div>
                    </div>
                    <button class="button-ghost" data-action="inspect-submission" data-submission-id="${submission.id}">Inspect</button>
                  </div>
                  <div class="pill-row">
                    <span class="pill">${studentMetrics.totalMinutes} min</span>
                    <span class="pill">${studentMetrics.revisionCount} edits</span>
                    <span class="pill">${studentMetrics.finalWordCount} words</span>
                    ${submission.teacherReview?.finalScore !== "" && submission.teacherReview?.finalScore != null ? `<span class="pill">Score: ${escapeHtml(String(submission.teacherReview.finalScore))}</span>` : ""}
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
                        <p class="mini-label">Coaching chat</p>
                        <button class="context-expand-btn" data-action="expand-context-col" data-col="ideas">⤢ Expand</button>
                      </div>
                      <div class="context-snippet">
                        ${
                          (selectedSubmission.chatHistory || []).length
                            ? `<p class="subtle-clamp">${escapeHtml((selectedSubmission.chatHistory || []).filter(m => m.role === "user").map(m => m.content).join(" · ").slice(0, 180))}</p>`
                            : `<p class="subtle">No coaching conversation yet.</p>`
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
                        ${(selectedSubmission.chatHistory || []).length
                          ? (selectedSubmission.chatHistory || []).map((msg) => `
                              <div class="chat-message chat-${escapeHtml(msg.role)}" style="margin-bottom:10px;">
                                <strong style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:4px;">${msg.role === "assistant" ? "Coach" : "Student"} · ${escapeHtml(formatTime(msg.timestamp))}</strong>
                                <div class="chat-bubble">${escapeHtml(msg.content)}</div>
                              </div>`).join("")
                          : `<p class="subtle">No coaching conversation recorded.</p>`}
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
                          ${selectedSubmission.teacherReview.suggestedGrade.studentComment ? `
                          <div class="muted-block" style="background:#f0f7ee;border-left:3px solid var(--accent);margin-top:10px;">
                            <strong style="font-size:0.8rem;color:var(--muted);display:block;margin-bottom:6px;">SUGGESTED STUDENT COMMENT</strong>
                            <p style="font-size:0.9rem;line-height:1.6;">${escapeHtml(selectedSubmission.teacherReview.suggestedGrade.studentComment)}</p>
                            <button class="button-secondary" style="margin-top:10px;font-size:0.8rem;" data-action="use-suggested-comment">Copy to teacher notes</button>
                          </div>
                          ` : ""}
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
                      <label>Student text — select any passage, then click a code or "Add Note" to annotate it</label>
                      <div id="student-text-annotate" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto;cursor:text;">${renderAnnotatedText(selectedSubmission)}</div>
                    </div>
                    <div class="field" style="margin-top:6px;">
                      <div class="error-code-toolbar">
                        <span class="mini-label" style="align-self:center;">Annotate selection:</span>
                        ${ERROR_CODES.map(({code, label}) => `<button class="error-code-btn" data-action="add-annotation" data-code="${code}" title="${label}">${code}</button>`).join("")}
                        <button class="error-code-btn" data-action="add-annotation" data-code="NOTE" title="Add a custom note" style="background:#fff9e6;border-color:#e0c84a;">+ Note</button>
                      </div>
                      ${(selectedSubmission?.teacherReview?.annotations?.length) ? `
                        <div style="margin-top:10px;display:grid;gap:6px;">
                          ${selectedSubmission.teacherReview.annotations.map((ann, i) => `
                            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-radius:10px;background:#fff9e6;border:1px solid #e0c84a;font-size:0.88rem;">
                              <strong style="color:var(--accent-deep);flex-shrink:0;">${escapeHtml(ann.code)}</strong>
                              <span style="flex:1;">"${escapeHtml(ann.selectedText)}"${ann.note ? ` — ${escapeHtml(ann.note)}` : ""}</span>
                              <button class="error-code-btn" data-action="remove-annotation" data-annotation-index="${i}" style="flex-shrink:0;color:var(--danger);">✕</button>
                            </div>
                          `).join("")}
                        </div>
                      ` : `<p class="subtle" style="margin-top:8px;font-size:0.85rem;">No annotations yet. Select text above then click a code.</p>`}
                    </div>
                    <div class="field">
                      <label for="teacher-review-notes">Overall teacher notes</label>
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
  const assignments = getPublishedAssignments();
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
            ${assignments.length
              ? assignments.map((item) => `<option value="${item.id}" ${ui.selectedStudentAssignmentId === item.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")
              : `<option value="">No assignments published yet</option>`
            }
          </select>
        </div>
        ${
          !assignments.length
            ? `<div class="empty-state"><h3>Nothing here yet</h3><p>Your teacher hasn't published any assignments yet.</p></div>`
            : !assignment || !submission
              ? `<div class="empty-state"><h3>No assignment yet</h3><p>Choose an assignment from the dropdown above to get started.</p></div>`
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
                    <span class="pill">${submission.feedbackHistory.length}/${assignment.feedbackRequestLimit} feedback checks</span>
                    ${assignment.deadline ? `<span class="${new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill"}">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"}))}</span>` : ""}
                    ${assignment.chatTimeLimit > 0 ? `<span class="pill">⏱ ${assignment.chatTimeLimit} min chat</span>` : ""}
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
  const chatHistory = submission.chatHistory || [];
  const timeLimit = assignment.chatTimeLimit || 0;
  const chatStartedAt = submission.chatStartedAt;
  const elapsedMins = chatStartedAt ? (Date.now() - Date.parse(chatStartedAt)) / 60000 : 0;
  const timeExpired = timeLimit > 0 && elapsedMins >= timeLimit;
  const minsRemaining = timeLimit > 0 ? Math.max(0, Math.ceil(timeLimit - elapsedMins)) : null;
  const hasEnoughChat = chatHistory.length >= 2;

  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">1</div>
          <h3>Explore your ideas</h3>
          <p class="subtle">Chat with your writing coach. Answer the questions to develop your thinking before you write.</p>
        </div>
        ${minsRemaining !== null ? `
          <div class="chat-timer ${minsRemaining <= 5 ? "chat-timer-urgent" : ""}">
            ${timeExpired ? "⏱ Time's up" : `⏱ ${minsRemaining} min${minsRemaining === 1 ? "" : "s"} left`}
          </div>
        ` : ""}
      </div>
      <div class="teacher-ready-card" style="margin-bottom:14px;">
        <p class="mini-label">Your focus for this piece</p>
        <ul class="focus-list">${assignment.studentFocus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="chatbot-window" id="chatbot-window">
        ${chatHistory.length === 0 ? `
          <div class="chat-message chat-assistant">
            <div class="chat-bubble">Hello! I'm your writing coach. I won't write anything for you, but I'll ask you questions to help you think. Let's start: what topic or idea are you thinking about for this piece?</div>
          </div>
        ` : chatHistory.map((msg) => `
          <div class="chat-message chat-${escapeHtml(msg.role)}">
            <div class="chat-bubble">${escapeHtml(msg.content)}</div>
          </div>
        `).join("")}
        ${ui.chatLoading ? `
          <div class="chat-message chat-assistant">
            <div class="chat-bubble chat-loading"><span></span><span></span><span></span></div>
          </div>
        ` : ""}
      </div>
      ${!timeExpired ? `
        <div class="chat-input-row">
          <textarea id="chat-input" class="chat-input" placeholder="Type your answer here…" rows="2">${escapeHtml(ui.chatInput)}</textarea>
          <button class="button" data-action="send-chat-message" ${ui.chatLoading ? "disabled" : ""}>Send</button>
        </div>
      ` : `<div class="notice" style="margin-top:12px;">Your chat session has ended. Click Next to continue to your draft.</div>`}
      <div class="wizard-nav">
        <span></span>
        <button class="button" data-action="student-next-step" data-step="2" ${!hasEnoughChat ? "disabled title='Have a conversation with the coach first'" : ""}>Next: Write Draft</button>
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
        <span class="pill" id="autosave-indicator" style="opacity:0;transition:opacity 0.5s;">Saved</span>
      </div>
      <div class="feedback-list">
        ${
          submission.feedbackHistory.length
            ? submission.feedbackHistory.slice().reverse().map((entry) => {
                const hasCode = ERROR_CODES.some(({code}) => entry.items.some(i => i.includes(`[${code}]`)));
                return `
                  <div class="feedback-card">
                    <strong>${escapeHtml(formatDateTime(entry.timestamp))}</strong>
                    <ul>${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    ${hasCode ? `
                      <div class="error-code-key">
                        <p>Code key</p>
                        <dl>${ERROR_CODES.filter(({code}) => entry.items.some(i => i.includes(`[${code}]`))).map(({code, label}) => `<dt>${code}</dt><dd>${escapeHtml(label)}</dd>`).join("")}</dl>
                      </div>` : ""}
                  </div>`;
              }).join("")
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
  const selfAssessment = submission.selfAssessment || {};
  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">3</div>
          <h3>Write your final piece and reflect</h3>
          <p class="subtle">Write or paste your final version, then rate yourself honestly against the rubric before you submit.</p>
        </div>
        ${assignment.deadline && new Date(assignment.deadline) < new Date() && submission.status !== "submitted"
          ? `<div style="font-size:0.82rem;color:var(--danger);font-weight:600;text-align:right;">Deadline passed</div>`
          : `<button class="button" data-action="submit-final" ${submission.status === "submitted" ? "disabled" : ""}>Submit Final</button>`
        }
      </div>
      ${submission.status === "submitted" ? `
        <div class="submitted-banner">
          <div class="submitted-icon">✓</div>
          <div>
            <strong>Submitted!</strong>
            <p>Your work was handed in on ${escapeHtml(formatDateTime(submission.submittedAt))}. Your teacher will review it soon.</p>
          </div>
          <button class="button-secondary" data-action="download-work" style="flex-shrink:0;margin-left:auto;">⬇ Download my work</button>
        </div>
        ${submission.teacherReview?.savedAt ? `
          <div class="teacher-ready-card" style="margin-top:14px;border-left:4px solid var(--accent);">
            <p class="mini-label">Teacher feedback</p>
            ${submission.teacherReview.finalScore !== "" ? `
              <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">
                Score: ${escapeHtml(String(submission.teacherReview.finalScore))}
              </div>
            ` : ""}
            ${submission.teacherReview.finalNotes ? `
              <p style="white-space:pre-wrap;line-height:1.65;">${escapeHtml(submission.teacherReview.finalNotes)}</p>
            ` : ""}
            ${submission.teacherReview.annotations?.length ? `
              <div style="margin-top:12px;">
                <p class="mini-label">Comments on your writing</p>
                <div style="display:grid;gap:6px;margin-top:6px;">
                  ${submission.teacherReview.annotations.map((ann) => `
                    <div style="padding:8px 12px;border-radius:10px;background:#fff9e6;border:1px solid #e0c84a;font-size:0.88rem;">
                      <strong style="color:var(--accent-deep);">${escapeHtml(ann.code)}</strong>
                      <span style="margin-left:8px;">"${escapeHtml(ann.selectedText)}"${ann.note ? ` — ${escapeHtml(ann.note)}` : ""}</span>
                    </div>
                  `).join("")}
                </div>
              </div>
            ` : ""}
          </div>
        ` : ""}
      ` : ""}
      <textarea id="final-editor" class="final-editor" placeholder="Write your final piece here.">${escapeHtml(submission.finalText || submission.draftText)}</textarea>
      <div class="pill-row">
        <span class="pill">Final words: <strong id="final-word-count">${wordCount(submission.finalText || submission.draftText)}</strong></span>
        <span class="pill">Status: ${escapeHtml(titleCase(submission.status))}</span>
      </div>
      <div class="teacher-ready-card">
        <p class="mini-label">Self-assessment — rate yourself against the rubric</p>
        <p class="subtle" style="margin:4px 0 14px;">Be honest. Your teacher will see your ratings alongside their own assessment.</p>
        <div class="review-stack">
          ${assignment.rubric.map((item) => {
            const key = "sa_" + item.id;
            const currentVal = selfAssessment[key] || "";
            return `
              <div class="rubric-score" style="flex-direction:column;align-items:stretch;gap:10px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                  <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    <p class="rubric-description">${escapeHtml(item.description)}</p>
                  </div>
                  <strong style="flex-shrink:0;margin-left:12px;">/ ${item.points}</strong>
                </div>
                <div class="self-assessment-row">
                  ${[1,2,3,4,5].filter(n => n <= item.points).map(n => `
                    <label class="sa-option ${currentVal == n ? "sa-selected" : ""}">
                      <input type="radio" name="${key}" data-sa-key="${key}" value="${n}" ${currentVal == n ? "checked" : ""} style="display:none;" />
                      ${n}
                    </label>
                  `).join("")}
                </div>
              </div>`;
          }).join("")}
        </div>
        <div class="field" style="margin-top:16px;">
          <label>What did you improve from your draft to your final piece?</label>
          <textarea class="reflection-input" data-reflection-field="improved" placeholder="I improved my writing by..." style="min-height:80px;">${escapeHtml(submission.reflections.improved)}</textarea>
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
    const hasChat = (submission.chatHistory || []).length >= 2;
    if (!hasChat) {
      ui.notice = "Have a conversation with your writing coach before moving on.";
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
  // Use the editable AI draft if present, otherwise fall back to teacherDraft
  const source = ui.teacherAssist || ui.teacherDraft;
  const draft = ui.teacherAssist
    ? {
        title: (ui.teacherAssist.title || "").trim(),
        prompt: (ui.teacherAssist.prompt || "").trim(),
        focus: ui.teacherDraft.focus || "",
        brief: ui.teacherDraft.brief || "",
        assignmentType: ui.teacherAssist.assignmentType || "response",
        languageLevel: ui.teacherDraft.languageLevel,
        totalPoints: ui.teacherDraft.totalPoints,
        wordCountMin: Number(ui.teacherAssist.wordCountMin || 250),
        wordCountMax: Number(ui.teacherAssist.wordCountMax || 400),
        ideaRequestLimit: Number(ui.teacherDraft.ideaRequestLimit || 3),
        feedbackRequestLimit: Number(ui.teacherDraft.feedbackRequestLimit || 2),
        studentFocus: ui.teacherAssist.studentFocus || [],
        rubric: (ui.teacherAssist.rubric || []).filter((item) => (item.name || "").trim()),
      }
    : normalizeTeacherDraft(ui.teacherDraft);

  if (!draft.title || !draft.prompt) {
    ui.notice = "Generate the student-ready assignment first, then save it.";
    render();
    return;
  }

  const studentFocusArray = Array.isArray(draft.studentFocus)
    ? draft.studentFocus
    : splitLines(draft.studentFocus);

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
    studentFocus: studentFocusArray,
    rubric: draft.rubric.length ? draft.rubric : rubricForType(draft.assignmentType),
    createdBy: "teacher-1",
    createdAt: new Date().toISOString(),
    status: "draft",
    deadline: ui.teacherDraft.deadline || "",
    chatTimeLimit: Number(ui.teacherDraft.chatTimeLimit || 0),
  };

  state.assignments.unshift(assignment);
  ui.selectedAssignmentId = assignment.id;
  ui.selectedReviewSubmissionId = null;
  ui.teacherDraft = createBlankTeacherDraft();
  ui.teacherAssist = null;
  ui.notice = "Assignment saved as draft. Publish it when you're ready for students to see it.";
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

  if (assignment.deadline && new Date(assignment.deadline) < new Date()) {
    ui.notice = "The deadline for this assignment has passed. Speak to your teacher if you need an extension.";
    render();
    return;
  }

  if (!finalText) {
    ui.notice = "Write your final text before submitting.";
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

function getPublishedAssignments() {
  return state.assignments.filter((a) => a.status === "published" && (!a.classId || a.classId === currentClassId));
}

function getSelectedAssignment() {
  return state.assignments.find((assignment) => assignment.id === ui.selectedAssignmentId) || null;
}

function getStudentAssignment() {
  return state.assignments.find((assignment) => assignment.id === ui.selectedStudentAssignmentId && assignment.status === "published") || null;
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

  const published = getPublishedAssignments();
  if (!published.some((assignment) => assignment.id === ui.selectedStudentAssignmentId)) {
    ui.selectedStudentAssignmentId = published[0]?.id || null;
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
  const totalPoints = Number(draft.totalPoints || 20);
  const baseRubric = rubricForType(assignmentType);
  const pointsEach = Math.floor(totalPoints / baseRubric.length);
  const remainder = totalPoints - pointsEach * baseRubric.length;
  const rubric = baseRubric.map((item, i) => ({
    ...item,
    points: i === baseRubric.length - 1 ? pointsEach + remainder : pointsEach,
  }));

  return {
    title,
    prompt: studentPromptForType(assignmentType, mainTopic, draft.languageLevel),
    focus: `Keep the student focused on ${studentFocus[0].toLowerCase()}.`,
    assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: ranges.min,
    wordCountMax: ranges.max,
    studentFocus,
    rubric,
  };
}

function detectAssignmentType(text) {
  const lower = text.toLowerCase();
  if (/\bargue\b|\bopinion\b|\bpersuade\b|\bshould\b/.test(lower)) return "argument";
  if (/\bnarrative\b|\bstory\b|\bpersonal\b|\bmemory\b/.test(lower)) return "narrative";
  if (/\bprocess\b|\bsteps\b|\bhow to\b|\bprocedure\b/.test(lower)) return "process";
  if (/\bdefin\b|\bmeaning\b|\bwhat is\b|\bconcept\b/.test(lower)) return "definition";
  if (/\bcompar\b|\bcontrast\b|\bdifference\b|\bsimilar\b/.test(lower)) return "compare";
  if (/\bexplain\b|\binform\b|\bresearch\b|\bhow\b|\bwhy\b/.test(lower)) return "informational";
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
  if (type === "process") {
    return [
      { id: uid("rubric"), name: "Steps in order", description: "Explains the steps clearly and in the right order.", points: 4 },
      { id: uid("rubric"), name: "Detail and accuracy", description: "Each step has enough detail to follow.", points: 4 },
      { id: uid("rubric"), name: "Clarity", description: "A reader unfamiliar with the topic could follow along.", points: 4 },
      { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
    ];
  }
  if (type === "definition") {
    return [
      { id: uid("rubric"), name: "Core meaning", description: "Gives a clear and accurate definition.", points: 4 },
      { id: uid("rubric"), name: "Examples", description: "Uses examples that help the reader understand.", points: 4 },
      { id: uid("rubric"), name: "Clarity", description: "The explanation is easy to follow.", points: 4 },
      { id: uid("rubric"), name: "Revision and reflection", description: "Shows improvement from draft to final and explains changes.", points: 4 },
    ];
  }
  if (type === "compare") {
    return [
      { id: uid("rubric"), name: "Both sides covered", description: "Addresses both subjects fairly.", points: 4 },
      { id: uid("rubric"), name: "Key differences", description: "Identifies the most important similarities or differences.", points: 4 },
      { id: uid("rubric"), name: "Organisation", description: "Ideas are grouped logically and easy to follow.", points: 4 },
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

  if (type === "process") {
    return `${levelIntro} Explain how to do or make ${topic}. Describe each step clearly and in the right order.`;
  }
  if (type === "definition") {
    return `${levelIntro} Explain what ${topic} means. Give a clear definition and use at least one example to help the reader understand.`;
  }
  if (type === "compare") {
    return `${levelIntro} Compare and contrast two things related to ${topic}. Show how they are similar and how they are different.`;
  }
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
  if (type === "process") {
    return [
      `explaining each step of ${topic} clearly`,
      "putting the steps in the right order",
      "adding enough detail so someone can follow along",
      "checking that no steps are missing or confusing",
    ];
  }
  if (type === "definition") {
    return [
      `giving a clear, accurate meaning of ${topic}`,
      "using at least one example that helps the reader understand",
      "explaining any difficult words",
      "making sure the definition is complete and easy to follow",
    ];
  }
  if (type === "compare") {
    return [
      `identifying the key features of both sides of ${topic}`,
      "finding at least two clear similarities or differences",
      "organising your points so the comparison is easy to follow",
      "checking that both sides are treated fairly",
    ];
  }
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

function getChatbotSystemPrompt(assignment) {
  const typeGuide = {
    argument:      "help the student identify a clear opinion, find one strong reason or example, and think about why it matters",
    narrative:     "help the student identify one specific moment, recall sensory details, and think about why the moment matters to them",
    process:       "help the student think through the steps in order, spot what might be unclear, and consider what the reader needs to know to follow along",
    definition:    "help the student explain what the term really means, think of a concrete example, and consider why understanding it matters",
    compare:       "help the student identify key features of both subjects, find meaningful similarities and differences, and decide which difference matters most",
    informational: "help the student identify their main idea, think of supporting facts or examples, and consider how to explain it clearly to a reader",
    response:      "help the student fully understand the question, form a clear answer, and find support for their thinking",
    other:         "help the student clarify what they want to say, find support for their ideas, and plan how to structure their response",
  };

 const focus = typeGuide[assignment.assignmentType] || typeGuide.other;

  return `You are a supportive writing coach helping a student plan their writing. Your role is to ${focus}.

RULES:
1. Ask ONE question at a time. Keep it short and friendly.
2. NEVER write text the student could copy into their assignment.
3. If a student seems stuck or says they don't know, don't keep pushing. Instead, offer a simple, structured prompt like: "What are your two or three main ideas?" or "Which of those ideas would make the most sense to write about first?"
4. Help the student organise their thinking by asking questions like: "What is the most important thing you want to say?", "Which idea would come first — and why?", "What example could you use to explain that?"
5. If the student asks you to write for them, gently redirect with a question instead.
6. Match your vocabulary to CEFR level ${assignment.languageLevel} — keep it simple and encouraging.
7. Never repeat the same question twice in a conversation.

Assignment title: "${assignment.title}"
Task: "${assignment.prompt}"

Start by asking the student what topic or idea they are thinking about. If they struggle to answer, suggest they think about two or three possible ideas and pick the one they feel most confident about.`;
}
function renderAnnotatedText(submission) {
  const text = submission?.finalText || submission?.draftText || "No text submitted yet.";
  const annotations = submission?.teacherReview?.annotations || [];
  if (!annotations.length) return escapeHtml(text);

  const highlights = [];
  for (const ann of annotations) {
    const idx = text.indexOf(ann.selectedText);
    if (idx !== -1) {
      highlights.push({ start: idx, end: idx + ann.selectedText.length, code: ann.code });
    }
  }
  highlights.sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const h of highlights) {
    if (h.start < cursor) continue;
    result += escapeHtml(text.slice(cursor, h.start));
    result += `<mark style="background:#fff176;border-radius:3px;padding:1px 2px;" title="${escapeHtml(h.code)}">${escapeHtml(text.slice(h.start, h.end))}<sup style="font-size:0.7em;color:var(--accent-deep);font-weight:700;">${escapeHtml(h.code)}</sup></mark>`;
    cursor = h.end;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}

function downloadStudentWork(assignment, submission) {
  const student = getUserById(submission.studentId);
  const studentName = student?.name || "Student";
  const chatLines = (submission.chatHistory || []).map((m) => `
    <div class="msg msg-${m.role}">
      <strong>${m.role === "assistant" ? "Coach" : studentName}</strong>
      <p>${escapeHtml(m.content)}</p>
    </div>`).join("");

  const eventLines = (submission.writingEvents || []).map((e) => `
    <tr>
      <td>${escapeHtml(formatDateTime(e.timestamp))}</td>
      <td>${escapeHtml(titleCase(e.type))}</td>
      <td>${e.delta >= 0 ? "+" : ""}${e.delta}</td>
      <td>${e.flagged ? "⚠ Yes" : ""}</td>
      <td>${escapeHtml(e.preview || "")}</td>
    </tr>`).join("");

  const rubricLines = (assignment.rubric || []).map((r) => `
    <tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.description)}</td><td>${r.points}</td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escapeHtml(assignment.title)} — ${escapeHtml(studentName)}</title>
<style>
  body{font-family:Georgia,serif;max-width:820px;margin:40px auto;color:#1f2a1f;line-height:1.6}
  h1{font-size:1.5rem;border-bottom:2px solid #a55233;padding-bottom:8px}
  h2{font-size:1.1rem;margin-top:32px;color:#a55233}
  .meta{color:#667063;font-size:.9rem;margin-bottom:24px}
  .section{margin-top:24px}
  .msg{margin:10px 0;padding:10px 14px;border-radius:8px}
  .msg-assistant{background:#f4efe6;border-left:3px solid #a55233}
  .msg-user{background:#edf4ea;border-left:3px solid #6f8868}
  .msg strong{display:block;font-size:.8rem;margin-bottom:4px;color:#667063}
  .msg p{margin:0}
  pre{white-space:pre-wrap;word-break:break-word;background:#f8f3ea;padding:16px;border-radius:8px;font-size:.92rem}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th{text-align:left;padding:6px 10px;background:#f4efe6}
  td{padding:6px 10px;border-bottom:1px solid #ddd2c2}
  mark{background:#fff176;border-radius:3px;padding:1px 2px;}
  sup{font-size:0.7em;color:#a55233;font-weight:700;}
  @media print{body{margin:20px}}
</style>
</head>
<body>
<h1>${escapeHtml(assignment.title)}</h1>
<div class="meta">
  Student: <strong>${escapeHtml(studentName)}</strong> &nbsp;|&nbsp;
  Submitted: <strong>${submission.submittedAt ? escapeHtml(formatDateTime(submission.submittedAt)) : "Not yet submitted"}</strong>
  ${assignment.deadline ? `&nbsp;|&nbsp; Deadline: <strong>${escapeHtml(new Date(assignment.deadline).toLocaleString())}</strong>` : ""}
</div>

<h2>Assignment</h2>
<p>${escapeHtml(assignment.prompt)}</p>

<h2>1 — Coaching conversation</h2>
${chatLines || "<p><em>No conversation recorded.</em></p>"}

<h2>2 — Draft writing log</h2>
<table>
  <thead><tr><th>Time</th><th>Type</th><th>Change</th><th>Flagged?</th><th>Preview</th></tr></thead>
  <tbody>${eventLines || "<tr><td colspan='5'>No events recorded.</td></tr>"}</tbody>
</table>

<h2>Draft text</h2>
<pre>${escapeHtml(submission.draftText || "No draft.")}</pre>

<h2>3 — Final submission</h2>
<pre>${escapeHtml(submission.finalText || "No final text.")}</pre>

${(submission.teacherReview?.annotations?.length) ? `
<h2>Teacher annotations</h2>
<table>
  <thead><tr><th>Code</th><th>Selected text</th><th>Note</th></tr></thead>
  <tbody>${submission.teacherReview.annotations.map((ann) => `
    <tr>
      <td><strong>${escapeHtml(ann.code)}</strong></td>
      <td style="background:#fff9e6;">"${escapeHtml(ann.selectedText)}"</td>
      <td>${escapeHtml(ann.note || "")}</td>
    </tr>`).join("")}
  </tbody>
</table>` : ""}

${(submission.teacherReview?.finalScore !== "" && submission.teacherReview?.finalScore != null) ? `
<h2>Teacher score &amp; feedback</h2>
<p><strong>Score:</strong> ${escapeHtml(String(submission.teacherReview.finalScore))}</p>
${submission.teacherReview.finalNotes ? `<p>${escapeHtml(submission.teacherReview.finalNotes)}</p>` : ""}` : ""}

<h2>Guided outline</h2>
<p><strong>Part 1:</strong> ${escapeHtml(submission.outline?.partOne || "—")}</p>
<p><strong>Part 2:</strong> ${escapeHtml(submission.outline?.partTwo || "—")}</p>
<p><strong>Part 3:</strong> ${escapeHtml(submission.outline?.partThree || "—")}</p>

<h2>Reflection — what I improved</h2>
<p>${escapeHtml(submission.reflections?.improved || "—")}</p>

<h2>Rubric</h2>
<table>
  <thead><tr><th>Criterion</th><th>Description</th><th>Points</th></tr></thead>
  <tbody>${rubricLines}</tbody>
</table>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(assignment.title || "assignment").replace(/\s+/g, "-")}-${(studentName).replace(/\s+/g, "-")}-process.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
 URL.revokeObjectURL(url);
}

function getOutlineFields(assignment, submission) {
  const type = assignment.assignmentType || "response";
  const topic = extractKeywords(`${assignment.title} ${assignment.prompt}`)[0] || "your topic";
  const outline = submission.outline || {};

  if (type === "process") {
    return {
      fields: [
        { key: "partOne", label: "What you are explaining how to do", placeholder: "I am going to explain how to..." },
        { key: "partTwo", label: "The key steps", placeholder: "The main steps are..." },
        { key: "partThree", label: "Final step or result", placeholder: "At the end, the reader will be able to..." },
      ],
      values: outline,
    };
  }
  if (type === "definition") {
    return {
      fields: [
        { key: "partOne", label: "The term and its core meaning", placeholder: `${topic} means...` },
        { key: "partTwo", label: "An example that shows the meaning", placeholder: "For example..." },
        { key: "partThree", label: "Why this definition matters", placeholder: "Understanding this is important because..." },
      ],
      values: outline,
    };
  }
  if (type === "compare") {
    return {
      fields: [
        { key: "partOne", label: "What you are comparing", placeholder: "I am comparing ... and ..." },
        { key: "partTwo", label: "Key similarities", placeholder: "Both are similar because..." },
        { key: "partThree", label: "Key differences", placeholder: "The main difference is..." },
      ],
      values: outline,
    };
  }
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
  const config = getOutlineFields(assignment, submission);
  return config.fields.every((field) => String(submission.outline?.[field.key] || "").trim());
}

function renderOutlineSummary(assignment, submission) {
  const outline = getOutlineFields(assignment, submission);
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
    studentComment: buildSuggestedStudentComment(assignment, submission, metrics, totalScore, maxScore),
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

function isJibberish(text) {
  if (!text || text.trim().length < 3) return true;
  const t = text.trim();
  const wordList = t.split(/\s+/);
  if (wordList.length < 2 && t.length < 8) return true;
  const uniqueChars = new Set(t.toLowerCase().replace(/\s/g, "")).size;
  if (uniqueChars < 4 && t.length > 5) return true;
  return false;
}

function assessChatEngagement(chatHistory) {
  const studentMessages = (chatHistory || []).filter((m) => m.role === "user");
  if (!studentMessages.length) return { engaged: false, messageCount: 0, note: "No chat engagement — student did not use the coaching conversation." };
  const meaningful = studentMessages.filter((m) => !isJibberish(m.content) && m.content.trim().split(/\s+/).length >= 3);
  const ratio = meaningful.length / studentMessages.length;
  return {
    engaged: ratio >= 0.5,
    messageCount: studentMessages.length,
    note: ratio >= 0.75
      ? `Student engaged meaningfully in the coaching chat (${studentMessages.length} messages).`
      : ratio >= 0.5
        ? `Student used the chat but some responses were brief or underdeveloped (${studentMessages.length} messages).`
        : `Student chat responses were mostly too short or unclear to show real thinking (${studentMessages.length} messages).`,
  };
}

function assessOutlineEngagement(submission, assignment) {
  const config = getOutlineFields(assignment, submission);
  const fields = config?.fields || [];
  const results = fields.map((field) => {
    const val = String(submission.outline?.[field.key] || "").trim();
    return { label: field.label, value: val, jibberish: isJibberish(val), empty: !val };
  });
  const empties = results.filter((r) => r.empty).length;
  const jibberish = results.filter((r) => !r.empty && r.jibberish).length;
  return {
    complete: empties === 0 && jibberish === 0,
    note: empties > 0
      ? `${empties} outline field${empties > 1 ? "s were" : " was"} left blank.`
      : jibberish > 0
        ? `${jibberish} outline field${jibberish > 1 ? "s appear" : " appears"} to contain placeholder or jibberish text rather than real thinking.`
        : "Outline was completed thoughtfully.",
  };
}

function buildSuggestedStudentComment(assignment, submission, metrics, totalScore, maxScore) {
  const chat = assessChatEngagement(submission.chatHistory);
  const outline = assessOutlineEngagement(submission, assignment);
  const reflection = submission.reflections.improved.trim();
  const pasteFlags = metrics.largePasteCount;
  const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const opening = scorePercent >= 80
    ? "Well done on this assignment."
    : scorePercent >= 60
      ? "You have made a reasonable attempt at this assignment."
      : "This assignment needed more effort and care.";

  const chatComment = chat.engaged
    ? "Your coaching conversation showed real engagement with your ideas before writing."
    : chat.messageCount === 0
      ? "You did not use the coaching chat — working through your ideas there first would have strengthened your writing."
      : "Your responses in the coaching chat were quite brief. Try to explain your thinking more fully next time.";

  const outlineComment = outline.complete
    ? "Your outline showed you had planned your writing carefully."
    : "Your outline was not fully or thoughtfully completed — planning your ideas before drafting makes a real difference to the quality of your writing.";

  const writingComment = metrics.targetHit
    ? "Your final piece met the expected length."
    : "Your final piece did not meet the expected word count — make sure you develop your ideas fully.";

  const revisionComment = metrics.revisionCount >= 4
    ? "Your editing process shows you revised your work, which is good practice."
    : "There was very little revision between your draft and final piece — always review and improve your writing before submitting.";

  const reflectionComment = reflection
    ? "Your reflection on what you improved showed self-awareness."
    : "You did not complete the reflection on what you improved — this is an important part of the writing process.";

  const pasteComment = pasteFlags
    ? ` Note: the system detected ${pasteFlags} large paste event${pasteFlags > 1 ? "s" : ""} in your writing log — all work should be your own.`
    : "";

  return `${opening} ${chatComment} ${outlineComment} ${writingComment} ${revisionComment} ${reflectionComment}${pasteComment}`;
}

function buildGradeJustification(assignment, submission, metrics, totalScore, maxScore) {
  const reflectionComplete = submission.reflections.improved.trim();
  const outlineAssessment = assessOutlineEngagement(submission, assignment);
  const chatAssessment = assessChatEngagement(submission.chatHistory);
  const pasteFlags = metrics.largePasteCount;
  const authorshipNote = pasteFlags
    ? ` The process log includes ${pasteFlags} large paste event${pasteFlags === 1 ? "" : "s"}, so authorship should be verified.`
    : " No large paste concerns detected.";
  return `Suggested score: ${totalScore}/${maxScore}. The final piece is ${metrics.targetHit ? "within" : "outside"} the target word range and includes ${submission.writingEvents.length} tracked edit events. ${outlineAssessment.note} ${chatAssessment.note} ${reflectionComplete ? "The student completed the reflection." : "The revision reflection is incomplete."}${authorshipNote}`;
}

function createBlankTeacherDraft() {
  return {
    brief: "",
    title: "",
    prompt: "",
    focus: "",
    assignmentType: "response",
    languageLevel: "B1",
    totalPoints: 20,
    wordCountMin: 250,
    wordCountMax: 400,
    ideaRequestLimit: 3,
    feedbackRequestLimit: 2,
    chatTimeLimit: 0,
    deadline: "",
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
    totalPoints: Number(draft.totalPoints || 20),
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
    chatHistory: [],
    chatStartedAt: null,
    teacherReview: {
      suggestedGrade: null,
      finalScore: "",
      finalNotes: "",
      annotations: [],
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
    status: assignment?.status || "published",
    deadline: assignment?.deadline || "",
    chatTimeLimit: Number(assignment?.chatTimeLimit ?? 0),
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
      annotations: safeArray(submission?.teacherReview?.annotations),
    },
    chatHistory: safeArray(submission?.chatHistory).map((msg) => ({
      role: msg?.role || "user",
      content: msg?.content || "",
      timestamp: msg?.timestamp || new Date().toISOString(),
    })),
    chatStartedAt: submission?.chatStartedAt || null,
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
    status: "published",
    chatTimeLimit: 0,
    deadline: "",
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
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) throw new Error("no stored state");
    return normalizeState(JSON.parse(stored));
  } catch (e) {
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
