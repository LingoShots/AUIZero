(function () {
  function renderTeacherProgressSteps(ui) {
    const step = ui.teacherAssist ? 3 : (ui.teacherDraft.brief ? 2 : 1);
    const labels = ["Rubric", "Brief + generate", "Review + save"];
    return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
      ${labels.map((label, index) => {
        const stepNumber = index + 1;
        const done = stepNumber < step;
        const active = stepNumber === step;
        return `<div style="display:flex;align-items:center;gap:6px;flex:1;">
          <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
            background:${done ? "var(--accent-deep)" : active ? "var(--accent)" : "var(--surface-soft)"};
            color:${done || active ? "#fff" : "var(--muted)"};
            border:1px solid ${done ? "var(--accent-deep)" : active ? "var(--accent)" : "var(--line)"};">
            ${done ? "✓" : stepNumber}
          </div>
          <span style="font-size:0.78rem;color:${active ? "var(--ink)" : "var(--muted)"};font-weight:${active ? 700 : 400};">${label}</span>
          ${index < 2 ? '<div style="flex:1;height:1px;background:var(--line);"></div>' : ""}
        </div>`;
      }).join("")}
    </div>`;
  }

  function renderTeacherGenerateButton(ui) {
    const { getTeacherGenerateButtonState } = window.AiAssistUtils;
    const generateButton = getTeacherGenerateButtonState({ loading: ui.aiAssistLoading });
    return `
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-top:10px;">
        <button class="button" data-action="generate-teacher-assist" ${generateButton.disabled ? "disabled" : ""}>
          ${generateButton.label}
        </button>
        <span class="subtle" style="font-size:0.78rem;">Advances to Step 3</span>
      </div>
    `;
  }

  function renderTeacherAssignmentSettingsFields(ui, idPrefix) {
    const { escapeHtml, escapeAttribute, titleCase, getVisibleChatTimeLimit } = window;
    const { buildDeadlineTimeOptions, getDeadlineDatePart, getDeadlineTimePart } = window.DeadlineUtils;
    return `
      <div class="field-grid compact-grid">
        <div class="field">
          <label for="${idPrefix}-assignment-type">Assignment type</label>
          <select id="${idPrefix}-assignment-type" data-teacher-field="assignmentType">
           ${["argument", "opinion", "narrative", "informational", "process", "definition", "compare/contrast", "response", "other"].map((t) => `<option value="${t}" ${ui.teacherDraft.assignmentType === t ? "selected" : ""}>${titleCase(t)}</option>`).join("")}
          </select>
          ${ui.teacherDraft.assignmentType === "other" ? `
            <input id="teacher-other-type" data-teacher-field="assignmentTypeOther" value="${escapeAttribute(ui.teacherDraft.assignmentTypeOther || "")}" placeholder="Describe the assignment type" style="margin-top:8px;width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 12px;" />
          ` : ""}
        </div>
        <div class="field">
          <label for="${idPrefix}-word-min">Min words</label>
          <input id="${idPrefix}-word-min" data-teacher-field="wordCountMin" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.wordCountMin))}" />
        </div>
        <div class="field">
          <label for="${idPrefix}-word-max">Max words</label>
          <input id="${idPrefix}-word-max" data-teacher-field="wordCountMax" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.wordCountMax))}" />
        </div>
        <div class="field">
          <label for="${idPrefix}-feedback-limit">Feedback checks</label>
          <input id="${idPrefix}-feedback-limit" data-teacher-field="feedbackRequestLimit" type="number" min="0" value="${escapeAttribute(String(ui.teacherDraft.feedbackRequestLimit))}" />
        </div>
        <div class="field">
          <label>Total points</label>
          ${ui.teacherAssist
            ? `<div style="font-size:1.1rem;font-weight:700;padding:8px 0;">${ui.teacherAssist.rubric.reduce((s, r) => s + Number(r.points || 0), 0)} pts (auto-calculated from rubric)</div>`
            : `<input id="${idPrefix}-total-points" data-teacher-field="totalPoints" type="number" min="4" value="${escapeAttribute(String(ui.teacherDraft.totalPoints))}" />`
          }
        </div>
        <div class="field">
          <label for="${idPrefix}-chat-limit">Chat time limit (mins, 0 = unlimited)</label>
          <input id="${idPrefix}-chat-limit" data-teacher-field="chatTimeLimit" type="number" min="0" value="${escapeAttribute(String(getVisibleChatTimeLimit(ui.teacherDraft)))}" ${ui.teacherDraft.disableChatbot ? "disabled" : ""} />
        </div>
        <div class="field" style="display:flex;align-items:flex-end;">
          <label style="display:flex;gap:10px;align-items:center;min-height:44px;padding:0 4px;font-weight:600;">
            <input id="${idPrefix}-disable-chatbot" data-teacher-field="disableChatbot" type="checkbox" ${ui.teacherDraft.disableChatbot ? "checked" : ""} />
            Disable chatbot
          </label>
        </div>
        <div class="field" style="grid-column:1 / -1;">
          <label for="${idPrefix}-deadline-date">Deadline</label>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:8px;align-items:end;">
            <div style="min-width:0;">
              <input id="${idPrefix}-deadline-date" type="date" value="${escapeAttribute(getDeadlineDatePart(ui.teacherDraft.deadline))}" style="width:100%;min-width:0;" />
            </div>
            <select id="${idPrefix}-deadline-time">
              ${buildDeadlineTimeOptions(getDeadlineTimePart(ui.teacherDraft.deadline))}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="${idPrefix}-language-level">Student language level</label>
          <select id="${idPrefix}-language-level" data-teacher-field="languageLevel">
            ${["A0", "A1", "A2", "B1", "B2", "C1", "C2"].map((level) => `<option value="${level}" ${ui.teacherDraft.languageLevel === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
          </select>
        </div>
      </div>
    `;
  }
  function renderTeacherWorkspace() {
    const { ui, state, currentClasses, currentClassId, currentClassMembers, currentProfile } = window.AppState;
    const { escapeHtml, escapeAttribute, renderRichTextHtml, renderUploadedRubricPreview,
      renderPromptFormattingToolbar, titleCase, truncateText, stripPromptFormatting,
      isPasteLikeWritingEvent, getSavedRubricLibrary,
      getTeacherAssignmentSaveLabel, getSubmissionCountsForAssignment,
      getSelectedReviewSubmission } = window;
    const { PRODUCT_NAME } = window.AppConstants;

    const assignments = currentClassId
      ? state.assignments.filter((assignment) => !assignment.classId || assignment.classId === currentClassId)
      : [];
    const classRoster = currentClassMembers.filter((member) => member?.id !== currentProfile?.id);
    const selectedAssignment = assignments.find(a => a.id === ui.selectedAssignmentId) || null;
    const submissions = state.submissions.filter(s => s.assignmentId === ui.selectedAssignmentId);
    const selectedSubmission = selectedAssignment && ui.teacherView === "grading"
      ? getSelectedReviewSubmission()
      : (state.submissions.find(s => s.id === ui.selectedReviewSubmissionId) || null);
    const savedRubrics = getSavedRubricLibrary();
    const selectedSavedRubric = savedRubrics.find((entry) => entry.id === ui.selectedSavedRubricId) || null;
    const manualSaveReady = Boolean(
      ui.teacherAssist || ((ui.teacherDraft.title || "").trim() && (ui.teacherDraft.prompt || "").trim())
    );
    const hasUploadedRubricPreview = Boolean(
      ui.teacherDraft.uploadedRubricText || ui.teacherDraft.uploadedRubricSchema?.criteria?.length || ui.teacherDraft.uploadedRubricData?.rows?.length
    );
    const rubricUploadField = `
    <div class="field">
      <label>Rubric (optional — drag and drop or click to upload)</label>
      <div id="rubric-drop-zone" style="border:2px dashed var(--line);border-radius:12px;padding:28px 18px;min-height:124px;text-align:center;cursor:pointer;transition:border-color 0.2s;background:#fafaf8;display:grid;place-items:center;"
        ondragover="event.preventDefault();this.style.borderColor='var(--accent)';"
        ondragleave="this.style.borderColor='var(--line)';"
        ondrop="handleRubricDrop(event);"
        onclick="document.getElementById('rubric-file-input').click();">
        ${ui.teacherDraft.uploadedRubricText
          ? `<p style="color:var(--accent-deep);font-weight:600;margin:0;">✓ Rubric loaded — ${ui.teacherDraft.uploadedRubricSchema?.criteria?.length || ui.teacherDraft.uploadedRubricData?.rows?.length || 0} criteria ready</p>
             <button class="button-ghost" style="margin-top:8px;font-size:0.8rem;" onclick="event.stopPropagation();clearUploadedRubric();">Remove</button>`
          : `<p style="color:var(--muted);margin:0;">Drop your rubric PDF or Word doc here, or click to browse</p>`
        }
      </div>
      <input type="file" id="rubric-file-input" accept=".pdf,.doc,.docx" style="display:none;" onchange="handleRubricFile(this.files[0]);" />
      ${savedRubrics.length ? `
        <div style="margin-top:10px;">
          <label for="saved-rubric-select" style="font-size:0.82rem;color:var(--muted);display:block;margin-bottom:6px;">Use a previous rubric</label>
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
            <select id="saved-rubric-select" style="flex:1;min-width:240px;">
              <option value="">Select a saved rubric</option>
              ${savedRubrics.map((entry) => `<option value="${entry.id}" ${ui.selectedSavedRubricId === entry.id ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
            </select>
            ${ui.selectedSavedRubricId
              ? `<button class="button-ghost" data-action="clear-saved-rubric-selection" style="min-height:42px;">Clear</button>`
              : ""
            }
            ${selectedSavedRubric?.source === "upload"
              ? `<button class="button-ghost" data-action="remove-saved-rubric" data-rubric-id="${selectedSavedRubric.id}" style="min-height:42px;">Remove saved rubric</button>`
              : ""
            }
          </div>
          ${selectedSavedRubric && selectedSavedRubric.source !== "upload"
            ? `<p class="subtle" style="font-size:0.78rem;margin-top:6px;">This rubric is attached to an existing assignment, so it stays in the list.</p>`
            : ""
          }
        </div>
      ` : ""}
    </div>
  `;

    return `
    <section class="teacher-grid">
      <div class="panel panel-tight">
        <div class="panel-header">
          <div>
            <p class="mini-label">Teacher Setup</p>
            <h2 class="panel-title">Describe the assignment in plain English</h2>
            ${ui.editingAssignmentId ? `<p class="subtle" style="margin:6px 0 0;">Editing an existing assignment. Changes will update the published version too.</p>` : ""}
          </div>
          <div class="toolbar">
            ${ui.editingAssignmentId ? `<button class="button-ghost" data-action="cancel-assignment-edit" ${ui.aiAssistLoading ? "disabled" : ""}>Cancel edit</button>` : ""}
          </div>
        </div>
        ${renderTeacherProgressSteps(ui)}
<div class="field-stack">
          <div id="teacher-rubric-upload" class="teacher-ready-card" style="padding:16px;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px;">
              <div>
                <p class="mini-label" style="margin-bottom:4px;">Step 1 — Rubric (optional)</p>
                <p class="subtle">Upload or reuse a rubric. The AI will shape its output to match.</p>
              </div>
              <span class="pill">Current class: ${escapeHtml(currentClasses.find((c) => c.id === currentClassId)?.name || "None")}</span>
            </div>
            ${rubricUploadField}
          </div>
          <div class="teacher-ready-card" style="padding:16px;">
            <div style="margin-bottom:10px;">
              <p class="mini-label" style="margin-bottom:4px;">Step 2 — Your brief</p>
              <p class="subtle">Describe the assignment in plain English, then click Create student-ready version.</p>
            </div>
            <textarea id="teacher-brief" data-teacher-field="brief" class="teacher-brief" placeholder="Example: My 7th grade students need a short opinion paragraph about whether school uniforms help learning. Keep the language simple, ask for one real example, and aim for 250 to 350 words. Give them 2 feedback checks.">${escapeHtml(ui.teacherDraft.brief)}</textarea>
            ${renderTeacherGenerateButton(ui)}
          </div>
          ${ui.aiAssistLoading ? `
            <div class="teacher-ready-card" style="padding:16px;border-color:var(--accent);">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                  <p class="mini-label" style="margin-bottom:4px;">AI is thinking…</p>
                  <p class="subtle">You can cancel, fix the brief or settings, and try again.</p>
                </div>
                <button class="button-ghost" data-action="cancel-teacher-assist" style="min-height:36px;padding:0 12px;">✕</button>
              </div>
            </div>
          ` : ""}
          <details id="teacher-shared-settings" class="teacher-ready-card" style="padding:16px;"
  ${ui.teacherAssist || ui.teacherDraft.title ? "open" : ""}>
  <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;">
    <div>
      <p class="mini-label" style="margin-bottom:4px;">Step 3 — Assignment settings</p>
      <p class="subtle">Word limits, deadline, chatbot, language level.</p>
    </div>
    <span class="pill">${ui.teacherAssist || ui.teacherDraft.title ? "Ready" : "After draft"}</span>
  </summary>
  <div style="margin-top:14px;">
    ${renderTeacherAssignmentSettingsFields(ui, "teacher")}
  </div>
</details>
        </div>
        ${
          ui.teacherAssist
            ? `
              <div id="teacher-generated-assignment" class="teacher-output">
                <div class="section-header" style="border-left:3px solid var(--accent);padding-left:12px;">
                  <div>
                    <p class="mini-label">Step 3 — Review AI draft</p>
                    <input class="assist-title-input" data-assist-field="title" value="${escapeAttribute(ui.teacherAssist.title)}" placeholder="Assignment title" />
                  </div>
                </div>
                <div class="teacher-ready-card">
                  <p class="m