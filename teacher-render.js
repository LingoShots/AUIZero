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
    const { escapeHtml, escapeAttribute, titleCase, getVisibleChatTimeLimit } = globalThis.window;
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
                  <p class="mini-label">Student instructions</p>
                  <div class="field" style="margin-bottom:10px;">
                    <label style="display:flex;align-items:center;gap:6px;">
                      Task prompt
                      <span style="font-size:0.7rem;padding:1px 6px;border-radius:8px;background:#fff8ed;color:var(--accent-deep);border:1px solid var(--accent);">✨ AI</span>
                    </label>
                    ${renderPromptFormattingToolbar("teacher-assist-prompt")}
                    <textarea id="teacher-assist-prompt" data-assist-field="prompt">${escapeHtml(ui.teacherAssist.prompt)}</textarea>
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
                     ${["argument", "opinion", "narrative", "informational", "process", "definition", "compare/contrast", "response", "other"].map((t) => `<option value="${t}" ${ui.teacherAssist.assignmentType === t ? "selected" : ""}>${titleCase(t)}</option>`).join("")}
                    </select>
                  </div>
                </div>
                <div class="teacher-ready-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <p class="mini-label" style="display:flex;align-items:center;gap:6px;">
                      Rubric
                      <span style="font-size:0.7rem;padding:1px 6px;border-radius:8px;background:#fff8ed;color:var(--accent-deep);border:1px solid var(--accent);">✨ AI</span>
                    </p>
                    <span class="pill">${ui.teacherAssist.rubric.reduce((s, r) => s + Number(r.points || 0), 0)} pts total</span>
                  </div>
                  ${hasUploadedRubricPreview
                    ? `
                    `
                    : `
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
                    `
                  }
                </div>

                                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                  <button class="button" data-action="save-assignment" ${ui.aiAssistLoading || ui.assignmentSaving ? "disabled" : ""}>
                    ${getTeacherAssignmentSaveLabel()}
                  </button>
                </div>              </div>
            `
            : `
              <div id="teacher-generated-assignment" class="teacher-output">
                <details class="teacher-ready-card" ${(ui.teacherDraft.title || ui.teacherDraft.prompt) ? "open" : ""}>
                  <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <div>
                      <p class="mini-label" style="margin-bottom:4px;">Manual assignment setup</p>
                      <p class="subtle">Skip AI if you already know the student-facing title and prompt. Fill these in manually, then save when you're ready.</p>
                    </div>
                    <span class="pill">${(ui.teacherDraft.title || ui.teacherDraft.prompt) ? "In progress" : "Optional"}</span>
                  </summary>
                  <div style="margin-top:14px;">
                    <div class="field" style="margin-bottom:10px;">
                      <label for="teacher-title">Assignment title</label>
                      <input id="teacher-title" data-teacher-field="title" value="${escapeAttribute(ui.teacherDraft.title)}" placeholder="Assignment title" />
                    </div>
                    <div class="field" style="margin-bottom:10px;">
                      <label for="teacher-prompt">Task prompt</label>
                      ${renderPromptFormattingToolbar("teacher-prompt")}
                      <textarea id="teacher-prompt" data-teacher-field="prompt" placeholder="Write the instructions students will see.">${escapeHtml(ui.teacherDraft.prompt)}</textarea>
                    </div>
                    <p class="subtle" style="font-size:0.84rem;margin:6px 0 0;">Use the shared settings above for assignment type, word limits, deadline, chatbot, language level, and feedback limits.</p>
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                      <button class="button" data-action="save-assignment" ${!manualSaveReady || ui.aiAssistLoading || ui.assignmentSaving ? "disabled" : ""}>${getTeacherAssignmentSaveLabel()}</button>
                    </div>
                  </div>
                </details>
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
          <button class="button-ghost" data-action="refresh-assignment-statuses" style="font-size:0.82rem;">Refresh statuses</button>
        </div>
        <details class="teacher-ready-card" style="margin-bottom:16px;">
          <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <p class="mini-label" style="margin-bottom:4px;">Class list</p>
              <p class="subtle" style="margin-bottom:0;">Students currently enrolled in ${escapeHtml(currentClasses.find((c) => c.id === currentClassId)?.name || "this class")}.</p>
            </div>
            <span class="pill">${classRoster.length} student${classRoster.length === 1 ? "" : "s"}</span>
          </summary>
          <div style="margin-top:12px;">
          ${classRoster.length
            ? `<div style="display:grid;gap:8px;">
                ${classRoster.map((member, index) => `
                  <div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fbfdff;display:flex;justify-content:space-between;gap:12px;align-items:center;">
                    <div style="min-width:0;">
                      <span class="subtle" style="display:block;font-size:0.74rem;margin-bottom:3px;">Student ${index + 1}</span>
                      <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(member.name || "Student")}</strong>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                      <button class="button-ghost" data-action="edit-class-member-name" data-student-id="${member.id}" data-student-name="${escapeAttribute(member.name || "Student")}" style="font-size:0.78rem;white-space:nowrap;">Rename</button>
                      <button class="button-ghost" data-action="remove-class-member" data-student-id="${member.id}" data-student-name="${escapeAttribute(member.name || "Student")}" style="font-size:0.78rem;color:var(--danger);border-color:var(--danger);white-space:nowrap;">Remove</button>
                    </div>
                  </div>
                `).join("")}
              </div>`
            : `<div class="empty-state compact-empty"><h3>No students yet</h3><p>Invite students to this class to start building the roster.</p></div>`
          }
          </div>
        </details>
        ${
          !assignments.length
            ? `<div class="empty-state" style="padding:36px 28px;">
                <div style="font-size:2.5rem;margin-bottom:12px;">✏️</div>
                <h3 style="margin:0 0 8px;">Welcome to ${PRODUCT_NAME}</h3>
                <p style="margin:0 0 20px;max-width:320px;margin-inline:auto;">Describe your assignment in plain English on the left, then click <strong>Format With AI</strong> to generate a student-ready task in seconds.</p>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                  <button class="button" data-action="focus-brief">Start your first assignment</button>
                </div>
              </div>`
            : `
              <div class="assignment-list">
                ${assignments.map((assignment) => {
                  const assignmentSubs = state.submissions.filter(s => s.assignmentId === assignment.id);
                  const statusCounts = getSubmissionCountsForAssignment(assignment.id, classRoster);
                  const submittedCount = statusCounts.submitted;
                  const gradedCount = statusCounts.graded;
                  const pasteCount = assignmentSubs.filter(s => (s.writingEvents || []).some((entry) => isPasteLikeWritingEvent(entry))).length;
                  const totalStudents = statusCounts.total;
                  const isBriefExpanded = ui.expandedAssignmentBriefId === assignment.id;
                  const isSavedFocus = ui.savedAssignmentFocusId === assignment.id;
                  const isPublishing = ui.publishingAssignmentId === assignment.id;
                  const promptPreview = truncateText(stripPromptFormatting(assignment.prompt), 140);
                  return `
                  <div class="assignment-card simple-card" id="assignment-card-${escapeAttribute(assignment.id)}" style="${isSavedFocus ? "box-shadow:0 0 0 3px rgba(76,111,231,0.22);border-color:var(--accent);" : ""}">
                    <div class="card-top" style="align-items:flex-start;">
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                          <h3 style="margin:0;">${escapeHtml(assignment.title)}</h3>
                          <span class="${assignment.status === "published" ? "pill" : "warning-pill"}" style="font-size:0.75rem;">${assignment.status === "published" ? "Published" : "Draft"}</span>
                        </div>
                        ${isBriefExpanded
                          ? `<div style="margin:0 0 8px;color:var(--muted);font-size:0.9rem;line-height:1.55;">${renderRichTextHtml(assignment.prompt)}</div>`
                          : `<p style="margin:0 0 8px;color:var(--muted);font-size:0.88rem;">${escapeHtml(promptPreview)}</p>`
                        }
                        ${assignment.prompt && assignment.prompt.length > 140 ? `
                          <button class="button-ghost" data-action="toggle-assignment-brief" data-assignment-id="${assignment.id}" style="font-size:0.78rem;padding:6px 10px;margin:0 0 10px;">
                            ${isBriefExpanded ? "Hide brief" : "View full brief"}
                          </button>
                        ` : ""}
                        <div class="pill-row" style="flex-wrap:wrap;">
                          <span class="pill">${escapeHtml(titleCase(assignment.assignmentType || "writing"))}</span>
                          <span class="pill">${assignment.wordCountMin}–${assignment.wordCountMax} words</span>
                          ${assignment.deadline ? `<span class="pill">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short"}))}</span>` : ""}
                          <span class="pill">${submittedCount}/${totalStudents} submitted</span>
                          ${gradedCount > 0 ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ ${gradedCount} graded</span>` : ""}
                          ${pasteCount > 0 ? `<span class="warning-pill">⚠ ${pasteCount} paste flag${pasteCount > 1 ? "s" : ""}</span>` : ""}
                        </div>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;align-items:flex-end;">
                        <button class="button" data-action="select-assignment" data-assignment-id="${assignment.id}" style="white-space:nowrap;">Review students →</button>
                        <div style="display:flex;gap:6px;">
                          <button class="button-ghost" data-action="edit-assignment" data-assignment-id="${assignment.id}" style="font-size:0.8rem;">Edit</button>
                          <button class="${assignment.status === "published" ? "button-ghost" : "button-secondary"}" data-action="publish-assignment" data-assignment-id="${assignment.id}" ${isPublishing ? "disabled" : ""} style="font-size:0.8rem;${assignment.status === "published" ? "color:var(--sage);border-color:var(--sage);" : ""}${isSavedFocus && assignment.status !== "published" ? "box-shadow:0 0 0 4px rgba(76,111,231,0.20);" : ""}">
                            ${isPublishing ? (assignment.status === "published" ? "Unpublishing..." : "Publishing...") : assignment.status === "published" ? "✓ Published" : "Publish"}
                          </button>
                          <button class="button-ghost" data-action="delete-assignment" data-assignment-id="${assignment.id}" style="font-size:0.8rem;color:var(--danger);border-color:var(--danger);">Delete</button>
                        </div>
                        ${isSavedFocus && assignment.status !== "published" ? `<span class="warning-pill" style="font-size:0.74rem;">Ready to publish when you are happy with it</span>` : ""}
                      </div>
                    </div>
                  </div>
                `}).join("")}
              </div>
            `
        }
      </div>
      ${hasUploadedRubricPreview ? `
        <div class="panel panel-tight" style="grid-column:1 / -1;">
         ${renderUploadedRubricPreview("Uploaded rubric preview", ui.teacherDraft.uploadedRubricText, ui.teacherDraft.uploadedRubricName, ui.teacherDraft.uploadedRubricData, ui.teacherDraft.uploadedRubricSchema)}

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button class="button" data-action="save-assignment" ${!manualSaveReady || ui.aiAssistLoading || ui.assignmentSaving ? "disabled" : ""}>
            ${getTeacherAssignmentSaveLabel()}
          </button>
        </div>
        </div>
      ` : ""}
    </section>
    ${ui.teacherView === "review" && selectedAssignment ? renderTeacherReview(selectedAssignment, submissions) : ""}
    ${ui.teacherView === "grading" && selectedAssignment && selectedSubmission ? renderTeacherGrading(selectedAssignment, selectedSubmission) : ""}
  `;
  }

  function renderTeacherReview(assignment, submissions) {
    const { currentClassMembers } = window.AppState;
    const { escapeHtml, getReviewRoster, levelTheme } = globalThis.window;
    const { getAssignmentSubmissionCounts, isSubmissionGraded } = window.SubmissionUtils;
    const { buildCriterionAnalytics } = window.ReviewUtils;

    const roster = currentClassMembers.length ? currentClassMembers : getReviewRoster(assignment.id);
    const statusCounts = getAssignmentSubmissionCounts(submissions, roster);
    const total = statusCounts.total;
    const submittedCount = statusCounts.submitted;
    const gradedCount = statusCounts.graded;
    const flaggedCount = submissions.filter(
      s => Array.isArray(s.writingEvents) && s.writingEvents.some((entry) => window.isPasteLikeWritingEvent(entry))
    ).length;
    const criterionAnalytics = buildCriterionAnalytics(assignment, submissions.filter((submission) => isSubmissionGraded(submission)));
    const hasCriterionAnalytics = criterionAnalytics.some((criterion) => criterion.gradedCount > 0);

    return `
          <section id="teacher-review-section" class="panel review-shell">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;">
        <button class="button-ghost" data-action="back-to-assignments" style="font-size:0.85rem;">← Assignments</button>
        <span style="color:var(--muted);font-size:0.85rem;">/</span>
        <span style="font-weight:600;font-size:0.95rem;">${escapeHtml(assignment.title)}</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;">${submittedCount}/${total}</div>
          <div style="font-size:0.75rem;color:var(--muted);">Submitted</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;">${gradedCount}</div>
          <div style="font-size:0.75rem;color:var(--muted);">Graded</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;">${statusCounts.notSubmitted}</div>
          <div style="font-size:0.75rem;color:var(--muted);">Not submitted</div>
        </div>
        <div style="background:${flaggedCount ? "#fff3cd" : "var(--surface)"};border:1px solid ${flaggedCount ? "#e0c84a" : "var(--line)"};border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;">${flaggedCount}</div>
          <div style="font-size:0.75rem;color:var(--muted);">Paste flags</div>
        </div>
      </div>

      <details id="teacher-review-panel" class="teacher-ready-card" style="margin-bottom:18px;">
        <summary style="cursor:pointer;list-style-position:inside;">
          <span class="mini-label" style="margin-right:8px;">Grade analytics</span>
          <span class="pill">${gradedCount} graded so far</span>
        </summary>
        <div style="margin-top:12px;">
          <p class="subtle" style="margin:0 0 12px;">After you grade a class set, this shows where students collectively struggled on each criterion.</p>
          ${hasCriterionAnalytics ? `
            <div style="display:grid;gap:10px;">
              ${criterionAnalytics.map((criterion) => `
                <div style="border:1px solid var(--line);border-radius:14px;padding:14px;background:#fbfdff;">
                  <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px;">
                    <div>
                      <strong style="display:block;margin-bottom:4px;">${escapeHtml(criterion.criterionName)}</strong>
                      <span class="subtle">Average ${criterion.averageScore.toFixed(1)}/${criterion.maxPoints}</span>
                    </div>
                    <span class="pill">${criterion.gradedCount} graded</span>
                  </div>
                  <div style="display:grid;gap:8px;">
                    ${criterion.distribution.map((band) => `
                      <div style="display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr) auto;gap:10px;align-items:center;">
                        <span class="rubric-level-legend-chip" style="width:100%;background:${levelTheme(band.label).badge};color:${levelTheme(band.label).text};">${escapeHtml(band.label)} · ${band.points}</span>
                        <div style="height:12px;border-radius:999px;background:#e9eff9;overflow:hidden;">
                          <div style="height:100%;width:${band.count ? Math.max(6, Math.round(band.share * 100)) : 0}%;background:linear-gradient(90deg,var(--accent),#9fc0ff);border-radius:inherit;"></div>
                        </div>
                        <span class="subtle">${band.count}</span>
                      </div>
                    `).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="empty-state compact-empty"><h3>No analytics yet</h3><p>Once you save some grades, the criterion distributions will appear here automatically.</p></div>`}
        </div>
      </details>

      <div id="student-review-list" class="student-list">
        ${roster.length === 0 && submissions.length === 0
          ? `<div class="empty-state compact-empty"><h3>No students yet</h3><p>Invite students to this class using the ✉ Invite students button.</p></div>`
          : roster.map((member) => renderTeacherReviewSubmissionCard(
              member,
              submissions.find((submission) => submission.studentId === member.id)
            )).join("")
        }
      </div>
    </section>
  `;
  }

  function renderTeacherReviewSubmissionCard(member, submission) {
    const { escapeHtml, getPasteEvidenceItems, getSubmissionStatusDisplay } = globalThis.window;
    const { isSubmissionGraded } = globalThis.window.SubmissionUtils;
    if (!submission) {
      return `
        <div class="submission-card simple-card">
          <div class="card-top">
            <div>
              <h3 style="margin:0 0 4px;">${escapeHtml(member.name)}</h3>
              <span class="warning-pill">Not started</span>
            </div>
            <button class="button" data-action="inspect-submission" data-student-id="${member.id}" style="flex-shrink:0;">Grade →</button>
          </div>
        </div>
      `;
    }
    const events = Array.isArray(submission.writingEvents) ? submission.writingEvents : [];
    const finalText = submission.finalText || submission.draftText || "";
    const startedAt = submission.startedAt || submission.updatedAt || submission.submittedAt;
    const endedAt = submission.submittedAt || submission.updatedAt || startedAt;
    const totalMinutes = startedAt && endedAt
      ? Math.max(1, Math.round((new Date(endedAt) - new Date(startedAt)) / 60000))
      : 0;
    const metrics = {
      largePasteCount: getPasteEvidenceItems(submission).length,
      finalWordCount: finalText.trim() ? finalText.trim().split(/\s+/).length : 0,
      revisionCount: events.length,
      totalMinutes,
    };
    const isGraded = isSubmissionGraded(submission);
    const score = submission.teacherReview?.finalScore;
    return `
      <div class="submission-card simple-card">
        <div class="card-top">
          <div style="flex:1;">
            <h3 style="margin:0 0 6px;">${escapeHtml(member.name)}</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <span class="status-pill">${escapeHtml(getSubmissionStatusDisplay(submission.status))}</span>
              ${isGraded ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ Graded${score !== "" && score != null ? ` · ${escapeHtml(String(score))}` : ""}</span>` : ""}
              ${metrics.largePasteCount ? `<span class="warning-pill">⚠ Paste</span>` : ""}
            </div>
            <div class="pill-row" style="margin-top:6px;">
              <span class="pill">${metrics.finalWordCount} words</span>
              <span class="pill">${metrics.revisionCount} edits</span>
              <span class="pill">${metrics.totalMinutes} min</span>
            </div>
          </div>
          <button class="button" data-action="inspect-submission" data-student-id="${member.id}" data-submission-id="${submission.id}" style="flex-shrink:0;">Grade →</button>
        </div>
      </div>
    `;
  }

  function renderTeacherSubmissionStatusPanel(currentStatus, canReopenSubmission, deadlinePassed) {
    const { escapeHtml, getSubmissionStatusDisplay } = globalThis.window;
    return `
      <div style="margin-bottom:16px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fafaf8;">
        <p class="mini-label" style="margin-bottom:8px;">Submission status</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${["submitted", "late", "missing"].map((status) => {
            const isActive = currentStatus === status;
            const lateOrMissing = status !== "submitted";
            let background = "#fff";
            let borderColor = "var(--line)";
            let color = "var(--ink)";
            if (isActive) {
              background = lateOrMissing ? "#fde7e7" : "#dff3e4";
              borderColor = lateOrMissing ? "#c56b6b" : "#4f8f68";
              color = lateOrMissing ? "#8a2f2f" : "#1f5c38";
            }
            return `<button class="button-ghost" data-action="set-review-status" data-status="${status}" style="background:${background};border-color:${borderColor};color:${color};">${escapeHtml(getSubmissionStatusDisplay(status))}</button>`;
          }).join("")}
          ${canReopenSubmission ? `<button class="button-secondary" data-action="open-reopen-submission-modal">Reopen for student</button>` : `<span class="pill">In progress</span>`}
        </div>
        ${deadlinePassed ? `
          <p style="font-size:0.78rem;color:var(--muted);margin:8px 0 0;">Deadline has passed, so you can mark this student as late or missing.</p>
        ` : ""}
      </div>
    `;
  }

  function renderTeacherAnnotationPanel(submission) {
    const { escapeHtml, escapeAttribute, getAnnotationDisplayLabel } = globalThis.window;
    const { getErrorCodes, getErrorCodeLabel, loadCustomErrorCodes } = globalThis.window.AppConstants;
    return `
      <div style="margin-bottom:16px;">
        <div class="error-code-toolbar">
          <span class="mini-label" style="align-self:center;">Annotate:</span>
          ${getErrorCodes().map(({code, label}) => `<button class="error-code-btn" data-action="add-annotation" data-code="${code}" title="${label}" onmousedown="event.preventDefault()">${code}</button>`).join("")}
          <button class="error-code-btn" data-action="add-annotation" data-code="NOTE" title="Add a custom note" onmousedown="event.preventDefault()" style="background:#fff9e6;border-color:#e0c84a;">+ Note</button>
          <button class="error-code-btn" data-action="add-custom-error-code" title="Add your own reusable error code" onmousedown="event.preventDefault()">+ Code</button>
        </div>
        ${loadCustomErrorCodes().length ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${loadCustomErrorCodes().map((entry) => `
              <button class="button-ghost" data-action="remove-custom-error-code" data-code="${escapeAttribute(entry.code)}" style="font-size:0.78rem;min-height:30px;padding:0 10px;">
                ${escapeHtml(entry.code)} ✕
              </button>
            `).join("")}
          </div>
        ` : ""}
        ${(submission.teacherReview?.annotations?.length) ? `
          <div style="margin-top:8px;display:grid;gap:6px;">
            ${submission.teacherReview.annotations.map((ann, i) => `
              <div id="comment-${escapeAttribute(ann.id)}" style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-radius:10px;background:#f6f0ff;border:1px solid #c9b3eb;font-size:0.88rem;scroll-margin-top:120px;">
                <strong style="color:#5b2a86;flex-shrink:0;">${escapeHtml(getAnnotationDisplayLabel(ann, i))}</strong>
                <button type="button" onclick="scrollToAnnotation('${escapeAttribute(ann.id)}')" style="flex:1;text-align:left;background:none;border:none;padding:0;color:#3f2a56;cursor:pointer;font:inherit;">
                  "${escapeHtml(ann.selectedText)}"${getErrorCodeLabel(ann.code) ? ` — ${escapeHtml(getErrorCodeLabel(ann.code))}` : ""}${ann.note ? ` — ${escapeHtml(ann.note)}` : ""}
                </button>
                <button class="error-code-btn" data-action="remove-annotation" data-annotation-index="${i}" style="flex-shrink:0;color:var(--danger);">✕</button>
              </div>
            `).join("")}
          </div>
        ` : `<p class="subtle" style="margin-top:8px;font-size:0.85rem;">No annotations yet. Select text above then click a code.</p>`}
      </div>
    `;
  }

  function renderTeacherGrading(assignment, submission) {
    const { ui } = window.AppState;
    const { escapeHtml, escapeAttribute, formatDateTime, getUserById, isStudentSubmissionLocked,
      getRubricSchema, renderRubricSchemaLayout, renderAnnotatedText,
      getReviewRoster, getPreviousReviewStudentId, getNextReviewStudentId,
      canMarkLateOrMissing, getPlaybackState, getSubmissionStatusDisplay,
      renderEmailDebugPanel, renderSubmissionBehaviourFlagPanel, renderWritingBehaviour,
      renderPasteEvidencePanel, renderWritingTimeNote, renderStudentAiFeedbackEvidence,
      renderSuggestedGradePanel } = window;
    const { calculateTeacherReviewSummary, getTeacherReviewRowScoreMap, getCriterionBands } = window.ReviewUtils;

    if (!submission) return `<div class="empty-state"><p>No submission selected.</p></div>`;
    const reviewSummary = calculateTeacherReviewSummary(assignment, submission);
    const suggestedRowScoreMap = getTeacherReviewRowScoreMap(submission.teacherReview?.suggestedRowScores);
    const reviewScore = submission.teacherReview?.finalScore ?? "";
    const reviewNotes = submission.teacherReview?.finalNotes ?? "";
    const studentName = submission._studentName || getUserById(submission.studentId)?.name || "Student";
    const roster = getReviewRoster(assignment.id);
    const rosterIndex = roster.findIndex((student) => student.id === submission.studentId);
    const previousStudentId = getPreviousReviewStudentId(submission.studentId, assignment.id);
    const nextStudentId = getNextReviewStudentId(submission.studentId, assignment.id);
    const deadlinePassed = canMarkLateOrMissing(assignment);
    const currentStatus = submission.status || submission.teacherReview?.status || "not_started";
    const canReopenSubmission = isStudentSubmissionLocked(submission);
    const rubricSchema = assignment.uploadedRubricSchema || assignment.rubricSchema || getRubricSchema(assignment.uploadedRubricData || assignment.rubric, assignment.uploadedRubricName || assignment.title);
    const playback = getPlaybackState(submission);

    return `
    <section class="panel review-shell">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;">
        <button class="button-ghost" data-action="back-to-assignments" style="font-size:0.85rem;">← Assignments</button>
        <span style="color:var(--muted);font-size:0.85rem;">/</span>
        <button class="button-ghost" data-action="back-to-review" style="font-size:0.85rem;">${escapeHtml(assignment.title)}</button>
        <span style="color:var(--muted);font-size:0.85rem;">/</span>
        <span style="font-weight:600;font-size:0.95rem;">${escapeHtml(studentName)}</span>
        <button class="button-ghost" data-action="edit-class-member-name" data-student-id="${submission.studentId}" data-student-name="${escapeAttribute(studentName)}" style="font-size:0.78rem;min-height:30px;padding:0 10px;">Rename</button>
        <span class="status-pill">${escapeHtml(getSubmissionStatusDisplay(currentStatus))}</span>
        ${roster.length ? `<span style="font-size:0.82rem;color:var(--muted);">${rosterIndex + 1}/${roster.length}</span>` : ""}
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="button-ghost" data-action="previous-review-student" ${!previousStudentId ? "disabled" : ""} style="font-size:0.85rem;">← Previous student</button>
          <button class="button-ghost" data-action="next-review-student" ${!nextStudentId ? "disabled" : ""} style="font-size:0.85rem;">Next student →</button>
          <button class="button-ghost" data-action="download-work" style="font-size:0.85rem;">⬇ Grade sheet</button>
        </div>
      </div>

      <div class="review-grid ${rubricSchema ? "review-grid-stacked" : ""}">
        <div class="review-card">

          ${renderTeacherSubmissionStatusPanel(currentStatus, canReopenSubmission, deadlinePassed)}

          ${renderEmailDebugPanel(assignment, submission)}
          ${renderSubmissionBehaviourFlagPanel(submission)}
          ${renderWritingBehaviour(submission, assignment)}
          ${renderPasteEvidencePanel(submission)}
          ${renderWritingTimeNote(submission)}
          ${renderStudentAiFeedbackEvidence(submission)}
          <div style="margin-bottom:16px;">
            <p class="mini-label" style="margin-bottom:6px;">Student text</p>
            <div class="editor-with-lines review-editor-with-lines">
              <div class="line-gutter" id="student-text-annotate-gutter" aria-hidden="true"></div>
              <div id="student-text-annotate" data-line-gutter="student-text-annotate-gutter" onmouseup="captureAnnotationSelection()" onkeyup="captureAnnotationSelection()" ontouchend="captureAnnotationSelection()" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;min-height:320px;max-height:min(78vh,900px);overflow-y:auto;cursor:text;">${renderAnnotatedText(submission)}</div>
            </div>
          </div>

          ${renderTeacherAnnotationPanel(submission)}

          <details style="margin-bottom:16px;" ${ui.playback.touched ? "open" : ""}>
            <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted);padding:6px 0;">▶ Letter-by-letter playback</summary>
            <div style="margin-top:10px;">
              <div class="pill-row" style="margin-bottom:10px;">
                <button type="button" class="button-ghost" data-action="playback-step" data-direction="-1" ${playback.frames.length <= 1 ? "disabled" : ""}>← Back</button>
                <button type="button" class="button-ghost" data-action="playback-toggle" ${playback.frames.length <= 1 ? "disabled" : ""}>${ui.playback.isPlaying ? "Pause" : "Play"}</button>
                <button type="button" class="button-ghost" data-action="playback-step" data-direction="1" ${playback.frames.length <= 1 ? "disabled" : ""}>Next →</button>
                <label class="subtle" style="display:flex;align-items:center;gap:8px;">Speed
                  <select id="playback-speed">
                    ${[0.5, 1, 1.5, 2, 3, 5, 8, 10, 15].map((speed) => `<option value="${speed}" ${Number(ui.playback.speed) === Number(speed) ? "selected" : ""}>${speed}×</option>`).join("")}
                  </select>
                </label>
                <span id="playback-meta" class="pill">${escapeHtml(playback.timeLabel)}</span>
              </div>
              <input id="playback-slider" type="range" min="0" max="${Math.max(playback.frames.length - 1, 0)}" value="${playback.index}" style="width:100%;margin-bottom:10px;" ${playback.frames.length <= 1 ? "disabled" : ""} />
              <div id="playback-label" class="subtle" style="margin-bottom:8px;">${escapeHtml(playback.label)}</div>
              <div id="playback-screen" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-height:180px;max-height:380px;overflow:auto;"><pre style="margin:0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(playback.text)}</pre></div>
            </div>
          </details>

          <details style="margin-bottom:16px;">
            <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted);padding:6px 0;">▶ Coaching chat (${(submission.chatHistory || []).filter(m => m.role === "user").length} student messages)</summary>
            <div style="margin-top:10px;max-height:200px;overflow-y:auto;display:grid;gap:6px;">
              ${(submission.chatHistory || []).map(m => `
                <div style="padding:8px 12px;border-radius:8px;background:${m.role === "user" ? "#edf4ea" : "#f4efe6"};font-size:0.85rem;">
                  <strong style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:2px;">${m.role === "user" ? escapeHtml(studentName) : "Coach"}</strong>
                  ${escapeHtml(m.content)}
                </div>
              `).join("")}
            </div>
            <div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#f8fbff;border:1px solid var(--line);">
              <strong style="display:block;font-size:0.8rem;margin-bottom:4px;color:var(--muted);">Reflection — what I improved</strong>
              <p style="margin:0;white-space:pre-wrap;line-height:1.6;">${escapeHtml(submission.reflections?.improved || "No reflection written yet.")}</p>
            </div>
          </details>

        </div>

        <div class="review-card">

            <div style="margin-bottom:16px;">
            <p class="mini-label" style="margin-bottom:8px;">Rubric</p>
            ${rubricSchema
              ? renderRubricSchemaLayout(rubricSchema, {
                  clickable: true,
                  compact: true,
                  rowScoreMap: reviewSummary.rowScoreMap,
                  suggestedRowScoreMap,
                  currentScore: (typeof submission.teacherReview?.finalScore === "number" && !Number.isNaN(submission.teacherReview.finalScore))
                     ? submission.teacherReview.finalScore
                     : reviewSummary.totalScore,
                })
              : reviewSummary.rubric.map((criterion) => {
                  const bands = getCriterionBands(criterion);
                  const selected = reviewSummary.rowScoreMap.get(criterion.id);
                  const suggested = suggestedRowScoreMap.get(criterion.id);
                  return `
                    <div style="padding:10px 0;border-bottom:1px solid var(--line);">
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                        <div style="flex:1;">
                          <div style="font-weight:600;font-size:0.9rem;">${escapeHtml(criterion.name)}</div>
                          <div style="font-size:0.82rem;color:var(--muted);line-height:1.5;">${escapeHtml(criterion.description)}</div>
                        </div>
                        <span style="font-size:0.85rem;color:var(--muted);flex-shrink:0;">/${criterion.points} pts</span>
                      </div>
                      ${bands.length ? `
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                          ${bands.map((band) => {
                            const isSelected = selected?.bandId === band.id || (selected && Number(selected.points) === Number(band.points) && selected.label === band.label);
                            const isSuggested = suggested?.bandId === band.id || (suggested && Number(suggested.points) === Number(band.points) && suggested.label === band.label);
                            const bg = isSelected ? "#dff3e4" : isSuggested ? "#f4efe6" : "#fff";
                            const border = isSelected ? "#4f8f68" : isSuggested ? "#c8b9a2" : "var(--line)";
                            const color = isSelected ? "#1f5c38" : "var(--ink)";
                            return `<button
                              class="button-ghost"
                              data-action="select-rubric-band"
                              data-criterion-id="${criterion.id}"
                              data-band-id="${escapeAttribute(band.id)}"
                              style="padding:8px 10px;min-width:0;background:${bg};border-color:${border};color:${color};font-size:0.8rem;"
                            >${escapeHtml(band.label)} (${band.points})</button>`;
                          }).join("")}
                        </div>
                      ` : ""}
                      ${selected ? `
                        <p style="font-size:0.78rem;color:var(--sage);margin:8px 0 0;">Selected: ${escapeHtml(selected.label)} (${selected.points}/${selected.maxPoints})</p>
                      ` : suggested ? `
                        <p style="font-size:0.78rem;color:var(--muted);margin:8px 0 0;">AI suggestion: ${escapeHtml(suggested.label)} (${suggested.points}/${suggested.maxPoints})</p>
                      ` : `
                        <p style="font-size:0.78rem;color:var(--muted);margin:8px 0 0;">Choose a band to score this criterion.</p>
                      `}
                    </div>
                  `;
                }).join("")
            }
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
                   <span style="font-size:0.82rem;color:var(--muted);">${reviewSummary.selectedCount}/${reviewSummary.rubric.length} criteria scored</span>
                   ${(typeof submission.teacherReview?.finalScore === "number" && submission.teacherReview.finalScore !== reviewSummary.totalScore) ? "" : `
                     <span style="font-size:0.95rem;font-weight:700;color:var(--ink);">Auto total: ${reviewSummary.totalScore}/${reviewSummary.maxScore}</span>
                   `}
                 </div>
          </div>

          ${renderSuggestedGradePanel(submission)}

          <div class="field" style="margin-bottom:12px;">
                <label for="teacher-review-final-score">Final score (out of ${reviewSummary.maxScore})</label>
                <div style="display:flex;align-items:center;gap:8px;">
                  <input
                    type="number"
                    id="teacher-review-final-score"
                    step="0.5"
                    min="0"
                    max="${reviewSummary.maxScore}"
                    value="${escapeAttribute(String(
                      ui.pendingFinalScoreOverride !== null
                        ? ui.pendingFinalScoreOverride
                        : (reviewScore !== "" ? reviewScore : reviewSummary.totalScore)
                    ))}"
                    style="padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fafaf8;font-weight:700;font-size:1rem;width:120px;text-align:center;"
                  />
                  <span style="color:var(--muted);">/ ${reviewSummary.maxScore}</span>
                  ${(typeof submission.teacherReview?.finalScore === "number" && submission.teacherReview.finalScore !== reviewSummary.totalScore) ? "" : `
                    <span style="font-size:0.78rem;color:var(--muted);">Auto total: ${reviewSummary.totalScore}/${reviewSummary.maxScore}</span>
                  `}
                </div>
                <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Edit this number to override the rubric total. Changing rubric scores will recalculate it.</p>
              </div>

          <div class="field" style="margin-bottom:12px;">
            <label for="teacher-review-notes">Teacher notes</label>
            <textarea id="teacher-review-notes" style="min-height:120px;">${escapeHtml(reviewNotes)}</textarea>
          </div>

          ${submission.teacherReview?.savedAt ? `
            <p style="font-size:0.8rem;color:var(--sage);margin-bottom:8px;">✓ Grade saved ${escapeHtml(formatDateTime(submission.teacherReview.savedAt))}</p>
          ` : ""}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="button-secondary" data-action="generate-grade" ${ui.gradeSuggestionLoading ? "disabled" : ""}>${ui.gradeSuggestionLoading ? "Suggesting…" : "Suggest rubric scores"}</button>
            ${ui.gradeSuggestionLoading ? `<span style="font-size:0.82rem;color:var(--muted);align-self:center;">AI is reviewing the submission…</span>` : ""}
            <button class="button-ghost" data-action="copy-lms-grade">Copy Grade</button>
            <button class="button" data-action="save-teacher-review" ${ui.gradeSubmitting ? "disabled" : ""}>${ui.gradeSubmitting ? "Submitting…" : "Submit grade"}</button>
            </div>
            ${ui.notice && /grade submitted/i.test(ui.notice) ? `
              <div style="margin-top:14px;padding:12px 14px;background:#e8f5e9;border:1px solid #66bb6a;border-radius:10px;color:#2e7d32;font-weight:600;">✓ ${escapeHtml(ui.notice)}</div>
            ` : ""}
        </div>
      </div>
    </section>
  `;
  }

  const TeacherRender = {
    renderTeacherWorkspace,
    renderTeacherReview,
    renderTeacherGrading,
  };

  if (typeof window !== "undefined") {
    window.TeacherRender = TeacherRender;
    Object.assign(window, TeacherRender);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TeacherRender;
  }
})();
