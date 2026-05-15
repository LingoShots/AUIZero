(function () {
  function summarizeLocalSubmissionForDebug(submission) {
    if (!submission) return null;
    const { isStudentSubmissionLocked, safeArray } = window;
    const { ui } = window.AppState;
    const review = submission.teacherReview || {};
    return {
      id: submission.id || null,
      assignmentId: submission.assignmentId || null,
      studentId: submission.studentId || null,
      status: submission.status || null,
      submittedAt: submission.submittedAt || null,
      updatedAt: submission.updatedAt || null,
      locked: isStudentSubmissionLocked(submission),
      renderedStep: ui.studentStep,
      teacherReview: {
        status: review.status || null,
        savedAt: review.savedAt || null,
        finalScore: review.finalScore ?? null,
        finalNotesLength: String(review.finalNotes || "").length,
        rowScoresCount: safeArray(review.rowScores).length,
        annotationsCount: safeArray(review.annotations).length,
      },
    };
  }

  function renderUpcomingStudentClasses(currentClasses, currentClassId, assignments) {
    const { escapeHtml } = window;
    return `
      <div class="upcoming-section">
        <p class="mini-label" style="margin-bottom:10px;">Your classes & assignments</p>
        ${currentClasses.map((cls) => {
          const clsAssignments = assignments.filter((assignment) => assignment.status === "published" && assignment.classId === cls.id);
          return `
            <div class="upcoming-class-block">
              <div class="upcoming-class-header">
                <strong>${escapeHtml(cls.name)}</strong>
                ${cls.id !== currentClassId ? `<button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="switch-class" data-class-id="${cls.id}">Open</button>` : `<span class="pill">Current</span>`}
              </div>
              ${clsAssignments.length ? clsAssignments.map((assignment) => `
                <div class="upcoming-assignment-row">
                  <span>${escapeHtml(assignment.title)}</span>
                  <span style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                    ${assignment.deadline ? `<span class="${new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill"}" style="font-size:0.75rem;">Due ${new Date(assignment.deadline).toLocaleDateString(undefined,{day:"numeric",month:"short"})}</span>` : ""}
                    <button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="open-assignment" data-class-id="${cls.id}" data-assignment-id="${assignment.id}">Start</button>
                  </span>
                </div>
              `).join("") : `<p class="subtle" style="font-size:0.85rem;margin:6px 0;">No published assignments yet.</p>`}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderStudentAssignmentOptions(assignments, assignmentBuckets, selectedAssignmentId) {
    const { escapeHtml } = window;
    if (!assignments.length) return `<option value="">No assignments published yet</option>`;
    return `
      ${assignmentBuckets.current.length ? `
        <optgroup label="Current work">
          ${assignmentBuckets.current.map(({ assignment }) => `<option value="${assignment.id}" ${selectedAssignmentId === assignment.id ? "selected" : ""}>${escapeHtml(assignment.title)}</option>`).join("")}
        </optgroup>
      ` : ""}
      ${assignmentBuckets.submitted.length ? `
        <optgroup label="Submitted work">
          ${assignmentBuckets.submitted.map(({ assignment, isGraded }) => `<option value="${assignment.id}" ${selectedAssignmentId === assignment.id ? "selected" : ""}>${escapeHtml(assignment.title)}${isGraded ? " — Graded" : " — Awaiting review"}</option>`).join("")}
        </optgroup>
      ` : ""}
    `;
  }

  function renderStudentActiveAssignment(assignment, submission, studentStep) {
    const { escapeHtml, renderRichTextHtml, renderSubmissionDebugPanel, renderStudentStep } = window;
    return `
      <div class="student-progress">
        ${,[1, 2, 3, 4].map((step) => `
          <div class="progress-step ${studentStep === step ? "active" : studentStep > step ? "done" : ""}">
            <span>${step}</span>
            <strong>${step === 1 ? "Get ideas" : step === 2 ? "Write draft" : step === 3 ? "Review & finalise" : "Submit"}</strong>
          </div>
        `).join("")}
      </div>
      <div class="student-card">
        <p class="mini-label">Your task</p>
        <h3>${escapeHtml(assignment.title)}</h3>
        <div class="student-task">${renderRichTextHtml(assignment.prompt)}</div>
        <div class="pill-row">
          <span class="pill">${assignment.wordCountMin}-${assignment.wordCountMax} words</span>
          <span class="pill">${submission.feedbackHistory.length}/${assignment.feedbackRequestLimit} feedback checks</span>
          ${assignment.deadline ? `<span class="${new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill"}">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"})))}</span>` : ""}
          ${assignment.chatTimeLimit > 0 ? `<span class="pill">⏱ ${assignment.chatTimeLimit} min chat</span>` : ""}
         </div>
        </div>
        ${renderSubmissionDebugPanel(assignment, submission)}
        ${renderStudentStep(assignment, submission)}
      `;
  }

  