// writing-behaviour-render.js
// Writing-behaviour fluency rendering extracted from app.js (Phase 3 refactor).
// Exposes window.WritingBehaviourRender plus legacy globals
// (renderWritingBehaviour, renderFluencyCard, fluencyBadgeStyle,
// requestProcessAnalysisSnapshot) for backward compatibility with app.js
// call sites.
//
// Cross-module helpers (escapeHtml, wordCount) are read lazily from
// window at call time so this module can load before app.js wires them up.

(function () {
  function _escapeHtml(value) {
    if (typeof window !== "undefined" && typeof window.escapeHtml === "function") {
      return window.escapeHtml(value);
    }
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function _wordCount(text) {
    if (typeof window !== "undefined" && typeof window.wordCount === "function") {
      return window.wordCount(text);
    }
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  const processAnalysisSnapshotRequests = new Set();

  function fluencyBadgeStyle(value, low, high) {
    if (value === null || value === undefined) return "background:#f0f0f0;color:#888;";
    if (value >= low && value <= high) return "background:#eef9f1;color:#1f5c38;border:1px solid #cdece2;";
    if (value >= low * 0.6 && value <= high * 1.4) return "background:#fff8e8;color:#9a6512;border:1px solid #f0d080;";
    return "background:#fff1f1;color:#962f2f;border:1px solid #f4c7c7;";
  }

  function requestProcessAnalysisSnapshot(submission) {
    if (!submission?.id || String(submission.id).startsWith("submission-") || String(submission.id).startsWith("pending-review-")) {
      return;
    }
    if (processAnalysisSnapshotRequests.has(submission.id)) {
      return;
    }
    processAnalysisSnapshotRequests.add(submission.id);
    const auth = (typeof window !== "undefined" && window.Auth) || null;
    if (!auth || typeof auth.apiFetch !== "function") return;
    auth.apiFetch(`/api/submissions/${submission.id}/process-analysis`)
      .catch((error) => {
        console.warn("Could not persist writing process analysis snapshot:", error?.message || error);
      });
  }

  function renderWritingBehaviour(submission, assignment) {
    const escapeHtml = _escapeHtml;
    const wordCount = _wordCount;
    if (typeof window !== "undefined" && window.PraxisWritingProcess?.renderTeacherPanel) {
      requestProcessAnalysisSnapshot(submission);
      const excludedSources = [];
      if (submission?.teacherReview?.writingBehaviourExcluded) excludedSources.push("submission_flag");
      return window.PraxisWritingProcess.renderTeacherPanel(submission, assignment, {
        excludedFromAnalytics: Boolean(submission?.teacherReview?.writingBehaviourExcluded),
        exclusionSources: excludedSources,
      });
    }

    const f = submission?.fluencySummary || submission?.fluency_summary || {};
    if (!Object.keys(f).length) return "";

    const burst = f.meanBurstLength;
    const pauses = f.pauseFrequency;
    const micro = f.microCorrections;
    const local = f.localRevisions;
    const substantive = f.substantiveRevisions;

    const level = (assignment?.languageLevel || "B1").toUpperCase();

    const ranges = {
      "A0": { burst: [2,  8],  pauses: [15, 50], local: [3,  20] },
      "A1": { burst: [2,  8],  pauses: [15, 50], local: [3,  20] },
      "A2": { burst: [3,  15], pauses: [8,  35], local: [4,  25] },
      "B1": { burst: [5,  22], pauses: [6,  28], local: [6,  30] },
      "B2": { burst: [8,  30], pauses: [4,  22], local: [8,  35] },
      "C1": { burst: [10, 40], pauses: [3,  18], local: [10, 40] },
      "C2": { burst: [12, 50], pauses: [2,  15], local: [12, 45] },
    };
    const r = ranges[level] || ranges["B1"];

    function scoreInRange(value, low, high) {
      if (value === null || value === undefined) return null;
      if (value >= low && value <= high) return 2;
      if (value >= low * 0.6 && value <= high * 1.4) return 1;
      return 0;
    }

    const scoreBurst  = scoreInRange(burst,  r.burst[0],  r.burst[1]);
    const scorePauses = scoreInRange(pauses, r.pauses[0], r.pauses[1]);

    let scoreMicro = null;
    if (micro !== null && micro !== undefined) {
      scoreMicro = micro < 1 ? 0 : 1;
    }

    const scoreLocal = scoreInRange(local, r.local[0], r.local[1]);

    let scoreSubstantive = null;
    if (substantive !== null && substantive !== undefined) {
      const words = wordCount(submission?.finalText || submission?.draftText || "");
      scoreSubstantive = substantive >= 1 ? 1 : (words < 150 ? 1 : 0);
    }

    const weightedScores = [
      scoreBurst     !== null ? { score: scoreBurst,      weight: 2 } : null,
      scorePauses    !== null ? { score: scorePauses,     weight: 2 } : null,
      scoreMicro     !== null ? { score: scoreMicro,      weight: 1 } : null,
      scoreLocal     !== null ? { score: scoreLocal,      weight: 2 } : null,
      scoreSubstantive !== null ? { score: scoreSubstantive, weight: 1 } : null,
    ].filter(Boolean);

    if (!weightedScores.length) return "";

    const totalPoints   = weightedScores.reduce((s, x) => s + x.score * x.weight, 0);
    const maxPoints     = weightedScores.reduce((s, x) => s + 2 * x.weight, 0);
    const avg           = totalPoints / maxPoints * 2;

    const band = avg >= 1.2 ? "Typical process"
      : avg >= 0.6 ? "Review suggested"
      : "Close review needed";

    const bandColour = avg >= 1.7 ? "#1f5c38" : avg >= 1.2 ? "#5a7a2e" : avg >= 0.6 ? "#9a6512" : "#962f2f";
    const bandBg     = avg >= 1.7 ? "#eef9f1" : avg >= 1.2 ? "#f4f9e8" : avg >= 0.6 ? "#fff8e8" : "#fff1f1";
    const bandBorder = avg >= 1.7 ? "#cdece2" : avg >= 1.2 ? "#cde0a0" : avg >= 0.6 ? "#f0d080" : "#f4c7c7";

    const bandScale = ["Typical process", "Review suggested", "Close review needed"].map(label => {
      const active = label === band;
      return `<span style="
        font-size:0.70rem;
        padding:2px 8px;
        border-radius:999px;
        border:1px solid ${active ? bandBorder : "var(--line)"};
        background:${active ? "#fff" : "rgba(255,255,255,0.55)"};
        color:${active ? bandColour : "var(--muted)"};
        font-weight:${active ? "700" : "500"};
        white-space:nowrap;
      ">${escapeHtml(label)}</span>`;
    }).join(`<span style="color:var(--muted);font-size:0.70rem;">→</span>`);

    const explanation = avg >= 1.7
      ? `Typing rhythm, pause patterns, and revision behaviour are consistent with normal drafting and revision at ${level}.`
      : avg >= 1.2
      ? `The writing process is broadly consistent with normal drafting and revision for ${level}.`
      : avg >= 0.6
      ? `Some indicators fall outside the expected range for ${level} — worth reviewing alongside the playback.`
      : `Several indicators are outside the expected range for ${level}. Playback recommended.`;

    function metricHelp(text) {
      return `
        <span onclick="var t=this.nextElementSibling;var wasHidden=t.style.display==='none';t.style.display=wasHidden?'block':'none';if(wasHidden){setTimeout(function(){document.addEventListener('click',function h(){t.style.display='none';document.removeEventListener('click',h);},{once:true});},0);}" style="cursor:pointer;font-size:0.68rem;color:var(--muted);border:1px solid var(--line);border-radius:50%;width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">?</span>
        <span class="fluency-tooltip" style="display:none;position:absolute;z-index:120;max-width:300px;margin-top:20px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.10);font-size:0.78rem;line-height:1.5;color:var(--ink);">
          ${escapeHtml(text)}
        </span>
      `;
    }

    function indicator(label, value, low, high, leftLabel, rightLabel, helpText) {
      const score = scoreInRange(value, low, high);
      const pct = value === null || value === undefined ? 50
        : Math.min(100, Math.max(0, ((value - low * 0.4) / (high * 1.6 - low * 0.4)) * 100));
      const dotColour = score === 2 ? "#2a7a4f" : score === 1 ? "#c8860a" : "#c24d4d";
      return `
        <div style="margin-bottom:10px;position:relative;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;gap:8px;">
            <span style="font-size:0.78rem;color:var(--ink);display:inline-flex;align-items:center;gap:5px;">
              ${escapeHtml(label)}
              ${metricHelp(helpText)}
            </span>
            <span style="font-size:0.74rem;color:var(--muted);">${value !== null && value !== undefined ? value : "—"}</span>
          </div>
          <div style="position:relative;height:6px;border-radius:3px;background:#e8e8e4;">
            <div style="position:absolute;left:${(low * 0.4 / (high * 1.6)) * 100}%;width:${((high - low) / (high * 1.6)) * 100}%;height:100%;background:#d4edda;border-radius:3px;opacity:0.7;"></div>
            <div style="position:absolute;left:calc(${pct}% - 5px);top:-3px;width:12px;height:12px;border-radius:50%;background:${dotColour};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:2px;">
            <span style="font-size:0.68rem;color:var(--muted);">${escapeHtml(leftLabel)}</span>
            <span style="font-size:0.68rem;color:var(--muted);">${escapeHtml(rightLabel)}</span>
          </div>
        </div>
      `;
    }

    function badge(label, value, score, note, helpText) {
      const dotColour = score === 1 ? "#2a7a4f" : "#c24d4d";
      const bgColour  = score === 1 ? "#eef9f1" : "#fff1f1";
      const display   = value !== null && value !== undefined ? value : "—";
      return `
        <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;position:relative;">
          <div style="width:12px;height:12px;border-radius:50%;background:${dotColour};flex-shrink:0;"></div>
          <span style="font-size:0.78rem;color:var(--ink);display:inline-flex;align-items:center;gap:5px;">
            ${escapeHtml(label)}
            ${metricHelp(helpText)}
          </span>
          <span style="font-size:0.74rem;color:var(--muted);margin-left:auto;">${display}</span>
          <span style="font-size:0.70rem;padding:1px 7px;border-radius:10px;background:${bgColour};color:${dotColour};">${escapeHtml(note)}</span>
        </div>
      `;
    }

    const microNote = micro < 1 ? "None recorded — review" : "Present — normal";
    const substantiveNote = substantive >= 1 ? `${substantive} found — positive` : "None — neutral";

    return `
      <div style="margin-bottom:16px;padding:14px;border:1px solid ${bandBorder};border-radius:12px;background:${bandBg};position:relative;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <p class="mini-label" style="margin:0;">Writing behaviour</p>
          <span style="font-size:0.82rem;font-weight:700;color:${bandColour};padding:2px 10px;border-radius:20px;border:1px solid ${bandBorder};background:#fff;">${escapeHtml(band)}</span>
          <span onclick="var t=this.nextElementSibling;var wasHidden=t.style.display==='none';t.style.display=wasHidden?'block':'none';if(wasHidden){setTimeout(function(){document.addEventListener('click',function h(){t.style.display='none';document.removeEventListener('click',h);},{once:true});},0);}" style="cursor:pointer;font-size:0.75rem;color:var(--muted);border:1px solid var(--line);border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">?</span>
          <div class="fluency-tooltip" style="display:none;position:absolute;z-index:100;max-width:340px;margin-top:4px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.10);font-size:0.80rem;line-height:1.6;color:var(--ink);">
            <p style="margin:0 0 8px;">Scores are based on keystroke-interval analysis grounded in L2 writing research. Ranges are provisional estimates calibrated to ${level} — they will be refined as real submission data accumulates from this platform.</p>
            <p style="margin:0 0 6px;font-weight:600;">Key references:</p>
            <p style="margin:0 0 4px;">Révész, A., Michel, M., Lu, X., et al. (2022). Proficiency, speed fluency, pausing and eye-gaze in L2 writing. <em>Journal of Second Language Writing, 58.</em> — Proficiency strongest predictor of burst length (p&lt;0.01, 13% variance).</p>
            <p style="margin:0 0 4px;">Crossley, S., Tian, Y., Choi, J.S., Holmes, L., &amp; Morris, W. (2024). Keystroke process evidence in copied and composed writing. <em>EDM 2024, 476–483.</em> — Authentic writers delete more, revise more, and show more varied production patterns than transcribers.</p>
            <p style="margin:0 0 4px;">Barkaoui, K. (2019). L2 writers' pausing behaviour. <em>Studies in Second Language Acquisition, 41(3).</em> — 2-second threshold; pause location matters because within-word, between-word, and sentence-boundary pauses reflect different writing processes.</p>
            <p style="margin:0;color:var(--muted);font-style:italic;">This panel is one signal — always interpret alongside the letter-by-letter playback. No single indicator is conclusive.</p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 12px;">
          ${bandScale}
        </div>
        ${indicator("Typing rhythm", burst, r.burst[0], r.burst[1], "Hesitant", "Unusually fast", "How much the student tends to write before stopping to think. Very short bursts can mean hesitation. Very long bursts can sometimes mean text was inserted too smoothly, so it is worth checking the playback.")}
        ${indicator("Thinking pauses", pauses, r.pauses[0], r.pauses[1], "Very few", "Frequent", "How often the student pauses for more than 2 seconds while writing. Some pauses are normal because real writers stop to think, plan, and reread. Very few pauses or constant pauses can both be worth checking.")}
        ${indicator("Local revisions / 100w", local, r.local[0], r.local[1], "Minimal", "Extensive", "Medium-sized edits per 100 words, such as changing a phrase, correcting grammar, or reworking part of a sentence. Real writing usually includes some local revision.")}
        ${badge("Micro-corrections / 100w", micro, scoreMicro, microNote, "Tiny corrections per 100 words, such as fixing a letter, typo, or small spelling mistake. If there are almost none, it can be unusual because most people make small corrections while typing.")}
        ${badge("Substantive revisions", substantive, scoreSubstantive, substantiveNote, "Bigger changes, such as deleting or rewriting a larger section. This is usually a positive sign of process writing, but having none is not automatically bad, especially for short texts.")}
        <p style="margin:10px 0 0;font-size:0.80rem;color:${bandColour};line-height:1.5;">${escapeHtml(explanation)}</p>
      </div>
    `;
  }

  function renderFluencyCard(submission, assignmentTitle = "") {
    const escapeHtml = _escapeHtml;
    const f = submission?.fluency_summary || submission?.fluencySummary || {};
    if (!Object.keys(f).length) return `<p class="subtle" style="font-size:0.82rem;">No fluency data yet.</p>`;

    const metrics = [
      {
        label: "Mean burst length",
        value: f.meanBurstLength,
        unit: "chars",
        low: 3, high: 15,
        note: "Characters typed between 2s pauses. Low = hesitant, very high = possible paste"
      },
      {
        label: "Pause frequency",
        value: f.pauseFrequency,
        unit: "per 100w",
        low: 8, high: 35,
        note: "Pauses over 2s per 100 words. Very low or very high values are review cues."
      },
      {
        label: "Deletion ratio",
        value: f.deletionRatio,
        unit: "",
        low: 0.05, high: 0.20,
        note: "Deletions vs insertions. Near zero = possible copy-paste, over 0.3 = lots of revision"
      },
      {
        label: "Sessions",
        value: f.sessionCount,
        unit: "",
        low: 1, high: 4,
        note: "Distinct writing sessions (30min gap = new session)"
      },
    ];

    return `
      <div style="margin-top:10px;">
        ${assignmentTitle ? `<p style="font-size:0.78rem;color:var(--muted);margin:0 0 8px;">${escapeHtml(assignmentTitle)}</p>` : ""}
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
          ${metrics.map(m => `
            <div style="padding:8px 10px;border-radius:10px;${fluencyBadgeStyle(m.value, m.low, m.high)}" title="${escapeHtml(m.note)}">
              <div style="font-size:0.72rem;margin-bottom:2px;">${escapeHtml(m.label)}</div>
              <strong style="font-size:1rem;">${m.value !== null && m.value !== undefined ? m.value : "—"}${m.unit ? ` <span style="font-size:0.72rem;font-weight:400;">${m.unit}</span>` : ""}</strong>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  const WritingBehaviourRender = {
    fluencyBadgeStyle,
    renderWritingBehaviour,
    renderFluencyCard,
    requestProcessAnalysisSnapshot,
  };

  if (typeof window !== "undefined") {
    window.WritingBehaviourRender = WritingBehaviourRender;
    Object.entries(WritingBehaviourRender).forEach(([name, fn]) => {
      if (typeof window[name] !== "function") {
        window[name] = fn;
      }
    });
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = WritingBehaviourRender;
  }
})();