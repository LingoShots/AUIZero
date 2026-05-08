(() => {
  const root = typeof window !== "undefined" ? window.PraxisWritingProcess || {} : {};

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function statusStyle(status) {
    if (status === root.STATUS?.CLOSE) return { bg: "#fff1f4", border: "#e07a93", color: "#9b3651" };
    if (status === root.STATUS?.REVIEW) return { bg: "#fff8e8", border: "#f0c870", color: "#8a5a00" };
    if (status === root.STATUS?.INSUFFICIENT) return { bg: "#f5f6f8", border: "#d8dee8", color: "#647084" };
    return { bg: "#eef9f1", border: "#bfe2ca", color: "#1f6b42" };
  }

  function formatMetricValue(key, value) {
    if (value === null || value === undefined) return "—";
    if (key === "productProcessRatio" || key === "pasteShare") return `${Math.round(Number(value) * 100)}%`;
    if (key === "typingRate") return `${value} chars/min`;
    if (key === "longPauses") return `${value}/100w`;
    if (key === "localRevisions") return `${value}/100w`;
    return String(value);
  }

  function renderMetricCard({ key, label, value, coachValue, range, position, help }) {
    const [low, high] = Array.isArray(range) ? range : [0, 1];
    const numeric = Number(value || 0);
    const pct = high > low ? Math.max(0, Math.min(100, ((numeric - low) / (high - low)) * 100)) : 50;
    const tag = position === "within" ? "within preliminary range" : position === "below" ? "below preliminary range" : position === "above" ? "above preliminary range" : "no range yet";
    return `
      <div class="process-metric-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <div class="mini-label">${escapeHtml(label)}</div>
            <div class="process-metric-value">${escapeHtml(formatMetricValue(key, value))}</div>
          </div>
          <span class="process-metric-tag">${escapeHtml(tag)}</span>
        </div>
        <p class="subtle" style="margin:6px 0 8px;font-size:0.78rem;">${escapeHtml(help || "")}</p>
        <div class="process-range">
          <div class="process-range-band"></div>
          <div class="process-range-dot" style="left:calc(${pct}% - 5px);"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.72rem;color:var(--muted);">
          <span>${escapeHtml(formatMetricValue(key, low))}</span>
          <span>${escapeHtml(formatMetricValue(key, high))}</span>
        </div>
        <p style="margin:8px 0 0;font-size:0.74rem;color:var(--muted);">Coach/outline baseline: ${coachValue === null || coachValue === undefined ? "not enough data yet" : escapeHtml(formatMetricValue(key, coachValue))}</p>
      </div>
    `;
  }

  function renderTimeline(timeline = []) {
    if (!timeline.length) return "";
    return `
      <div class="process-timeline" aria-label="Writing process timeline">
        ${timeline.map((bucket) => {
          const height = Math.max(8, Math.round(58 * Number(bucket.intensity || 0)));
          const paste = Number(bucket.pasteChars || 0) > 0;
          return `
            <div class="process-timeline-bucket" title="${escapeHtml(bucket.label)} · ${bucket.typedChars} typed chars${paste ? ` · ${bucket.pasteChars} paste chars` : ""}">
              ${paste ? `<span class="process-paste-pin"></span>` : ""}
              <span class="process-timeline-bar" style="height:${height}px;"></span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderTeacherPanel(submission = {}, assignment = {}, options = {}) {
    if (!root.analyzeSubmission) return "";
    const analysis = root.analyzeSubmission(submission, assignment, options);
    const style = statusStyle(analysis.status);
    const defs = root.METRIC_DEFINITIONS || {};
    const ranges = analysis.cohortComparison?.ranges || {};
    const positions = analysis.cohortComparison?.positions || {};
    const metrics = analysis.metrics || {};
    const coach = analysis.coachBaseline || {};
    const metricCards = [
      { key: "typingRate", label: defs.typingRate?.label || "Typing rate", value: metrics.typingRate, coachValue: coach.typingRate, range: ranges.typingRate, position: positions.typingRate, help: defs.typingRate?.help },
      { key: "longPauses", label: defs.longPauses?.label || "Long thinking pauses", value: metrics.longPausesPer100w, coachValue: null, range: ranges.longPauses, position: positions.longPauses, help: defs.longPauses?.help },
      { key: "localRevisions", label: defs.localRevisions?.label || "Local revisions", value: metrics.localRevisionsPer100w, coachValue: coach.localRevisionsPer100w, range: ranges.localRevisions, position: positions.localRevisions, help: defs.localRevisions?.help },
      { key: "productProcessRatio", label: defs.productProcessRatio?.label || "Text survival", value: metrics.productProcessRatio, coachValue: null, range: ranges.productProcessRatio, position: positions.productProcessRatio, help: defs.productProcessRatio?.help },
    ];

    return `
      <section class="process-panel" style="border-color:${style.border};background:${style.bg};">
        <div class="process-panel-header">
          <div>
            <p class="mini-label" style="margin:0 0 4px;">Writing process evidence</p>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span class="process-status-pill" style="color:${style.color};border-color:${style.border};background:#fff;">${escapeHtml(analysis.statusLabel)}</span>
              ${analysis.excludedFromAnalytics ? `<span class="process-excluded-pill">Excluded from analytics pool</span>` : ""}
            </div>
          </div>
          <div class="process-summary-stats">
            <span>${escapeHtml(String(metrics.finalWords || 0))} words</span>
            <span>${escapeHtml(String(metrics.pasteEventCount || 0))} paste-like events</span>
            <span>${escapeHtml(String(metrics.localRevisions || 0))} local revisions</span>
          </div>
        </div>
        <p class="process-reason" style="color:${style.color};">${escapeHtml(analysis.reason)}</p>
        ${analysis.evidence.length ? `
          <div class="process-chip-row">
            ${analysis.evidence.map((item) => `<span class="process-chip" title="${escapeHtml(item.detail)}">${escapeHtml(item.label)}</span>`).join("")}
          </div>
        ` : `<p class="subtle" style="margin:0 0 12px;">No specific process evidence needs highlighting.</p>`}
        ${renderTimeline(analysis.timeline)}
        <div class="process-metric-grid">
          ${metricCards.map(renderMetricCard).join("")}
        </div>
        <p class="subtle" style="font-size:0.76rem;margin:12px 0 0;">
          Reference ranges are preliminary L2 writing-process ranges for ${escapeHtml(analysis.cohortComparison?.level || "B1")} (n=${escapeHtml(String(analysis.cohortComparison?.n || 0))}) and should be interpreted with playback and teacher judgment.
        </p>
      </section>
    `;
  }

  const api = { renderTeacherPanel };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.PraxisWritingProcess = {
      ...(window.PraxisWritingProcess || {}),
      ...api,
    };
  }
})();
