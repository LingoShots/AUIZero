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
    const { escapeHtml } = globalThis.window;
    return `
      <div class="upcoming-section">
        <p class="mini-label" style="margin-bottom:10px;">Your classes & assignments</p>
        ${currentClasses.map((cls) => {
          const clsAssignments = assignments.filter((assignment) => assignment.status === "published" && assignment.classId === cls.id);
          const assignmentRows = clsAssignments.length
            ? clsAssignments.map((assignment) => {
                const deadlineClass = new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill";
                const deadline = assignment.deadline
                  ? `<span class="${deadlineClass}" style="font-size:0.75rem;">Due ${new Date(assignment.deadline).toLocaleDateString(undefined,{day:"numeric",month:"short"})}</span>`
                  : "";
                return `
                  <div class="upcoming-assignment-row">
                    <span>${escapeHtml(assignment.title)}</span>
                    <span style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                      ${deadline}
                      <button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="open-assignment" data-class-id="${cls.id}" data-assignment-id="${assignment.id}">Start</button>
                    </span>
                  </div>
                `;
              }).join("")
            : `<p class="subtle" style="font-size:0.85rem;margin:6px 0;">No published assignments yet.</p>`;
          return `
            <div class="upcoming-class-block">
              <div class="upcoming-class-header">
                <strong>${escapeHtml(cls.name)}</strong>
                ${cls.id !== currentClassId ? `<button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="switch-class" data-class-id="${cls.id}">Open</button>` : `<span class="pill">Current</span>`}
              </div>
              ${assignmentRows}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderStudentAssignmentOptions(assignments, assignmentBuckets, selectedAssignmentId) {
    const { escapeHtml } = globalThis.window;
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
    const { escapeHtml, renderRichTextHtml, renderSubmissionDebugPanel, renderStudentStep } = globalThis.window;
    const stepLabels = ["Get ideas", "Write draft", "Review & finalise", "Submit"];
    const getProgressStepClass = (step) => {
      if (studentStep === step) return "active";
      return studentStep > step ? "done" : "";
    };
    return `
      <div class="student-progress">
        ${[1, 2, 3, 4].map((step) => `
          <div class="progress-step ${getProgressStepClass(step)}">
            <span>${step}</span>
            <strong>${stepLabels[step - 1]}</strong>
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
          ${assignment.deadline ? `<span class="${new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill"}">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"}))}</span>` : ""}
          ${assignment.chatTimeLimit > 0 ? `<span class="pill">⏱ ${assignment.chatTimeLimit} min chat</span>` : ""}
        </div>
      </div>
      ${renderSubmissionDebugPanel(assignment, submission)}
      ${renderStudentStep(assignment, submission)}
    `;
  }

  function renderStudentWorkspace() {
    const { ui, state, currentClasses, currentClassId, currentProfile } = globalThis.window.AppState;
    const { escapeHtml, getPublishedAssignments, getStudentAssignmentBuckets,
      getUserById, getStudentSubmission, getStudentAssignment } = globalThis.window;

    const assignments = getPublishedAssignments();
    const assignmentBuckets = getStudentAssignmentBuckets();
    const student = getUserById(ui.activeUserId);
    const submission = getStudentSubmission();
    const assignment = getStudentAssignment();
    const currentClass = currentClasses.find(c => c.id === currentClassId);
    const hasOtherGradedWork = assignmentBuckets.submitted.some(({ assignment: item, isGraded }) =>
      isGraded && item.id !== ui.selectedStudentAssignmentId
    );

    return `
    <section class="student-shell">
      <div class="panel student-panel">
        <div class="panel-header">
          <div>
            <p class="mini-label">Student View</p>
            <h2 class="panel-title">${escapeHtml(student?.name || currentProfile?.name || "Student")}</h2>
          </div>
          ${currentClasses.length > 1 ? `
            <div class="field" style="min-width:180px;">
              <label for="student-class-select" style="font-size:0.82rem;">Class</label>
              <select id="student-class-select" aria-label="Switch class">
                ${currentClasses.map(c => `<option value="${c.id}" ${currentClassId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              </select>
            </div>
          ` : ""}
        </div>
        ${currentClass ? `
          <div class="class-banner">
            <span class="class-banner-icon">🎓</span>
            <span><strong>${escapeHtml(currentClass.name)}</strong>${currentClass.teacher_name ? ` · ${escapeHtml(currentClass.teacher_name)}` : ""}</span>
          </div>
        ` : ""}
        ${currentClasses.length > 0 && !assignment ? renderUpcomingStudentClasses(currentClasses, currentClassId, state.assignments) : ""}
        <div class="field">
          <label for="student-assignment-select">Choose assignment</label>
          <select id="student-assignment-select" aria-label="Select assignment">
            ${renderStudentAssignmentOptions(assignments, assignmentBuckets, ui.selectedStudentAssignmentId)}
          </select>
        </div>
        ${assignments.length ? `
          <div class="pill-row" style="margin-top:-4px;">
            <span class="pill">${assignmentBuckets.current.length} current</span>
            <span class="pill">${assignmentBuckets.submitted.length} submitted</span>
            ${hasOtherGradedWork ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ Graded work available</span>` : ""}
          </div>
        ` : ""}
        ${hasOtherGradedWork ? `<p class="subtle" style="margin-top:8px;font-size:0.84rem;">Open any assignment marked <strong>Graded</strong> to view your teacher's notes, rubric breakdown, and marked copy.</p>` : ""}
        ${renderStudentWorkspaceBody(assignments, assignment, submission, ui.studentStep)}
      </div>
    </section>
  `;
  }

  function renderStudentWorkspaceBody(assignments, assignment, submission, studentStep) {
    if (!assignments.length) {
      return `<div class="empty-state"><h3>Nothing here yet</h3><p>Your teacher hasn't published any assignments yet.</p></div>`;
    }
    if (!assignment || !submission) {
      return `<div class="empty-state"><h3>No assignment yet</h3><p>Choose an assignment from the dropdown above to get started.</p></div>`;
    }
    return renderStudentActiveAssignment(assignment, submission, studentStep);
  }

  function renderSubmissionDebugPanel(assignment, submission) {
    const { escapeHtml, isSubmissionDebugEnabled } = window;
    const { ui } = window.AppState;
    if (!isSubmissionDebugEnabled()) return "";
    const localSummary = summarizeLocalSubmissionForDebug(submission);
    const serverSummary = ui.latestSubmissionDebug || { note: "Server debug has not loaded yet." };
    return `
    <details class="teacher-ready-card" open style="border-color:#f59e0b;background:#fff7ed;margin:14px 0;">
      <summary style="cursor:pointer;font-weight:800;color:#9a3412;">Submission debug</summary>
      <p class="subtle" style="margin:8px 0;">Temporary diagnostic. This shows what the student UI is rendering locally and what the server reports for the selected assignment.</p>
      <div class="pill-row" style="margin-bottom:8px;">
        <span class="pill">Assignment: ${escapeHtml(assignment?.id || "")}</span>
        <span class="pill">Selected: ${escapeHtml(ui.selectedStudentAssignmentId || "")}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
        <div>
          <p class="mini-label">Local client state</p>
          <pre style="white-space:pre-wrap;word-break:break-word;font-size:0.75rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;">${escapeHtml(JSON.stringify(localSummary, null, 2))}</pre>
        </div>
        <div>
          <p class="mini-label">Server debug response</p>
          <pre style="white-space:pre-wrap;word-break:break-word;font-size:0.75rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;">${escapeHtml(JSON.stringify(serverSummary, null, 2))}</pre>
        </div>
      </div>
      <button class="button-ghost" data-action="refresh-submission-debug" style="margin-top:10px;">Refresh debug</button>
    </details>
  `;
  }

  function renderEmailDebugPanel(assignment, submission) {
    const { escapeHtml, isEmailDebugEnabled } = window;
    const { ui } = window.AppState;
    if (!isEmailDebugEnabled()) return "";
    const latest = ui.latestEmailDebug || { note: "Email diagnostic has not loaded yet." };
    return `
    <details class="teacher-ready-card" open style="border-color:#0ea5e9;background:#f0f9ff;margin:14px 0;">
      <summary style="cursor:pointer;font-weight:800;color:#075985;">Email diagnostics</summary>
      <p class="subtle" style="margin:8px 0;">Temporary diagnostic. This checks config, recipient lookup, current submission state, notification guards, and idempotency keys.</p>
      <div class="pill-row" style="margin-bottom:8px;">
        <span class="pill">Assignment: ${escapeHtml(assignment?.id || "")}</span>
        <span class="pill">Student: ${escapeHtml(submission?.studentId || "")}</span>
      </div>
      <pre style="white-space:pre-wrap;word-break:break-word;font-size:0.75rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;">${escapeHtml(JSON.stringify(latest, null, 2))}</pre>
      <button class="button-ghost" data-action="refresh-email-debug" style="margin-top:10px;">Refresh email diagnostics</button>
    </details>
  `;
  }

  function renderStudentStep(assignment, submission) {
    const { isStudentSubmissionLocked } = window;
    const { ui } = window.AppState;
    if (isStudentSubmissionLocked(submission)) {
      return renderStudentFinalStep(assignment, submission);
    }
    if (ui.studentStep === 1) {
      return renderStudentIdeasStep(assignment, submission);
    }
    if (ui.studentStep === 2) {
      return renderStudentDraftStep(assignment, submission);
    }
    if (ui.studentStep === 3) {
      return renderStudentReviewStep(assignment, submission);
    }
    return renderStudentFinalStep(assignment, submission);
  }

  function renderStudentIdeasStep(assignment, submission) {
    const { isChatDisabled, resumeActiveChatSession,
      isChatSessionExpired, getActiveChatElapsedMs, getOutlineFields, isOutlineComplete,
      persistState } = window;
    const { ui } = window.AppState;

    const chatHistory = submission.chatHistory || [];
    const chatDisabled = isChatDisabled(assignment);
    const timeLimit = chatDisabled ? 0 : Math.max(0, Number(assignment.chatTimeLimit || 0));
    const chatStartedAt = submission.chatStartedAt;
    if (!chatDisabled && chatStartedAt && !submission.chatSkippedAt && !submission.chatExpiredAt && !document.hidden) {
      resumeActiveChatSession();
    }
    const timeExpired = isChatSessionExpired(assignment, submission);
    const totalSecsRemaining = (timeLimit > 0 && chatStartedAt) ? Math.max(0, Math.round((timeLimit * 60) - getActiveChatElapsedMs(assignment, submission) / 1000)) : null;
    const minsRemaining = totalSecsRemaining !== null ? Math.floor(totalSecsRemaining / 60) : null;
    const secsRemaining = totalSecsRemaining !== null ? totalSecsRemaining % 60 : null;
    const hasEnoughChat = chatDisabled || submission.chatSkippedAt || chatHistory.length >= 2;
    const outlineFields = getOutlineFields(assignment, submission);
    const outlineComplete = isOutlineComplete(submission, assignment);
    if (timeExpired && !submission.chatExpiredAt) {
      submission.chatExpiredAt = new Date().toISOString();
      persistState();
    }

    const locked = submission.finalUnlocked;

    return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">1</div>
          <h3>Explore your ideas</h3>
          <p class="subtle">${chatDisabled ? "Your teacher has turned off the chatbot for this assignment. You can move straight to drafting when you are ready." : "Step 1: use the coach to build your outline and test your ideas. When you feel ready, click Next to move to drafting."}</p>
        </div>
      </div>
      ${renderStudentIdeasChatPanel(assignment, submission, { chatHistory, chatDisabled, locked, timeExpired, ui })}
      ${renderStudentOutlineCard(submission, outlineFields, locked)}
      ${renderStudentIdeasNavigation({
        chatDisabled,
        hasEnoughChat,
        locked,
        minsRemaining,
        outlineComplete,
        secsRemaining,
        timeExpired,
        timeLimit,
      })}
    </div>
  `;
  }

  function renderStudentIdeasChatPanel(assignment, submission, { chatHistory, chatDisabled, locked, timeExpired, ui }) {
    const { escapeHtml } = globalThis.window;
    if (locked) {
      return `
        <div style="background:#f5f5f3;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
          <p style="margin:0;font-size:0.88rem;color:var(--muted);">You've started your final version — the coach is no longer available. Your conversation is saved below for reference.</p>
        </div>
        <div style="opacity:0.4;pointer-events:none;">
          <div class="chatbot-window">
            ${chatHistory.map((msg) => `
              <div class="chat-message chat-${escapeHtml(msg.role)}">
                <div class="chat-bubble">${escapeHtml(msg.content)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }
    if (chatDisabled) {
      return `
        <div class="teacher-ready-card">
          <p class="mini-label">Planning prompt</p>
          <p class="subtle" style="margin-bottom:10px;">Take a minute to jot down your main idea and one example you might use before you start drafting.</p>
          <textarea id="chat-skip-notes" class="chat-input" rows="3" placeholder="Optional: note your main idea here before you draft.">${escapeHtml(submission.outline?.partOne || "")}</textarea>
        </div>
      `;
    }
    return `
      <div class="chatbot-window" id="chatbot-window">
        ${chatHistory.length === 0 ? `
          <div class="chat-message chat-assistant">
            <div class="chat-bubble">Hello! I'm your writing coach. I won't write anything for you, but I'll ask you questions to help you think. Let's start outlining: What are your thoughts on the topic "${escapeHtml(assignment.title || "this assignment")}"?</div>
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
    `;
  }

  function renderStudentOutlineCard(submission, outlineFields, locked) {
    const { escapeHtml, escapeAttribute } = globalThis.window;
    return `
      <div class="teacher-ready-card" style="margin-top:14px;${locked ? "opacity:0.55;pointer-events:none;" : ""}">
        <p class="mini-label">Build your outline</p>
        <p class="subtle" style="margin:4px 0 12px;">Type the bones of your plan in your own words. This helps you start the draft and gives your teacher better evidence of your planning process.</p>
        <div class="field-grid compact-grid">
          ${outlineFields.fields.map((field) => `
            <label class="field">
              <span>${escapeHtml(field.label)}</span>
              <textarea data-outline-field="${escapeAttribute(field.key)}" rows="2" placeholder="${escapeAttribute(field.placeholder)}" ${locked ? "disabled" : ""}>${escapeHtml(submission.outline?.[field.key] || "")}</textarea>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderStudentIdeasNavigation({ chatDisabled, hasEnoughChat, locked, minsRemaining, outlineComplete, secsRemaining, timeExpired, timeLimit }) {
    return `
      <div class="wizard-nav">
        ${locked || chatDisabled ? `<span></span>` : `
          <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex-wrap:wrap;">
            ${timeLimit > 0 && minsRemaining !== null ? `
              <div class="chat-timer ${minsRemaining <= 5 ? "chat-timer-urgent" : ""}">
                ${timeExpired ? "⏱ Time's up" : `⏱ ${minsRemaining}:${String(secsRemaining).padStart(2,'0')} left`}
              </div>
            ` : ""}
          </div>
        `}
        <button class="button" data-action="student-next-step" data-step="2" ${!hasEnoughChat || !outlineComplete ? "disabled title='Have a short coach conversation and complete the outline first'" : ""}>Next: Write Draft</button>
      </div>
    `;
  }

  function renderStudentFeedbackCard(entry) {
    const { escapeHtml, safeArray, formatDateTime } = globalThis.window;
    const { getErrorCodes } = globalThis.window.AppConstants;
    const errorCodes = getErrorCodes();
    const items = safeArray(entry.items).map((item) => String(item || "").trim()).filter(Boolean);
    const matchingCodes = errorCodes.filter(({ code }) => items.some((item) => item.includes(`[${code}]`)));
    return `
      <div class="feedback-card">
        <strong>${escapeHtml(formatDateTime(entry.timestamp))}</strong>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        ${matchingCodes.length ? `
          <div class="error-code-key">
            <p>Code key</p>
            <dl>${matchingCodes.map(({ code, label }) => `<dt>${code}</dt><dd>${escapeHtml(label)}</dd>`).join("")}</dl>
          </div>` : ""}
      </div>
    `;
  }

  function renderStudentDraftStep(assignment, submission) {
    const { escapeHtml, wordCount, safeArray } = window;
    const { ui } = window.AppState;

    const feedbackUsed = Number(safeArray(submission.feedbackHistory).length || 0);
    const feedbackLimit = Number(assignment.feedbackRequestLimit || 0);
    return `
   <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">2</div>
          <h3>Write your draft</h3>
          <p class="subtle">Write in your own words. The tool keeps track of your writing process while you work.</p>
        </div>
      </div>
      ${submission.finalUnlocked ? `
        <div style="background:#f5f5f3;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
          <p style="margin:0;font-size:0.88rem;color:var(--muted);">You've started your final version. Your draft is saved here for your teacher but can no longer be edited.</p>
        </div>
        <div style="background:#f5f5f3;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.8;white-space:pre-wrap;word-break:break-word;color:var(--muted);min-height:200px;">${escapeHtml(submission.draftText || "")}</div>
      ` : `
        <div class="field-grid compact-grid">
          <div class="field inline-end">
            <button class="button-ghost" data-action="save-draft">Save Draft</button>
          </div>
        </div>
        <div class="pill-row" style="margin-bottom:8px;">
          <button class="button-ghost" data-action="scroll-editor-top" data-target="draft-editor" style="font-size:0.8rem;min-height:32px;">Jump to top</button>
          <button class="button-ghost" data-action="scroll-editor-bottom" data-target="draft-editor" style="font-size:0.8rem;min-height:32px;">Jump to bottom</button>
        </div>
        <div class="editor-with-lines">
          <div class="line-gutter" id="draft-editor-gutter" aria-hidden="true"></div>
          <textarea id="draft-editor" class="draft-editor" data-line-gutter="draft-editor-gutter" placeholder="Start your draft here.">${escapeHtml(submission.draftText)}</textarea>
        </div>
        <div class="pill-row">
          <span class="pill">Words: <strong id="draft-word-count">${wordCount(submission.draftText)}</strong></span>
          <span class="pill">Tracked edits: <strong id="draft-event-count">${submission.writingEvents.length}</strong></span>
          <span class="pill" id="autosave-indicator" style="opacity:0;transition:opacity 0.5s;">Saved</span>
        </div>
        <p id="draft-save-status" class="subtle" style="margin:8px 0 0;min-height:1.2em;">${escapeHtml(ui.draftSaveMessage || "")}</p>
      `}
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="1">Back</button>
        <button class="button" data-action="save-draft-and-next">Save and next</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
    </div>
  `;
  }

  function renderStudentReviewStep(assignment, submission) {
    const { escapeHtml, safeArray, wordCount } = globalThis.window;
    const { ui } = globalThis.window.AppState;
    const { getStudentFeedbackButtonState } = globalThis.window.AiAssistUtils;

    const feedbackEntries = safeArray(submission?.feedbackHistory);
    const feedbackLimit = Number(assignment?.feedbackRequestLimit ?? 3);
    const feedbackUsed = feedbackEntries.length;
    const feedbackButton = getStudentFeedbackButtonState({
      loading: ui.draftFeedbackLoading,
      feedbackUsed,
      feedbackLimit,
    });

    return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">3</div>
          <h3>Write your final version and get AI feedback</h3>
          <p class="subtle">Your draft has been copied below. Revise it here, use AI feedback if you want, then continue to self-assessment.</p>
        </div>
      </div>
      <div class="field-grid compact-grid">
        <div class="field inline-end">
          <button class="button-secondary" data-action="request-feedback" ${feedbackButton.disabled ? "disabled" : ""}>${feedbackButton.label}</button>
        </div>
      </div>
      <div class="feedback-list">
        ${
          feedbackEntries.length
            ? feedbackEntries.slice().reverse().map(renderStudentFeedbackCard).join("")
            : `<div class="empty-state compact-empty"><h3>No AI feedback yet</h3><p>Click "Get AI feedback" to get suggestions on your draft before you write your final version.</p></div>`
        }
      </div>
      <div class="pill-row" style="margin-bottom:8px;margin-top:16px;">
        <button class="button-ghost" data-action="scroll-editor-top" data-target="final-editor" style="font-size:0.8rem;min-height:32px;">Jump to top</button>
        <button class="button-ghost" data-action="scroll-editor-bottom" data-target="final-editor" style="font-size:0.8rem;min-height:32px;">Jump to bottom</button>
      </div>
      <div class="editor-with-lines">
        <div class="line-gutter" id="final-editor-gutter" aria-hidden="true"></div>
        <textarea id="final-editor" class="final-editor" data-line-gutter="final-editor-gutter" placeholder="Write your final version here.">${escapeHtml(submission.finalText || submission.draftText)}</textarea>
      </div>
      <div class="pill-row">
        <span class="pill">Final words: <strong id="final-word-count">${wordCount(submission.finalText || submission.draftText)}</strong></span>
        <span class="pill" id="autosave-indicator" style="opacity:0;transition:opacity 0.5s;">Saved</span>
      </div>
      <p id="draft-save-status" class="subtle" style="margin:8px 0 0;min-height:1.2em;">${escapeHtml(ui.draftSaveMessage || "")}</p>
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="2">Back</button>
        <button class="button-secondary" data-action="request-feedback" ${feedbackButton.disabled ? "disabled" : ""}>${feedbackButton.label}</button>
        <button class="button" data-action="student-next-step" data-step="4" ${!submission.finalText?.trim() && !submission.draftText?.trim() ? "disabled" : ""}>Next</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
    </div>
  `;
  }

  function renderStudentFinalStep(assignment, submission) {
    const { isStudentSubmissionLocked, getTeacherReviewRowsForExport } = globalThis.window;
    const { getRubricSchema } = globalThis.window;
    const { getStudentSelfAssessmentRowScoreMap, getStudentSelfAssessmentCompletion } = globalThis.window.ReviewUtils;

    const selfAssessment = submission.selfAssessment || {};
    const rubricSchema = assignment.uploadedRubricSchema || assignment.rubricSchema || getRubricSchema(assignment.rubric, assignment.uploadedRubricName || assignment.title);
    const selfAssessmentRowMap = getStudentSelfAssessmentRowScoreMap(submission);
    const selfAssessmentScore = Array.from(selfAssessmentRowMap.values()).reduce((sum, entry) => sum + Number(entry?.points ?? 0), 0);
    const selfAssessmentCompletion = getStudentSelfAssessmentCompletion(rubricSchema, submission);
    const teacherReviewRows = getTeacherReviewRowsForExport(assignment, submission);

    if (isStudentSubmissionLocked(submission) && submission.teacherReview?.savedAt) {
      return renderStudentGradedFinalStep(submission, teacherReviewRows);
    }
    if (submission.status === "submitted") {
      return renderStudentSubmittedFinalStep(submission);
    }
    return renderStudentSelfAssessmentFinalStep(assignment, submission, {
      rubricSchema,
      selfAssessmentCompletion,
      selfAssessmentRowMap,
      selfAssessmentScore,
    });
  }

  function renderStudentGradedFinalStep(submission, teacherReviewRows) {
    const { escapeHtml, escapeAttribute, formatDateTime, renderAnnotatedText, getAnnotationDisplayLabel } = globalThis.window;
    const { getErrorCodeLabel } = globalThis.window.AppConstants;
    return `
      <div class="step-card wizard-card">
        <div class="step-head">
          <div>
            <div class="step-number">3</div>
            <h3>Your graded work</h3>
            <p class="subtle">Your teacher has finished reviewing this assignment. Your score, comments, rubric breakdown, and marked copy are below.</p>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.8rem;font-weight:800;color:var(--accent-deep);">${escapeHtml(String(submission.teacherReview.finalScore ?? "—"))}</div>
            <div class="subtle">Final score</div>
          </div>
        </div>
        <div class="submitted-banner" style="margin-bottom:16px;">
          <div class="submitted-icon">✓</div>
          <div>
            <strong>Submitted and graded</strong>
            <p>Your work was handed in on ${escapeHtml(formatDateTime(submission.submittedAt))}. Review the teacher feedback below or download the graded report.</p>
          </div>
          <button class="button-secondary" data-action="download-work" style="flex-shrink:0;margin-left:auto;">⬇ Download graded report</button>
        </div>
        <div class="teacher-ready-card" style="border-left:4px solid var(--accent);">
          <p class="mini-label">Teacher feedback</p>
          ${submission.teacherReview.finalNotes ? `<p style="white-space:pre-wrap;line-height:1.65;margin:8px 0 0;">${escapeHtml(submission.teacherReview.finalNotes)}</p>` : `<p class="subtle" style="margin:8px 0 0;">Your teacher saved a score without overall notes.</p>`}
          ${teacherReviewRows.length ? `
            <div style="display:grid;gap:8px;margin:14px 0 0;">
              ${teacherReviewRows.map((row) => `
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfdff;">
                  <div style="min-width:0;">
                    <strong style="display:block;margin-bottom:4px;">${escapeHtml(row.criterion)}</strong>
                    <span class="subtle" style="font-size:0.82rem;display:block;">${escapeHtml(row.selectedLabel || "Not scored")}</span>
                    ${row.selectedDescription ? `<span class="subtle" style="font-size:0.8rem;display:block;margin-top:4px;line-height:1.5;">${escapeHtml(row.selectedDescription)}</span>` : ""}
                  </div>
                  <strong style="white-space:nowrap;">${row.selectedPoints}/${row.maxPoints}</strong>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${submission.teacherReview.annotations?.length ? `
            <div style="margin-top:14px;">
              <p class="mini-label">Marked copy</p>
              <div id="student-feedback-text" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;min-height:220px;max-height:min(72vh,720px);overflow-y:auto;">
                ${renderAnnotatedText(submission)}
              </div>
              <p class="mini-label" style="margin-top:12px;">Comments on your writing</p>
              <div style="display:grid;gap:6px;margin-top:6px;">
                ${submission.teacherReview.annotations.map((ann, i) => `
                  <button id="comment-${escapeAttribute(ann.id)}" type="button" onclick="scrollToAnnotation('${escapeAttribute(ann.id)}')" style="padding:8px 12px;border-radius:10px;background:#f6f0ff;border:1px solid #c9b3eb;font-size:0.88rem;text-align:left;cursor:pointer;scroll-margin-top:120px;">
                    <strong style="color:#5b2a86;">${escapeHtml(getAnnotationDisplayLabel(ann, i))}</strong>
                    <span style="margin-left:8px;color:#3f2a56;">"${escapeHtml(ann.selectedText)}"${getErrorCodeLabel(ann.code) ? ` — ${escapeHtml(getErrorCodeLabel(ann.code))}` : ""}${ann.note ? ` — ${escapeHtml(ann.note)}` : ""}</span>
                  </button>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>
        <details class="teacher-ready-card" style="margin-top:14px;">
          <summary style="cursor:pointer;font-weight:600;">View your final writing and reflection</summary>
          <div style="margin-top:14px;">
            <p class="mini-label">Your final writing</p>
            <div style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.8;white-space:pre-wrap;word-break:break-word;">${escapeHtml(submission.finalText || submission.draftText || "No final text recorded.")}</div>
            <div class="field" style="margin-top:14px;">
              <label>Reflection — what you improved</label>
              <div style="background:#fbfdff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;white-space:pre-wrap;line-height:1.65;">${escapeHtml(submission.reflections.improved || "No reflection recorded.")}</div>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  function renderStudentSubmittedFinalStep(submission) {
    const { escapeHtml, formatDateTime } = globalThis.window;
    return `
      <div class="step-card wizard-card">
        <div class="step-head">
          <div>
            <div class="step-number">4</div>
            <h3>Submitted</h3>
            <p class="subtle">Your work is locked while your teacher reviews it.</p>
          </div>
        </div>
        <div id="submitted-confirmation" class="submitted-banner" style="margin-bottom:16px;">
          <div class="submitted-icon">✓</div>
          <div>
            <strong>Submitted!</strong>
            <p>Your work was handed in on ${escapeHtml(formatDateTime(submission.submittedAt))}. Your teacher will review it soon.</p>
          </div>
          <button class="button-secondary" data-action="download-work" style="flex-shrink:0;margin-left:auto;">⬇ Download my work</button>
        </div>
        <details class="teacher-ready-card">
          <summary style="cursor:pointer;font-weight:600;">View submitted writing and reflection</summary>
          <div style="margin-top:14px;">
            <p class="mini-label">Your submitted writing</p>
            <div style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.8;white-space:pre-wrap;word-break:break-word;">${escapeHtml(submission.finalText || submission.draftText || "No final text recorded.")}</div>
            <div class="field" style="margin-top:14px;">
              <label>Reflection — what you improved</label>
              <div style="background:#fbfdff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;white-space:pre-wrap;line-height:1.65;">${escapeHtml(submission.reflections?.improved || "No reflection recorded.")}</div>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  function renderStudentSelfAssessmentFinalStep(assignment, submission, {
    rubricSchema,
    selfAssessmentCompletion,
    selfAssessmentRowMap,
    selfAssessmentScore,
  }) {
    const { escapeHtml, renderRubricSchemaLayout } = globalThis.window;
    const { ui } = globalThis.window.AppState;
    return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">4</div>
          <h3>Rate yourself and submit</h3>
          <p class="subtle">Rate yourself honestly against the rubric, then submit your work.</p>
        </div>
        ${assignment.deadline && new Date(assignment.deadline) < new Date() && submission.status !== "submitted"
          ? `<div style="font-size:0.82rem;color:var(--danger);font-weight:600;text-align:right;">Deadline passed</div>`
          : ``
        }
      </div>
      <div class="teacher-ready-card">
        <p class="mini-label">Self-assessment — rate yourself against the rubric</p>
        <p class="subtle" style="margin:4px 0 14px;">Be honest. Your teacher will see your ratings alongside their own assessment.</p>
        <p class="mini-label" style="margin-bottom:8px;">Rubric</p>
        ${rubricSchema ? `
          <div style="margin-bottom:14px;">
            ${renderRubricSchemaLayout(rubricSchema, {
              clickable: true,
              compact: true,
              previewMode: true,
              selectionAction: "select-self-assessment-band",
              rowScoreMap: selfAssessmentRowMap,
              currentScore: selfAssessmentScore,
            })}
          </div>
        ` : `<p class="subtle">No rubric available for self-assessment yet.</p>`}
        ${!selfAssessmentCompletion.isComplete ? `
              <div class="notice" style="margin-top:14px;">Please rate yourself on all rubric items before submitting. (${selfAssessmentCompletion.selectedCount}/${selfAssessmentCompletion.requiredCount} complete)</div>
            ` : ""}
            <div class="field" style="margin-top:18px;">
              <label for="student-reflection-improved">Reflection — what did you improve? (optional)</label>
              <textarea id="student-reflection-improved" data-reflection-field="improved" placeholder="Write a sentence or two about what you focused on improving in your final version. This helps your teacher see your thinking." style="min-height:96px;">${escapeHtml(submission.reflections?.improved || "")}</textarea>
            </div>
          </div>
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="3">Back</button>
        <span></span>
        <button class="button" data-action="submit-final" ${ui.studentSubmitting || !selfAssessmentCompletion.isComplete ? "disabled" : ""} ${!selfAssessmentCompletion.isComplete ? "title='Rate yourself on all rubric items before submitting'" : ""}>${ui.studentSubmitting ? "Submitting…" : "Submit assignment"}</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
      ${renderStudentSelfAssessmentSubmissionSummary(assignment, submission)}
    </div>
  `;
  }

  function renderStudentSelfAssessmentSubmissionSummary(assignment, submission) {
    const { escapeHtml, escapeAttribute, formatDateTime, getAnnotationDisplayLabel,
      getTeacherReviewRowsForExport, renderAnnotatedText } = globalThis.window;
    const { getErrorCodeLabel } = globalThis.window.AppConstants;
    if (submission.status !== "submitted") return "";
    const teacherReviewRows = getTeacherReviewRowsForExport(assignment, submission);
    const teacherReviewRowsHtml = renderStudentTeacherReviewRows(teacherReviewRows);
    return `
        <div id="submitted-confirmation" class="submitted-banner" style="margin-top:16px;">
          <div class="submitted-icon">✓</div>
          <div>
            <strong>Submitted!</strong>
            <p>Your work was handed in on ${escapeHtml(formatDateTime(submission.submittedAt))}. Your teacher will review it soon.</p>
          </div>
          <button class="button-secondary" data-action="download-work" style="flex-shrink:0;margin-left:auto;">⬇ Download my work</button>
        </div>
        ${submission.teacherReview?.savedAt ? `
          <div class="teacher-ready-card" style="margin-top:14px;border-left:4px solid var(--accent);">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <p class="mini-label">Teacher feedback</p>
                <p class="subtle" style="margin:4px 0 0;">Your teacher's score, comments, rubric breakdown, and marked copy are below.</p>
              </div>
              <button class="button-ghost" data-action="download-work" style="font-size:0.82rem;">⬇ Download graded report</button>
            </div>
            ${submission.teacherReview.finalScore !== "" ? `
              <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">
                Score: ${escapeHtml(String(submission.teacherReview.finalScore))}
              </div>
            ` : ""}
            ${submission.teacherReview.finalNotes ? `
              <p style="white-space:pre-wrap;line-height:1.65;">${escapeHtml(submission.teacherReview.finalNotes)}</p>
            ` : ""}
            ${teacherReviewRowsHtml}
            ${submission.teacherReview.annotations?.length ? `
              <div style="margin-top:12px;">
                <p class="mini-label">Marked copy</p>
                <div id="student-feedback-text" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;min-height:220px;max-height:min(72vh,720px);overflow-y:auto;">
                  ${renderAnnotatedText(submission)}
                </div>
                <p class="mini-label" style="margin-top:12px;">Comments on your writing</p>
                <div style="display:grid;gap:6px;margin-top:6px;">
                  ${submission.teacherReview.annotations.map((ann, i) => `
                    <button id="comment-${escapeAttribute(ann.id)}" type="button" onclick="scrollToAnnotation('${escapeAttribute(ann.id)}')" style="padding:8px 12px;border-radius:10px;background:#f6f0ff;border:1px solid #c9b3eb;font-size:0.88rem;text-align:left;cursor:pointer;scroll-margin-top:120px;">
                      <strong style="color:#5b2a86;">${escapeHtml(getAnnotationDisplayLabel(ann, i))}</strong>
                      <span style="margin-left:8px;color:#3f2a56;">"${escapeHtml(ann.selectedText)}"${getErrorCodeLabel(ann.code) ? ` — ${escapeHtml(getErrorCodeLabel(ann.code))}` : ""}${ann.note ? ` — ${escapeHtml(ann.note)}` : ""}</span>
                    </button>
                  `).join("")}
                </div>
              </div>
            ` : ""}
          </div>
        ` : ""}
    `;
  }

  function renderStudentTeacherReviewRows(teacherReviewRows) {
    const { escapeHtml } = globalThis.window;
    if (!teacherReviewRows.length) return "";
    return `
      <div style="display:grid;gap:8px;margin:12px 0 14px;">
        ${teacherReviewRows.map((row) => `
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfdff;">
            <div style="min-width:0;">
              <strong style="display:block;margin-bottom:4px;">${escapeHtml(row.criterion)}</strong>
              <span class="subtle" style="font-size:0.82rem;display:block;">${escapeHtml(row.selectedLabel || "Not scored")}</span>
              ${row.selectedDescription ? `<span class="subtle" style="font-size:0.8rem;display:block;margin-top:4px;line-height:1.5;">${escapeHtml(row.selectedDescription)}</span>` : ""}
            </div>
            <strong style="white-space:nowrap;">${row.selectedPoints}/${row.maxPoints}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  const StudentRender = {
    renderStudentWorkspace,
    renderSubmissionDebugPanel,
    renderEmailDebugPanel,
    renderStudentStep,
    renderStudentIdeasStep,
    renderStudentDraftStep,
    renderStudentReviewStep,
    renderStudentFinalStep,
  };

  if (typeof window !== "undefined") {
    window.StudentRender = StudentRender;
    Object.assign(window, StudentRender);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = StudentRender;
  }
})();
