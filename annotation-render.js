(function () {
  const {
    escapeHtml,
    escapeAttribute,
    formatDateTime,
    safeArray,
    wordCount,
    trimTo,
    uid,
  } = window.CoreUtils;
  const {
    getEvidenceKindLabel,
    getEvidenceStatusLabel,
  } = window.PasteEvidenceUtils;

  function requireLegacyAppFunction(name) {
    const dependency = window[name];
    if (typeof dependency !== "function") {
      throw new Error(`AnnotationRender missing dependency: window.${name}`);
    }
    return dependency;
  }

  const getPasteEvidenceItems = (...args) => requireLegacyAppFunction("getPasteEvidenceItems")(...args);
  const getWritingTimeSummary = (...args) => requireLegacyAppFunction("getWritingTimeSummary")(...args);
  const getSubmissionReviewText = (...args) => requireLegacyAppFunction("getSubmissionReviewText")(...args);
  const getAnnotationDisplayLabel = (...args) => requireLegacyAppFunction("getAnnotationDisplayLabel")(...args);
  const isPasteLikeWritingEvent = (...args) => requireLegacyAppFunction("isPasteLikeWritingEvent")(...args);
  const getOutlineFields = (...args) => requireLegacyAppFunction("getOutlineFields")(...args);

  function renderPasteEvidencePanel(submission) {
    const items = getPasteEvidenceItems(submission);
    if (!items.length) return "";
    return `
    <section class="paste-evidence-panel teacher-ready-card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <p class="mini-label" style="margin-bottom:4px;">Paste evidence</p>
          <h3 style="margin:0;">${items.length} paste-like event${items.length === 1 ? "" : "s"}</h3>
          <p class="subtle" style="margin:6px 0 0;">Click an evidence flag to jump to the violet highlight when the pasted or bulk-inserted text is still present.</p>
        </div>
        <span class="warning-pill">Review authorship evidence</span>
      </div>
      <div style="display:grid;gap:10px;margin-top:12px;">
        ${items.map((item) => {
          const kindLabel = getEvidenceKindLabel(item.kind);
          const statusLabel = getEvidenceStatusLabel(item.foundExact);
          const body = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span class="pill">${escapeHtml(formatDateTime(item.timestamp))}</span>
              <span class="pill">${item.charCount} characters</span>
              <span class="pill">${escapeHtml(kindLabel)}</span>
              <span class="${item.foundExact ? "pill" : "warning-pill"}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="paste-evidence-excerpts">
              <div>
                <p class="mini-label">Preview</p>
                <p>${escapeHtml(item.excerpt?.preview || "(blank insert)")}</p>
              </div>
            </div>
          `;
          return `
            <details id="paste-evidence-${escapeAttribute(item.id)}" class="paste-evidence-card">
              <summary>
                ${body}
              </summary>
              <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
                  ${item.foundExact
                    ? `<button class="button-ghost" data-action="inspect-paste-flag" data-paste-id="${escapeAttribute(item.id)}" type="button" style="font-size:0.82rem;">Show in student text</button>`
                    : item.canHighlight
                      ? `<button class="button-ghost" data-action="inspect-paste-flag" data-paste-id="${escapeAttribute(item.id)}" type="button" style="font-size:0.82rem;">Show likely matched text</button>`
                      : `<button class="button-ghost" type="button" disabled style="font-size:0.82rem;">Exact text not found</button>`
                  }
                  <p class="subtle" style="margin:0;">${item.foundExact
                    ? "This exact text is still present in the final submission."
                    : item.canHighlight
                      ? "The exact original insert changed, but the final text appears to come from this inserted block."
                      : "This exact text is no longer found in the final submission. It may have been edited, shortened, or removed."
                  }</p>
                </div>
                <p class="mini-label" style="margin-bottom:6px;">Inserted text</p>
                <pre class="paste-evidence-fulltext">${escapeHtml(item.text)}</pre>
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </section>
  `;
  }

  function renderWritingTimeNote(submission) {
    const summary = getWritingTimeSummary(submission);
    return `
    <div class="teacher-ready-card" style="margin-bottom:16px;padding:12px 14px;">
      <p class="mini-label" style="margin-bottom:6px;">Writing time</p>
      <div class="pill-row">
        <span class="pill">${escapeHtml(summary.durationLabel)} active writing window</span>
        <span class="pill">${summary.editCount} tracked edit${summary.editCount === 1 ? "" : "s"}</span>
        <span class="pill">${summary.finalWords} final word${summary.finalWords === 1 ? "" : "s"}</span>
      </div>
      <p class="subtle" style="margin:8px 0 0;">Use this with the paste evidence and replay, especially when a long submission appears in a very short writing window.</p>
    </div>
  `;
  }

  function renderSuggestedGradePanel(submission) {
    if (!submission?.teacherReview?.suggestedGrade) return "";
    const suggestedGrade = submission.teacherReview.suggestedGrade;
    return `
    <div id="suggested-grade-panel" style="margin-bottom:16px;padding:14px;background:#f4efe6;border-radius:12px;border:1px solid var(--line);">
      <p class="mini-label" style="margin-bottom:6px;">AI suggested grade</p>
      <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px;">${suggestedGrade.totalScore}/${suggestedGrade.maxScore}</div>
      ${safeArray(suggestedGrade.criteria).length ? `
        <div style="display:grid;gap:6px;margin:0 0 10px;">
          ${suggestedGrade.criteria.map((criterion) => `
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.82rem;padding:8px 10px;background:#fff;border:1px solid var(--line);border-radius:10px;">
              <span>${escapeHtml(criterion.name)}</span>
              <strong>${escapeHtml(criterion.bandLabel || "Band")} (${criterion.score}/${criterion.points})</strong>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${suggestedGrade.studentComment ? `
        <div style="background:#f0f7ee;border-left:3px solid var(--accent);padding:10px 12px;border-radius:8px;margin-bottom:10px;">
          <p class="mini-label" style="margin-bottom:4px;">Suggested student comment</p>
          <p style="font-size:0.85rem;margin:0 0 8px;">${escapeHtml(suggestedGrade.studentComment)}</p>
          <button class="button-ghost" data-action="use-suggested-comment" style="font-size:0.8rem;">Copy to notes</button>
        </div>
      ` : ""}
      ${renderSuggestedGradeProcessNote(submission)}
      <div style="display:flex;gap:8px;">
        <button class="button-secondary" data-action="accept-suggested-grade">Use this score</button>
        <button class="button-ghost" data-action="ignore-suggested-grade">Ignore</button>
      </div>
    </div>
  `;
  }

  function renderStudentAiFeedbackEvidence(submission) {
    const entries = safeArray(submission?.feedbackHistory)
      .filter((entry) => safeArray(entry?.items).length);
    if (!entries.length) return "";
    const finalText = getSubmissionReviewText(submission);
    return `
    <section class="teacher-ready-card" style="margin-bottom:16px;">
      <p class="mini-label" style="margin-bottom:4px;">AI feedback used by student</p>
      <h3 style="margin:0 0 8px;">${entries.length} draft feedback check${entries.length === 1 ? "" : "s"}</h3>
      <div style="display:grid;gap:10px;">
        ${entries.slice().reverse().map((entry) => {
          const snapshot = String(entry.draftTextAtRequest || "");
          const hasSnapshot = snapshot.trim().length > 0;
          const changed = hasSnapshot && snapshot.trim() !== finalText.trim();
          const wordDelta = hasSnapshot ? wordCount(finalText) - wordCount(snapshot) : 0;
          return `
            <div class="feedback-card">
              <strong>${escapeHtml(formatDateTime(entry.timestamp || submission?.updatedAt || new Date().toISOString()))}</strong>
              <ul>${safeArray(entry.items).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              ${hasSnapshot ? `
                <div class="teacher-feedback-comparison">
                  <span class="${changed ? "pill" : "warning-pill"}">${changed ? "Changed after feedback" : "No clear change after feedback"}</span>
                  <span class="pill">${wordDelta >= 0 ? "+" : ""}${wordDelta} words after feedback</span>
                  <div class="comparison-grid">
                    <div>
                      <p class="mini-label">Draft at feedback time</p>
                      <p>${escapeHtml(trimTo(snapshot.replace(/\s+/g, " ").trim(), 220))}</p>
                    </div>
                    <div>
                      <p class="mini-label">Current final version</p>
                      <p>${escapeHtml(trimTo(finalText.replace(/\s+/g, " ").trim(), 220))}</p>
                    </div>
                  </div>
                </div>
              ` : `<p class="subtle" style="margin:8px 0 0;">Change comparison unavailable for older feedback checks.</p>`}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
  }

  function renderSuggestedGradeProcessNote(submission) {
    const evidenceItems = getPasteEvidenceItems(submission);
    if (!evidenceItems.length) return "";
    const pasteCount = evidenceItems.filter((item) => item.kind === "paste").length;
    const bulkInsertCount = evidenceItems.filter((item) => item.kind !== "paste").length;
    const parts = [
      pasteCount ? `${pasteCount} paste event${pasteCount === 1 ? "" : "s"}` : "",
      bulkInsertCount ? `${bulkInsertCount} large single insert event${bulkInsertCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return `
    <div class="process-note-card" style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;padding:10px 12px;border-radius:10px;margin-bottom:10px;">
      <p class="mini-label" style="margin-bottom:4px;color:#9a3412;">Writing process note</p>
      <p style="font-size:0.85rem;margin:0;line-height:1.55;color:#7c2d12;">
        The writing process shows ${escapeHtml(parts.join(" and "))}. This is not proof of misconduct, but it may indicate pasted text, an input tool, or another bulk-entry method. Ask the student to explain their process before finalizing the grade.
      </p>
    </div>
  `;
  }

  function renderAnnotatedText(submission, options = {}) {
    const {
      annotationClickTarget = "comment",
      includeClickHandlers = true,
      idPrefix = "",
    } = options;
    const text = getSubmissionReviewText(submission) || "No text submitted yet.";
    const annotations = submission?.teacherReview?.annotations || [];
    const pasteEvidenceItems = getPasteEvidenceItems(submission).filter((item) => item.canHighlight);

    const pasteHighlights = createPasteHighlights(pasteEvidenceItems);
    const annotationHighlights = createAnnotationHighlights(text, annotations, pasteHighlights);
    const highlights = [...pasteHighlights, ...annotationHighlights];

    if (!highlights.length) return escapeHtml(text);

    highlights.sort(compareHighlights);

    let result = "";
    let cursor = 0;

    for (const h of highlights) {
      if (h.start < cursor) continue;

      result += escapeHtml(text.slice(cursor, h.start));
      const segment = escapeHtml(text.slice(h.start, h.end));

      result += h.type === "paste"
        ? renderPasteHighlight(h, segment, { annotationClickTarget, includeClickHandlers, idPrefix })
        : renderAnnotationHighlight(h, segment, { annotationClickTarget, includeClickHandlers, idPrefix });

      cursor = h.end;
    }

    result += escapeHtml(text.slice(cursor));
    return result;
  }

  function renderPasteHighlight(highlight, segment, options) {
    const { annotationClickTarget, includeClickHandlers, idPrefix } = options;
    const pasteTitle = highlight.annotationLabels?.length
      ? `Pasted content — teacher review required. Also tagged: ${highlight.annotationLabels.join(", ")}`
      : "Pasted content — teacher review required";
    const overlayCodes = highlight.annotationLabels?.length
      ? `<sup style="font-size:0.76em;color:#5b2a86;font-weight:800;margin-left:4px;background:rgba(255,255,255,0.82);padding:1px 4px;border-radius:999px;">${escapeHtml(highlight.annotationLabels.join("/"))}</sup>`
      : "";
    const overlayTarget = annotationClickTarget === "annotation" ? "scrollToAnnotation" : "scrollToComment";
    const overlayIds = includeClickHandlers && highlight.annotationIds?.length
      ? ` onclick="${overlayTarget}('${escapeAttribute(highlight.annotationIds[0])}')"`
      : "";
    const overlayStyle = highlight.annotationCodes?.length ? "border:2px solid #5b2a86;" : "";
    const pasteAnchors = safeArray(highlight.annotationIds)
      .map((id) => {
        const annotationAnchorId = `${idPrefix}annotation-${id}`;
        return `<span id="${escapeAttribute(annotationAnchorId)}"></span>`;
      })
      .join("");
    const pasteHighlightId = `${idPrefix}paste-highlight-${highlight.id}`;
    return `<mark id="${escapeAttribute(pasteHighlightId)}" class="paste-highlight"${overlayIds} style="${overlayStyle}" title="${escapeAttribute(pasteTitle)}">${pasteAnchors}${segment}<sup style="font-size:0.7em;color:#9b4dca;font-weight:700;">PASTE</sup>${overlayCodes}</mark>`;
  }

  function renderAnnotationHighlight(highlight, segment, options) {
    const { annotationClickTarget, includeClickHandlers, idPrefix } = options;
    const markId = `${idPrefix}annotation-${highlight.id}`;
    const clickTarget = annotationClickTarget === "annotation" ? "scrollToAnnotation" : "scrollToComment";
    const clickHandler = includeClickHandlers
      ? ` onclick="${clickTarget}('${escapeAttribute(highlight.id)}')"`
      : "";
    const styles = highlight.overlapsPaste
      ? "background:rgba(91,42,134,0.10);border:2px solid #5b2a86;color:inherit;border-radius:4px;padding:2px 4px;scroll-margin-top:120px;cursor:pointer;"
      : "background:#fff176;color:#2f2416;border-radius:4px;padding:2px 4px;scroll-margin-top:120px;cursor:pointer;";
    const labelColor = highlight.overlapsPaste ? "#5b2a86" : "var(--accent-deep)";
    return `<mark id="${escapeAttribute(markId)}"${clickHandler} style="${styles}" title="Click to jump to comment">${segment}<sup style="font-size:0.7em;color:${labelColor};font-weight:700;margin-left:3px;">${escapeHtml(highlight.label || highlight.code)}</sup></mark>`;
  }

  function createPasteHighlights(pasteEvidenceItems) {
    return pasteEvidenceItems.map((paste) => ({
      id: paste.id,
      start: paste.highlightStart,
      end: paste.highlightEnd,
      type: "paste",
      annotationIds: [],
      annotationCodes: [],
      annotationLabels: [],
    }));
  }

  function createAnnotationHighlights(text, annotations, pasteHighlights) {
    const searchStarts = new Map();
    return safeArray(annotations)
      .map((annotation, index) => createAnnotationHighlight(text, annotation, index, pasteHighlights, searchStarts))
      .filter(Boolean);
  }

  function createAnnotationHighlight(text, annotation, index, pasteHighlights, searchStarts) {
    const start = findNextSequentialIndex(text, annotation.selectedText, searchStarts);
    if (start === -1) {
      return null;
    }

    const end = start + annotation.selectedText.length;
    const overlappingPastes = pasteHighlights.filter((range) => start < range.end && end > range.start);
    const annotationLabel = getAnnotationDisplayLabel(annotation, index);
    const annotationId = annotation.id || uid("ann");
    for (const paste of overlappingPastes) {
      paste.annotationIds.push(annotationId);
      paste.annotationCodes.push(annotation.code);
      paste.annotationLabels.push(annotationLabel);
    }

    return {
      start,
      end,
      code: annotation.code,
      label: annotationLabel,
      type: "annotation",
      id: annotationId,
      overlapsPaste: overlappingPastes.length > 0,
    };
  }

  function findNextSequentialIndex(text, needle, searchStarts) {
    if (!needle) {
      return -1;
    }
    const start = Number(searchStarts.get(needle) || 0);
    let index = text.indexOf(needle, start);
    if (index === -1 && start > 0) {
      index = text.indexOf(needle);
    }
    if (index !== -1) {
      searchStarts.set(needle, index + Math.max(needle.length, 1));
    }
    return index;
  }

  function compareHighlights(left, right) {
    if (left.start !== right.start) return left.start - right.start;
    if (left.end !== right.end) return right.end - left.end;
    if (left.type === right.type) return 0;
    return left.type === "paste" ? -1 : 1;
  }

  function renderTextWithPasteHighlights(text, writingEvents) {
    if (!text) return "";
    const flaggedPastes = (writingEvents || []).filter((entry) => isPasteLikeWritingEvent(entry) && entry.insertedText);
    if (!flaggedPastes.length) return `<pre class="context-expanded-text">${escapeHtml(text)}</pre>`;

    let remaining = text;
    let html = "";
    for (const event of flaggedPastes) {
      const idx = remaining.indexOf(event.insertedText);
      if (idx === -1) continue;
      html += escapeHtml(remaining.slice(0, idx));
      html += `<mark class="paste-highlight" title="Pasted content">${escapeHtml(event.insertedText)}</mark>`;
      remaining = remaining.slice(idx + event.insertedText.length);
    }
    html += escapeHtml(remaining);
    return `<pre class="context-expanded-text">${html}</pre>`;
  }

  function renderOutlineSummary(assignment, submission) {
    const outline = getOutlineFields(assignment, submission);
    const parts = outline.fields
      .map((field) => String(submission.outline?.[field.key] || "").trim())
      .filter(Boolean);

    return parts.length ? parts.join(" | ") : "No outline completed";
  }

  const AnnotationRender = {
    renderPasteEvidencePanel,
    renderWritingTimeNote,
    renderSuggestedGradePanel,
    renderStudentAiFeedbackEvidence,
    renderSuggestedGradeProcessNote,
    renderAnnotatedText,
    renderTextWithPasteHighlights,
    renderOutlineSummary,
  };

  if (typeof window !== "undefined") {
    window.AnnotationRender = AnnotationRender;
    Object.assign(window, AnnotationRender);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = AnnotationRender;
  }
})();
