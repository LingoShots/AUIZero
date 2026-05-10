// chrome-render.js
// Shared chrome (modals, topbar, hero) extracted from app.js (Phase 8).
// Reads ui, currentProfile, currentClasses, currentClassId via window.AppState.
// Calls isAdminTeacherView, getStudentAssignment, getStudentSubmission,
// getRemainingStudentFeedbackChecks via window. Other helpers
// (escapeHtml, escapeAttribute, renderBrandGlyph, renderProductWordmark,
// getStudentFeedbackButtonState, PRODUCT_NAME, PRODUCT_TAGLINE) are already
// on window.
// Exposes window.ChromeRender plus individual function globals for back-compat.

(function () {
  function renderPasteWarning() {
    const { ui } = window.AppState;
    if (!ui.pasteWarning) return "";
    return `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:999;display:grid;place-items:center;padding:20px;">
        <div style="background:#fffdf9;border-radius:18px;padding:28px;max-width:440px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.2);">
          <div style="font-size:2rem;margin-bottom:10px;">⚠️</div>
          <h3 style="margin:0 0 10px;color:var(--danger);">Paste recorded</h3>
          <p style="margin:0 0 12px;line-height:1.6;">Your pasted text has been added to your draft. Your teacher will be able to see it highlighted in violet.</p>
          <p style="margin:0 0 20px;line-height:1.6;">You can leave it in if it was fair use — for example, a quote you are responding to — or remove it and write the section in your own words.</p>
          <div style="display:grid;gap:10px;">
            <button class="button-ghost" data-action="dismiss-paste-warning">I'll rewrite it in my own words</button>
            <button class="button" data-action="dismiss-paste-warning">Leave it in — it's fair use</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderInvitePanel() {
    const { ui, currentClassId, currentClasses } = window.AppState;
    if (!ui.showInvitePanel) return "";
    const appUrl = window.location.origin;
    const inviteLink = `${appUrl}?join=${currentClassId}`;
    const currentClass = currentClasses.find(c => c.id === currentClassId);
    const className = currentClass?.name || "your class";
    const inviteText = `You have been invited to join ${className} on ${PRODUCT_NAME}.\n\nClick this link to join:\n${inviteLink}\n\nYou will be asked to create an account if you don't have one. Once signed in you will be added to the class automatically.`;

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

  function renderClassModal() {
    const { ui } = window.AppState;
    if (!ui.showClassModal) return "";
    return `
      <div style="position:fixed;inset:0;background:rgba(10,18,33,0.35);z-index:1000;display:grid;place-items:center;padding:20px;">
        <div style="background:rgba(255,255,255,0.96);border:1px solid var(--line);border-radius:20px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(21,39,74,0.16);backdrop-filter:blur(16px);">
          <p class="mini-label" style="margin-bottom:6px;">Create class</p>
          <h3 style="margin:0 0 8px;">Start a new class space</h3>
          <p class="subtle" style="margin:0 0 14px;">This will become your current class immediately, with its own students and assignments.</p>
          <div class="field" style="margin-bottom:10px;">
            <label for="class-modal-name">Class name</label>
            <input id="class-modal-name" value="${escapeAttribute(ui.classModalName)}" oninput="ui.classModalName=this.value" placeholder="Example: AWG 1001 Section B" />
          </div>
          ${ui.classModalError ? `<p style="margin:0 0 12px;color:var(--danger);font-size:0.88rem;">${escapeHtml(ui.classModalError)}</p>` : ""}
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="button-ghost" data-action="close-class-modal">Cancel</button>
            <button class="button" data-action="submit-create-class">Create class</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDraftFeedbackModal() {
    const { ui } = window.AppState;
    if (!ui.showDraftFeedbackPrompt) return "";
    const assignment = getStudentAssignment();
    const submission = getStudentSubmission();
    const { used, limit, remaining } = getRemainingStudentFeedbackChecks(assignment, submission);
    const feedbackButton = getStudentFeedbackButtonState({
      loading: ui.draftFeedbackLoading,
      feedbackUsed: used,
      feedbackLimit: limit,
    });
    return `
      <div style="position:fixed;inset:0;background:rgba(10,18,33,0.38);z-index:1000;display:grid;place-items:center;padding:20px;">
        <div style="background:rgba(255,255,255,0.96);border:1px solid var(--line);border-radius:20px;padding:28px;max-width:520px;width:100%;box-shadow:0 20px 50px rgba(21,39,74,0.16);backdrop-filter:blur(16px);">
          <p class="mini-label" style="margin-bottom:6px;">Before you finish</p>
          <h3 style="margin:0 0 8px;">Get AI feedback first?</h3>
          <p class="subtle" style="margin:0 0 16px;">You still have ${remaining} of ${limit} AI feedback check${limit === 1 ? "" : "s"} available. Feedback can point out places to improve before self-assessment and submission.</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="button-ghost" data-action="continue-without-feedback">Continue without feedback</button>
            <button class="button-secondary" data-action="prompt-request-feedback" ${feedbackButton.disabled ? "disabled" : ""}>${ui.draftFeedbackLoading ? "Checking…" : "Yes, get AI feedback"}</button>
          </div>
        </div>
      </div>
    `;
  }
    function renderReopenSubmissionModal() {
    const { ui } = window.AppState;
    if (!ui.reopenSubmissionPrompt) return "";
    const studentName = ui.reopenSubmissionPrompt.studentName || "this student";
    return `
      <div style="position:fixed;inset:0;background:rgba(10,18,33,0.38);z-index:1000;display:grid;place-items:center;padding:20px;">
        <div style="background:rgba(255,255,255,0.96);border:1px solid var(--line);border-radius:20px;padding:28px;max-width:560px;width:100%;box-shadow:0 20px 50px rgba(21,39,74,0.16);backdrop-filter:blur(16px);">
          <p class="mini-label" style="margin-bottom:6px;">Reopen submission</p>
          <h3 style="margin:0 0 8px;">Reopen this submission for ${escapeHtml(studentName)}?</h3>
          <p class="subtle" style="margin:0 0 16px;">They'll be able to edit and resubmit. Their existing work and writing process evidence will remain visible — future changes will update the same submission record.</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="button-ghost" data-action="close-reopen-submission-modal">Cancel</button>
            <button class="button-secondary" data-action="confirm-reopen-submission">Reopen for student</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderTopbar() {
    const { ui, currentProfile, currentClasses, currentClassId } = window.AppState;
    const studentOptions = "";
    const classSwitcherOptions = currentClasses.filter((c) => c.id !== currentClassId);

    return `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${renderBrandGlyph()}</div>
          <div>
            ${renderProductWordmark("h1", "brand-wordmark")}
            <p>${escapeHtml(PRODUCT_TAGLINE)}</p>
          </div>
        </div>
        <div class="toolbar">
          ${currentProfile ? `<span style="font-size:0.85rem;color:var(--muted);">${escapeHtml(currentProfile.name)} · ${escapeHtml(currentProfile.role)}</span>` : ""}
         ${ui.role === "teacher" || isAdminTeacherView() ? `
            ${currentClassId ? `<span class="pill">Current class: ${escapeHtml(currentClasses.find((c) => c.id === currentClassId)?.name || "None")}</span>` : ""}
            ${currentClasses.length === 0 ? `
              <button class="button-secondary" data-action="create-class">+ Create first class</button>
            ` : `
              <select id="class-select" aria-label="Select class">
                <option value="" selected>Change class</option>
                ${classSwitcherOptions.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
                <option value="__new__">+ New class</option>
                ${currentClassId ? `<option value="__delete__">── Delete this class</option>` : ""}
              </select>
             <button class="button-secondary" data-action="invite-by-email">✉ Invite students</button>
            `}
            ` : ""}
          ${isAdminTeacherView() ? `<button class="button-ghost" data-action="admin-exit-teacher-view" style="color:var(--accent-deep);">← Back to admin</button>` : ""}
          <button class="button-ghost" data-action="account-security-change-password">Change password</button>
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

  const ChromeRender = {
    renderPasteWarning,
    renderInvitePanel,
    renderClassModal,
    renderDraftFeedbackModal,
    renderReopenSubmissionModal,
    renderTopbar,
    renderHero,
  };

  if (typeof window !== "undefined") {
    window.ChromeRender = ChromeRender;
    Object.assign(window, ChromeRender);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ChromeRender;
  }
})();