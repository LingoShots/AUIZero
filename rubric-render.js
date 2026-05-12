// rubric-render.js
// Pure rubric conversion and prompt-serialization helpers extracted from app.js
// (Phase 2 refactor). Complements rubric-utils.js (which handles low-level
// schema normalization). Exposes window.RubricRender plus legacy globals
// (matrixRubricToSchema, simpleRubricRowsToSchema, getMatrixRubricData,
// getRubricSchema, serializeRubricSchemaForPrompt, serializeRubricDataForPrompt)
// for backward compatibility with existing app.js call sites.

(function () {
  function cleanLevelLabel(label = "") {
    const raw = String(label || "").trim();
    const separators = [" - ", " – "];
    for (const separator of separators) {
      const index = raw.lastIndexOf(separator);
      if (index < 0) continue;
      const suffix = raw.slice(index + separator.length).trim();
      if (suffix && Number.isFinite(Number(suffix))) return raw.slice(0, index).trim();
    }
    return raw;
  }

  function getRubricUtils() {
    return (typeof window !== "undefined" && window.RubricUtils) || {};
  }

  function matrixRubricToSchema(source, fallbackName = "Uploaded rubric") {
    const { normalizeRubricSchema } = getRubricUtils();
    const matrix = source?.headers && safeArray(source?.rows).length
      ? {
          kind: "matrix",
          name: source?.name || "",
          notes: safeArray(source?.notes),
          headers: safeArray(source?.headers),
          rows: safeArray(source?.rows),
        }
      : null;

    if (!matrix) return null;

    return normalizeRubricSchema({
      title: matrix.name || fallbackName,
      subtitle: "",
      totalPoints: matrix.rows.reduce((sum, row) => sum + Number(row?.points || 0), 0),
      notes: safeArray(matrix.notes),
      criteria: matrix.rows.map((row, rowIndex) => ({
        id: row?.id || `rubric-row-${rowIndex + 1}`,
        name: row?.name || row?.subcriterion || `Criterion ${rowIndex + 1}`,
        minScore: Math.min(...safeArray(row?.levels).map((level) => Number(level?.points ?? 0)), Number(row?.points || 0)),
        maxScore: Number(row?.points || 0),
        levels: safeArray(row?.levels).map((level, levelIndex) => ({
          id: level?.id || `${row?.id || `criterion-${rowIndex + 1}`}-level-${levelIndex + 1}`,
          label: cleanLevelLabel(level?.label) || `Level ${levelIndex + 1}`,
          score: Number(level?.points ?? 0),
          description: String(level?.description || "").trim(),
        })),
      })),
    }, fallbackName);
  }

  function simpleRubricRowsToSchema(source, fallbackName = "Rubric") {
    const { slugifyRubricId, normalizeRubricSchema } = getRubricUtils();
    const rows = safeArray(source)
      .filter((row) => row && typeof row === "object")
      .map((row, rowIndex) => {
        const rowPoints = Math.max(0, Number(row?.points || 0));
        const rawLevels = safeArray(row?.bands).length
          ? safeArray(row.bands)
          : (safeArray(row?.levels).length ? safeArray(row.levels) : []);
        const levels = rawLevels
          .map((level, levelIndex) => ({
            id: level?.id || `${slugifyRubricId(row?.id || row?.name || `criterion-${rowIndex + 1}`, `criterion-${rowIndex + 1}`)}-level-${levelIndex + 1}`,
            label: String(level?.label || `Level ${levelIndex + 1}`).trim(),
            score: Number(level?.score ?? level?.points ?? 0),
            description: String(level?.description || "").trim(),
          }))
          .filter((level) => level.label || level.description || Number.isFinite(level.score));

        if (!String(row?.name || "").trim() || !levels.length) return null;

        return {
          id: String(row?.id || slugifyRubricId(row.name, `criterion-${rowIndex + 1}`)).trim(),
          name: String(row.name).trim(),
          minScore: Math.min(...levels.map((level) => Number(level.score || 0)), rowPoints || 0),
          maxScore: rowPoints || Math.max(...levels.map((level) => Number(level.score || 0)), 0),
          levels: levels.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
        };
      })
      .filter(Boolean);

    if (!rows.length) return null;

    return normalizeRubricSchema({
      title: fallbackName,
      totalPoints: rows.reduce((sum, row) => sum + Number(row.maxScore || 0), 0),
      preserveCriteria: true,
      criteria: rows,
    }, fallbackName);
  }

  function getMatrixRubricData(source) {
    const { rubricSchemaToMatrixData } = getRubricUtils();
    if (source?.headers && safeArray(source?.rows).length) {
      return {
        kind: "matrix",
        name: source?.name || "",
        notes: safeArray(source?.notes),
        headers: safeArray(source?.headers),
        rows: safeArray(source?.rows),
      };
    }

    if (safeArray(source?.criteria).length) {
      return rubricSchemaToMatrixData(source, source?.title || "Uploaded rubric");
    }

    const rows = safeArray(source)
      .filter((row) => safeArray(row?.levels).length)
      .map((row) => ({
        id: row.id,
        section: row.section || "",
        subcriterion: row.subcriterion || row.name || "",
        name: row.name || row.subcriterion || "Criterion",
        description: row.description || "",
        points: Number(row.points || 0),
        pointsLabel: row.pointsLabel || "",
        levels: safeArray(row.levels),
      }));

    if (!rows.length) return null;

    return {
      kind: "matrix",
      headers: safeArray(rows[0].levels).map((level) => level.label),
      rows,
      notes: [],
      name: "",
    };
  }

  function getRubricSchema(source, fallbackName = "Uploaded rubric") {
    const { normalizeRubricSchema } = getRubricUtils();
    if (!source) return null;
    if (source?.schema) return getRubricSchema(source.schema, fallbackName);
    if (source?._normalized) return source;
    if (safeArray(source?.criteria).length) return normalizeRubricSchema(source, fallbackName);

    const matrix = getMatrixRubricData(source);
    if (matrix) return matrixRubricToSchema(matrix, fallbackName);

    const simpleSchema = simpleRubricRowsToSchema(source, fallbackName);
    if (simpleSchema) return simpleSchema;

    return null;
  }

  function serializeRubricSchemaForPrompt(schema, fallbackName = "Uploaded rubric") {
    const normalized = getRubricSchema(schema, fallbackName);
    if (!normalized) return "";

    const lines = [
      normalized.title,
      normalized.subtitle,
      ...safeArray(normalized.notes),
      ...normalized.criteria.map((criterion) => {
        const levels = safeArray(criterion.levels)
          .map((level) => `${level.label} (${level.score}): ${level.description}`)
          .join(" | ");
        return `${criterion.name}: ${levels}`;
      }),
      normalized.attribution,
    ].filter(Boolean);

    return lines.join("\n");
  }

  function serializeRubricDataForPrompt(rubricData) {
    const schemaText = serializeRubricSchemaForPrompt(rubricData);
    if (schemaText) return schemaText;

    const matrix = getMatrixRubricData(rubricData);
    if (!matrix) return "";
    const lines = [
      ...safeArray(matrix.notes),
      matrix.headers.length ? `Columns: ${matrix.headers.join(" | ")}` : "",
      ...matrix.rows.map((row) => {
        const header = row.section && row.section !== row.name
          ? `${row.section} — ${row.name}`
          : row.name;
        const levelText = safeArray(row.levels)
          .map((level) => `${level.label}: ${level.description}`)
          .join(" | ");
        return `${header}: ${levelText}`;
      }),
    ].filter(Boolean);
    return lines.join("\n");
  }

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

  function _escapeAttribute(value) {
    if (typeof window !== "undefined" && typeof window.escapeAttribute === "function") {
      return window.escapeAttribute(value);
    }
    return _escapeHtml(value).replace(/`/g, "&#96;");
  }

  function _renderRichTextHtml(text) {
    if (typeof window !== "undefined" && typeof window.renderRichTextHtml === "function") {
      return window.renderRichTextHtml(text);
    }
    return _escapeHtml(text).replace(/\n+/g, "<br>");
  }

  function levelTheme(label = "") {
    const lower = String(label || "").toLowerCase();
    if (lower.includes("excel")) return { ring: "#23824c", bg: "#eef9f1", text: "#1c663d", badge: "#cdeed7" };
    if (lower.includes("good")) return { ring: "#2f67d8", bg: "#edf3ff", text: "#1f4fb6", badge: "#d7e4ff" };
    if (lower.includes("satisf")) return { ring: "#cf8b1f", bg: "#fff8e8", text: "#9a6512", badge: "#f6df9a" };
    if (lower.includes("needs")) return { ring: "#c46a2b", bg: "#fff3ea", text: "#a4531d", badge: "#f6d0b4" };
    if (lower.includes("unsatisf") || lower.includes("weak")) return { ring: "#c24d4d", bg: "#fff1f1", text: "#962f2f", badge: "#f4c7c7" };
    return { ring: "#768078", bg: "#f6f6f4", text: "#4f574f", badge: "#e7e7e2" };
  }

  function renderRubricMatrixTable(matrixData, options = {}) {
    const escapeHtml = _escapeHtml;
    const escapeAttribute = _escapeAttribute;
    const matrix = getMatrixRubricData(matrixData);
    if (!matrix) return "";

    const clickable = Boolean(options.clickable);
    const compact = Boolean(options.compact);
    const rowScoreMap = options.rowScoreMap || new Map();
    const suggestedRowScoreMap = options.suggestedRowScoreMap || new Map();
    const criterionMinWidth = compact ? 150 : 180;
    const levelMinWidth = compact ? 128 : 160;
    const cellPadding = compact ? 8 : 10;
    const headerPadding = compact ? 8 : 10;
    const minHeight = compact ? 84 : 110;
    const fontSize = compact ? "0.76rem" : "0.82rem";

    return `
      <div style="overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff;">
        <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:${fontSize};min-width:${compact ? 760 : 840}px;">
          <thead>
            <tr>
              <th style="position:sticky;top:0;background:#eef4ff;padding:${headerPadding}px;border-bottom:1px solid var(--line);text-align:left;min-width:${criterionMinWidth}px;">Criterion</th>
              ${safeArray(matrix.headers).map((header) => `<th style="position:sticky;top:0;background:#eef4ff;padding:${headerPadding}px;border-bottom:1px solid var(--line);text-align:left;min-width:${levelMinWidth}px;">${escapeHtml(header)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${matrix.rows.map((row) => {
              const selected = rowScoreMap.get(row.id);
              const suggested = suggestedRowScoreMap.get(row.id);
              return `
                <tr>
                  <td style="padding:${cellPadding}px;vertical-align:top;border-bottom:1px solid var(--line);background:#f7faff;">
                    ${row.section && row.section !== row.name ? `<div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${escapeHtml(row.section)}</div>` : ""}
                    <div style="font-weight:700;">${escapeHtml(row.name)}</div>
                    ${row.pointsLabel ? `<div style="font-size:0.74rem;color:var(--muted);margin-top:4px;">${escapeHtml(row.pointsLabel)}</div>` : ""}
                  </td>
                  ${safeArray(row.levels).map((level) => {
                    const isSelected = selected?.bandId === level.id;
                    const isSuggested = suggested?.bandId === level.id;
                    const background = isSelected ? "#e8fbf4" : isSuggested ? "#eef4ff" : "#fff";
                    const border = isSelected ? "#34a587" : isSuggested ? "#b6c8f6" : "transparent";
                    const content = `
                      <div style="font-weight:700;font-size:0.78rem;margin-bottom:6px;">${escapeHtml(level.label)}</div>
                      <div style="line-height:1.5;">${escapeHtml(level.description || "—")}</div>
                    `;
                    return `
                      <td style="padding:${compact ? 6 : 8}px;vertical-align:top;border-bottom:1px solid var(--line);">
                        ${clickable
                          ? `<button class="button-ghost" data-action="select-rubric-band" data-criterion-id="${row.id}" data-band-id="${escapeAttribute(level.id)}" style="width:100%;min-height:100%;padding:${cellPadding}px;white-space:normal;text-align:left;background:${background};border-color:${border};">${content}</button>`
                          : `<div style="padding:${cellPadding}px;border:1px solid ${border};border-radius:10px;background:${background};min-height:${minHeight}px;">${content}</div>`
                        }
                      </td>
                    `;
                  }).join("")}
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRubricSchemaLayout(schemaInput, options = {}) {
    const escapeHtml = _escapeHtml;
    const escapeAttribute = _escapeAttribute;
    const renderRichTextHtml = _renderRichTextHtml;
    const schema = getRubricSchema(schemaInput, options.rubricName || "Uploaded rubric");
    if (!schema) return "";

    const clickable = Boolean(options.clickable);
    const compact = Boolean(options.compact);
    const previewMode = Boolean(options.previewMode);
    const rowScoreMap = options.rowScoreMap || new Map();
    const suggestedRowScoreMap = options.suggestedRowScoreMap || new Map();
    const selectionAction = options.selectionAction || "select-rubric-band";
    const currentScore = typeof options.currentScore === "number"
      ? options.currentScore
      : Array.from(rowScoreMap.values()).reduce((sum, entry) => sum + Number(entry?.points ?? 0), 0);
    const criteriaCount = schema.criteria.length;
    const gradedCount = Array.from(rowScoreMap.values()).length;

    return `
      <div class="rubric-schema-shell ${compact ? "rubric-schema-shell-compact" : ""} ${previewMode ? "rubric-schema-shell-preview" : ""}">
        <div class="rubric-schema-header">
          <div>
            ${options.kicker ? `<p class="mini-label" style="margin-bottom:4px;">${escapeHtml(options.kicker)}</p>` : ""}
            <h3 class="rubric-schema-title">${escapeHtml(schema.title || options.rubricName || "Uploaded rubric")}</h3>
            ${schema.subtitle ? `<p class="rubric-schema-subtitle">${escapeHtml(schema.subtitle)}</p>` : ""}
          </div>
          <div class="rubric-schema-summary">
            ${clickable ? `
              <div class="rubric-schema-score">
                <strong>${currentScore}</strong>
                <span>/ ${schema.totalPoints}</span>
              </div>
              <div class="rubric-schema-meta">${gradedCount}/${criteriaCount} criteria graded</div>
            ` : `
              <div class="rubric-schema-score">
                <strong>${schema.totalPoints}</strong>
                <span>pts total</span>
              </div>
              <div class="rubric-schema-meta">${criteriaCount} criteria</div>
            `}
          </div>
        </div>
        ${schema.notes.length ? `
          <div class="rubric-note-strip">
            ${schema.notes.map((note) => `<span>⚠ ${escapeHtml(note)}</span>`).join("")}
          </div>
        ` : ""}
        <div class="rubric-schema-criteria">
          ${schema.criteria.map((criterion) => {
            const selected = rowScoreMap.get(criterion.id);
            const suggested = suggestedRowScoreMap.get(criterion.id);
            const statusTheme = selected ? levelTheme(selected.label) : null;
            return `
              <section class="rubric-criterion-card ${previewMode ? "rubric-criterion-card-preview" : ""}" data-rubric-criterion-id="${escapeAttribute(criterion.id)}">
                <div class="rubric-criterion-header">
                  <div>
                    <div class="rubric-criterion-name">${escapeHtml(criterion.name)}</div>
                    <div class="rubric-criterion-range">${criterion.minScore}–${criterion.maxScore} pts</div>
                  </div>
                  ${selected ? `
                    <span class="rubric-selection-pill" style="background:${statusTheme.badge};color:${statusTheme.text};">${escapeHtml(selected.label)} · ${selected.points} pts</span>
                  ` : suggested ? `
                    <span class="rubric-selection-pill" style="background:#eef4ff;color:#4562b8;">Suggested · ${escapeHtml(suggested.label)} · ${suggested.points} pts</span>
                  ` : ""}
                </div>
                <div class="rubric-level-grid ${previewMode ? "rubric-level-grid-preview" : `rubric-level-grid-${Math.min(Math.max(criterion.levels.length, 1), 5)}`}">
                  ${criterion.levels.map((level) => {
                    const theme = levelTheme(level.label);
                    const isSelected = selected?.bandId === level.id || (selected && Number(selected.points) === Number(level.score ?? level.points) && selected.label === level.label);
                    const isSuggested = suggested?.bandId === level.id || (suggested && Number(suggested.points) === Number(level.score ?? level.points) && suggested.label === level.label);
                    const bg = isSelected ? theme.bg : isSuggested ? "#f7f2e9" : "#fff";
                    const border = isSelected ? theme.ring : isSuggested ? "#ccb48f" : "#e7ddd0";
                    const content = `
                      <span class="rubric-level-badge" style="background:${theme.badge};color:${theme.text};">${escapeHtml(level.label)} · ${Number(level.score ?? level.points ?? 0)} pts</span>
                      <span class="rubric-level-text">${renderRichTextHtml(level.description || "No descriptor provided.")}</span>
                    `;
                    return clickable
                      ? `<button class="rubric-level-cell ${isSelected ? "is-selected" : ""} ${isSuggested ? "is-suggested" : ""}" data-action="${escapeAttribute(selectionAction)}" data-criterion-id="${escapeAttribute(criterion.id)}" data-band-id="${escapeAttribute(level.id)}" style="background:${bg};border-color:${border};">${content}</button>`
                      : `<div class="rubric-level-cell ${isSelected ? "is-selected" : ""} ${isSuggested ? "is-suggested" : ""}" style="background:${bg};border-color:${border};">${content}</div>`;
                  }).join("")}
                </div>
              </section>
            `;
          }).join("")}
        </div>
        ${schema.attribution ? `<p class="rubric-schema-attribution">${escapeHtml(schema.attribution)}</p>` : ""}
      </div>
    `;
  }

  function renderUploadedRubricPreview(title = "Uploaded rubric preview", rubricText = "", rubricName = "", rubricData = null, rubricSchema = null) {
    const escapeHtml = _escapeHtml;
    const schema = getRubricSchema(rubricSchema || rubricData, rubricName || "Uploaded rubric");
    const trimmed = String(rubricText || "").trim();
    if (!trimmed && !schema) return "";

    return `
      <div style="background:#fffdf9;border:1px solid var(--line);border-radius:14px;padding:${schema ? "12px" : "16px"};">
        ${schema
          ? renderRubricSchemaLayout(schema, {
              kicker: title,
              rubricName: rubricName || schema.title || "Uploaded rubric",
              compact: true,
              previewMode: true,
            })
          : `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
              <div>
                <p class="mini-label" style="margin-bottom:4px;">${escapeHtml(title)}</p>
                <p style="margin:0;font-size:0.88rem;color:var(--muted);">${escapeHtml(rubricName || "Uploaded rubric")}</p>
              </div>
              <span class="pill">${trimmed.split(/\n+/).filter(Boolean).length} lines</span>
            </div>
            <pre style="margin:0;max-height:320px;overflow:auto;background:#faf7f0;border:1px solid var(--line);border-radius:12px;padding:14px;font-size:0.84rem;line-height:1.55;white-space:pre-wrap;">${escapeHtml(trimmed)}</pre>
          `
        }
      </div>
    `;
  }

  const RubricRender = {
    matrixRubricToSchema,
    simpleRubricRowsToSchema,
    getMatrixRubricData,
    getRubricSchema,
    serializeRubricSchemaForPrompt,
    serializeRubricDataForPrompt,
    levelTheme,
    renderRubricMatrixTable,
    renderRubricSchemaLayout,
    renderUploadedRubricPreview,
  };

  if (typeof window !== "undefined") {
    window.RubricRender = RubricRender;
    Object.entries(RubricRender).forEach(([name, fn]) => {
      if (typeof window[name] !== "function") {
        window[name] = fn;
      }
    });
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = RubricRender;
  }
})();
