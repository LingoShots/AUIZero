// admin-render.js
// Admin workspace renderers extracted from app.js (Phase 6).
// Reads ui via window.AppState. Helpers (escapeHtml, escapeAttribute, safeArray,
// formatDateTime, isPasteLikeWritingEvent, createDefaultTeacherReview,
// fluencyBadgeStyle, renderFluencyCard) are read from window.
// Exposes window.AdminRender plus individual function globals for back-compat.

(function () {
  function renderAdminProcessRefreshStatus() {
    const { ui } = window.AppState;
    if (ui.adminProcessRecomputeLoading) {
      return `<div style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fafaf8;margin-bottom:16px;color:var(--muted);font-size:0.84rem;">Updating writing process analytics in the background…</div>`;
    }
    if (ui.adminProcessRecomputeError) {
      return `<div style="padding:12px 14px;border:1px solid #e8b4b8;border-radius:12px;background:#fff8fa;margin-bottom:16px;color:#9b3651;font-size:0.84rem;">Could not update writing process analytics: ${escapeHtml(ui.adminProcessRecomputeError)}</div>`;
    }
    const result = ui.adminProcessRecomputeResult;
    if (!result) return "";
    if (!Number(result.recomputed || 0) && !Number(result.remainingEstimate || 0)) return "";
    return `
      <div style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#f8fbff;margin-bottom:16px;color:var(--muted);font-size:0.84rem;">
        Writing process analytics updated: ${escapeHtml(String(result.recomputed || 0))} refreshed for ${escapeHtml(result.analysisVersion || "current version")}${Number(result.remainingEstimate || 0) > 0 ? `, about ${escapeHtml(String(result.remainingEstimate))} still queued for the next admin load` : ""}.
      </div>
    `;
  }

  function renderAdminCefrBenchmarkPanel() {
    const { ui } = window.AppState;
    const CEFR_LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const BENCHMARKS = window.PraxisWritingProcess?.PRELIMINARY_COHORTS || {
      A0: { typingRate: [45, 115], longPauses: [18, 58], localRevisions: [2, 18], productProcessRatio: [0.62, 0.94], pasteShare: [0, 0.18] },
      A1: { typingRate: [55, 125], longPauses: [15, 52], localRevisions: [3, 20], productProcessRatio: [0.60, 0.94], pasteShare: [0, 0.18] },
      A2: { typingRate: [70, 145], longPauses: [10, 42], localRevisions: [4, 24], productProcessRatio: [0.58, 0.93], pasteShare: [0, 0.16] },
      B1: { typingRate: [85, 170], longPauses: [6, 32], localRevisions: [6, 30], productProcessRatio: [0.55, 0.92], pasteShare: [0, 0.14] },
      B2: { typingRate: [105, 205], longPauses: [4, 26], localRevisions: [8, 35], productProcessRatio: [0.52, 0.91], pasteShare: [0, 0.12] },
      C1: { typingRate: [120, 235], longPauses: [3, 20], localRevisions: [10, 40], productProcessRatio: [0.50, 0.90], pasteShare: [0, 0.10] },
      C2: { typingRate: [130, 255], longPauses: [2, 18], localRevisions: [12, 45], productProcessRatio: [0.48, 0.90], pasteShare: [0, 0.10] },
    };

    const METRIC_LABELS = {
    typingRate: {
      label: 'Typing rate',
      unit: 'chars/min',
      help: 'How quickly the student typed during the writing task. Very low typing may suggest hesitation, difficulty, or lots of thinking time.'
    },
    longPausesPer100w: {
      label: 'Long pauses',
      unit: 'per 100w',
      help: 'How often the student stopped typing for a longer time. Some pauses are normal because writers think, plan, and check their work.'
    },
    localRevisionsPer100w: {
      label: 'Local revisions',
      unit: 'per 100w',
      help: 'Small changes made while writing, such as fixing words, grammar, spelling, or reworking part of a sentence.'
    },
    productProcessRatio: {
      label: 'Product/process ratio',
      unit: '',
      help: 'A rough comparison between the final text and the amount of writing activity used to create it. Lower values can mean more drafting, deleting, or revising.'
    },
    pasteShare: {
      label: 'Paste share',
      unit: '',
      help: 'How much of the final writing appears to have come from pasted text rather than normal typing.'
    },
  };

    function statusDot(measured, range) {
      if (measured === null || measured === undefined || !range) return '<span style="color:var(--muted);">—</span>';
      const [lo, hi] = range;
      if (measured < lo) return '<span title="Below benchmark range" style="color:#c0392b;">▼</span>';
      if (measured > hi) return '<span title="Above benchmark range" style="color:#e67e22;">▲</span>';
      return '<span title="Within benchmark range" style="color:#27ae60;">✓</span>';
    }
  	
  function metricNameWithHelp(label, help) {
    return `
      <span style="position:relative;display:inline-block;">
        <span 
          style="cursor:help;text-decoration:underline dotted;text-underline-offset:3px;"
          onmouseenter="this.nextElementSibling.style.display='block'"
          onmouseleave="this.nextElementSibling.style.display='none'"
        >
          ${escapeHtml(label)} ?
        </span>
        <span style="display:none;position:absolute;left:0;top:22px;z-index:9999;width:260px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.14);font-size:0.78rem;line-height:1.45;color:var(--ink);font-weight:400;white-space:normal;">
          ${escapeHtml(help)}
        </span>
      </span>
    `;
  }
  	
    function fmt(v, unit) {
      if (v === null || v === undefined) return '<span style="color:var(--muted);">no data</span>';
      if (unit === '') return String(v);
      return `${v} <span style="color:var(--muted);font-size:0.78rem;">${unit}</span>`;
    }

    if (ui.adminCefrBenchmarksLoading) {
      return `<div style="padding:16px;border:1px solid var(--line);border-radius:14px;background:#fafaf8;margin-bottom:24px;color:var(--muted);font-size:0.9rem;">Loading writing process benchmark data…</div>`;
    }

    if (ui.adminCefrBenchmarksError) {
      return `<div style="padding:16px;border:1px solid #e8b4b8;border-radius:14px;background:#fff8fa;margin-bottom:24px;font-size:0.85rem;color:#9b3651;">Could not load benchmark data: ${escapeHtml(ui.adminCefrBenchmarksError)}</div>`;
    }

    if (!ui.adminCefrBenchmarks) return '';

    const byLevel = ui.adminCefrBenchmarks;
    const levelsWithData = CEFR_LEVELS.filter(l => byLevel[l]);

    if (!levelsWithData.length) {
      return `<div style="padding:16px;border:1px solid var(--line);border-radius:14px;background:#fafaf8;margin-bottom:24px;color:var(--muted);font-size:0.9rem;">No writing process data yet across any class.</div>`;
    }

    const metricKeys = Object.keys(METRIC_LABELS);

    return `
      <details open style="margin-bottom:24px;border:1px solid var(--line);border-radius:14px;background:#fff;">
        <summary style="cursor:pointer;padding:14px 16px;font-weight:700;font-size:1rem;list-style:none;display:flex;align-items:center;justify-content:space-between;">
          <span>Writing Process — CEFR Benchmark Comparison</span>
          <span class="pill" style="font-weight:400;font-size:0.8rem;">All classes · ${levelsWithData.length} level${levelsWithData.length !== 1 ? 's' : ''} with data</span>
        </summary>
        <div style="padding:0 16px 16px;overflow-x:auto;">
          <p style="margin:0 0 12px;font-size:0.83rem;color:var(--muted);">Median measured values (included submissions only, ≥50 words) vs. placeholder benchmarks. ✓ = within range, ▼ = below, ▲ = above.</p>
          <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
            <thead>
              <tr style="border-bottom:2px solid var(--line);">
                <th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;">Metric</th>
                ${levelsWithData.map(l => {
                  const d = byLevel[l];
                  return `<th style="text-align:center;padding:6px 10px;min-width:90px;">
                    <span style="font-weight:700;">${escapeHtml(l)}</span>
                    <br><span style="font-size:0.74rem;color:var(--muted);font-weight:400;">${d.included} incl. / ${d.total} total</span>
                  </th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              ${metricKeys.map((key, rowIndex) => {
                const { label, unit, help } = METRIC_LABELS[key];
                const bg = rowIndex % 2 === 0 ? '#fafaf8' : '#fff';
                return `
                  <tr style="border-bottom:1px solid var(--line);background:${bg};">
                    <td style="padding:8px 10px;font-weight:600;white-space:nowrap;">
   				 	${metricNameWithHelp(label, help)}
  				  </td>
                    ${levelsWithData.map(l => {
                      const measured = byLevel[l]?.measured?.[key];
                      const range = BENCHMARKS[l]?.[key === 'longPausesPer100w' ? 'longPauses' : key === 'localRevisionsPer100w' ? 'localRevisions' : key];
                      const rangeText = range ? `<br><span style="color:var(--muted);font-size:0.75rem;">bench: ${range[0]}–${range[1]}</span>` : '';
                      return `<td style="text-align:center;padding:8px 10px;">
                        <span>${statusDot(measured, range)} ${fmt(measured, unit)}</span>
                        ${rangeText}
                      </td>`;
                    }).join('')}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <p style="margin:12px 0 0;font-size:0.75rem;color:var(--muted);">Benchmarks are placeholder values bootstrapped from L2 literature. Replace with Praxis cohort data once sample sizes are sufficient.</p>
        </div>
      </details>
    `;
  }
  function renderAdminTeacherList() {
    const { ui } = window.AppState;
    const teachers = ui.adminTeachers || [];
    return `
      <section class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="margin:0;">Admin — All Teachers</h2>
          <button class="button-secondary" data-action="admin-view-as-teacher">Switch to my teacher view</button>
        </div>
       ${renderAdminCefrBenchmarkPanel()}
        ${renderAdminProcessRefreshStatus()}
        ${teachers.length === 0
          ? `<div class="empty-state"><p>No teachers found.</p></div>`
          : `<div class="assignment-list">
              ${teachers.map(teacher => `
                <div class="assignment-card simple-card">
                  <div class="card-top">
                    <div style="flex:1;">
                      <h3 style="margin:0 0 4px;">${escapeHtml(teacher.name)}</h3>
                      <div class="pill-row" style="flex-wrap:wrap;">
                        <span class="pill">${teacher.classCount} class${teacher.classCount !== 1 ? "es" : ""}</span>
                        <span class="pill">${teacher.assignmentCount} assignment${teacher.assignmentCount !== 1 ? "s" : ""}</span>
                        <span class="pill">${teacher.publishedCount} published</span>
                        <span class="pill">${teacher.studentCount} student${teacher.studentCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <button class="button" data-action="admin-select-teacher" data-teacher-id="${teacher.id}">View →</button>
                  </div>
                </div>
              `).join("")}
            </div>`
        }
      </section>
    `;
  }

  function renderAdminTeacherDetail() {
    const { ui } = window.AppState;
    const teacher = (ui.adminTeachers || []).find(t => t.id === ui.adminSelectedTeacherId);
    if (!teacher) return `<div class="empty-state"><p>Teacher not found.</p></div>`;
    return `
      <section class="panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="button-ghost" data-action="admin-back-to-teachers" style="font-size:0.85rem;">← All teachers</button>
          <span style="color:var(--muted);">/</span>
          <span style="font-weight:600;">${escapeHtml(teacher.name)}</span>
        </div>
        ${(teacher.classes || []).length === 0
          ? `<div class="empty-state"><p>This teacher has no classes yet.</p></div>`
          : `<div class="assignment-list">
              ${(teacher.classes || []).map(cls => `
                <div class="assignment-card simple-card">
                  <div class="card-top">
                    <h3 style="margin:0;">${escapeHtml(cls.name)}</h3>
                    <button class="button" data-action="admin-select-class" data-class-id="${cls.id}" data-teacher-id="${teacher.id}">View →</button>
                  </div>
                </div>
              `).join("")}
            </div>`
        }
      </section>
    `;
  }

  function renderAdminStudentDataFlags(member) {
    const flags = [];
    if (member?.is_test_account) {
      flags.push(`<span class="warning-pill" title="Admin-only marker for fake/demo/test accounts. Future writing behaviour analytics should ignore this student.">Test account</span>`);
    }
    return flags.length ? `<div class="pill-row" style="margin-top:8px;">${flags.join("")}</div>` : "";
  }

  function renderAdminStudentFlagControls(member) {
    const { ui } = window.AppState;
    const saving = ui.adminStudentFlagSavingId === member?.id;
    return `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="button-ghost" data-action="admin-toggle-test-student" data-student-id="${escapeAttribute(member?.id || "")}" ${saving ? "disabled" : ""} title="Admin-only marker for fake/demo/test accounts. This is not for one assignment concern. To exclude one assignment from the future data pool, use Flag submission in the teacher grading screen." style="font-size:0.78rem;">
          ${saving ? "Saving…" : member?.is_test_account ? "Unmark test account" : "Mark as test account"}
        </button>
      </div>
    `;
  }

  function renderAdminWritingBehaviourCard(submission, member, assignment = {}) {
    const review = submission?.teacher_review || submission?.teacherReview || {};
    if (member?.is_test_account || review?.writingBehaviourExcluded) {
      return `
        <div style="padding:12px;border:1px dashed var(--line);border-radius:12px;background:#fbfdff;color:var(--muted);font-size:0.85rem;">
          Writing behaviour data excluded ${member?.is_test_account ? "because this is marked as a test account" : "because this submission was flagged by the teacher"}.
        </div>
      `;
    }
    const assignmentRecord = typeof assignment === "string" ? { title: assignment } : (assignment || {});
    const assignmentTitle = assignmentRecord.title || "Assignment";
    if (window.PraxisWritingProcess?.analyzeSubmission) {
      const analysis = window.PraxisWritingProcess.analyzeSubmission(submission, assignmentRecord);
      const metrics = analysis.metrics || {};
      const idleNote = Number(metrics.ignoredIdlePauseCount || 0) > 0
        ? `<span class="pill" title="Longer gaps over 2 minutes are treated as idle or away time.">${escapeHtml(String(metrics.ignoredIdlePauseCount))} idle gap${Number(metrics.ignoredIdlePauseCount) === 1 ? "" : "s"} ignored</span>`
        : "";
      return `
        <div style="padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px;">
            <div>
              <span class="mini-label" style="display:block;margin-bottom:3px;">${escapeHtml(assignmentTitle)}</span>
              <strong style="font-size:0.95rem;color:var(--ink);">${escapeHtml(analysis.statusLabel || "Writing process")}</strong>
            </div>
            <span class="pill">${escapeHtml(analysis.analysisVersion || "")}</span>
          </div>
          <div class="pill-row">
            <span class="pill">${escapeHtml(String(metrics.finalWords || 0))} words</span>
            <span class="pill">${escapeHtml(String(metrics.typingRate || 0))} chars/min</span>
            <span class="pill">${escapeHtml(String(metrics.longPausesPer100w || 0))} long pauses/100w</span>
            <span class="pill">${escapeHtml(String(metrics.localRevisionsPer100w || 0))} local revisions/100w</span>
            <span class="pill">${escapeHtml(String(Math.round(Number(metrics.productProcessRatio || 0) * 100)))}% text survival</span>
            ${idleNote}
          </div>
        </div>
      `;
    }
    return renderFluencyCard(submission, assignmentTitle);
  }

  function renderSubmissionBehaviourFlagPanel(submission) {
    const review = createDefaultTeacherReview(submission?.teacherReview);
    const isFlagged = Boolean(review.writingBehaviourExcluded);
    return `
      <details style="margin-bottom:12px;border:1px solid ${isFlagged ? "#d46a7b" : "var(--line)"};border-radius:12px;background:${isFlagged ? "#fff8fa" : "#fafaf8"};">
        <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;list-style-position:inside;">
          <span style="font-weight:700;color:var(--ink);">Writing behaviour analytics</span>
          <span class="${isFlagged ? "warning-pill" : "pill"}" style="margin-left:auto;">
            ${isFlagged ? "Flagged" : "Optional"}
          </span>
        </summary>
        <div style="padding:0 12px 12px;">
          <p style="margin:0;color:var(--muted);font-size:0.84rem;line-height:1.5;">
            ${isFlagged
              ? `This submission is ignored by future writing behaviour analytics.`
              : `Flag only this submission if its writing behaviour looks unreliable, cheated, or unsuitable for future analytics.`}
          </p>
          ${isFlagged ? `<p style="margin:6px 0 10px;font-size:0.78rem;color:#9b3651;">Flagged ${escapeHtml(formatDateTime(review.writingBehaviourExcludedAt))}${review.writingBehaviourExclusionReason ? ` · ${escapeHtml(review.writingBehaviourExclusionReason)}` : ""}</p>` : `<div style="height:10px;"></div>`}
          <button
            class="${isFlagged ? "button-ghost" : "button-secondary"}"
            data-action="toggle-submission-behaviour-exclusion"
            title="This affects only this assignment submission, not the whole student account. Use admin's test-account flag for fake/demo accounts."
            style="font-size:0.82rem;"
          >
            ${isFlagged ? "Unflag submission" : "Flag submission"}
          </button>
        </div>
      </details>
    `;
  }

  function renderAdminAssignmentMemberCard(member, subs, assignment) {
    const sub = subs.find((submission) => submission.student_id === member.id);
    const review = sub?.teacher_review;
    const rowScores = review?.rowScores || [];
    const finalScore = review?.finalScore ?? "";
    const status = sub?.status || "not started";
    const wordCount = sub?.final_text?.trim()
      ? sub.final_text.trim().split(/\s+/).length
      : sub?.draft_text?.trim()
        ? sub.draft_text.trim().split(/\s+/).length
        : 0;
    const pasteFlags = (sub?.writing_events || []).filter((entry) => isPasteLikeWritingEvent(entry)).length;
    const statusColour = status === "submitted" ? "var(--sage)" : status === "not started" ? "var(--muted)" : "var(--accent)";

    return `
      <div style="border:1px solid var(--line);border-radius:14px;padding:16px;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div>
            <strong style="display:block;margin-bottom:4px;">${escapeHtml(member.name)}</strong>
            <span style="font-size:0.82rem;color:${statusColour};">${escapeHtml(status)}</span>
            ${renderAdminStudentDataFlags(member)}
            ${renderAdminStudentFlagControls(member)}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            ${finalScore !== "" ? `<div style="font-size:1.4rem;font-weight:800;color:var(--accent-deep);">${escapeHtml(String(finalScore))}</div><div style="font-size:0.75rem;color:var(--muted);">score</div>` : `<div style="font-size:0.85rem;color:var(--muted);">Not graded</div>`}
          </div>
        </div>

        ${sub ? renderAdminSubmissionDetail(sub, member, assignment, review, rowScores, wordCount, pasteFlags) : `<p class="subtle" style="margin-top:8px;font-size:0.85rem;">No work started yet.</p>`}
      </div>
    `;
  }

  function renderAdminSubmissionDetail(sub, member, assignment, review, rowScores, wordCount, pasteFlags) {
    return `
      <div class="pill-row" style="margin-top:10px;">
        <span class="pill">${wordCount} words</span>
        <span class="pill">${(sub.writing_events || []).length} edits</span>
        ${pasteFlags ? `<span class="warning-pill">⚠ ${pasteFlags} paste flag${pasteFlags > 1 ? "s" : ""}</span>` : ""}
        ${(sub.feedback_history || []).length ? `<span class="pill">${sub.feedback_history.length} feedback check${sub.feedback_history.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      ${rowScores.length ? `
        <div style="margin-top:12px;display:grid;gap:6px;">
          ${rowScores.map(row => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#f8fbff;font-size:0.84rem;">
              <span>${escapeHtml(row.criterionName || "")}</span>
              <strong style="white-space:nowrap;">${escapeHtml(row.label || "")} · ${row.points}/${row.maxPoints}</strong>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${review?.finalNotes ? `
        <div style="margin-top:10px;padding:10px 12px;border-left:3px solid var(--accent);background:#f4f8ff;border-radius:0 8px 8px 0;font-size:0.85rem;">
          <span class="mini-label" style="display:block;margin-bottom:4px;">Teacher feedback</span>
          ${escapeHtml(review.finalNotes)}
        </div>
      ` : ""}
      <div style="margin-top:12px;">
        <span class="mini-label">Writing fluency</span>
        ${renderAdminWritingBehaviourCard(sub, member, assignment)}
      </div>
    `;
  }

  function renderAdminStudentOverviewCard(member, detail) {
    const studentSubs = (detail.submissions || []).filter((submission) => submission.student_id === member.id);
    const submitted = studentSubs.filter((submission) => SubmissionUtils.isSubmissionSubmitted(submission)).length;
    const graded = studentSubs.filter((submission) => SubmissionUtils.isSubmissionGraded(submission)).length;
    const totalScore = studentSubs.reduce((sum, submission) => sum + Number(submission.teacher_review?.finalScore || 0), 0);
    return `
      <div class="submission-card simple-card" style="margin-bottom:6px;">
        <div class="card-top" style="flex-wrap:wrap;gap:10px;">
          <div style="flex:1;min-width:220px;">
            <h3 style="margin:0;">${escapeHtml(member.name)}</h3>
            ${renderAdminStudentDataFlags(member)}
            ${renderAdminStudentFlagControls(member)}
          </div>
          <div class="pill-row">
            <span class="pill">${submitted} submitted</span>
            ${graded ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ ${graded} graded · ${totalScore} pts total</span>` : ""}
          </div>
        </div>
        ${renderAdminStudentWritingBehaviour(member, studentSubs, detail.assignments || [])}
      </div>
    `;
  }

  function renderAdminStudentWritingBehaviour(member, studentSubs, assignments) {
    if (member.is_test_account) {
      return `
        <div style="margin-top:10px;padding:12px;border:1px dashed var(--line);border-radius:12px;background:#fbfdff;color:var(--muted);font-size:0.85rem;">
          Writing behaviour data excluded for this test account across ${studentSubs.length} assignment${studentSubs.length === 1 ? "" : "s"}.
        </div>
      `;
    }
    if (!studentSubs.length) return "";
    return `
      <div style="margin-top:10px;display:grid;gap:8px;">
        ${studentSubs.map((sub) => {
          const assignment = assignments.find((item) => item.id === sub.assignment_id);
          return renderAdminWritingBehaviourCard(sub, member, assignment || { title: "Assignment" });
        }).join("")}
      </div>
    `;
  }

  function renderAdminClassDetail() {
    const { ui } = window.AppState;
    const detail = ui.adminClassDetail;
    if (!detail) return `<div class="empty-state"><p>Loading...</p></div>`;
    const teacher = (ui.adminTeachers || []).find(t => t.id === ui.adminSelectedTeacherId);

    // If an assignment is selected, show the gradebook for that assignment
    if (ui.adminSelectedAssignmentId) {
      const assignment = (detail.assignments || []).find(a => a.id === ui.adminSelectedAssignmentId);
      const subs = (detail.submissions || []).filter(s => s.assignment_id === ui.adminSelectedAssignmentId);
      const rubric = assignment?.rubric || [];

      return `
        <section class="panel">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
            <button class="button-ghost" data-action="admin-back-to-teachers" style="font-size:0.85rem;">← All teachers</button>
            <span style="color:var(--muted);">/</span>
            <button class="button-ghost" data-action="admin-back-to-teacher" style="font-size:0.85rem;">${escapeHtml(teacher?.name || "Teacher")}</button>
            <span style="color:var(--muted);">/</span>
            <button class="button-ghost" data-action="admin-back-to-class" style="font-size:0.85rem;">${escapeHtml(ui.adminSelectedClassName || "Class")}</button>
            <span style="color:var(--muted);">/</span>
            <span style="font-weight:600;">${escapeHtml(assignment?.title || "Assignment")}</span>
          </div>

          ${window.PraxisWritingProcess?.renderAdminDataQualityPanel
            ? window.PraxisWritingProcess.renderAdminDataQualityPanel({
                ...detail,
                submissions: subs,
              }, escapeHtml)
            : ""}

          <div style="margin-bottom:16px;">
            <p class="subtle">${escapeHtml(assignment?.prompt || "")}</p>
            <div class="pill-row" style="margin-top:8px;">
              <span class="${assignment?.status === "published" ? "pill" : "warning-pill"}">${escapeHtml(assignment?.status || "draft")}</span>
              <span class="pill">${assignment?.word_count_min || 0}–${assignment?.word_count_max || 0} words</span>
              <span class="pill">${subs.length} submission${subs.length !== 1 ? "s" : ""}</span>
              ${assignment?.deadline ? `<span class="pill">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short"}))}</span>` : ""}
            </div>
          </div>

          ${subs.length === 0
            ? `<div class="empty-state compact-empty"><p>No submissions yet for this assignment.</p></div>`
            : `<div style="display:grid;gap:10px;">
                ${(detail.members || []).map((member) => renderAdminAssignmentMemberCard(member, subs, assignment)).join("")}
              </div>`
          }
        </section>
      `;
    }

    // Default: class overview with assignments and students
    return `
      <section class="panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="button-ghost" data-action="admin-back-to-teachers" style="font-size:0.85rem;">← All teachers</button>
          <span style="color:var(--muted);">/</span>
          <button class="button-ghost" data-action="admin-back-to-teacher" style="font-size:0.85rem;">${escapeHtml(teacher?.name || "Teacher")}</button>
          <span style="color:var(--muted);">/</span>
          <span style="font-weight:600;">${escapeHtml(ui.adminSelectedClassName || "Class")}</span>
        </div>

        <div style="margin-bottom:24px;">
          ${window.PraxisWritingProcess?.renderAdminDataQualityPanel
            ? window.PraxisWritingProcess.renderAdminDataQualityPanel(detail, escapeHtml)
            : ""}
          <p class="mini-label" style="margin-bottom:10px;">Assignments</p>
          ${(detail.assignments || []).length === 0
            ? `<p class="subtle">No assignments yet.</p>`
            : detail.assignments.map(a => {
                const subs = (detail.submissions || []).filter(s => s.assignment_id === a.id);
                const statusCounts = SubmissionUtils.getAssignmentSubmissionCounts(subs, detail.members || []);
                const submitted = statusCounts.submitted;
                const graded = statusCounts.graded;
                return `
                  <div class="assignment-card simple-card" style="margin-bottom:8px;">
                    <div class="card-top">
                      <div style="flex:1;">
                        <h3 style="margin:0 0 4px;">${escapeHtml(a.title)}</h3>
                        <div class="pill-row">
                          <span class="${a.status === "published" ? "pill" : "warning-pill"}">${escapeHtml(a.status)}</span>
                          <span class="pill">${submitted}/${(detail.members || []).length} submitted</span>
                          <span class="pill">${graded} graded</span>
                        </div>
                      </div>
                      <button class="button" data-action="admin-select-assignment" data-assignment-id="${a.id}">Gradebook →</button>
                    </div>
                  </div>
                `;
              }).join("")
          }
        </div>

        <div>
          <p class="mini-label" style="margin-bottom:10px;">Students (${(detail.members || []).length})</p>
          ${(detail.members || []).length === 0
            ? `<p class="subtle">No students enrolled.</p>`
            : detail.members.map((member) => renderAdminStudentOverviewCard(member, detail)).join("")
          }
        </div>
      </section>
    `;
  }


  const AdminRender = {
    renderAdminProcessRefreshStatus,
    renderAdminCefrBenchmarkPanel,
    renderAdminTeacherList,
    renderAdminTeacherDetail,
    renderAdminStudentDataFlags,
    renderAdminStudentFlagControls,
    renderAdminWritingBehaviourCard,
    renderSubmissionBehaviourFlagPanel,
    renderAdminClassDetail,
  };

  if (typeof window !== "undefined") {
    window.AdminRender = AdminRender;
    Object.assign(window, AdminRender);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AdminRender;
  }
})();