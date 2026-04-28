const STORAGE_KEY = "AUIZero-v1";
const RUBRIC_LIBRARY_KEY = "AUIZero-rubric-library-v1";
const STORAGE_BACKUP_KEY = "AUIZero-v1-backup";
const ACTIVE_CLASS_KEY = "AUIZero-active-class-v1";
const ACTIVE_STUDENT_ASSIGNMENT_KEY = "AUIZero-active-student-assignment-v1";
const CUSTOM_ERROR_CODES_KEY = "AUIZero-custom-error-codes-v1";
const LARGE_PASTE_LIMIT = 220;
const PRODUCT_NAME = "praxis";
const PRODUCT_TAGLINE = "Think clearly. Write clearly.";
const REVIEW_REFRESH_MS = 20000;

const {
  buildDeadlineTimeOptions,
  combineDeadlineParts,
  getDeadlineDatePart,
  getDeadlineTimePart,
} = window.DeadlineUtils;
const {
  loadStateSnapshot,
  persistStateSnapshot,
} = window.StorageUtils;
const {
  parseJsonResponse,
  stringifyLinesWithMarkers,
} = window.AiAssistUtils;

// App state — now server-backed
let currentProfile = null;
let currentClasses = [];
let currentClassId = null;
let currentClassMembers = [];
let reviewRefreshTimer = null;
let storageWarningShown = false;

const BASE_ERROR_CODES = [
  { code: "CS",  label: "Comma splice: two complete sentences joined with only a comma" },
  { code: "RO",  label: "Run-on: two or more sentences run together without correct punctuation" },
  { code: "FR",  label: "Fragment: incomplete sentence — missing a subject or verb" },
  { code: "P",   label: "Missing punctuation: a period, comma, or other mark is needed here" },
  { code: "VT",  label: "Wrong verb tense: doesn't match the tense of the rest of the text" },
  { code: "WF",  label: "Wrong word form: e.g. adjective used where an adverb is needed" },
  { code: "AGR", label: "Agreement error: subject and verb, or noun and pronoun, don't agree" },
  { code: "SP",  label: "Spelling error" },
];

function loadCustomErrorCodes() {
  try {
    return JSON.parse(window.localStorage.getItem(CUSTOM_ERROR_CODES_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function saveCustomErrorCodes(entries) {
  try {
    window.localStorage.setItem(CUSTOM_ERROR_CODES_KEY, JSON.stringify(entries || []));
  } catch (_) {
    // Ignore localStorage failures and keep grading usable.
  }
}

function getErrorCodes() {
  const custom = loadCustomErrorCodes()
    .filter((entry) => entry?.code && entry?.label)
    .map((entry) => ({
      code: String(entry.code).trim().toUpperCase().slice(0, 8),
      label: String(entry.label).trim(),
      custom: true,
    }))
    .filter((entry) => entry.code && entry.label);
  const seen = new Set();
  return [...BASE_ERROR_CODES, ...custom].filter((entry) => {
    if (seen.has(entry.code)) return false;
    seen.add(entry.code);
    return true;
  });
}

function getErrorCodeLabel(code) {
  return getErrorCodes().find((entry) => entry.code === code)?.label || "";
}

const ui = {
  role: "student",
  activeUserId: "",
  pin: "",
  showInvitePanel: false,
  showClassModal: false,
  classModalName: "",
  classModalError: "",
  showDraftFeedbackPrompt: false,
  showFullRubric: false,
  inviteText: "",
  inviteMailto: "",
  teacherView: "assignments",
  teacherDraft: null,
  teacherAssist: null,
  aiAssistLoading: false,
  selectedSavedRubricId: "",
  selectedAssignmentId: null,
  expandedAssignmentBriefId: null,
  editingAssignmentId: null,
  selectedStudentAssignmentId: null,
  selectedReviewSubmissionId: null,
  selectedReviewStudentId: null,
  activeFocusIdeaId: "",
  pasteWarning: false,
  studentStep: 1,
  playback: {
    isPlaying: false,
    speed: 1,
    index: 0,
    timerId: null,
    touched: false,
  },
  lastAnnotationSelection: "",
  pendingPaste: null,
  notice: "",
  draftSaveMessage: "",
  studentStepOverrides: {},
  expandedContextCol: null,
  chatInput: "",
  chatLoading: false,
  latestDraftFeedbackByAssignmentId: {},
  adminView: "teachers",
  adminSelectedTeacherId: null,
  adminSelectedClassId: null,
  adminSelectedClassName: "",
  adminViewingAsTeacher: false,
  adminTeachers: [],
  adminClassDetail: null,
  adminSelectedAssignmentId: null,
};

let state = { assignments: [], submissions: [], users: [] };
let teacherAssistAbortController = null;
const authUiState = {
  signupRole: "student",
};

function loadActiveClassPreferences() {
  try {
    return JSON.parse(window.localStorage.getItem(ACTIVE_CLASS_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveActiveClassPreferences(preferences) {
  try {
    window.localStorage.setItem(ACTIVE_CLASS_KEY, JSON.stringify(preferences || {}));
  } catch (_) {
    // Ignore localStorage write failures and keep the app usable.
  }
}

function loadActiveStudentAssignmentPreferences() {
  try {
    return JSON.parse(window.localStorage.getItem(ACTIVE_STUDENT_ASSIGNMENT_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveActiveStudentAssignmentPreferences(preferences) {
  try {
    window.localStorage.setItem(ACTIVE_STUDENT_ASSIGNMENT_KEY, JSON.stringify(preferences || {}));
  } catch (_) {
    // Ignore localStorage write failures and keep the app usable.
  }
}

function getStudentAssignmentPreferenceKey(profile = currentProfile, classId = currentClassId) {
  if (!profile?.id || !classId) return "";
  return `${profile.id}:${classId}`;
}

function getSavedStudentAssignmentId(profile = currentProfile, classId = currentClassId) {
  const key = getStudentAssignmentPreferenceKey(profile, classId);
  if (!key) return null;
  const preferences = loadActiveStudentAssignmentPreferences();
  return preferences[key] || null;
}

function saveStudentAssignmentId(assignmentId, profile = currentProfile, classId = currentClassId) {
  const key = getStudentAssignmentPreferenceKey(profile, classId);
  if (!key) return;
  const preferences = loadActiveStudentAssignmentPreferences();
  if (assignmentId) {
    preferences[key] = assignmentId;
  } else {
    delete preferences[key];
  }
  saveActiveStudentAssignmentPreferences(preferences);
}

function getActiveClassPreferenceKey(profile = currentProfile) {
  if (!profile?.id || !profile?.role) return "";
  return `${profile.role}:${profile.id}`;
}

function getSavedActiveClassId(profile = currentProfile) {
  const key = getActiveClassPreferenceKey(profile);
  if (!key) return null;
  const preferences = loadActiveClassPreferences();
  return preferences[key] || null;
}

function saveActiveClassId(profile = currentProfile, classId = currentClassId) {
  const key = getActiveClassPreferenceKey(profile);
  if (!key) return;
  const preferences = loadActiveClassPreferences();
  if (classId) {
    preferences[key] = classId;
  } else {
    delete preferences[key];
  }
  saveActiveClassPreferences(preferences);
}

function chooseBestTeacherClassId(classes, classAssignments = [], preferredClassId = null) {
  const preferredAssignments = preferredClassId
    ? safeArray(classAssignments[classes.findIndex((cls) => cls.id === preferredClassId)])
    : [];
  const anyClassHasAssignments = classAssignments.some((assignments) => safeArray(assignments).length);
  if (
    preferredClassId &&
    classes.some((cls) => cls.id === preferredClassId) &&
    (preferredAssignments.length || !anyClassHasAssignments)
  ) {
    return preferredClassId;
  }

  const ranked = classes
    .map((cls, index) => {
      const assignments = safeArray(classAssignments[index]);
      const totalCount = assignments.length;
      const publishedCount = assignments.filter((assignment) => assignment?.status === "published").length;
      return {
        id: cls.id,
        score: (publishedCount * 100) + (totalCount * 10) - index,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score > 0 ? ranked[0].id : (classes[0]?.id || null);
}

function chooseBestStudentClassId(classes, assignments = [], preferredClassId = null) {
  if (!classes.length) return null;
  if (preferredClassId && classes.some((cls) => cls.id === preferredClassId)) {
    const preferredHasAssignments = assignments.some((assignment) => assignment?.classId === preferredClassId);
    if (preferredHasAssignments || !assignments.some((assignment) => assignment?.classId)) {
      return preferredClassId;
    }
  }

  const classWithAssignments = classes.find((cls) => assignments.some((assignment) => assignment?.classId === cls.id));
  return classWithAssignments?.id || preferredClassId || classes[0]?.id || null;
}

async function resolveTeacherStartingClass(profile, classes) {
  const preferredClassId = getSavedActiveClassId(profile);
  if (!classes.length) return null;
  if (preferredClassId && classes.some((cls) => cls.id === preferredClassId)) {
    return preferredClassId;
  }
  if (classes.length === 1) {
    return classes[0]?.id || null;
  }

  const assignmentResults = await Promise.allSettled(
    classes.map((cls) => Auth.apiFetch(`/api/classes/${cls.id}/assignments`))
  );
  const classAssignments = assignmentResults.map((result) => (
    result.status === "fulfilled" ? safeArray(result.value?.assignments) : []
  ));
  return chooseBestTeacherClassId(classes, classAssignments, preferredClassId);
}

function recoverStudentActiveClass(profile = currentProfile) {
  const preferredClassId = getSavedActiveClassId(profile) || currentClassId;
  const bestClassId = chooseBestStudentClassId(currentClasses, state.assignments, preferredClassId);
  currentClassId = bestClassId;
  saveActiveClassId(profile, currentClassId);
  return currentClassId;
}

// Rubric utility helpers are loaded from rubric-utils.js before app.js.
// Keep higher-level rubric conversion/rendering functions below in app.js for now.

function matrixRubricToSchema(source, fallbackName = "Uploaded rubric") {
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
        label: String(level?.label || "").replace(/\s+[–-]\s+\d+(?:\.\d+)?$/, "").trim() || `Level ${levelIndex + 1}`,
        score: Number(level?.points ?? 0),
        description: String(level?.description || "").trim(),
      })),
    })),
  }, fallbackName);
}

function simpleRubricRowsToSchema(source, fallbackName = "Rubric") {
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

function rubricLibraryDedupKey(entry = {}) {
  if (entry?.schema?.criteria?.length) return JSON.stringify(entry.schema);
  if (entry?.text) return entry.text;
  if (entry?.data) return JSON.stringify(entry.data);
  return entry?.id || "";
}

function normalizeRubricLibraryEntry(entry = {}) {
  const rawSchema = entry?.schema && typeof entry.schema === "object" ? getRubricSchema(entry.schema, entry?.name || "Saved rubric") : null;
  const rawData = entry?.data && typeof entry.data === "object"
    ? getMatrixRubricData(entry.data)
    : (rawSchema ? rubricSchemaToMatrixData(rawSchema, rawSchema.title || entry?.name || "Saved rubric") : null);
  const text = String(entry?.text || "").trim()
    || serializeRubricSchemaForPrompt(rawSchema, entry?.name || "Saved rubric")
    || serializeRubricDataForPrompt(rawData);
  if (!text && !rawData?.rows?.length && !rawSchema?.criteria?.length) return null;

  return {
    id: entry?.id || uid("saved-rubric"),
    name: String(entry?.name || rawSchema?.title || "Saved rubric").trim() || "Saved rubric",
    text,
    data: rawData,
    schema: rawSchema,
    savedAt: entry?.savedAt || new Date().toISOString(),
    source: entry?.source || "upload",
  };
}

function getSavedRubricLibrary() {
  const fromStorage = (() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(RUBRIC_LIBRARY_KEY) || "[]");
      return safeArray(stored).map(normalizeRubricLibraryEntry).filter(Boolean);
    } catch (error) {
      return [];
    }
  })();

  const fromAssignments = safeArray(state.assignments)
    .filter((assignment) => assignment?.uploadedRubricText || assignment?.uploadedRubricSchema || getMatrixRubricData(assignment?.uploadedRubricData || assignment?.rubric))
    .map((assignment) => normalizeRubricLibraryEntry({
      id: `assignment-rubric-${assignment.id}`,
      name: assignment.uploadedRubricName || assignment.uploadedRubricSchema?.title || `${assignment.title || "Assignment"} rubric`,
      text: assignment.uploadedRubricText || serializeRubricSchemaForPrompt(assignment?.uploadedRubricSchema || assignment?.rubric, assignment?.uploadedRubricName || assignment?.title || "Assignment rubric"),
      data: assignment.uploadedRubricData || getMatrixRubricData(assignment?.rubric),
      schema: assignment.uploadedRubricSchema || getRubricSchema(assignment?.rubric, assignment?.uploadedRubricName || assignment?.title || "Assignment rubric"),
      savedAt: assignment.createdAt,
      source: "assignment",
    }))
    .filter(Boolean);

  const deduped = new Map();
  [...fromStorage, ...fromAssignments].forEach((entry) => {
    const key = rubricLibraryDedupKey(entry);
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

function saveRubricToLibrary(name, text, data = null, schema = null) {
  const normalized = normalizeRubricLibraryEntry({ name, text, data, schema, source: "upload" });
  if (!normalized) return;

  const existing = getSavedRubricLibrary().filter((entry) => entry.source === "upload");
  const withoutDuplicate = existing.filter((entry) => rubricLibraryDedupKey(entry) !== rubricLibraryDedupKey(normalized));
  const next = [normalized, ...withoutDuplicate].slice(0, 25);
  window.localStorage.setItem(RUBRIC_LIBRARY_KEY, JSON.stringify(next));
}

function removeSavedRubricFromLibrary(rubricId) {
  try {
    const stored = safeArray(JSON.parse(window.localStorage.getItem(RUBRIC_LIBRARY_KEY) || "[]"))
      .map(normalizeRubricLibraryEntry)
      .filter(Boolean);
    const next = stored.filter((entry) => entry.id !== rubricId);
    window.localStorage.setItem(RUBRIC_LIBRARY_KEY, JSON.stringify(next));
  } catch (error) {
    window.localStorage.setItem(RUBRIC_LIBRARY_KEY, "[]");
  }
}

function applySavedRubricSelection(rubricId) {
  const savedRubric = getSavedRubricLibrary().find((entry) => entry.id === rubricId);
  if (!savedRubric) {
    ui.notice = "Choose a saved rubric first.";
    render();
    return;
  }

  ui.teacherDraft.uploadedRubricSchema = savedRubric.schema || null;
  ui.teacherDraft.uploadedRubricData = savedRubric.data || rubricSchemaToMatrixData(savedRubric.schema, savedRubric.name);
  ui.teacherDraft.uploadedRubricText = savedRubric.text
    || serializeRubricSchemaForPrompt(savedRubric.schema, savedRubric.name)
    || serializeRubricDataForPrompt(savedRubric.data);
  ui.teacherDraft.uploadedRubricName = savedRubric.name;
  ui.selectedSavedRubricId = savedRubric.id;
  ui.teacherAssist = null;
  ui.notice = `Loaded saved rubric "${savedRubric.name}". You can save manually or use Format With AI.`;
  render();
}

function renderRubricMatrixTable(matrixData, options = {}) {
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

function fluencyBadgeStyle(value, low, high) {
  if (value === null || value === undefined) return "background:#f0f0f0;color:#888;";
  if (value >= low && value <= high) return "background:#eef9f1;color:#1f5c38;border:1px solid #cdece2;";
  if (value >= low * 0.6 && value <= high * 1.4) return "background:#fff8e8;color:#9a6512;border:1px solid #f0d080;";
  return "background:#fff1f1;color:#962f2f;border:1px solid #f4c7c7;";
}

function renderWritingBehaviour(submission, assignment) {
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

  // Score each metric on its own scale
  function scoreInRange(value, low, high) {
    if (value === null || value === undefined) return null;
    if (value >= low && value <= high) return 2;
    if (value >= low * 0.6 && value <= high * 1.4) return 1;
    return 0;
  }

  // Burst: 2pts, Pauses: 2pts
  const scoreBurst  = scoreInRange(burst,  r.burst[0],  r.burst[1]);
  const scorePauses = scoreInRange(pauses, r.pauses[0], r.pauses[1]);

  // Micro-corrections: 1pt — only flags on near-zero absence
  let scoreMicro = null;
  if (micro !== null && micro !== undefined) {
    scoreMicro = micro < 1 ? 0 : 1;
  }

  // Local revisions: 2pts, CEFR-calibrated
  const scoreLocal = scoreInRange(local, r.local[0], r.local[1]);

  // Substantive revisions: 1pt — presence is positive, absence is neutral for short texts
  let scoreSubstantive = null;
  if (substantive !== null && substantive !== undefined) {
    const words = wordCount(submission?.finalText || submission?.draftText || "");
    scoreSubstantive = substantive >= 1 ? 1 : (words < 150 ? 1 : 0);
  }

  // Weighted total out of 8
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
  const avg           = totalPoints / maxPoints * 2; // normalise to 0–2 scale

  const band = avg >= 1.7 ? "Natural"
    : avg >= 1.2 ? "Likely natural"
    : avg >= 0.6 ? "Uncertain"
    : "Needs review";

  const bandColour = avg >= 1.7 ? "#1f5c38" : avg >= 1.2 ? "#5a7a2e" : avg >= 0.6 ? "#9a6512" : "#962f2f";
  const bandBg     = avg >= 1.7 ? "#eef9f1" : avg >= 1.2 ? "#f4f9e8" : avg >= 0.6 ? "#fff8e8" : "#fff1f1";
  const bandBorder = avg >= 1.7 ? "#cdece2" : avg >= 1.2 ? "#cde0a0" : avg >= 0.6 ? "#f0d080" : "#f4c7c7";

  const bandScale = ["Natural", "Likely natural", "Uncertain", "Needs review"].map(label => {
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
    ? `Typing rhythm, pause patterns, and revision behaviour are consistent with independent composition at ${level}.`
    : avg >= 1.2
    ? `Mostly natural writing behaviour with some variation — consistent with ${level}.`
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

  // Indicator for range-based metrics (burst, pauses, local revisions)
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

    // Simple badge for micro-corrections and substantive revisions
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
  
  const microNote = micro < 1 ? "None detected — flag" : "Present — normal";
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
          <p style="margin:0 0 4px;">Crossley, S., Tian, Y., Choi, J.S., Holmes, L., &amp; Morris, W. (2024). Plagiarism Detection Using Keystroke Logs. <em>EDM 2024, 476–483.</em> — Authentic writers delete more, revise more, and produce more variable deletion patterns than transcribers.</p>
          <p style="margin:0 0 4px;">Barkaoui, K. (2019). L2 writers' pausing behaviour. <em>Studies in Second Language Acquisition, 41(3).</em> — 2-second threshold; lower proficiency = more pauses.</p>
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
      note: "Pauses over 2s per 100 words. Very low = suspicious, very high = struggling"
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

function levelTheme(label = "") {
  const lower = String(label || "").toLowerCase();
  if (lower.includes("excel")) return { ring: "#23824c", bg: "#eef9f1", text: "#1c663d", badge: "#cdeed7" };
  if (lower.includes("good")) return { ring: "#2f67d8", bg: "#edf3ff", text: "#1f4fb6", badge: "#d7e4ff" };
  if (lower.includes("satisf")) return { ring: "#cf8b1f", bg: "#fff8e8", text: "#9a6512", badge: "#f6df9a" };
  if (lower.includes("needs")) return { ring: "#c46a2b", bg: "#fff3ea", text: "#a4531d", badge: "#f6d0b4" };
  if (lower.includes("unsatisf") || lower.includes("weak")) return { ring: "#c24d4d", bg: "#fff1f1", text: "#962f2f", badge: "#f4c7c7" };
  return { ring: "#768078", bg: "#f6f6f4", text: "#4f574f", badge: "#e7e7e2" };
}

function renderRichTextHtml(text = "") {
  return escapeHtml(String(text || ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\+\+([^+]+)\+\+/g, "<u>$1</u>")
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\n+/g, "<br>");
}

function stripPromptFormatting(text = "") {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\+\+([^+]+)\+\+/g, "$1")
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
}

function truncateText(text = "", maxLength = 140) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function focusChatInput() {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const textarea = document.getElementById("chat-input");
    if (!textarea) return;
    textarea.focus();
    const cursor = textarea.value.length;
    if (typeof textarea.setSelectionRange === "function") {
      textarea.setSelectionRange(cursor, cursor);
    }
  });
}

function applyPromptFormattingToTextarea(textarea, format) {
  if (!textarea) return;
  const wrappers = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    underline: ["++", "++"],
  };
  const [open, close] = wrappers[format] || ["", ""];
  if (!open) return;

  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const selected = textarea.value.slice(start, end);
  const nextValue = `${textarea.value.slice(0, start)}${open}${selected}${close}${textarea.value.slice(end)}`;
  textarea.value = nextValue;
  const cursorStart = start + open.length;
  const cursorEnd = cursorStart + selected.length;
  textarea.focus();
  textarea.setSelectionRange(cursorStart, cursorEnd);
}

function renderPromptFormattingToolbar(targetId) {
  return `
    <div class="pill-row" style="margin-bottom:8px;gap:8px;">
      <span class="mini-label" style="margin:0;align-self:center;">Formatting</span>
      <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="bold" style="min-height:34px;padding:0 12px;"><strong>B</strong></button>
      <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="italic" style="min-height:34px;padding:0 12px;"><em>I</em></button>
      <button class="button-ghost" type="button" data-action="format-prompt-text" data-target-id="${targetId}" data-format="underline" style="min-height:34px;padding:0 12px;"><u>U</u></button>
    </div>
  `;
}

function renderRubricSchemaLayout(schemaInput, options = {}) {
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

function createBlankTeacherDraft() {
  return {
    brief: "",
    title: "",
    prompt: "",
    focus: "",
    assignmentType: "response",
    assignmentTypeOther: "",
    languageLevel: "B1",
    totalPoints: 20,
    wordCountMin: 250,
    wordCountMax: 400,
    ideaRequestLimit: 3,
    feedbackRequestLimit: 2,
    chatTimeLimit: 0,
    disableChatbot: false,
    deadline: "",
    studentFocus: "",
    rubric: [],
    uploadedRubricText: "",
    uploadedRubricName: "",
    uploadedRubricData: null,
    uploadedRubricSchema: null,
  };
}

function populateTeacherDraftFromAssignment(assignment) {
  if (!assignment) return;
  ui.teacherDraft = {
    brief: assignment.brief || "",
    title: assignment.title || "",
    prompt: assignment.prompt || "",
    focus: assignment.focus || "",
    assignmentType: assignment.assignmentType || "response",
    languageLevel: assignment.languageLevel || "B1",
    totalPoints: Number(assignment.totalPoints || assignment.rubricSchema?.totalPoints || assignment.rubric?.reduce((sum, row) => sum + Number(row?.points || 0), 0) || 20),
    wordCountMin: Number(assignment.wordCountMin || 250),
    wordCountMax: Number(assignment.wordCountMax || 400),
    ideaRequestLimit: Number(assignment.ideaRequestLimit || 3),
    feedbackRequestLimit: Number(assignment.feedbackRequestLimit || 2),
    chatTimeLimit: Number(assignment.chatTimeLimit ?? 0),
    disableChatbot: isChatDisabled(assignment),
    deadline: assignment.deadline || "",
    studentFocus: Array.isArray(assignment.studentFocus) ? assignment.studentFocus.join("\n") : String(assignment.studentFocus || ""),
    rubric: safeArray(assignment.rubric).map((item) => normalizeRubricRow(item)),
    uploadedRubricText: assignment.uploadedRubricText || "",
    uploadedRubricName: assignment.uploadedRubricName || "",
    uploadedRubricData: assignment.uploadedRubricData || null,
    uploadedRubricSchema: assignment.uploadedRubricSchema || null,
  };
  if (ui.teacherDraft.disableChatbot) {
    ui.teacherDraft.chatTimeLimit = -1;
  }
  ui.teacherAssist = null;
  ui.editingAssignmentId = assignment.id;
}

function inferTeacherBriefSettings(text = "") {
  const brief = String(text || "");
  const inferred = {};

  const explicitLevel = brief.match(/\b(?:CEFR\s*)?(A0|A1|A2|B1|B2|C1|C2)\b/i);
  if (explicitLevel) {
    inferred.languageLevel = explicitLevel[1].toUpperCase();
  } else {
    const levelKeywords = [
      { pattern: /\bbeginner\b/i, level: "A1" },
      { pattern: /\belementary\b/i, level: "A2" },
      { pattern: /\bpre-?intermediate\b/i, level: "A2" },
      { pattern: /\bintermediate\b/i, level: "B1" },
      { pattern: /\bupper-?intermediate\b/i, level: "B2" },
      { pattern: /\badvanced\b/i, level: "C1" },
    ];
    const matchedLevel = levelKeywords.find(({ pattern }) => pattern.test(brief));
    if (matchedLevel) {
      inferred.languageLevel = matchedLevel.level;
    }
  }

  if (/\b(?:disable|turn off|switch off|skip|no|without)\s+(?:the\s+)?(?:chatbot|chat|coach)\b/i.test(brief)) {
    inferred.disableChatbot = true;
    inferred.chatTimeLimit = -1;
  } else {
    const chatPatterns = [
      /\b(?:chat(?:bot)?|coach)(?:\s+(?:time|session))?(?:\s+limit)?(?:\s+(?:of|for|to|at|around))?[^0-9]{0,10}(\d{1,3})\s*(?:min|mins|minutes)\b/i,
      /\b(\d{1,3})\s*(?:min|mins|minutes)\s*(?:of\s+)?(?:chat|chatbot|coach)\b/i,
      /\bchat\s*time\s*limit[^0-9]{0,10}(\d{1,3})\b/i,
    ];
    for (const pattern of chatPatterns) {
      const match = brief.match(pattern);
      if (match) {
        inferred.chatTimeLimit = Number(match[1]);
        break;
      }
    }
  }

  const feedbackMatch = brief.match(/\b(\d+)\s*(?:feedback checks?|feedbacks?|draft checks?)\b/i);
  if (feedbackMatch) {
    inferred.feedbackRequestLimit = Number(feedbackMatch[1]);
  }

  const totalPointsMatch = brief.match(/\b(\d+)\s*(?:total\s*)?(?:pts|points)\b/i);
  if (totalPointsMatch) {
    inferred.totalPoints = Number(totalPointsMatch[1]);
  }

  const detectedType = detectAssignmentType(brief);
  if (detectedType !== "response" || /\bresponse\b/i.test(brief)) {
    inferred.assignmentType = detectedType;
  }

  return inferred;
}

function isChatDisabled(config = {}) {
  return Boolean(config?.disableChatbot) || Number(config?.chatTimeLimit ?? 0) < 0;
}

function getVisibleChatTimeLimit(config = {}) {
  return isChatDisabled(config) ? 0 : Number(config?.chatTimeLimit ?? 0);
}

function assignmentUsesSingleParagraph(assignment = {}) {
  const haystack = `${assignment?.title || ""} ${assignment?.brief || ""} ${assignment?.prompt || ""}`.toLowerCase();
  return /\bparagraph\b/.test(haystack) && !/\bparagraphs\b/.test(haystack);
}

function assignmentLikelyEssay(assignment = {}) {
  const haystack = `${assignment?.title || ""} ${assignment?.brief || ""} ${assignment?.prompt || ""}`.toLowerCase();
  return /\bessay\b/.test(haystack)
    || /\bintroduction\b/.test(haystack)
    || /\bconclusion\b/.test(haystack)
    || /\bbody paragraph\b/.test(haystack);
}

function getAssignmentRubricFeedbackText(assignment = {}) {
  const rubricSchema = assignment?.uploadedRubricSchema
    || assignment?.rubricSchema
    || getRubricSchema(assignment?.rubric, assignment?.uploadedRubricName || assignment?.title || "Rubric");

  if (!rubricSchema?.criteria?.length) {
    return safeArray(assignment?.rubric)
      .map((criterion) => `${criterion?.name || ""} ${criterion?.description || ""}`)
      .join(" ")
      .toLowerCase();
  }

  return safeArray(rubricSchema.criteria)
    .flatMap((criterion) => [
      criterion?.name || "",
      ...safeArray(criterion?.levels).map((level) => `${level?.label || ""} ${level?.description || ""}`),
    ])
    .join(" ")
    .toLowerCase();
}

function hasLowSentenceVariety(sentences = []) {
  if (!Array.isArray(sentences) || sentences.length < 3) return false;
  const lengths = sentences.map((sentence) => wordCount(sentence)).filter(Boolean);
  if (lengths.length < 3) return false;
  return Math.max(...lengths) - Math.min(...lengths) <= 4;
}

function scrollToNextRubricCriterionMobile(criterionId) {
  if (!criterionId || typeof window === "undefined" || !window.matchMedia("(max-width: 900px)").matches) return;
  window.setTimeout(() => {
    const sections = Array.from(document.querySelectorAll("[data-rubric-criterion-id]"));
    const currentIndex = sections.findIndex((section) => section.dataset.rubricCriterionId === criterionId);
    if (currentIndex === -1) return;
    const nextSection = sections[currentIndex + 1];
    if (nextSection) {
      nextSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 140);
}

function isChatSessionExpired(assignment, submission) {
  const timeLimit = isChatDisabled(assignment) ? 0 : Math.max(0, Number(assignment?.chatTimeLimit || 0));
  if (timeLimit <= 0 || !submission?.chatStartedAt) return false;
  const elapsedMs = getActiveChatElapsedMs(assignment, submission);
  return Number.isFinite(elapsedMs) && elapsedMs >= timeLimit * 60000;
}

function getAssignmentRubricType(assignment) {
  if (assignment?.rubricType) return assignment.rubricType;
  if (assignment?.uploadedRubricSchema || safeArray(assignment?.rubricSchema?.criteria).length || safeArray(assignment?.rubric?.criteria).length) return "matrix";
  if (safeArray(assignment?.rubric).some((row) => safeArray(row?.levels).length)) return "matrix";
  return assignment?.uploadedRubricText ? "matrix" : "simple_band";
}

function createDefaultTeacherReview(review = {}) {
  return {
    status: review?.status || "ungraded",
    rubricType: review?.rubricType || "simple_band",
    rowScores: Array.isArray(review?.rowScores) ? review.rowScores : [],
    suggestedRowScores: Array.isArray(review?.suggestedRowScores) ? review.suggestedRowScores : [],
    suggestedGrade: review?.suggestedGrade || null,
    finalScore: review?.finalScore ?? "",
    finalNotes: review?.finalNotes || "",
    annotations: Array.isArray(review?.annotations) ? review.annotations : [],
    savedAt: review?.savedAt || null,
    acceptedAt: review?.acceptedAt || null,
  };
}

function createScoreBandsForPoints(maxPoints) {
  const ceiling = Math.max(1, Number(maxPoints || 0));
  const labels = ["Excellent", "Good", "Satisfactory", "Developing", "Needs work"];
  const rawPoints = [
    ceiling,
    Math.max(ceiling - 1, 0),
    Math.max(Math.round(ceiling * 0.65), 0),
    Math.max(Math.round(ceiling * 0.4), 0),
    0,
  ];
  const uniquePoints = [...new Set(rawPoints)].sort((a, b) => b - a);

  return uniquePoints.map((points, index) => ({
    id: `band-${ceiling}-${points}-${index}`,
    label: labels[index] || `Band ${index + 1}`,
    points,
    description: `${labels[index] || `Band ${index + 1}`} (${points})`,
  }));
}

function createSimpleRubricCriterion(name, description, points = 4) {
  const maxPoints = Math.max(1, Number(points || 4));
  return {
    id: uid("rubric"),
    name,
    description,
    points: maxPoints,
    bands: createScoreBandsForPoints(maxPoints),
  };
}

function getCriterionBands(criterion) {
  const levels = safeArray(criterion?.levels);
  if (levels.length) return levels;
  const bands = safeArray(criterion?.bands);
  if (bands.length) return bands;
  return createScoreBandsForPoints(Number(criterion?.points || 0));
}

function buildTeacherReviewRowScore(criterion, band) {
  return {
    criterionId: criterion.id,
    criterionName: criterion.name || "Criterion",
    bandId: band.id || `band-${criterion.id}-${band.points}`,
    label: cleanRubricLevelLabel(band.label || `${band.points}`),
    description: String(band.description || "").trim(),
    points: Number(band.points ?? 0),
    maxPoints: Number(criterion.points || 0),
  };
}

function getTeacherReviewRowScoreMap(rowScores) {
  return new Map(
    safeArray(rowScores)
      .filter((entry) => entry?.criterionId)
      .map((entry) => [entry.criterionId, entry])
  );
}

function getStudentSelfAssessmentRowScoreMap(submission) {
  return new Map(
    safeArray(submission?.selfAssessment?.rowScores)
      .filter((entry) => entry?.criterionId)
      .map((entry) => [entry.criterionId, entry])
  );
}

function findClosestBand(criterion, desiredPoints) {
  const bands = getCriterionBands(criterion);
  if (!bands.length) return null;
  const target = Number(desiredPoints ?? 0);
  return bands.reduce((best, band) => {
    if (!best) return band;
    const bestDistance = Math.abs(Number(best.points ?? 0) - target);
    const bandDistance = Math.abs(Number(band.points ?? 0) - target);
    if (bandDistance < bestDistance) return band;
    if (bandDistance === bestDistance && Number(band.points ?? 0) > Number(best.points ?? 0)) return band;
    return best;
  }, null);
}

function calculateTeacherReviewSummary(assignment, submission, rowScores = submission?.teacherReview?.rowScores) {
  const rubric = safeArray(assignment?.rubric).length ? assignment.rubric : rubricForType(assignment?.assignmentType);
  const rowScoreMap = getTeacherReviewRowScoreMap(rowScores);
  const maxScore = rubric.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0);
  const selectedCount = rubric.filter((criterion) => rowScoreMap.has(criterion.id)).length;
  const totalScore = rubric.reduce((sum, criterion) => {
    const entry = rowScoreMap.get(criterion.id);
    return sum + Number(entry?.points ?? 0);
  }, 0);
  const fallbackScore = selectedCount === 0 && submission?.teacherReview?.finalScore !== ""
    ? Number(submission.teacherReview.finalScore || 0)
    : totalScore;

  return {
    rubric,
    rowScoreMap,
    totalScore: fallbackScore,
    maxScore,
    selectedCount,
    isComplete: rubric.length > 0 && selectedCount === rubric.length,
  };
}

function buildCriterionAnalytics(assignment, submissions) {
  const rubric = safeArray(assignment?.rubric);
  if (!rubric.length) return [];

  return rubric.map((criterion) => {
    const bands = getCriterionBands(criterion)
      .slice()
      .sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0));
    const counts = new Map(bands.map((band) => [band.id || `${criterion.id}-${band.points}`, 0]));
    let gradedCount = 0;
    let totalPoints = 0;

    safeArray(submissions).forEach((submission) => {
      const rowMap = getTeacherReviewRowScoreMap(submission?.teacherReview?.rowScores);
      const entry = rowMap.get(criterion.id);
      if (!entry) return;
      gradedCount += 1;
      totalPoints += Number(entry.points ?? 0);
      const matchingBand = bands.find((band) => (band.id || `${criterion.id}-${band.points}`) === entry.bandId)
        || findClosestBand(criterion, entry.points);
      if (matchingBand) {
        const key = matchingBand.id || `${criterion.id}-${matchingBand.points}`;
        counts.set(key, Number(counts.get(key) || 0) + 1);
      }
    });

    const distribution = bands.map((band) => {
      const key = band.id || `${criterion.id}-${band.points}`;
      const count = Number(counts.get(key) || 0);
      return {
        id: key,
        label: cleanRubricLevelLabel(band.label || `${band.points}`),
        points: Number(band.points ?? 0),
        count,
        share: gradedCount ? count / gradedCount : 0,
      };
    });

    return {
      criterionId: criterion.id,
      criterionName: criterion.name || "Criterion",
      gradedCount,
      averageScore: gradedCount ? (totalPoints / gradedCount) : 0,
      maxPoints: Number(criterion.points || 0),
      distribution,
    };
  });
}

async function syncTeacherReviewToServer(submission) {
  if (!submission?.id || String(submission.id).startsWith("submission-")) return;
  try {
    await Auth.apiFetch(`/api/submissions/${submission.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        teacher_review: submission.teacherReview,
      }),
    });
  } catch (error) {
    console.error("Could not sync teacher review:", error.message, error);
  }
}

async function upsertTeacherReviewSubmission(assignment, submission) {
  if (!assignment?.id || !submission?.studentId) return submission;

  try {
    if (submission.id && !String(submission.id).startsWith("submission-") && !String(submission.id).startsWith("pending-review-")) {
      const result = await Auth.apiFetch(`/api/submissions/${submission.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: submission.status,
          teacher_review: submission.teacherReview,
        }),
      });
      return mapServerSubmission(result?.submission || submission);
    }

    const result = await Auth.apiFetch(`/api/assignments/${assignment.id}/students/${submission.studentId}/submission`, {
      method: "PUT",
      body: JSON.stringify(buildSubmissionServerPayload(submission, {
        teacher_review: submission.teacherReview,
      })),
    });

    return mapServerSubmission(result?.submission || submission);
  } catch (error) {
    console.error("Could not upsert teacher review submission:", error.message, error);
    return submission;
  }
}

function replaceSubmissionInState(nextSubmission) {
  if (!nextSubmission?.assignmentId || !nextSubmission?.studentId) return;
  state.submissions = state.submissions.filter(
    (submission) => !(submission.assignmentId === nextSubmission.assignmentId && submission.studentId === nextSubmission.studentId)
  );
  state.submissions.push(nextSubmission);
}

function buildSubmissionServerPayload(submission, overrides = {}) {
  return {
    idea_responses: safeArray(submission?.ideaResponses),
    draft_text: submission?.draftText || "",
    final_text: submission?.finalText || "",
    reflections: submission?.reflections || { improved: "" },
    outline: submission?.outline || { partOne: "", partTwo: "", partThree: "" },
    chat_history: safeArray(submission?.chatHistory),
    writing_events: safeArray(submission?.writingEvents),
    feedback_history: safeArray(submission?.feedbackHistory),
    focus_annotations: safeArray(submission?.focusAnnotations),
    self_assessment: submission?.selfAssessment || {},
    status: submission?.status || "draft",
    chat_started_at: submission?.chatStartedAt || null,
    chat_skipped_at: submission?.chatSkippedAt || null,
    chat_expired_at: submission?.chatExpiredAt || null,
    chat_elapsed_ms: Math.max(0, Math.round(Number(submission?.chatElapsedMs || 0))),
    started_at: submission?.startedAt || null,
    submitted_at: submission?.submittedAt || null,
    keystroke_log: safeArray(submission?.keystrokeLog),
    fluency_summary: submission?.fluencySummary || {},
    final_unlocked: submission.finalUnlocked || false,
    ...overrides,
  };
}

function getTeacherReviewRowsForExport(assignment, submission) {
  const reviewSummary = calculateTeacherReviewSummary(assignment, submission);
  return reviewSummary.rubric.map((criterion) => {
    const selected = reviewSummary.rowScoreMap.get(criterion.id);
    const matchedBand = selected
      ? getCriterionBands(criterion).find((band) => (band.id || `band-${criterion.id}-${band.points}`) === selected.bandId)
        || findClosestBand(criterion, selected.points)
      : null;
    return {
      criterion: criterion.name,
      description: criterion.description,
      selectedLabel: selected?.label || cleanRubricLevelLabel(matchedBand?.label || "") || "",
      selectedDescription: selected?.description || String(matchedBand?.description || "").trim(),
      selectedPoints: Number(selected?.points ?? 0),
      maxPoints: Number(criterion.points || 0),
    };
  });
}

function buildLmsGradeText(assignment, submission) {
  const studentName = submission._studentName || getUserById(submission.studentId)?.name || "Student";
  const rows = getTeacherReviewRowsForExport(assignment, submission);
  const total = calculateTeacherReviewSummary(assignment, submission).totalScore;
  const maxScore = rows.reduce((sum, row) => sum + row.maxPoints, 0);
  const annotations = safeArray(submission.teacherReview?.annotations);
  const lines = [
    `${assignment.title} — ${studentName}`,
    `Status: ${getSubmissionStatusDisplay(submission.status || submission.teacherReview?.status || "not_started")}`,
    `Score: ${total}/${maxScore}`,
    "",
    "Rubric breakdown:",
    ...rows.map((row) => `- ${row.criterion}: ${row.selectedLabel ? `${row.selectedLabel} (${row.selectedPoints}/${row.maxPoints})${row.selectedDescription ? ` — ${row.selectedDescription}` : ""}` : `Not scored (0/${row.maxPoints})`}`),
  ];

  if (submission.teacherReview?.finalNotes) {
    lines.push("", "Teacher feedback:", submission.teacherReview.finalNotes.trim());
  }

  if (annotations.length) {
    lines.push(
      "",
      "Annotation comments:",
      ...annotations.map((annotation, index) => `- ${getAnnotationDisplayLabel(annotation, index)}: "${annotation.selectedText}"${annotation.note ? ` — ${annotation.note}` : ""}`)
    );
  }

  return lines.join("\n");
}

async function copyLmsGradeToClipboard(assignment, submission) {
  if (!assignment || !submission) return false;
  const text = buildLmsGradeText(assignment, submission);

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Could not copy LMS grade text:", error.message, error);
    return false;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function titleCase(text) {
  return String(text || "").replace(/\b\w/g, (char) => char.toUpperCase());
}

function stopPlayback() {
  ui.playback.isPlaying = false;
  if (ui.playback.timerId) {
    window.clearTimeout(ui.playback.timerId);
    ui.playback.timerId = null;
  }
}

let appEl = null;

document.addEventListener("DOMContentLoaded", async () => {
  appEl = document.getElementById("app");
  bindLifecycleEvents();

  // Bind events once here so they work on auth screen and app screen
 appEl.addEventListener("click", handleClick);
  appEl.addEventListener("change", handleChange);
  appEl.addEventListener("input", handleInput);
  appEl.addEventListener("paste", handlePaste, true);
  appEl.addEventListener("keydown", handleKeydown);

  // Show loading screen while checking session
  appEl.innerHTML = `<div style="display:grid;place-items:center;min-height:60vh;"><p>Loading...</p></div>`;
  const params = new URLSearchParams(window.location.search);
  const joinClassId = params.get('join');
  const isResetFlow = params.get('reset') === '1';
  let inviteInfo = null;
  if (joinClassId) inviteInfo = await Auth.getInviteInfo(joinClassId);
  await Auth.consumeRecoverySessionFromUrl();
  if (isResetFlow) {
    renderResetPasswordScreen();
    return;
  }
  const profile = await Auth.restoreSession();
  if (!profile) {
    resetAppShellState();
    setTimeout(() => renderAuthScreen(joinClassId, inviteInfo), 0);
    return;
  }
  await bootApp(profile);
});

function resetAppShellState() {
  currentProfile = null;
  currentClasses = [];
  currentClassId = null;
  currentClassMembers = [];
  state = createBlankState();
  ui.role = "student";
  ui.activeUserId = "";
  ui.selectedAssignmentId = null;
  ui.selectedStudentAssignmentId = null;
  ui.selectedReviewSubmissionId = null;
  ui.selectedReviewStudentId = null;
  ui.selectedSavedRubricId = "";
  ui.teacherView = "assignments";
  ui.teacherDraft = createBlankTeacherDraft();
  ui.teacherAssist = null;
  ui.studentStep = 1;
  ui.studentStepOverrides = {};
  ui.showDraftFeedbackPrompt = false;
  ui.latestDraftFeedbackByAssignmentId = {};
  ui.notice = "";
}
async function bootApp(profile) {
  currentProfile = profile;
  storageWarningShown = false;
  state = loadState(profile);
  ui.teacherDraft = createBlankTeacherDraft();
  ui.role = profile.role;
  ui.activeUserId = profile.id;

  // Auto-join class if arriving via invite link
  try { await Auth.joinClassIfInvited(); } catch(e) { console.warn("Join class skipped:", e.message); }

  if (profile.role === 'admin' && !ui.adminViewingAsTeacher) {
    await loadAdminData();
    render();
    return;
  }

  if (profile.role === 'teacher' || (profile.role === 'admin' && ui.adminViewingAsTeacher)) {
    const data = await Auth.apiFetch('/api/classes');
    currentClasses = data.classes || [];
    currentClassId = await resolveTeacherStartingClass(profile, currentClasses);
    if (currentClassId) {
      await loadTeacherClassContext(currentClassId);
    }
  } else {
    const localSubmissions = safeArray(state.submissions).slice();
    await refreshStudentClasses(getSavedActiveClassId(profile));
    state.assignments = [];
    state.submissions = localSubmissions;
    await loadStudentAssignmentsForCurrentClass();
    recoverStudentActiveClass(profile);
  }
  hydrateSelections();
  if (profile.role === 'student' && ui.selectedStudentAssignmentId) {
    await loadStudentSubmissionForAssignment(ui.selectedStudentAssignmentId);
  }
  render();
}

async function loadAdminData() {
  const data = await Auth.apiFetch('/api/admin/teachers');
  ui.adminTeachers = data.teachers || [];
}

async function loadTeacherClassContext(classId) {
  const previousAssignments = safeArray(state.assignments).slice();
  const previousSubmissions = safeArray(state.submissions).slice();
  const previousMembers = safeArray(currentClassMembers).slice();
  currentClassId = classId || null;
  saveActiveClassId(currentProfile, currentClassId);
  ui.selectedAssignmentId = null;
  ui.selectedReviewSubmissionId = null;
  ui.selectedReviewStudentId = null;

  if (!currentClassId) return;

  const [membersData, assignData] = await Promise.all([
    Auth.apiFetch(`/api/classes/${currentClassId}/members`),
    Auth.apiFetch(`/api/classes/${currentClassId}/assignments`)
  ]);

  if (membersData?.error || assignData?.error) {
    currentClassMembers = previousMembers;
    state.assignments = previousAssignments;
    state.submissions = previousSubmissions;
    ui.notice = assignData?.error || membersData?.error || "We couldn't load this class right now.";
    persistState();
    return;
  }

  currentClassMembers = membersData.members || [];
  const raw = safeArray(assignData.assignments);
  state.submissions = [];
  state.assignments = raw.map((a) => normalizeAssignment({
    id: a.id,
    title: a.title || '',
    prompt: a.prompt || '',
    brief: a.brief || '',
    focus: a.focus || '',
    assignmentType: a.assignment_type || 'response',
    languageLevel: a.language_level || 'B1',
    wordCountMin: a.word_count_min || 250,
    wordCountMax: a.word_count_max || 400,
    feedbackRequestLimit: a.feedback_request_limit || 2,
    chatTimeLimit: Math.max(0, Number(a.chat_time_limit || 0)),
    disableChatbot: Boolean(a.disable_chatbot || false),
    studentFocus: a.student_focus || [],
    rubric: a.rubric || [],
    deadline: a.deadline || '',
    status: a.status || 'draft',
    uploadedRubricText: a.uploaded_rubric_text || '',
    uploadedRubricName: a.uploaded_rubric_name || '',
    createdAt: a.created_at || new Date().toISOString(),
    classId: a.class_id || currentClassId,
      ideaRequestLimit: 3,
  }));
  await loadTeacherSubmissionsForAssignments(state.assignments.map((assignment) => assignment.id));
  ui.notice = "";
  persistState();
}

async function refreshStudentClasses(preferredClassId = currentClassId) {
  const data = await Auth.apiFetch('/api/student/classes');
  currentClasses = data.classes || [];
  if (preferredClassId && currentClasses.some((cls) => cls.id === preferredClassId)) {
    currentClassId = preferredClassId;
  } else {
    currentClassId = currentClasses[0]?.id || null;
  }
  saveActiveClassId(currentProfile, currentClassId);
  return currentClasses;
}

async function loadStudentAssignmentsForCurrentClass() {
  const classIds = currentClasses.map((cls) => cls.id).filter(Boolean);
  if (!classIds.length) {
    state.assignments = [];
    persistState();
    return;
  }

  try {
    const results = await Promise.allSettled(
      classIds.map((classId) => Auth.apiFetch(`/api/classes/${classId}/assignments`))
    );
    const successfulResults = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const resultsWithAssignments = successfulResults.filter((result) => !result?.error);
    if (!resultsWithAssignments.length) {
      throw new Error("No class assignment requests succeeded");
    }
    const rawAssignments = resultsWithAssignments.flatMap((result) => safeArray(result?.assignments));

    state.assignments = rawAssignments
      .filter((a) => a.status === 'published')
      .map((a) => normalizeAssignment({
        id: a.id,
        title: a.title || '',
        prompt: a.prompt || '',
        brief: a.brief || '',
        focus: a.focus || '',
        assignmentType: a.assignment_type || 'response',
        languageLevel: a.language_level || 'B1',
        wordCountMin: a.word_count_min || 250,
        wordCountMax: a.word_count_max || 400,
        feedbackRequestLimit: a.feedback_request_limit || 2,
        chatTimeLimit: Math.max(0, Number(a.chat_time_limit || 0)),
        disableChatbot: Boolean(a.disable_chatbot || false),
        studentFocus: a.student_focus || [],
        rubric: a.rubric || [],
        deadline: a.deadline || '',
        status: a.status || 'published',
        uploadedRubricText: a.uploaded_rubric_text || '',
        uploadedRubricName: a.uploaded_rubric_name || '',
        createdAt: a.created_at || new Date().toISOString(),
        classId: a.class_id || currentClassId,
        ideaRequestLimit: 3,
      }));
    recoverStudentActiveClass(currentProfile);
    const allowedAssignmentIds = new Set(state.assignments.map((assignment) => assignment.id));
    state.submissions = state.submissions.filter((submission) => allowedAssignmentIds.has(submission.assignmentId));
    await loadStudentSubmissionsForAssignments(Array.from(allowedAssignmentIds));
    ui.notice = "";
    persistState();
  } catch (error) {
    console.error("Could not load student assignments:", error.message, error);
    ui.notice = "We couldn't load assignments from the server just now.";
  }
}

function mergeStudentSubmission(localSubmission, serverSubmission) {
  const local = localSubmission ? normalizeSubmission(localSubmission) : null;
  const server = normalizeSubmission(serverSubmission);
  if (!local) return server;

  const localUpdatedAt = Date.parse(local.updatedAt || 0) || 0;
  const serverUpdatedAt = Date.parse(server.updatedAt || 0) || 0;
  const localIsNewer = localUpdatedAt >= serverUpdatedAt;
  const prefer = (serverValue, localValue, options = {}) => {
    const { isEmpty = (value) => value === null || value === undefined || value === "" } = options;
    if (localIsNewer && !isEmpty(localValue)) return localValue;
    return isEmpty(serverValue) ? localValue : serverValue;
  };
  const preferArray = (serverValue, localValue) => {
    if (localIsNewer && safeArray(localValue).length) return safeArray(localValue);
    return safeArray(serverValue).length ? safeArray(serverValue) : safeArray(localValue);
  };
  const serverReview = createDefaultTeacherReview(server.teacherReview);
  const localReview = createDefaultTeacherReview(local.teacherReview);
  const serverHasReview = Boolean(
    serverReview.savedAt ||
    serverReview.finalScore !== "" ||
    serverReview.finalNotes ||
    safeArray(serverReview.annotations).length ||
    safeArray(serverReview.rowScores).length
  );
  const localHasReview = Boolean(
    localReview.savedAt ||
    localReview.finalScore !== "" ||
    localReview.finalNotes ||
    safeArray(localReview.annotations).length ||
    safeArray(localReview.rowScores).length
  );
  const mergedTeacherReview = serverHasReview || !localHasReview
    ? createDefaultTeacherReview({
        ...localReview,
        ...serverReview,
        rowScores: safeArray(serverReview.rowScores).length ? serverReview.rowScores : localReview.rowScores,
        suggestedRowScores: safeArray(serverReview.suggestedRowScores).length ? serverReview.suggestedRowScores : localReview.suggestedRowScores,
        annotations: safeArray(serverReview.annotations).length ? serverReview.annotations : localReview.annotations,
      })
    : localReview;
  const reviewedStatus = ["graded", "late", "missing"].includes(server.status) || Boolean(mergedTeacherReview.savedAt)
    ? server.status
    : "";

  return normalizeSubmission({
    ...server,
    id: server.id || local.id,
    assignmentId: server.assignmentId || local.assignmentId,
    studentId: server.studentId || local.studentId,
    draftText: prefer(server.draftText, local.draftText),
    finalText: prefer(server.finalText, local.finalText),
    reflections: {
      improved: prefer(server.reflections?.improved, local.reflections?.improved),
    },
    outline: {
      partOne: prefer(server.outline?.partOne, local.outline?.partOne),
      partTwo: prefer(server.outline?.partTwo, local.outline?.partTwo),
      partThree: prefer(server.outline?.partThree, local.outline?.partThree),
    },
    ideaResponses: preferArray(server.ideaResponses, local.ideaResponses),
    feedbackHistory: preferArray(server.feedbackHistory, local.feedbackHistory),
    writingEvents: preferArray(server.writingEvents, local.writingEvents),
    focusAnnotations: preferArray(server.focusAnnotations, local.focusAnnotations),
    chatHistory: preferArray(server.chatHistory, local.chatHistory),
    selfAssessment: Object.keys(server.selfAssessment || {}).length ? server.selfAssessment : (local.selfAssessment || {}),
    chatStartedAt: prefer(server.chatStartedAt, local.chatStartedAt),
    chatSkippedAt: prefer(server.chatSkippedAt, local.chatSkippedAt),
    chatExpiredAt: prefer(server.chatExpiredAt, local.chatExpiredAt),
    chatElapsedMs: prefer(server.chatElapsedMs, local.chatElapsedMs, { isEmpty: (value) => value === null || value === undefined || Number(value) === 0 }),
    startedAt: prefer(server.startedAt, local.startedAt),
    submittedAt: prefer(server.submittedAt, local.submittedAt),
    status: reviewedStatus || prefer(server.status, local.status, { isEmpty: (value) => !value }),
    teacherReview: mergedTeacherReview,
    updatedAt: localIsNewer ? local.updatedAt : server.updatedAt,
  });
}

function mapServerSubmission(serverSubmission) {
  return {
    id: serverSubmission?.id || `submission-${Date.now()}`,
    assignmentId: serverSubmission?.assignment_id || "",
    studentId: serverSubmission?.student_id || "",
    ideaResponses: Array.isArray(serverSubmission?.idea_responses) ? serverSubmission.idea_responses : [],
    draftText: serverSubmission?.draft_text || "",
    finalText: serverSubmission?.final_text || "",
    finalUnlocked: serverSubmission?.final_unlocked || false,
    reflections: serverSubmission?.reflections || { improved: "" },
    outline: serverSubmission?.outline || {
      partOne: "",
      partTwo: "",
      partThree: "",
    },
    feedbackHistory: Array.isArray(serverSubmission?.feedback_history) ? serverSubmission.feedback_history : [],
    writingEvents: Array.isArray(serverSubmission?.writing_events) ? serverSubmission.writing_events : [],
    focusAnnotations: Array.isArray(serverSubmission?.focus_annotations) ? serverSubmission.focus_annotations : [],
    teacherReview: createDefaultTeacherReview({
      status: serverSubmission?.teacher_review?.status,
      rubricType: serverSubmission?.teacher_review?.rubricType,
      rowScores: serverSubmission?.teacher_review?.rowScores,
      suggestedRowScores: serverSubmission?.teacher_review?.suggestedRowScores,
      suggestedGrade: serverSubmission?.teacher_review?.suggestedGrade,
      finalScore: serverSubmission?.teacher_review?.finalScore,
      finalNotes: serverSubmission?.teacher_review?.finalNotes,
      annotations: serverSubmission?.teacher_review?.annotations,
      savedAt: serverSubmission?.teacher_review?.savedAt,
      acceptedAt: serverSubmission?.teacher_review?.acceptedAt,
    }),
    selfAssessment: serverSubmission?.self_assessment || {},
    chatHistory: Array.isArray(serverSubmission?.chat_history) ? serverSubmission.chat_history : [],
    chatStartedAt: serverSubmission?.chat_started_at || null,
    chatSkippedAt: serverSubmission?.chat_skipped_at || null,
    chatExpiredAt: serverSubmission?.chat_expired_at || null,
    chatElapsedMs: serverSubmission?.chat_elapsed_ms || 0,
    chatResumedAt: null,
    status: serverSubmission?.status || "draft",
    startedAt: serverSubmission?.started_at || null,
    updatedAt: serverSubmission?.updated_at || new Date().toISOString(),
    submittedAt: serverSubmission?.submitted_at || null,
    _studentName: serverSubmission?.profiles?.name || "",
    keystrokeLog: safeArray(serverSubmission?.keystroke_log),
    fluencySummary: serverSubmission?.fluency_summary || {},
  };
}

async function loadTeacherSubmissionsForAssignments(assignmentIds) {
  const ids = Array.isArray(assignmentIds) ? assignmentIds.filter(Boolean) : [];
  if (!currentClassId) return;
  if (!ids.length) {
    state.submissions = [];
    return;
  }

  try {
    const results = await Promise.all(
      ids.map((assignmentId) => Auth.apiFetch(`/api/assignments/${assignmentId}/submissions`))
    );

    const nextSubmissions = [];
    results.forEach((result) => {
      const submissions = Array.isArray(result?.submissions) ? result.submissions : [];
      submissions.forEach((submission) => {
        nextSubmissions.push(mapServerSubmission(submission));
      });
    });

    state.submissions = nextSubmissions;
  } catch (error) {
    console.error("Could not load teacher submissions:", error.message, error);
  }
}

async function loadStudentSubmissionForAssignment(assignmentId) {
  if (!assignmentId) return null;
  const localSubmission = state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === ui.activeUserId) || null;
  try {
    const result = await Auth.apiFetch(`/api/assignments/${assignmentId}/my-submission`);
    if (result?.error || !result?.submission) {
      if (result?.error) {
        ui.notice = "We couldn't refresh your work from the server just now. Showing your saved device copy.";
      }
      return localSubmission;
    }
    const mapped = mapServerSubmission(result.submission);
    const index = state.submissions.findIndex((submission) => submission.assignmentId === mapped.assignmentId && submission.studentId === mapped.studentId);
    if (index >= 0) {
      state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
    } else {
      state.submissions.push(mapped);
    }
    persistState();
    return index >= 0 ? state.submissions[index] : mapped;
  } catch (error) {
    console.error("Could not load student submission:", error.message, error);
    ui.notice = "We couldn't refresh your work from the server just now. Showing your saved device copy.";
    return localSubmission;
  }
}

async function loadStudentSubmissionsForAssignments(assignmentIds) {
  const ids = safeArray(assignmentIds).filter(Boolean);
  if (!ids.length || currentProfile?.role !== "student") return [];

  try {
    const params = new URLSearchParams({ assignmentIds: ids.join(",") });
    const result = await Auth.apiFetch(`/api/student/submissions?${params.toString()}`);
    if (result?.error) {
      throw new Error(result.error);
    }

    const serverSubmissions = safeArray(result?.submissions).map(mapServerSubmission);
    serverSubmissions.forEach((mapped) => {
      const index = state.submissions.findIndex(
        (submission) => submission.assignmentId === mapped.assignmentId && submission.studentId === mapped.studentId
      );
      if (index >= 0) {
        state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
      } else {
        state.submissions.push(mapped);
      }
    });
    persistState();
    return serverSubmissions;
  } catch (error) {
    console.error("Could not load student submissions:", error.message, error);
    return [];
  }
}

function getSubmissionStatusSignature(submissions = state.submissions) {
  return safeArray(submissions)
    .map((submission) => [
      submission?.assignmentId || "",
      submission?.studentId || "",
      submission?.id || "",
      submission?.status || "",
      submission?.submittedAt || "",
      submission?.updatedAt || "",
      submission?.teacherReview?.savedAt || "",
      submission?.teacherReview?.finalScore ?? "",
    ].join(":"))
    .sort()
    .join("|");
}

async function refreshTeacherAssignmentStatusData(options = {}) {
  const { forceRender = false } = options;
  if (
    (currentProfile?.role !== "teacher" && !ui.adminViewingAsTeacher)
    || ui.teacherView !== "assignments"
    || !currentClassId
    || !state.assignments.length
    || document.visibilityState === "hidden"
  ) {
    return false;
  }

  const before = getSubmissionStatusSignature();
  await loadTeacherSubmissionsForAssignments(state.assignments.map((assignment) => assignment.id));
  const after = getSubmissionStatusSignature();
  const changed = before !== after;
  if (changed || forceRender) {
    persistState();
    render();
  }
  return changed;
}

async function loadReviewDataForAssignment(assignmentId) {
  if (!assignmentId || !currentClassId) return [];

  const [membersData, data] = await Promise.all([
    Auth.apiFetch(`/api/classes/${currentClassId}/members`),
    Auth.apiFetch(`/api/assignments/${assignmentId}/submissions`)
  ]);

  currentClassMembers = membersData.members || [];
  const subs = data.submissions || [];

  state.submissions = state.submissions.filter((s) => s.assignmentId !== assignmentId);
  subs.forEach((submission) => {
    state.submissions.push(mapServerSubmission(submission));
  });

  return subs;
}

function stopTeacherReviewPolling() {
  if (reviewRefreshTimer) {
    window.clearInterval(reviewRefreshTimer);
    reviewRefreshTimer = null;
  }
}

function getReviewRefreshSignature(submissions = []) {
  return safeArray(submissions)
    .map((submission) => `${submission?.id || ""}:${submission?.updated_at || submission?.updatedAt || ""}:${submission?.status || ""}:${submission?.teacher_review?.savedAt || submission?.teacherReview?.savedAt || ""}:${submission?.submitted_at || submission?.submittedAt || ""}`)
    .join("|");
}

async function refreshTeacherReviewData() {
  if (
    currentProfile?.role !== "teacher"
    || ui.teacherView !== "review"
    || !ui.selectedAssignmentId
    || document.visibilityState !== "visible"
  ) {
    return;
  }

  const currentSignature = getReviewRefreshSignature(
    state.submissions.filter((submission) => submission.assignmentId === ui.selectedAssignmentId)
  );
  const subs = await loadReviewDataForAssignment(ui.selectedAssignmentId);
  const nextSignature = getReviewRefreshSignature(subs);
  if (currentSignature !== nextSignature) {
    render();
  }
}

function syncTeacherReviewPolling() {
  const shouldPoll =
    currentProfile?.role === "teacher"
    && ui.teacherView === "review"
    && Boolean(ui.selectedAssignmentId);

  if (!shouldPoll) {
    stopTeacherReviewPolling();
    return;
  }

  if (reviewRefreshTimer) {
    return;
  }

  reviewRefreshTimer = window.setInterval(() => {
    refreshTeacherReviewData().catch((error) => {
      console.error("Could not refresh teacher review data:", error);
    });
  }, REVIEW_REFRESH_MS);
}

let keystrokeBuffer = [];
let lastKeystrokeAt = null;
let keystrokeFlushTimer = null;
let autoSaveTimer = null;
let submissionSyncTimer = null;
let submissionSyncInFlight = null;
let queuedSubmissionSyncKey = "";
let queuedSubmissionSyncResolvers = [];
let lifecycleEventsBound = false;
function showAutosaveIndicator(message = "Saved") {
  const indicator = document.getElementById("autosave-indicator");
  if (!indicator) return;
  indicator.textContent = message;
  indicator.style.opacity = "1";
  setTimeout(() => { indicator.style.opacity = "0"; }, 2000);
}

function setDraftSaveMessage(message) {
  ui.draftSaveMessage = message || "";
  const el = document.getElementById("draft-save-status");
  if (el) {
    el.textContent = ui.draftSaveMessage;
  }
}

function getActiveChatElapsedMs(assignment, submission) {
  const timeLimit = isChatDisabled(assignment) ? 0 : Math.max(0, Number(assignment?.chatTimeLimit || 0));
  if (timeLimit <= 0 || !submission?.chatStartedAt) return 0;
  const accumulated = Number(submission?.chatElapsedMs || 0);
  const resumedAt = submission?.chatResumedAt ? Date.parse(submission.chatResumedAt) : null;
  if (!resumedAt || Number.isNaN(resumedAt)) return accumulated;
  return accumulated + Math.max(0, Date.now() - resumedAt);
}

function pauseActiveChatSession() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission?.chatResumedAt || isChatDisabled(assignment)) return;
  const resumedAt = Date.parse(submission.chatResumedAt);
  if (!Number.isNaN(resumedAt)) {
    submission.chatElapsedMs = Number(submission.chatElapsedMs || 0) + Math.max(0, Date.now() - resumedAt);
  }
  submission.chatResumedAt = null;
  submission.updatedAt = new Date().toISOString();
  persistState();
  if (currentProfile?.role === "student") {
    queueSubmissionSync(submission);
  }
}

function resumeActiveChatSession() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission?.chatStartedAt || submission.chatSkippedAt || submission.chatExpiredAt || isChatDisabled(assignment)) return;
  if (!submission.chatResumedAt) {
    submission.chatResumedAt = new Date().toISOString();
    persistState();
  }
}

function bindLifecycleEvents() {
  if (lifecycleEventsBound) return;
  lifecycleEventsBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseActiveChatSession();
      flushCurrentStudentWork({ preferKeepalive: true });
    } else if (ui.role === "student" && ui.studentStep === 1) {
      resumeActiveChatSession();
      render();
    }
  });
  window.addEventListener("pagehide", () => {
    pauseActiveChatSession();
    flushCurrentStudentWork({ preferKeepalive: true });
  });
  window.addEventListener("beforeunload", () => {
    pauseActiveChatSession();
    flushCurrentStudentWork({ preferKeepalive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshTeacherReviewData().catch((error) => {
        console.error("Could not refresh teacher review data:", error);
      });
      refreshTeacherAssignmentStatusData().catch((error) => {
        console.error("Could not refresh teacher assignment statuses:", error);
      });
    }
  });
  window.addEventListener("pageshow", async () => {
    const params = new URLSearchParams(window.location.search);
    const joinClassId = params.get('join');
    const inviteInfo = joinClassId ? await Auth.getInviteInfo(joinClassId) : null;
    const profile = await Auth.restoreSession();
    if (!profile) {
      resetAppShellState();
      renderAuthScreen(joinClassId, inviteInfo);
      return;
    }
    if (!currentProfile || currentProfile.id !== profile.id || currentProfile.role !== profile.role) {
      await bootApp(profile);
    } else {
      refreshTeacherAssignmentStatusData().catch((error) => {
        console.error("Could not refresh teacher assignment statuses:", error);
      });
    }
  });
}

function bindEvents() {
  appEl.addEventListener("click", handleClick);
  appEl.addEventListener("change", handleChange);
  appEl.addEventListener("input", handleInput);
  appEl.addEventListener("scroll", handleScroll, true);
  appEl.addEventListener("paste", handlePaste, true);
  appEl.addEventListener("keydown", handleKeydown);
}

function handleKeydown(event) {
  if (event.target.id === "chat-input" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const btn = document.querySelector("[data-action='send-chat-message']");
    if (btn && !btn.disabled) btn.click();
  }
}

function handleScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const gutterId = target.dataset.lineGutter;
  if (!gutterId) return;
  const gutter = document.getElementById(gutterId);
  if (gutter) {
    gutter.scrollTop = target.scrollTop;
  }
}

let chatTimerInterval = null;

function startChatTimer() {
  if (chatTimerInterval) clearInterval(chatTimerInterval);
  resumeActiveChatSession();
  chatTimerInterval = setInterval(() => {
    const timerEl = document.querySelector(".chat-timer");
    if (!timerEl) { clearInterval(chatTimerInterval); return; }
    const assignment = state.assignments.find(a => a.id === ui.selectedStudentAssignmentId) || null;
    const submission = state.submissions.find(s => s.assignmentId === ui.selectedStudentAssignmentId && s.studentId === currentProfile?.id) || null;
    if (!assignment?.chatTimeLimit || !submission?.chatStartedAt) return;
    const totalSecs = Math.max(0, Math.round((assignment.chatTimeLimit * 60) - getActiveChatElapsedMs(assignment, submission) / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const expired = totalSecs <= 0;
    timerEl.textContent = expired ? "⏱ Time's up" : `⏱ ${mins}:${String(secs).padStart(2,'0')} left`;
    timerEl.className = `chat-timer ${mins <= 5 ? "chat-timer-urgent" : ""}`;
    if (expired) {
      if (!submission.chatExpiredAt) {
        pauseActiveChatSession();
        submission.chatExpiredAt = new Date().toISOString();
        persistState();
        scheduleSubmissionSync(600);
      }
      clearInterval(chatTimerInterval);
      const sendBtn = document.querySelector("[data-action='send-chat-message']");
      const nextBtn = document.querySelector("[data-action='student-next-step']");
      if (sendBtn) sendBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = false;
      render();
    }
  }, 1000);
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  showAutosaveIndicator("Saving...");
  setDraftSaveMessage("Saving…");
  autoSaveTimer = setTimeout(() => {
    const submission = getStudentSubmission();
    if (!submission) return;
    persistState();
    flushCurrentStudentWork().then((saved) => {
      showAutosaveIndicator(saved ? "Saved" : "Saved on this device");
      setDraftSaveMessage(saved ? "Saved just now." : "Saved on this device.");
    });
  }, 2500);
}

function scheduleSubmissionSync(delay = 1800) {
  clearTimeout(submissionSyncTimer);
  submissionSyncTimer = null;
  submissionSyncTimer = setTimeout(() => {
    const submission = getStudentSubmission();
    if (!submission) return;
    persistState();
    queueSubmissionSync(submission);
  }, delay);
}

function getSubmissionSyncKey(submission) {
  if (!submission?.assignmentId || !submission?.studentId) return "";
  return `${submission.assignmentId}:${submission.studentId}`;
}

function getSubmissionBySyncKey(syncKey) {
  if (!syncKey) return null;
  const [assignmentId, studentId] = String(syncKey).split(":");
  if (!assignmentId || !studentId) return null;
  return state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === studentId) || null;
}

async function syncSubmissionToServerWithRetry(submission) {
  const initialTarget = submission || getStudentSubmission();
  if (!initialTarget) return false;

  const delays = [0, 900];
  let saved = false;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
    }
    const latest = getSubmissionBySyncKey(getSubmissionSyncKey(initialTarget)) || initialTarget;
    saved = await syncSubmissionToServer(latest);
    if (saved) return true;
  }
  return false;
}

async function drainSubmissionSyncQueue() {
  if (submissionSyncInFlight) {
    return submissionSyncInFlight;
  }
  if (!queuedSubmissionSyncKey) {
    return false;
  }

  const syncKey = queuedSubmissionSyncKey;
  const resolvers = queuedSubmissionSyncResolvers.splice(0, queuedSubmissionSyncResolvers.length);
  queuedSubmissionSyncKey = "";
  submissionSyncInFlight = syncSubmissionToServerWithRetry(getSubmissionBySyncKey(syncKey))
    .finally(() => {
      submissionSyncInFlight = null;
    });

  const saved = await submissionSyncInFlight;
  resolvers.forEach((resolve) => resolve(saved));

  if (queuedSubmissionSyncKey) {
    return drainSubmissionSyncQueue();
  }

  return saved;
}

function queueSubmissionSync(submission) {
  if (!submission || currentProfile?.role !== "student") {
    return Promise.resolve(false);
  }
  const syncKey = getSubmissionSyncKey(submission);
  if (!syncKey) {
    return Promise.resolve(false);
  }
  queuedSubmissionSyncKey = syncKey;
  return new Promise((resolve) => {
    queuedSubmissionSyncResolvers.push(resolve);
    drainSubmissionSyncQueue().catch((error) => {
      console.error("Could not drain submission sync queue:", error);
      const pendingResolvers = queuedSubmissionSyncResolvers.splice(0, queuedSubmissionSyncResolvers.length);
      pendingResolvers.forEach((pendingResolve) => pendingResolve(false));
    });
  });
}

function flushCurrentStudentWork(options = {}) {
  const submission = getStudentSubmission();
  if (!submission || currentProfile?.role !== "student") {
    return Promise.resolve(false);
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  clearTimeout(submissionSyncTimer);
  submissionSyncTimer = null;
  persistState();
  if (options.preferKeepalive) {
    submission.updatedAt = new Date().toISOString();
  }
  return queueSubmissionSync(submission).then((saved) => {
    setDraftSaveMessage(saved ? "Saved just now." : "Saved on this device.");
    return saved;
  });
}

async function requestAiGenerate(payload, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 1));
  const externalSignal = options.signal || null;
  const timeoutMs = Math.max(8000, Number(options.timeoutMs || 20000));
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const abortHandler = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        window.clearTimeout(timeoutId);
        throw new DOMException("Aborted", "AbortError");
      }
      externalSignal.addEventListener("abort", abortHandler, { once: true });
    }
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Server ${response.status}`);
      }
      if (!String(data?.response || "").trim()) {
        throw new Error("Empty AI response.");
      }
      return data;
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" && externalSignal?.aborted) {
        throw error;
      }
      if (attempt === retries) {
        throw lastError;
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortHandler);
      }
    }
  }

  throw lastError || new Error("AI request failed.");
}

function buildFormatPrompt() {
  const d = ui.teacherDraft;
  const inferredType = detectAssignmentType(d.brief || "");
  const deadlineLine = d.deadline
    ? `- Deadline: ${new Date(d.deadline).toLocaleDateString(undefined, {weekday:"long",day:"numeric",month:"long",year:"numeric"})}. Do not mention this in the student prompt — it is shown separately.`
    : "";
  const rubricSourceText = serializeRubricSchemaForPrompt(d.uploadedRubricSchema, d.uploadedRubricName || "Uploaded rubric")
    || serializeRubricDataForPrompt(d.uploadedRubricData)
    || d.uploadedRubricText;
  const rubricLine = rubricSourceText
    ? `\nTEACHER RUBRIC (use this as the basis for the student rubric — simplify language to CEFR ${d.languageLevel}, preserve the criteria structure and point values where possible, adjust points to total exactly ${d.totalPoints}):\n${rubricSourceText.slice(0, 3000)}`
    : "- No rubric uploaded. Create 4 appropriate rubric criteria for the assignment type.";
  const rubricGuidance = d.uploadedRubricSchema || d.uploadedRubricText
    ? ""
    : ({
        argument: "Prioritise a clear position, relevant support, logical organisation, language control, and mechanics.",
        narrative: "Prioritise story development, sequencing, meaningful detail, language control, and mechanics.",
        process: "Prioritise complete steps, clear sequencing, reader clarity, language control, and mechanics.",
        definition: "Prioritise concept accuracy, explanation, clarifying detail, language control, and mechanics.",
        compare: "Prioritise balanced comparison, meaningful similarities or differences, organisation, language control, and mechanics.",
        informational: "Prioritise content accuracy, supporting detail, organisation, language control, and mechanics.",
        response: "Prioritise answering the task, support, organisation, language control, and mechanics.",
        other: "Tailor the rubric to the specific writing task instead of using generic criterion names.",
      }[inferredType] || "Tailor the rubric to the specific writing task instead of using generic criterion names.");
  const rubricGuidanceLine = (d.uploadedRubricSchema || d.uploadedRubricText) ? "" : `- ${rubricGuidance}`;

  return `Create a student-ready writing assignment based on these teacher notes: "${d.brief}".

Assignment settings:
- Student CEFR level: ${d.languageLevel}. All student-facing text (prompt, rubric descriptions, focus points) must be written at this level.
- Total assignment points: ${d.totalPoints}. Distribute points evenly across criteria where possible (e.g. for 4 criteria and 20 points, use 5/5/5/5). Only use uneven distribution if the uploaded rubric specifies different weights.
- Feedback checks allowed: ${d.feedbackRequestLimit}. Mention this in the student prompt if relevant.
- Chat time limit: ${d.chatTimeLimit === 0 ? "unlimited" : d.chatTimeLimit + " minutes"}.
- The teacher brief most likely fits this assignment type: ${inferredType}. Use that unless the brief strongly points elsewhere.
${deadlineLine}
${rubricLine}

Rules:
- Keep the student prompt short and teacher-like: 2 to 4 short sentences plus one final reminder line at most.
- Choose the assignmentType that best matches the teacher brief. Use one of: argument, narrative, informational, process, definition, compare, response, other.
- If no rubric is uploaded, make the rubric specific to the chosen writing type instead of generic.
- Keep exactly 4 rubric criteria when no rubric is uploaded.
${rubricGuidanceLine}
- Keep rubric criterion names short (2-4 words).
- Rubric descriptions must be one clear sentence a student at CEFR ${d.languageLevel} can understand.
- The student prompt should sound like a clear teacher instruction, not an AI coach.
- Do not use markdown, emojis, or motivational filler.
- Do not explain how to answer the prompt in detail or model the response.
- Do not include lines like "start with" or "then write" unless the teacher explicitly asked for that structure.
- If a deadline exists, mention it briefly as a reminder line: "Deadline: ...".
- If feedback checks are limited, mention them in one short reminder line only.

Respond with ONLY a valid JSON object, no extra text, with these exact keys: "title" (string), "prompt" (string for students), "assignmentType" (one of: argument, narrative, informational, process, definition, compare, response, other), "wordCountMin" (number), "wordCountMax" (number), "studentFocus" (array of 3-4 short strings), "rubric" (array of exactly 4 objects each with "name", "description", "points"), "feedbackRequestLimit" (number), "chatTimeLimit" (number, 0 if unlimited), "disableChatbot" (boolean), "languageLevel" (one of: A0, A1, A2, B1, B2, C1, C2), "totalPoints" (number), "deadlineDate" (string in YYYY-MM-DD format or empty string), "deadlineTime" (string in HH:MM 24-hour format or empty string).`;
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;

if (action === "generate-teacher-assist") {
    if (ui.aiAssistLoading) return;
    // Capture all form values before render wipes them
    const deadlineDateInput = document.getElementById("teacher-deadline-date");
    const deadlineTimeInput = document.getElementById("teacher-deadline-time");
    ui.teacherDraft.deadline = combineDeadlineParts(
      deadlineDateInput ? deadlineDateInput.value : getDeadlineDatePart(ui.teacherDraft.deadline),
      deadlineTimeInput ? deadlineTimeInput.value : getDeadlineTimePart(ui.teacherDraft.deadline)
    );
    const briefInput = document.getElementById("teacher-brief");
    if (briefInput) ui.teacherDraft.brief = briefInput.value;
    const chatLimitInput = document.getElementById("teacher-chat-limit");
    if (chatLimitInput) ui.teacherDraft.chatTimeLimit = Number(chatLimitInput.value);
    const feedbackLimitInput = document.getElementById("teacher-feedback-limit");
    if (feedbackLimitInput) ui.teacherDraft.feedbackRequestLimit = Number(feedbackLimitInput.value);
    const langLevel = document.getElementById("teacher-language-level");
    if (langLevel) ui.teacherDraft.languageLevel = langLevel.value;
    const totalPts = document.getElementById("teacher-total-points");
    if (totalPts) ui.teacherDraft.totalPoints = Number(totalPts.value);
    const inferredSettings = inferTeacherBriefSettings(ui.teacherDraft.brief);
    if (inferredSettings.assignmentType) {
      ui.teacherDraft.assignmentType = inferredSettings.assignmentType;
    }
    if (inferredSettings.languageLevel) {
      ui.teacherDraft.languageLevel = inferredSettings.languageLevel;
    }
    if (Number.isFinite(Number(inferredSettings.feedbackRequestLimit))) {
      ui.teacherDraft.feedbackRequestLimit = Number(inferredSettings.feedbackRequestLimit);
    }
    if (typeof inferredSettings.disableChatbot === "boolean") {
      ui.teacherDraft.disableChatbot = inferredSettings.disableChatbot;
    }
    if (ui.teacherDraft.disableChatbot) {
      ui.teacherDraft.chatTimeLimit = -1;
    } else if (Number.isFinite(Number(inferredSettings.chatTimeLimit)) && Number(inferredSettings.chatTimeLimit) >= 0) {
      ui.teacherDraft.chatTimeLimit = Number(inferredSettings.chatTimeLimit);
    }
    if (Number.isFinite(Number(inferredSettings.totalPoints)) && Number(inferredSettings.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
      ui.teacherDraft.totalPoints = Number(inferredSettings.totalPoints);
    }
    ui.notice = "";
    ui.aiAssistLoading = true;
    teacherAssistAbortController = new AbortController();
    render();

    // Try reaching the API at the same domain (relative path)
    requestAiGenerate({
      prompt: buildFormatPrompt()
    }, {
      signal: teacherAssistAbortController.signal,
      retries: 1,
      timeoutMs: 25000,
    })
    .then(data => {
      let jsonStr = data.response.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      if (ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
        parsed.rubricSchema = ui.teacherDraft.uploadedRubricSchema;
        parsed.rubric = safeArray(parsed.rubricSchema.criteria).map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          description: "",
          points: Number(criterion.maxScore || 0),
          pointsLabel: criterion.minScore !== criterion.maxScore
            ? `${criterion.minScore} – ${criterion.maxScore} points`
            : `${criterion.maxScore} points`,
          levels: safeArray(criterion.levels).map((level) => ({
            id: level.id,
            label: `${level.label} – ${level.score}`,
            points: Number(level.score || 0),
            description: level.description,
          })),
        }));
        parsed.rubricType = "matrix";
      } else {
        parsed.rubric = (parsed.rubric || []).map((item) => {
          const points = Number(item.points) || 1;
          return { id: uid("rubric"), ...item, points, bands: createScoreBandsForPoints(points) };
        });
        // Ensure rubric points add up to totalPoints
        const targetPts = Number(ui.teacherDraft.totalPoints) || 20;
        const currentTotal = parsed.rubric.reduce((s, r) => s + r.points, 0);
        if (currentTotal !== targetPts && parsed.rubric.length > 0) {
          const diff = targetPts - currentTotal;
          parsed.rubric[parsed.rubric.length - 1].points += diff;
          parsed.rubric[parsed.rubric.length - 1].bands = createScoreBandsForPoints(parsed.rubric[parsed.rubric.length - 1].points);
        }
      }
      applyAiSettingsToTeacherDraft(parsed);
      ui.teacherAssist = parsed;
      ui.notice = "Assignment generated successfully!";
      ui.aiAssistLoading = false;
      teacherAssistAbortController = null;
      render();

      requestAnimationFrame(() => {
        const settingsPanel = document.getElementById("teacher-shared-settings");
        if (settingsPanel) {
          settingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    })
    .catch(err => {
      if (err.name === "AbortError") {
        ui.notice = "AI formatting cancelled.";
      } else {
      console.error("Fetch Error:", err);
        ui.notice = "Error: Could not reach the AI. Check console.";
      }
      ui.aiAssistLoading = false;
      teacherAssistAbortController = null;
      render();
    });
  return;
}

  if (action === "cancel-teacher-assist") {
    if (teacherAssistAbortController) {
      teacherAssistAbortController.abort();
    }
    ui.aiAssistLoading = false;
    teacherAssistAbortController = null;
    ui.notice = "AI formatting cancelled.";
    render();
    return;
  }

  if (action === "apply-saved-rubric") {
    const select = document.getElementById("saved-rubric-select");
    applySavedRubricSelection(select?.value);
    return;
  }

  if (action === "add-rubric-row" && ui.teacherAssist) {
    const defaultPts = Math.max(1, Math.floor(ui.teacherDraft.totalPoints / (ui.teacherAssist.rubric.length + 1)));
    ui.teacherAssist.rubric.push({ id: uid("rubric"), name: "", description: "", points: defaultPts, bands: createScoreBandsForPoints(defaultPts) });
    render();
    return;
  }

  if (action === "remove-rubric-row" && ui.teacherAssist) {
    const rubricId = target.dataset.rubricId;
    ui.teacherAssist.rubric = ui.teacherAssist.rubric.filter((r) => r.id !== rubricId);
    render();
    return;
  }

  if (action === "add-annotation") {
    const submission = getSelectedReviewSubmission();
    if (!submission) return;
    const code = target.dataset.code;
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    const annotationText = selectedText || ui.lastAnnotationSelection || "";
    if (!annotationText) {
      alert("Please select some text in the student text box first, then click a code.");
      return;
    }
    let note = "";
    if (code === "NOTE") {
      note = prompt("Add a note for this selection:") || "";
      if (!note) return;
    }
    submission.teacherReview = submission.teacherReview || {};
    submission.teacherReview.annotations = submission.teacherReview.annotations || [];
    submission.teacherReview.annotations.push({ id: uid("ann"), code, selectedText: annotationText, note });
    ui.lastAnnotationSelection = annotationText;
    preserveTeacherTextScroll(() => {
      persistState();
      render();
    });
    return;
  }

  if (action === "remove-annotation") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.annotations) return;
    const index = Number(target.dataset.annotationIndex);
    submission.teacherReview.annotations.splice(index, 1);
    preserveTeacherTextScroll(() => {
      persistState();
      render();
    });
    return;
  }

  if (action === "add-custom-error-code") {
    const code = String(window.prompt("New error code (for example TS or WW)", "") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!code) return;
    const label = String(window.prompt(`Explanation for ${code}`, "") || "").trim();
    if (!label) {
      ui.notice = "Add a short explanation for the new error code.";
      render();
      return;
    }
    const nextCodes = [...loadCustomErrorCodes().filter((entry) => String(entry.code || "").toUpperCase() !== code), { code, label }];
    saveCustomErrorCodes(nextCodes);
    ui.notice = `${code} added to your reusable error codes.`;
    render();
    return;
  }

  if (action === "remove-custom-error-code") {
    const code = String(target.dataset.code || "").trim().toUpperCase();
    if (!code) return;
    saveCustomErrorCodes(loadCustomErrorCodes().filter((entry) => String(entry.code || "").toUpperCase() !== code));
    ui.notice = `${code} removed from your reusable error codes.`;
    render();
    return;
  }

  if (action === "insert-error-code") {
    const code = target.dataset.code;
    const textarea = document.getElementById("teacher-review-notes");
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + " " + code + " " + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + code.length + 2;
    textarea.focus();
    return;
  }

  if (action === "expand-context-col") {
    const col = target.dataset.col;
    ui.expandedContextCol = col || null;
    render();
    if (ui.expandedContextCol) {
      document.querySelector(".context-expanded-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }

  if (action === "save-draft") {
    const submission = getStudentSubmission();
    if (!submission) return;
    const draftEditor = document.getElementById("draft-editor");
    if (draftEditor) {
      submission.draftText = draftEditor.value;
    }
    submission.updatedAt = new Date().toISOString();
    persistState();
    setDraftSaveMessage("Saving…");
    const saved = await flushCurrentStudentWork();
    showAutosaveIndicator(saved ? "Draft saved" : "Saved on this device");
    setDraftSaveMessage(saved ? "Draft saved." : "Saved on this device.");
    ui.notice = saved ? "Draft saved." : "We couldn't save to the server just now, but your draft is still on this device.";
    render();
    return;
  }

if (action === "switch-class") {
    pauseActiveChatSession();
    await flushCurrentStudentWork();
    currentClassId = target.dataset.classId;
    saveActiveClassId(currentProfile, currentClassId);
    ui.selectedStudentAssignmentId = null;
    ui.notice = "";
    hydrateSelections();
    render();
    loadStudentAssignmentsForCurrentClass().then(() => {
      hydrateSelections();
      render();
    });
    return;
  }

  if (action === "open-assignment") {
    pauseActiveChatSession();
    await flushCurrentStudentWork();
    currentClassId = target.dataset.classId;
    saveActiveClassId(currentProfile, currentClassId);
    ui.selectedStudentAssignmentId = target.dataset.assignmentId;
    saveStudentAssignmentId(ui.selectedStudentAssignmentId);
    rememberStudentStep(1, ui.selectedStudentAssignmentId);
    ui.notice = "";
    ensureStudentSubmission();
    render();
    loadStudentAssignmentsForCurrentClass().then(async () => {
      const loaded = await loadStudentSubmissionForAssignment(ui.selectedStudentAssignmentId);
      rememberStudentStep(getStudentStepForSubmission(loaded || getStudentSubmission()), ui.selectedStudentAssignmentId);
      render();
    });
    return;
  }

  if (action === "create-class") {
    ui.showClassModal = true;
    ui.classModalName = "";
    ui.classModalError = "";
    render();
    return;
  }

  if (action === "close-class-modal") {
    ui.showClassModal = false;
    ui.classModalName = "";
    ui.classModalError = "";
    render();
    return;
  }

  if (action === "submit-create-class") {
    const name = ui.classModalName.trim();
    if (!name) {
      ui.classModalError = "Please enter a class name.";
      render();
      return;
    }
    const data = await Auth.apiFetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    if (data.class) {
      currentClasses.unshift(data.class);
      await loadTeacherClassContext(data.class.id);
      hydrateSelections();
      ui.showClassModal = false;
      ui.classModalName = "";
      ui.classModalError = "";
      ui.notice = `New class created: ${name}. You are now working in this class.`;
    } else {
      ui.classModalError = data.error || "Could not create class.";
    }
    render();
    return;
  }

  if (action === "invite-student") {
    if (!currentClassId) { alert("Select a class first."); return; }
    const email = prompt("Student's email address:");
    if (!email) return;
    const data = await Auth.apiFetch(`/api/classes/${currentClassId}/members`, {
      method: 'POST',
      body: JSON.stringify({ studentEmail: email.trim() })
    });
    if (data.ok) {
      ui.notice = "Student added. They can now log in and see published assignments for this class.";
    } else {
      ui.notice = `Could not add student: ${data.error || "unknown error"}`;
    }
    render();
    return;
  }

  if (action === "remove-class-member") {
    if (!currentClassId) return;
    const studentId = target.dataset.studentId;
    const studentName = target.dataset.studentName || "this student";
    if (!studentId || !window.confirm(`Remove ${studentName} from this class?`)) return;
    const data = await Auth.apiFetch(`/api/classes/${currentClassId}/members/${studentId}`, {
      method: "DELETE",
    });
    if (data.ok) {
      await loadTeacherClassContext(currentClassId);
      ui.notice = `${studentName} was removed from this class.`;
    } else {
      ui.notice = `Could not remove student: ${data.error || "unknown error"}`;
    }
    render();
    return;
  }

  if (action === "edit-class-member-name") {
    if (!currentClassId) return;
    const studentId = target.dataset.studentId;
    const currentName = target.dataset.studentName || "Student";
    if (!studentId) return;
    const nextName = window.prompt("Edit student name", currentName);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      ui.notice = "Student name cannot be empty.";
      render();
      return;
    }
    const data = await Auth.apiFetch(`/api/classes/${currentClassId}/members/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: trimmed }),
    });
    if (data?.profile?.name) {
      updateStudentDisplayName(studentId, data.profile.name);
      persistState();
      ui.notice = `Updated student name to ${data.profile.name}.`;
    } else {
      ui.notice = `Could not update student name: ${data?.error || "unknown error"}`;
    }
    render();
    return;
  }

  if (action === "invite-by-email") {
    if (!currentClassId) { alert("Select a class first."); return; }
    const currentClass = currentClasses.find(c => c.id === currentClassId);
    const className = currentClass?.name || "your class";
    const appUrl = window.location.origin;
    const subject = encodeURIComponent(`You have been invited to join ${className} on ${PRODUCT_NAME}`);
    const body = encodeURIComponent(`Hello,\n\nYou have been invited to join ${className} on ${PRODUCT_NAME}.\n\nTo get started:\n1. Go to ${appUrl}\n2. Click "Create account"\n3. Sign up with this email address as a student\n4. Your teacher will then add you to the class\n\nSee you there!`);
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    const copyText = `You have been invited to join ${className} on ${PRODUCT_NAME}.\n\nTo get started:\n1. Go to ${appUrl}\n2. Click "Create account"\n3. Sign up with this email address as a student\n4. Your teacher will then add you to the class`;
   ui.showInvitePanel = true;
    render();
    return;
  }

  if (action === "copy-invite-text") {
    const textarea = document.getElementById("invite-textarea");
    const text = textarea ? textarea.value : "";
    navigator.clipboard.writeText(text).then(() => {
      ui.notice = "Invite message copied to clipboard.";
      ui.showInvitePanel = false;
      render();
    });
    return;
  }

  if (action === "close-invite-panel") {
    ui.showInvitePanel = false;
    render();
    return;
  }

  if (action === "dismiss-paste-warning") {
    ui.pasteWarning = false;
    render();
    return;
  }
  
if (action === "toggle-full-rubric") {
    ui.showFullRubric = !ui.showFullRubric;
    render();
    return;
  }

  if (action === "format-prompt-text") {
    const textarea = document.getElementById(target.dataset.targetId);
    applyPromptFormattingToTextarea(textarea, target.dataset.format);
    if (textarea?.dataset.assistField && ui.teacherAssist) {
      ui.teacherAssist[textarea.dataset.assistField] = textarea.value;
    }
    if (textarea?.dataset.teacherField) {
      ui.teacherDraft[textarea.dataset.teacherField] = textarea.value;
    }
    return;
  }

if (action === "admin-select-teacher") {
    ui.adminSelectedTeacherId = target.dataset.teacherId;
    ui.adminView = "teacher";
    render();
    return;
  }

  if (action === "admin-back-to-teachers") {
    ui.adminSelectedTeacherId = null;
    ui.adminSelectedClassId = null;
    ui.adminView = "teachers";
    render();
    return;
  }

  if (action === "admin-back-to-teacher") {
    ui.adminSelectedClassId = null;
    ui.adminSelectedAssignmentId = null;
    ui.adminView = "teacher";
    render();
    return;
  }

if (action === "admin-select-assignment") {
    ui.adminSelectedAssignmentId = target.dataset.assignmentId;
    render();
    return;
  }

  if (action === "admin-back-to-class") {
    ui.adminSelectedAssignmentId = null;
    render();
    return;
  }
  
  if (action === "admin-select-class") {
    ui.adminSelectedClassId = target.dataset.classId;
    ui.adminSelectedTeacherId = target.dataset.teacherId;
    ui.adminSelectedClassName = target.closest(".assignment-card")?.querySelector("h3")?.textContent || "";
    ui.adminView = "class";
    ui.adminClassDetail = null;
    render();
    Auth.apiFetch(`/api/admin/classes/${ui.adminSelectedClassId}/detail`).then(data => {
      ui.adminClassDetail = data;
      render();
    });
    return;
  }

  if (action === "admin-view-as-teacher") {
    ui.adminViewingAsTeacher = true;
    await bootApp(currentProfile);
    return;
  }

  if (action === "admin-exit-teacher-view") {
    ui.adminViewingAsTeacher = false;
    ui.adminView = "teachers";
    await loadAdminData();
    render();
    return;
  }
  
if (action === "sign-out") {
    if (currentProfile?.role === "student") {
      await flushCurrentStudentWork();
    }
    await Auth.signOut();
    resetAppShellState();
    appEl.innerHTML = '';
    setTimeout(() => renderAuthScreen(), 0);
    return;
  }
  
  if (action === "focus-brief") {
    ui.selectedAssignmentId = null;
    render();
    setTimeout(() => {
      const brief = document.getElementById("teacher-brief");
      if (brief) {
        brief.focus();
        brief.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
    return;
  }

  if (action === "load-demo") {
    ui.notice = "Demo mode is disabled in the pilot build.";
    render();
    return;
  }
    
  if (action === "reset-app") {
    ui.notice = "Workspace reset is disabled in the pilot build.";
    render();
    return;
  }

  if (action === "continue-without-feedback") {
    ui.showDraftFeedbackPrompt = false;
    rememberStudentStep(3);
    ui.notice = "";
    render();
    return;
  }

  if (action === "prompt-request-feedback") {
    ui.showDraftFeedbackPrompt = false;
    handleFeedbackRequest();
    return;
  }

 if (action === "use-generated-assignment" && ui.teacherAssist) {
    applyTeacherAssistToDraft();
    ui.notice = "Generated assignment details copied into the draft.";
    render();
    return;
  }

  if (action === "remove-saved-rubric") {
    const rubricId = target.dataset.rubricId || ui.selectedSavedRubricId;
    if (!rubricId) return;
    removeSavedRubricFromLibrary(rubricId);
    if (ui.selectedSavedRubricId === rubricId) {
      ui.selectedSavedRubricId = "";
    }
    ui.notice = "Saved rubric removed from your reusable library.";
    render();
    return;
  }

  if (action === "clear-saved-rubric-selection") {
    clearUploadedRubric();
    ui.notice = "Saved rubric cleared from this assignment draft.";
    render();
    return;
  }

  if (action === "toggle-assignment-brief") {
    const assignmentId = target.dataset.assignmentId || "";
    ui.expandedAssignmentBriefId = ui.expandedAssignmentBriefId === assignmentId ? null : assignmentId;
    render();
    return;
  }

  if (action === "edit-assignment") {
    const assignmentId = target.dataset.assignmentId;
    const assignment = state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    populateTeacherDraftFromAssignment(assignment);
    ui.notice = "Assignment loaded into the editor. Update the details and save when you are ready.";
    render();
    window.setTimeout(() => {
      document.getElementById("teacher-rubric-upload")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
    return;
  }

  if (action === "cancel-assignment-edit") {
    ui.teacherDraft = createBlankTeacherDraft();
    ui.teacherAssist = null;
    ui.editingAssignmentId = null;
    ui.notice = "Assignment editing cancelled.";
    render();
    return;
  }

 if (action === "save-assignment") {
    await saveTeacherAssignment();
    return;
  }

 if (action === "back-to-assignments") {
    ui.teacherView = "assignments";
    ui.selectedAssignmentId = null;
    ui.selectedReviewSubmissionId = null;
    ui.selectedReviewStudentId = null;
    ui.playback.touched = false;
    render();
    refreshTeacherAssignmentStatusData().catch((error) => {
      console.error("Could not refresh teacher assignment statuses:", error);
    });
    return;
  }

  if (action === "refresh-assignment-statuses") {
    ui.notice = "Refreshing submission statuses...";
    render();
    const changed = await refreshTeacherAssignmentStatusData({ forceRender: true });
    ui.notice = changed ? "Submission statuses refreshed." : "Submission statuses are already up to date.";
    render();
    return;
  }

  if (action === "back-to-review") {
    ui.teacherView = "review";
    ui.selectedReviewSubmissionId = null;
    ui.selectedReviewStudentId = null;
    ui.playback.touched = false;
    render();
    return;
  }

 if (action === "publish-assignment") {
    const assignmentId = target.dataset.assignmentId;
    const assignment = state.assignments.find((a) => a.id === assignmentId);
    if (!assignment) return;
    if (!currentClassId) {
      ui.notice = "Select a class first before publishing.";
      render();
      return;
    }
    const newStatus = assignment.status === "published" ? "draft" : "published";
    ui.notice = newStatus === "published" ? "Publishing assignment..." : "Moving assignment back to draft...";
    render();
    const data = await Auth.apiFetch(`/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    if (data.error) {
      ui.notice = "Could not update assignment: " + data.error;
      render();
      return;
    }
    await loadTeacherClassContext(currentClassId);
    ui.selectedAssignmentId = assignmentId;
    ui.notice = newStatus === "published"
      ? "Assignment published — students in this class can now see it."
      : "Assignment moved back to draft.";
    persistState();
    render();
    return;
  }

if (action === "delete-class") {
    if (!currentClassId) return;
    const className = currentClasses.find(c => c.id === currentClassId)?.name || "this class";
    if (!confirm(`Delete "${className}"? This will permanently delete all assignments and submissions in this class. This cannot be undone.`)) return;
    const result = await Auth.apiFetch(`/api/classes/${currentClassId}`, { method: 'DELETE' });
    if (result.error) {
      ui.notice = `Could not delete class: ${result.error}`;
      render();
      return;
    }
    currentClasses = currentClasses.filter(c => c.id !== currentClassId);
    currentClassId = currentClasses[0]?.id || null;
    if (currentClassId) {
      await loadTeacherClassContext(currentClassId);
    } else {
      state.assignments = [];
      state.submissions = [];
      currentClassMembers = [];
    }
    saveActiveClassId(currentProfile, currentClassId);
    ui.notice = `"${className}" was deleted.`;
    render();
    return;
  }
  
  if (action === "delete-assignment") {
    const assignmentId = target.dataset.assignmentId;
    if (!confirm("Delete this assignment? This cannot be undone.")) return;
    const result = await Auth.apiFetch(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
    if (result.error) {
      ui.notice = `Could not delete assignment: ${result.error}`;
      render();
      return;
    }
    await loadTeacherClassContext(currentClassId);
    if (ui.selectedAssignmentId === assignmentId) ui.selectedAssignmentId = state.assignments[0]?.id || null;
    if (ui.selectedStudentAssignmentId === assignmentId) ui.selectedStudentAssignmentId = null;
    ui.selectedReviewSubmissionId = null;
    ui.notice = "Assignment deleted.";
    persistState();
    render();
    return;
  }

if (action === "select-assignment") {
  stopPlayback();
  ui.selectedAssignmentId = target.dataset.assignmentId;
  ui.selectedReviewSubmissionId = null;
  ui.selectedReviewStudentId = null;
  ui.teacherView = "review";
  ui.notice = "Loading submissions...";
  render();

  loadReviewDataForAssignment(target.dataset.assignmentId).then(subs => {

    const roster = getReviewRoster(ui.selectedAssignmentId);
    ui.selectedReviewStudentId = roster[0]?.id || null;
    ui.selectedReviewSubmissionId = ui.selectedReviewStudentId
      ? getReviewSubmissionForStudent(ui.selectedReviewStudentId, ui.selectedAssignmentId)?.id || null
      : null;

    ui.notice = subs.length
      ? ""
      : (currentClassMembers.length
          ? "No submissions yet for this assignment. You can still open students and mark late or missing."
          : "No submissions yet for this assignment.");
    render();

    requestAnimationFrame(() => {
      const reviewSection = document.getElementById("teacher-review-section");
      if (reviewSection) {
        reviewSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

  });

  return;
}
  if (action === "student-next-step") {
    const nextStep = Number(target.dataset.step);
    if (nextStep === 2) {
      const notes = document.getElementById("chat-skip-notes");
      const submission = getStudentSubmission();
      if (notes && submission) {
        submission.outline.partOne = notes.value.trim();
        submission.updatedAt = new Date().toISOString();
        persistState();
        scheduleSubmissionSync();
      }
    }
    if (nextStep === 3) {
      const assignment = getStudentAssignment();
      const submission = getStudentSubmission();

      if (submission && !submission.finalText?.trim() && submission.draftText?.trim()) {
        submission.finalText = submission.draftText;
        submission.updatedAt = new Date().toISOString();
        persistState();
      }
  
    }
    if (canAdvanceToStep(nextStep)) {
      if (ui.studentStep === 1 && nextStep !== 1) {
        pauseActiveChatSession();
      }
      rememberStudentStep(nextStep);
      ui.notice = "";
    } else {
      render();
    }
    render();
    return;
  }

  if (action === "skip-chat-to-draft") {
    const submission = getStudentSubmission();
    if (!submission) return;
    const notes = document.getElementById("chat-skip-notes");
    pauseActiveChatSession();
    submission.chatSkippedAt = new Date().toISOString();
    if (notes) {
      submission.outline.partOne = notes.value.trim();
    }
    rememberStudentStep(2);
    ui.notice = "You can return to the chat later if you want more idea help.";
    persistState();
    scheduleSubmissionSync();
    render();
    return;
  }

  if (action === "student-prev-step") {
    const targetStep = Number(target.dataset.step);
    if (ui.studentStep === 1 && targetStep !== 1) {
      pauseActiveChatSession();
    }
    if (targetStep === 1) {
      resumeActiveChatSession();
    }
    rememberStudentStep(targetStep);
    ui.notice = "";
    render();
    return;
  }

  if (action === "download-work") {
    const submission = ui.teacherView === "grading" ? getSelectedReviewSubmission() : getStudentSubmission();
    const assignment = ui.teacherView === "grading" ? getSelectedAssignment() : getStudentAssignment();
    if (submission && assignment) downloadStudentWork(assignment, submission);
    return;
  }

  if (action === "copy-lms-grade") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) return;

    const copied = await copyLmsGradeToClipboard(assignment, submission);
    ui.notice = copied ? "Grade copied to clipboard." : "Could not copy grade text. Please try again.";
    render();
    return;
  }

  if (action === "scroll-editor-top" || action === "scroll-editor-bottom") {
    const editor = document.getElementById(target.dataset.target || "");
    if (!editor) return;
    const toBottom = action === "scroll-editor-bottom";
    editor.focus();
    editor.scrollTop = toBottom ? editor.scrollHeight : 0;
    const cursor = toBottom ? editor.value.length : 0;
    if (typeof editor.setSelectionRange === "function") {
      editor.setSelectionRange(cursor, cursor);
    }
    return;
  }

  if (action === "send-chat-message") {
    const submission = getStudentSubmission();
    const assignment = getStudentAssignment();
    if (!submission || !assignment || ui.chatLoading) return;
    if (isChatSessionExpired(assignment, submission)) {
      submission.chatExpiredAt = submission.chatExpiredAt || new Date().toISOString();
      ui.notice = "Your chat time has finished. Move on to your draft when you are ready.";
      persistState();
      scheduleSubmissionSync();
      render();
      return;
    }
    const textarea = document.getElementById("chat-input");
    const text = (textarea ? textarea.value : ui.chatInput).trim();
    if (!text) return;

    // Start timer on first message
    if (!submission.chatStartedAt) {
      submission.chatStartedAt = new Date().toISOString();
      submission.chatElapsedMs = Number(submission.chatElapsedMs || 0);
      submission.chatResumedAt = submission.chatStartedAt;
    } else if (!submission.chatResumedAt) {
      submission.chatResumedAt = new Date().toISOString();
    }

    submission.chatHistory = submission.chatHistory || [];
    submission.chatHistory.push({ role: "user", content: text, timestamp: new Date().toISOString() });
    ui.chatInput = "";
    ui.chatLoading = true;
    persistState();
    scheduleSubmissionSync(25000);
    render();
    focusChatInput();

    // Scroll chat to bottom
    setTimeout(() => {
      const win = document.getElementById("chatbot-window");
      if (win) win.scrollTop = win.scrollHeight;
    }, 50);

    requestAiGenerate({
        system: getChatbotSystemPrompt(assignment),
        messages: submission.chatHistory.map((m) => ({ role: m.role, content: m.content })),
      }, {
        retries: 1,
        timeoutMs: 22000,
      })
      .then((data) => {
        submission.chatHistory.push({ role: "assistant", content: data.response, timestamp: new Date().toISOString() });
        submission.updatedAt = new Date().toISOString();
        ui.chatLoading = false;
        persistState();
        scheduleSubmissionSync(900);
        render();
        focusChatInput();
        setTimeout(() => {
          const win = document.getElementById("chatbot-window");
          if (win) win.scrollTop = win.scrollHeight;
        }, 50);
      })
      .catch((err) => {
        console.error("Chat error:", err);
        submission.chatHistory.push({ role: "assistant", content: "Sorry, I couldn't connect. Please try again.", timestamp: new Date().toISOString() });
        ui.chatLoading = false;
        persistState();
        scheduleSubmissionSync(900);
        render();
        focusChatInput();
      });
    return;
  }

  if (action === "request-ideas") {
    handleIdeaRequest().catch((error) => {
      console.error("Idea help failed:", error);
      ui.notice = "We couldn't prepare idea help just now.";
      render();
    });
    return;
  }

  if (action === "request-feedback") {
    handleFeedbackRequest().catch((error) => {
      console.error("Draft feedback failed:", error);
      ui.notice = "We couldn't check your draft just now.";
      render();
    });
    return;
  }

  if (action === "submit-final") {
    handleSubmission();
    return;
  }

  if (action === "inspect-submission") {
    stopPlayback();
    ui.selectedReviewStudentId = target.dataset.studentId;
    ui.selectedReviewSubmissionId = getReviewSubmissionForStudent(ui.selectedReviewStudentId, ui.selectedAssignmentId)?.id || null;
    ui.teacherView = "grading";
    ui.playback.index = 0;
    ui.playback.touched = false;
    ui.notice = "";
    render();
    return;
  }

  if (action === "next-review-student") {
    const nextStudentId = getNextReviewStudentId(ui.selectedReviewStudentId, ui.selectedAssignmentId);
    if (!nextStudentId) return;
    stopPlayback();
    ui.selectedReviewStudentId = nextStudentId;
    ui.selectedReviewSubmissionId = getReviewSubmissionForStudent(nextStudentId, ui.selectedAssignmentId)?.id || null;
    ui.teacherView = "grading";
    ui.playback.index = 0;
    ui.playback.touched = false;
    ui.notice = "";
    render();
    return;
  }
  
  if (action === "playback-toggle") {
    const submission = getSelectedReviewSubmission();
    const frames = submission ? getPlaybackFrames(submission) : [];
    if (!frames.length) {
      return;
    }
    ui.playback.touched = true;

    if (ui.playback.isPlaying) {
      stopPlayback();
    } else {
      startPlayback(frames);
    }
    render();
    return;
  }

  if (action === "playback-step") {
    const direction = Number(target.dataset.direction);
    ui.playback.touched = true;
    stepPlayback(direction);
    render();
    return;
  }

  if (action === "generate-grade") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) {
      return;
    }

    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    submission.teacherReview.rubricType = getAssignmentRubricType(assignment);
    ui.notice = "Preparing suggested grade...";
    ui.gradeSuggestionLoading = true;
    render();
    requestGradeSuggestionFromAi(assignment, submission)
      .catch((error) => {
        console.error("Falling back to local grade suggestion:", error);
        ui.gradeSuggestionLoading = false;
        return gradeSubmission(assignment, submission);
      })
      .then((suggestedGrade) => {
        submission.teacherReview.suggestedGrade = suggestedGrade;
        submission.teacherReview.suggestedRowScores = safeArray(suggestedGrade?.rowScores);
        ui.notice = "Suggested grading is ready to review.";
        ui.gradeSuggestionLoading = false;
        persistState();
        render();
        window.requestAnimationFrame(() => {
          document.getElementById("suggested-grade-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    return;
  }

  if (action === "use-suggested-comment") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.suggestedGrade?.studentComment) return;
    const textarea = document.getElementById("teacher-review-notes");
    if (textarea) {
      textarea.value = submission.teacherReview.suggestedGrade.studentComment;
      textarea.focus();
    }
    return;
  }
  if (action === "accept-suggested-grade") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview?.suggestedGrade) {
      return;
    }

    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    submission.teacherReview.rowScores = safeArray(submission.teacherReview.suggestedGrade.rowScores).map((entry) => ({ ...entry }));
    submission.teacherReview.finalScore = submission.teacherReview.suggestedGrade.totalScore;
    submission.teacherReview.finalNotes = submission.teacherReview.suggestedGrade.justification;
    submission.teacherReview.status = "graded";
    submission.teacherReview.acceptedAt = new Date().toISOString();
    ui.notice = "Suggested grade copied into the editable review.";
    persistState();
    render();
    window.requestAnimationFrame(() => {
      const submitBtn = document.querySelector('[data-action="save-teacher-review"]');
      if (submitBtn) submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return;
  }

  if (action === "ignore-suggested-grade") {
    const submission = getSelectedReviewSubmission();
    if (!submission?.teacherReview) {
      return;
    }

    submission.teacherReview.suggestedGrade = null;
    gradeSuggestionLoading: false,
    submission.teacherReview.suggestedRowScores = [];
    ui.notice = "Suggested grade cleared.";
    persistState();
    render();
    return;
  }

  if (action === "select-rubric-band") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) {
      return;
    }

    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    submission.teacherReview.rubricType = getAssignmentRubricType(assignment);
    const rubric = safeArray(assignment.rubric).length ? assignment.rubric : rubricForType(assignment.assignmentType);
    const criterion = rubric.find((item) => item.id === target.dataset.criterionId);
    if (!criterion) {
      return;
    }

    const band = getCriterionBands(criterion).find((item) => item.id === target.dataset.bandId);
    if (!band) {
      return;
    }

    const nextEntry = buildTeacherReviewRowScore(criterion, band);
    const remainingRows = safeArray(submission.teacherReview.rowScores).filter((entry) => entry.criterionId !== criterion.id);
    submission.teacherReview.rowScores = [...remainingRows, nextEntry];
    submission.teacherReview.finalScore = calculateTeacherReviewSummary(assignment, submission, submission.teacherReview.rowScores).totalScore;
    persistState();
    render();
    scrollToNextRubricCriterionMobile(criterion.id);
    return;
  }

  if (action === "select-self-assessment-band") {
    const submission = getStudentSubmission();
    const assignment = getStudentAssignment();
    if (!submission || !assignment) return;
    const rubricSchema = assignment.uploadedRubricSchema || assignment.rubricSchema || getRubricSchema(assignment.rubric, assignment.uploadedRubricName || assignment.title);
    const criterion = safeArray(rubricSchema?.criteria).find((item) => item.id === target.dataset.criterionId);
    if (!criterion) return;
    const band = safeArray(criterion.levels).find((item) => item.id === target.dataset.bandId);
    if (!band) return;
    const nextEntry = {
      criterionId: criterion.id,
      criterionName: criterion.name || "Criterion",
      bandId: band.id,
      label: cleanRubricLevelLabel(band.label || `${band.score}`),
      points: Number(band.score ?? band.points ?? 0),
      maxPoints: Number(criterion.maxScore ?? criterion.points ?? 0),
    };
    const remainingRows = safeArray(submission.selfAssessment?.rowScores).filter((entry) => entry.criterionId !== criterion.id);
    submission.selfAssessment = {
      ...(submission.selfAssessment || {}),
      rowScores: [...remainingRows, nextEntry],
    };
    submission.updatedAt = new Date().toISOString();
    persistState();
    scheduleSubmissionSync();
    render();
    scrollToNextRubricCriterionMobile(criterion.id);
    return;
  }

  if (action === "save-teacher-review") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission) {
      return;
    }

    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    const notesInput = document.getElementById("teacher-review-notes");
    const summary = calculateTeacherReviewSummary(assignment, submission);
    submission.teacherReview.rubricType = getAssignmentRubricType(assignment);
    submission.teacherReview.finalScore = summary.totalScore;
    submission.teacherReview.finalNotes = notesInput ? notesInput.value.trim() : "";
    submission.teacherReview.status = submission.teacherReview.status || "graded";
    submission.teacherReview.savedAt = new Date().toISOString();
    const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
    replaceSubmissionInState(savedSubmission);
    ui.selectedReviewSubmissionId = savedSubmission.id;
    ui.notice = "Grade submitted.";
    persistState();
    render();
    return;
  }

  if (action === "set-review-status") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    const nextStatus = target.dataset.status;
    if (!submission || !assignment || !nextStatus) {
      return;
    }

    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    submission.status = nextStatus;
    submission.teacherReview.status = nextStatus;
    submission.updatedAt = new Date().toISOString();

    const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
    replaceSubmissionInState(savedSubmission);
    ui.selectedReviewSubmissionId = savedSubmission.id;
    ui.notice = `Marked ${savedSubmission._studentName || "student"} as ${getSubmissionStatusDisplay(nextStatus).toLowerCase()}.`;
    persistState();
    render();
    return;
  }

  if (action === "add-focus-note") {
    const submission = getStudentSubmission();
    if (!submission || !ui.activeFocusIdeaId) {
      ui.notice = "Choose one of your ideas first, then tag the paragraph you are working on.";
      render();
      return;
    }

    const idea = submission.ideaResponses.find((entry) => entry.id === ui.activeFocusIdeaId);
    submission.focusAnnotations.push({
      id: uid("focus"),
      timestamp: new Date().toISOString(),
      label: idea?.rewrittenIdea?.trim() || "Writing focus",
    });
    ui.notice = "Writing focus saved.";
    persistState();
    scheduleSubmissionSync();
    render();
  }
}

async function handleChange(event) {
  const target = event.target;

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.type === "checkbox" ? target.checked : target.value;
    if (target.dataset.teacherField === "disableChatbot" && target.checked) {
      ui.teacherDraft.chatTimeLimit = -1;
    } else if (target.dataset.teacherField === "disableChatbot" && !target.checked && Number(ui.teacherDraft.chatTimeLimit) < 0) {
      ui.teacherDraft.chatTimeLimit = 0;
    }
    return;
  }

if (target.id === "playback-speed") {
    ui.playback.speed = Number(target.value);
    ui.playback.touched = true;
    if (ui.playback.isPlaying) {
      const submission = getSelectedReviewSubmission();
      const frames = submission ? getPlaybackFrames(submission) : [];
      stopPlayback();
      startPlayback(frames);
    }
    renderPlaybackScreenOnly();
    return;
  }
  
  if (target.dataset.assistField && ui.teacherAssist) {
    ui.teacherAssist[target.dataset.assistField] = target.value;
    return;
  }

if (target.id === "student-class-select") {
    pauseActiveChatSession();
    await flushCurrentStudentWork();
    currentClassId = target.value;
    saveActiveClassId(currentProfile, currentClassId);
    ui.selectedStudentAssignmentId = null;
    ui.notice = "";
    hydrateSelections();
    render();
    loadStudentAssignmentsForCurrentClass().then(async () => {
      hydrateSelections();
      if (ui.selectedStudentAssignmentId) {
        await loadStudentSubmissionForAssignment(ui.selectedStudentAssignmentId);
      }
      render();
    });
    return;
  }

  if (target.id === "class-select") {
    if (target.value === "__delete__") {
      target.value = "";
      if (!currentClassId) return;
      const className = currentClasses.find(c => c.id === currentClassId)?.name || "this class";
      if (!confirm(`Delete "${className}"? This will permanently delete all assignments and submissions in this class. This cannot be undone.`)) return;
      const result = await Auth.apiFetch(`/api/classes/${currentClassId}`, { method: "DELETE" });
      if (result.error) { ui.notice = `Could not delete class: ${result.error}`; render(); return; }
      currentClasses = currentClasses.filter(c => c.id !== currentClassId);
      currentClassId = currentClasses[0]?.id || null;
      if (currentClassId) { await loadTeacherClassContext(currentClassId); } else { state.assignments = []; state.submissions = []; currentClassMembers = []; }
      saveActiveClassId(currentProfile, currentClassId);
      ui.notice = `"${className}" was deleted.`;
      render();
      return;
    }
    if (!target.value) {
      return;
    }
    if (target.value === "__new__") {
      ui.showClassModal = true;
      ui.classModalName = "";
      ui.classModalError = "";
    } else {
      await loadTeacherClassContext(target.value);
      hydrateSelections();
    }
    render();
    return;
  }
  
  if (target.id === "role-select") {
    const newRole = target.value;
    if (newRole === "teacher") {
      const entered = prompt("Enter teacher PIN to continue (default: 1234):");
      if (entered !== "1234") {
        ui.notice = "Incorrect PIN.";
        render();
        return;
      }
    }
    stopPlayback();
    ui.role = newRole;
    ui.activeUserId = ui.role === "teacher" ? "teacher-1" : getStudentUsers()[0]?.id || "";
    hydrateSelections();
    render();
    return;
  }

  if (target.id === "user-select") {
    ui.activeUserId = target.value;
    hydrateSelections();
    render();
    return;
  }

  if (target.id === "student-assignment-select") {
    await flushCurrentStudentWork();
    ui.selectedStudentAssignmentId = target.value;
    saveStudentAssignmentId(ui.selectedStudentAssignmentId);
    rememberStudentStep(1, ui.selectedStudentAssignmentId);
    ui.notice = "";
    ensureStudentSubmission();
    const loaded = await loadStudentSubmissionForAssignment(target.value);
    rememberStudentStep(getStudentStepForSubmission(loaded || getStudentSubmission()), ui.selectedStudentAssignmentId);
    render();
    return;
  }

  if (target.id === "review-submission-select") {
    stopPlayback();
    ui.selectedReviewSubmissionId = target.value;
    ui.playback.index = 0;
    ui.playback.touched = false;
    render();
    return;
  }

  if (target.id === "saved-rubric-select") {
    if (!target.value) {
      ui.selectedSavedRubricId = "";
      render();
      return;
    }
    applySavedRubricSelection(target.value);
    return;
  }

  if (target.id === "playback-speed") {
    ui.playback.speed = Number(target.value);
    ui.playback.touched = true;
    if (ui.playback.isPlaying) {
      const submission = getSelectedReviewSubmission();
      const frames = submission ? getPlaybackFrames(submission) : [];
      stopPlayback();
      startPlayback(frames);
    }
    renderPlaybackScreenOnly();
    return;
  }

  if (target.id === "playback-slider") {
    ui.playback.index = Number(target.value);
    ui.playback.touched = true;
    renderPlaybackScreenOnly();
    return;
  }

  if (target.id === "focus-idea-select") {
    ui.activeFocusIdeaId = target.value;
    return;
  }
}

function handleInput(event) {
  const target = event.target;

  if (target.id === "chat-input") {
    ui.chatInput = target.value;
    return;
  }

  if (target.dataset.teacherField) {
    ui.teacherDraft[target.dataset.teacherField] = target.value;
    return;
  }

  if (target.dataset.assistField && ui.teacherAssist) {
    if (target.dataset.assistField === "studentFocusText") {
      ui.teacherAssist.studentFocus = target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      ui.teacherAssist[target.dataset.assistField] = target.type === "number" ? Number(target.value) : target.value;
    }
    return;
  }

  if (target.dataset.rubricId && target.dataset.rubricField && ui.teacherAssist) {
    const item = ui.teacherAssist.rubric.find((r) => r.id === target.dataset.rubricId);
    if (item) {
      item[target.dataset.rubricField] = target.type === "number" ? Number(target.value) : target.value;
      if (target.dataset.rubricField === "points") {
        item.bands = createScoreBandsForPoints(item.points);
      }
    }
    return;
  }

  if (target.dataset.ideaField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    const idea = submission.ideaResponses.find((entry) => entry.id === target.dataset.ideaId);
    if (!idea) {
      return;
    }

    idea[target.dataset.ideaField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    scheduleAutoSave();
    return;
  }

      if (target.id.endsWith("-deadline-date") || target.id.endsWith("-deadline-time")) {
    const prefix = target.id.startsWith("manual-") ? "manual" : "teacher";
    const dateInput = document.getElementById(`${prefix}-deadline-date`);
    const timeInput = document.getElementById(`${prefix}-deadline-time`);
    ui.teacherDraft.deadline = combineDeadlineParts(
      dateInput ? dateInput.value : "",
      timeInput ? timeInput.value : "09:00"
    );
    return;
  }
  
  if (target.id === "draft-editor") {
    updateDraftSubmission(target.value);
    updateDraftMeters();
    // Use setTimeout to ensure pasted content is in the DOM before measuring
    setTimeout(() => refreshLineNumberGutterForElement(target), 0);
    scheduleAutoSave();
    return;
  }

  if (target.id === "final-editor") {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    if (!submission.finalUnlocked) submission.finalUnlocked = true;
    
    submission.finalText = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    scheduleSubmissionSync();
    setTimeout(() => refreshLineNumberGutterForElement(target), 0);
    scheduleAutoSave();
    updateFinalMeters();
    return;
  }

  if (target.dataset.saKey) {
    const submission = getStudentSubmission();
    if (!submission) return;
    submission.selfAssessment = submission.selfAssessment || {};
    submission.selfAssessment[target.dataset.saKey] = target.value;
    submission.updatedAt = new Date().toISOString();
    // Update visual selection without full re-render
    document.querySelectorAll(`[name="${target.dataset.saKey}"]`).forEach(el => {
      el.closest(".sa-option").classList.toggle("sa-selected", el === target);
    });
    persistState();
    scheduleAutoSave();
    return;
  }
  if (target.dataset.reflectionField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    submission.reflections[target.dataset.reflectionField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    scheduleAutoSave();
    return;
  }

  if (target.dataset.outlineField) {
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    submission.outline[target.dataset.outlineField] = target.value;
    submission.updatedAt = new Date().toISOString();
    persistState();
    scheduleAutoSave();
    return;
  }
}

function handlePaste(event) {
  if (event.target.id !== "draft-editor" && event.target.id !== "final-editor") {
    return;
  }

  const pasted = event.clipboardData?.getData("text") || "";
  ui.pendingPaste = {
    content: pasted,
    timestamp: Date.now(),
  };

  if (pasted.length >= 10) {
    setTimeout(() => {
      ui.pasteWarning = true;
      render();
      const editor = document.getElementById(event.target.id);
      if (editor) editor.focus();
    }, 100);
  }
}

function render() {
  document.title = PRODUCT_NAME;
  if (!currentProfile || !Auth.getToken() || !Auth.getProfile()) {
    stopTeacherReviewPolling();
    resetAppShellState();
    const params = new URLSearchParams(window.location.search);
    renderAuthScreen(params.get("join"));
    return;
  }
  if (ui.role === "student") {
    hydrateSelections();
  }

  appEl.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${ui.notice ? `<div class="notice">${escapeHtml(ui.notice)}</div>` : ""}
      ${ui.role === "admin" && !ui.adminViewingAsTeacher ? renderAdminWorkspace() : ui.role === "teacher" || ui.adminViewingAsTeacher ? renderTeacherWorkspace() : renderStudentWorkspace()}
    </div>
  ` + renderInvitePanel() + renderPasteWarning() + renderClassModal() + renderDraftFeedbackModal();

  // Start chat timer if student is on step 1 and there's a time limit
  if (ui.role === "student" && ui.studentStep === 1) {
    const assignment = getStudentAssignment();
    const submission = getStudentSubmission();
    if (assignment?.chatTimeLimit > 0 && submission?.chatStartedAt) {
      startChatTimer();
    }
    window.requestAnimationFrame(() => {
      const win = document.getElementById("chatbot-window");
      if (win) {
        win.scrollTop = win.scrollHeight;
      }
    });
  }

  window.requestAnimationFrame(() => {
    refreshAllLineNumberGutters();
  });

  window.requestAnimationFrame(() => {
    ["draft-editor", "final-editor"].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.keystrokeListenerAttached) return;
      el.addEventListener("keydown", () => {
        recordKeystrokeInterval();
        scheduleKeystrokeFlush();
      });
      el.dataset.keystrokeListenerAttached = "true";
    });
  });

  syncTeacherReviewPolling();
}

function setAuthTab(tab) {
  const signinForm = document.getElementById("auth-signin-form");
  const signupForm = document.getElementById("auth-signup-form");
  const signinTab = document.getElementById("auth-tab-signin");
  const signupTab = document.getElementById("auth-tab-signup");
  if (!signinForm || !signupForm || !signinTab || !signupTab) return;
  signinForm.style.display = tab === "signin" ? "block" : "none";
  signupForm.style.display = tab === "signup" ? "block" : "none";
  signinTab.style.background = tab === "signin" ? "#fff" : "#eef4ff";
  signinTab.style.color = tab === "signin" ? "var(--accent)" : "#667063";
  signupTab.style.background = tab === "signup" ? "#fff" : "#eef4ff";
  signupTab.style.color = tab === "signup" ? "var(--accent)" : "#667063";
}

function setAuthSignupRole(role) {
  authUiState.signupRole = role === "teacher" ? "teacher" : "student";
  const studentButton = document.getElementById("role-btn-student");
  const teacherButton = document.getElementById("role-btn-teacher");
  if (studentButton) {
    studentButton.style.border = authUiState.signupRole === "student" ? "2px solid var(--accent)" : "1px solid var(--line)";
    studentButton.style.background = authUiState.signupRole === "student" ? "#e7eeff" : "#fff";
    studentButton.style.color = authUiState.signupRole === "student" ? "var(--accent-deep)" : "#667063";
  }
  if (teacherButton) {
    teacherButton.style.border = authUiState.signupRole === "teacher" ? "2px solid var(--accent)" : "1px solid var(--line)";
    teacherButton.style.background = authUiState.signupRole === "teacher" ? "#e7eeff" : "#fff";
    teacherButton.style.color = authUiState.signupRole === "teacher" ? "var(--accent-deep)" : "#667063";
  }
}

function bindAuthScreenEvents(joinClassId = null) {
  authUiState.signupRole = "student";
  setAuthTab("signin");
  setAuthSignupRole("student");

  appEl.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
  });

  appEl.querySelectorAll("[data-auth-role]").forEach((button) => {
    button.addEventListener("click", () => setAuthSignupRole(button.dataset.authRole));
  });

  appEl.querySelector("[data-auth-action='signin']")?.addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const errEl = document.getElementById("auth-error");
    errEl.style.display = "none";
    try {
      const stayLoggedIn = document.getElementById("stay-logged-in")?.checked !== false;
      const profile = await Auth.signIn(email, password, stayLoggedIn);
      await Auth.joinClassIfInvited();
      await bootApp(profile);
    } catch (error) {
      errEl.textContent = error.message;
      errEl.style.display = "block";
    }
  });

  appEl.querySelector("[data-auth-action='forgot-password']")?.addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    const errEl = document.getElementById("auth-error");
    errEl.style.display = "none";
    if (!email) {
      errEl.textContent = "Enter your email first, then click forgot password.";
      errEl.style.display = "block";
      errEl.style.color = "var(--danger)";
      return;
    }
    try {
      await Auth.requestPasswordReset(email);
      errEl.textContent = "Password reset email sent. Check your inbox.";
      errEl.style.display = "block";
      errEl.style.color = "var(--sage)";
    } catch (error) {
      errEl.textContent = error.message;
      errEl.style.display = "block";
      errEl.style.color = "var(--danger)";
    }
  });

  appEl.querySelector("[data-auth-action='signup']")?.addEventListener("click", async () => {
    const name = document.getElementById("auth-signup-name").value.trim();
    const email = document.getElementById("auth-signup-email").value.trim();
    const password = document.getElementById("auth-signup-password").value;
    const errEl = document.getElementById("auth-signup-error");
    errEl.style.display = "none";
    if (!name || !email || !password) {
      errEl.textContent = "Please fill in all fields.";
      errEl.style.display = "block";
      return;
    }
    try {
      const profile = await Auth.signUp(email, password, name, joinClassId ? "student" : authUiState.signupRole);
      await Auth.joinClassIfInvited();
      await bootApp(profile);
    } catch (error) {
      errEl.textContent = error.message;
      errEl.style.display = "block";
    }
  });
}

function renderAuthScreen(joinClassId = null, inviteInfo = null) {
  stopTeacherReviewPolling();
  document.title = PRODUCT_NAME;
  const teacherName = inviteInfo?.teacherName || "";
  const className = inviteInfo?.className || "";
  const inviteBanner = joinClassId ? `
    <div style="background:#edf4ea;border:1px solid #cbddc6;border-radius:12px;padding:14px 16px;margin-bottom:20px;color:#2e5c28;line-height:1.55;">
      <strong style="display:block;margin-bottom:4px;">You've been invited to join a class</strong>
      ${teacherName && className
        ? `You have been invited to join <strong>${escapeHtml(teacherName)}'s ${escapeHtml(className)}</strong> class.`
        : "Sign in or create a student account to join."}
      <span style="display:block;margin-top:6px;font-size:0.88rem;">Sign in or create a student account below to join automatically.</span>
    </div>
  ` : "";
  appEl.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:20px;">
      <div style="width:100%;max-width:400px;background:rgba(255,255,255,0.92);border:1px solid rgba(217,227,240,0.92);border-radius:20px;padding:32px;box-shadow:0 18px 42px rgba(21,39,74,0.10);backdrop-filter:blur(16px);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div class="brand-mark brand-mark-auth">${renderBrandGlyph()}</div>
          <div>
            ${renderProductWordmark("h1", "brand-wordmark auth-wordmark")}
            <p style="margin:0;color:#667063;font-size:0.85rem;">${escapeHtml(PRODUCT_TAGLINE)}</p>
          </div>
        </div>
        ${inviteBanner}
        <div style="display:flex;gap:0;margin-bottom:24px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#eef4ff;">
          <button id="auth-tab-signin" data-auth-tab="signin" style="flex:1;padding:10px;border:none;background:#fff;font-weight:700;cursor:pointer;color:var(--accent);">Sign in</button>
          <button id="auth-tab-signup" data-auth-tab="signup" style="flex:1;padding:10px;border:none;background:#eef4ff;font-weight:700;cursor:pointer;color:#667063;">Create account</button>
        </div>
        <div id="auth-signin-form">
          <div style="display:grid;gap:12px;">
            <input id="auth-email" type="email" placeholder="Email" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-password" type="password" placeholder="Password" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--muted);cursor:pointer;">
              <input type="checkbox" id="stay-logged-in" checked style="cursor:pointer;" /> Stay logged in
            </label>
            <button type="button" data-auth-action="forgot-password" style="background:none;border:none;padding:0;text-align:left;color:var(--accent);font-weight:600;cursor:pointer;">Forgot password?</button>
            <button type="button" data-auth-action="signin" style="background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:white;border:none;border-radius:999px;padding:12px 24px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 10px 24px rgba(63,109,246,0.24);">Sign in</button>
            <p id="auth-error" style="color:#b34949;font-size:0.85rem;margin:0;display:none;"></p>
          </div>
        </div>
        <div id="auth-signup-form" style="display:none;">
          <div style="display:grid;gap:12px;">
            <input id="auth-signup-name" type="text" placeholder="Full name" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-signup-email" type="email" placeholder="Email" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <input id="auth-signup-password" type="password" placeholder="Password (min 6 characters)" style="border:1px solid #ddd2c2;border-radius:10px;padding:12px 14px;width:100%;font:inherit;box-sizing:border-box;" />
            <div style="display:flex;gap:8px;">
              <button type="button" data-auth-role="student" id="role-btn-student" style="flex:1;padding:10px;border:2px solid var(--accent);border-radius:10px;background:#e7eeff;font:inherit;font-weight:700;cursor:pointer;color:var(--accent-deep);">Student</button>
              ${!joinClassId ? `<button type="button" data-auth-role="teacher" id="role-btn-teacher" style="flex:1;padding:10px;border:1px solid #ddd2c2;border-radius:10px;background:#fff;font:inherit;font-weight:700;cursor:pointer;color:#667063;">Teacher</button>` : ''}
              </div>
            <button type="button" data-auth-action="signup" style="background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:white;border:none;border-radius:999px;padding:12px 24px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 10px 24px rgba(63,109,246,0.24);">Create account</button>
            <p id="auth-signup-error" style="color:#b34949;font-size:0.85rem;margin:0;display:none;"></p>
          </div>
        </div>
      </div>
    </div>
  `;
  bindAuthScreenEvents(joinClassId);
}

function renderResetPasswordScreen() {
  stopTeacherReviewPolling();
  document.title = `${PRODUCT_NAME} · Reset password`;
  appEl.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:20px;">
      <div style="width:100%;max-width:400px;background:rgba(255,255,255,0.92);border:1px solid rgba(217,227,240,0.92);border-radius:20px;padding:32px;box-shadow:0 18px 42px rgba(21,39,74,0.10);backdrop-filter:blur(16px);">
        <h1 style="margin:0 0 8px;font-family:'Manrope','Avenir Next','Segoe UI',sans-serif;font-size:1.35rem;letter-spacing:-0.03em;">Reset your password</h1>
        <p class="subtle" style="margin:0 0 16px;">Choose a new password for your ${PRODUCT_NAME} account.</p>
        <div class="field-stack">
          <div class="field">
            <label for="reset-password-input">New password</label>
            <input id="reset-password-input" type="password" placeholder="At least 6 characters" />
          </div>
          <div class="field">
            <label for="reset-password-confirm">Confirm password</label>
            <input id="reset-password-confirm" type="password" placeholder="Repeat your new password" />
          </div>
          <p id="reset-password-error" style="display:none;margin:0;font-size:0.88rem;"></p>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="button-ghost" type="button" data-reset-action="cancel">Cancel</button>
            <button class="button" type="button" data-reset-action="save">Save new password</button>
          </div>
        </div>
      </div>
    </div>
  `;
  appEl.querySelector("[data-reset-action='cancel']")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  appEl.querySelector("[data-reset-action='save']")?.addEventListener("click", async () => {
    const password = document.getElementById('reset-password-input').value;
    const confirm = document.getElementById('reset-password-confirm').value;
    const errEl = document.getElementById('reset-password-error');
    errEl.style.display = 'none';
    if (!password || password.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters.';
      errEl.style.display = 'block';
      errEl.style.color = 'var(--danger)';
      return;
    }
    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match.';
      errEl.style.display = 'block';
      errEl.style.color = 'var(--danger)';
      return;
    }
    try {
      await Auth.updatePassword(password);
      errEl.textContent = 'Password updated. You can sign in now.';
      errEl.style.display = 'block';
      errEl.style.color = 'var(--sage)';
      setTimeout(() => {
        window.history.replaceState({}, '', '/');
        renderAuthScreen();
      }, 800);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      errEl.style.color = 'var(--danger)';
    }
  });
}

window.handleRubricDrop = async (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) await uploadRubricFile(file);
  document.getElementById('rubric-drop-zone').style.borderColor = 'var(--line)';
};

window.handleRubricFile = async (file) => {
  if (file) await uploadRubricFile(file);
};

window.clearUploadedRubric = () => {
  ui.teacherDraft.uploadedRubricText = '';
  ui.teacherDraft.uploadedRubricName = '';
  ui.teacherDraft.uploadedRubricData = null;
  ui.teacherDraft.uploadedRubricSchema = null;
  ui.selectedSavedRubricId = "";
  ui.teacherAssist = null;
  render();
};

async function uploadRubricFile(file) {
  const dropZone = document.getElementById('rubric-drop-zone');
  if (dropZone) dropZone.innerHTML = '<p style="color:var(--muted);margin:0;">Extracting text...</p>';
  try {
    const formData = new FormData();
    formData.append('rubric', file);
    const res = await fetch('/api/rubric/parse', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Auth.getToken()}` },
      body: formData
    });
    const data = await res.json();
    if (data.error || data.success === false) {
      ui.notice = `Could not read rubric: ${data.error}`;
    } else {
      ui.teacherDraft.uploadedRubricText = data.text;
      ui.teacherDraft.uploadedRubricName = file.name;
      ui.teacherDraft.uploadedRubricData = data.rubricData || null;
      ui.teacherDraft.uploadedRubricSchema = data.schema || null;
      ui.selectedSavedRubricId = "";
      ui.teacherAssist = null;
      saveRubricToLibrary(file.name, data.text, data.rubricData || null, data.schema || null);
      ui.notice = `Rubric "${file.name}" loaded and saved for reuse. Click Format With AI to rebuild the assignment with it.`;
    }
  } catch (e) {
    ui.notice = 'Could not read the rubric file. Try a different format.';
  }
  render();
}

function renderPasteWarning() {
  if (!ui.pasteWarning) return "";
  return `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:999;display:grid;place-items:center;padding:20px;">
      <div style="background:#fffdf9;border-radius:18px;padding:28px;max-width:440px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.2);">
        <div style="font-size:2rem;margin-bottom:10px;">⚠️</div>
        <h3 style="margin:0 0 10px;color:var(--danger);">Paste detected</h3>
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

function renderWritingHeatmap(submission) {
  const events = (submission?.writingEvents || []);
  if (!events.length) return `<p class="subtle">No writing events recorded yet.</p>`;

  // Group events by day and hour
  const buckets = {};
  for (const e of events) {
    const d = new Date(e.timestamp);
    const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const hour = d.getHours();
    const key = `${day}__${hour}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }

  const days = [...new Set(Object.keys(buckets).map(k => k.split("__")[0]))];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const maxCount = Math.max(...Object.values(buckets), 1);

  const hourLabel = (h) => h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;

  return `
    <div style="overflow-x:auto;">
      <div style="display:grid;grid-template-columns:60px repeat(${days.length}, 1fr);gap:3px;min-width:${60 + days.length * 36}px;">
        <div></div>
        ${days.map(d => `<div style="font-size:0.7rem;color:var(--muted);text-align:center;padding-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${d}">${d.split(" ")[0]}<br>${d.split(" ").slice(1).join(" ")}</div>`).join("")}
        ${hours.map(h => `
          <div style="font-size:0.65rem;color:var(--muted);text-align:right;padding-right:6px;line-height:24px;">${h % 3 === 0 ? hourLabel(h) : ""}</div>
          ${days.map(d => {
            const count = buckets[`${d}__${h}`] || 0;
            const intensity = count === 0 ? 0 : Math.max(0.12, count / maxCount);
            const bg = count === 0
              ? "#eef3fb"
              : `rgba(95,143,255,${intensity})`;
            return `<div title="${count} edit${count !== 1 ? "s" : ""} — ${hourLabel(h)} on ${d}" style="height:24px;border-radius:4px;background:${bg};"></div>`;
          }).join("")}
        `).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.75rem;color:var(--muted);">
        <span>Less</span>
        ${[0.12, 0.35, 0.6, 0.85, 1].map(v => `<div style="width:14px;height:14px;border-radius:3px;background:rgba(95,143,255,${v});"></div>`).join("")}
        <span>More</span>
        <span style="margin-left:12px;">${events.length} total edits across ${days.length} day${days.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  `;
}

function renderInvitePanel() {
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
  if (!ui.showDraftFeedbackPrompt) return "";
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  const used = Number(submission?.feedbackHistory?.length || 0);
  const limit = Number(assignment?.feedbackRequestLimit || 0);
  return `
    <div style="position:fixed;inset:0;background:rgba(10,18,33,0.38);z-index:1000;display:grid;place-items:center;padding:20px;">
      <div style="background:rgba(255,255,255,0.96);border:1px solid var(--line);border-radius:20px;padding:28px;max-width:520px;width:100%;box-shadow:0 20px 50px rgba(21,39,74,0.16);backdrop-filter:blur(16px);">
        <p class="mini-label" style="margin-bottom:6px;">Before you finish</p>
        <h3 style="margin:0 0 8px;">Do you want AI draft feedback first?</h3>
        <p class="subtle" style="margin:0 0 16px;">You still have ${Math.max(0, limit - used)} of ${limit} draft feedback check${limit === 1 ? "" : "s"} available. AI feedback can point out places to improve before you move to the final step.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="button-ghost" data-action="continue-without-feedback">No, continue</button>
          <button class="button-secondary" data-action="prompt-request-feedback">Yes, get AI feedback</button>
        </div>
      </div>
    </div>
  `;
}

function renderTopbar() {
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
       ${ui.role === "teacher" || ui.adminViewingAsTeacher ? `
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
        ${ui.adminViewingAsTeacher ? `<button class="button-ghost" data-action="admin-exit-teacher-view" style="color:var(--accent-deep);">← Back to admin</button>` : ""}
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

function renderAdminWorkspace() {
  if (ui.adminViewingAsTeacher) return renderTeacherWorkspace();

  if (ui.adminView === "class" && ui.adminSelectedClassId) {
    return renderAdminClassDetail();
  }

  if (ui.adminView === "teacher" && ui.adminSelectedTeacherId) {
    return renderAdminTeacherDetail();
  }

  return renderAdminTeacherList();
}

function renderAdminTeacherList() {
  const teachers = ui.adminTeachers || [];
  return `
    <section class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h2 style="margin:0;">Admin — All Teachers</h2>
        <button class="button-secondary" data-action="admin-view-as-teacher">Switch to my teacher view</button>
      </div>
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

function renderAdminClassDetail() {
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
              ${(detail.members || []).map(member => {
                const sub = subs.find(s => s.student_id === member.id);
                const review = sub?.teacher_review;
                const rowScores = review?.rowScores || [];
                const finalScore = review?.finalScore ?? "";
                const status = sub?.status || "not started";
                const wordCount = sub?.final_text?.trim()
                  ? sub.final_text.trim().split(/\s+/).length
                  : sub?.draft_text?.trim()
                    ? sub.draft_text.trim().split(/\s+/).length
                    : 0;
                const pasteFlags = (sub?.writing_events || []).filter(e => e.flagged).length;
                const statusColour = status === "submitted" ? "var(--sage)" : status === "not started" ? "var(--muted)" : "var(--accent)";

                return `
                  <div style="border:1px solid var(--line);border-radius:14px;padding:16px;background:#fff;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                      <div>
                        <strong style="display:block;margin-bottom:4px;">${escapeHtml(member.name)}</strong>
                        <span style="font-size:0.82rem;color:${statusColour};">${escapeHtml(status)}</span>
                      </div>
                      <div style="text-align:right;flex-shrink:0;">
                        ${finalScore !== "" ? `<div style="font-size:1.4rem;font-weight:800;color:var(--accent-deep);">${escapeHtml(String(finalScore))}</div><div style="font-size:0.75rem;color:var(--muted);">score</div>` : `<div style="font-size:0.85rem;color:var(--muted);">Not graded</div>`}
                      </div>
                    </div>

                    ${sub ? `
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
                        ${renderFluencyCard(sub)}
                      </div>
                    ` : `<p class="subtle" style="margin-top:8px;font-size:0.85rem;">No work started yet.</p>`}
                  </div>
                `;
              }).join("")}
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
          : detail.members.map(m => {
              const studentSubs = (detail.submissions || []).filter(s => s.student_id === m.id);
              const submitted = studentSubs.filter((submission) => SubmissionUtils.isSubmissionSubmitted(submission)).length;
              const graded = studentSubs.filter((submission) => SubmissionUtils.isSubmissionGraded(submission)).length;
              const totalScore = studentSubs.reduce((sum, s) => sum + Number(s.teacher_review?.finalScore || 0), 0);
              return `
                <div class="submission-card simple-card" style="margin-bottom:6px;">
                  <div class="card-top" style="flex-wrap:wrap;gap:10px;">
                    <h3 style="margin:0;flex:1;">${escapeHtml(m.name)}</h3>
                    <div class="pill-row">
                      <span class="pill">${submitted} submitted</span>
                      ${graded ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ ${graded} graded · ${totalScore} pts total</span>` : ""}
                    </div>
                  </div>
                  ${studentSubs.length ? `
                    <div style="margin-top:10px;display:grid;gap:8px;">
                      ${studentSubs.map(sub => {
                        const a = (detail.assignments || []).find(a => a.id === sub.assignment_id);
                        return renderFluencyCard(sub, a?.title || "Assignment");
                      }).join("")}
                    </div>
                  ` : ""}
                </div>
              `;
            }).join("")
        }
      </div>
    </section>
  `;
}

function renderTeacherWorkspace() {
  const assignments = state.assignments;
  const classRoster = currentClassMembers.filter((member) => member?.id !== currentProfile?.id);
  const selectedAssignment = state.assignments.find(a => a.id === ui.selectedAssignmentId) || null;
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
  const renderAssignmentSettingsFields = (idPrefix) => `
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
        ${(() => {
  const step = ui.teacherAssist ? 3 : (ui.teacherDraft.brief ? 2 : 1);
  const labels = ["Rubric", "Brief + generate", "Review + save"];
  return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
    ${labels.map((l, i) => {
      const s = i + 1;
      const done = s < step;
      const active = s === step;
      return `<div style="display:flex;align-items:center;gap:6px;flex:1;">
        <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
          background:${done ? "var(--accent-deep)" : active ? "var(--accent)" : "var(--surface-soft)"};
          color:${done||active ? "#fff" : "var(--muted)"};
          border:1px solid ${done ? "var(--accent-deep)" : active ? "var(--accent)" : "var(--line)"};">
          ${done ? "✓" : s}
        </div>
        <span style="font-size:0.78rem;color:${active ? "var(--ink)" : "var(--muted)"};font-weight:${active ? 700 : 400};">${l}</span>
        ${i < 2 ? '<div style="flex:1;height:1px;background:var(--line);"></div>' : ""}
      </div>`;
    }).join("")}
  </div>`;
})()}
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
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-top:10px;">
              <button class="button" data-action="generate-teacher-assist"
                ${ui.aiAssistLoading ? "disabled" : ""}>
                ${ui.aiAssistLoading ? "Generating…" : "Create student-ready version →"}
              </button>
              <span class="subtle" style="font-size:0.78rem;">Advances to Step 3</span>
            </div>
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
    ${renderAssignmentSettingsFields("teacher")}
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
                  <button class="button" data-action="save-assignment" ${ui.aiAssistLoading ? "disabled" : ""}>
                    ${ui.editingAssignmentId ? "Update assignment" : "Save assignment"}
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
                      <button class="button" data-action="save-assignment" ${!manualSaveReady || ui.aiAssistLoading ? "disabled" : ""}>${ui.editingAssignmentId ? "Update assignment" : "Save assignment"}</button>
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
        <div class="teacher-ready-card" style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
            <div>
              <p class="mini-label" style="margin-bottom:4px;">Class list</p>
              <p class="subtle">Students currently enrolled in ${escapeHtml(currentClasses.find((c) => c.id === currentClassId)?.name || "this class")}.</p>
            </div>
            <span class="pill">${classRoster.length} student${classRoster.length === 1 ? "" : "s"}</span>
          </div>
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
                  const pasteCount = assignmentSubs.filter(s => (s.writingEvents || []).some(e => e.flagged)).length;
                  const totalStudents = statusCounts.total;
                  const isBriefExpanded = ui.expandedAssignmentBriefId === assignment.id;
                  const promptPreview = truncateText(stripPromptFormatting(assignment.prompt), 140);
                  return `
                  <div class="assignment-card simple-card">
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
                          <button class="${assignment.status === "published" ? "button-ghost" : "button-secondary"}" data-action="publish-assignment" data-assignment-id="${assignment.id}" style="font-size:0.8rem;${assignment.status === "published" ? "color:var(--sage);border-color:var(--sage);" : ""}">
                            ${assignment.status === "published" ? "✓ Published" : "Publish"}
                          </button>
                          <button class="button-ghost" data-action="delete-assignment" data-assignment-id="${assignment.id}" style="font-size:0.8rem;color:var(--danger);border-color:var(--danger);">Delete</button>
                        </div>
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
          <button class="button" data-action="save-assignment" ${!manualSaveReady || ui.aiAssistLoading ? "disabled" : ""}>
            ${ui.editingAssignmentId ? "Update assignment" : "Save assignment"}
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
  const roster = currentClassMembers.length ? currentClassMembers : getReviewRoster(assignment.id);
  const statusCounts = SubmissionUtils.getAssignmentSubmissionCounts(submissions, roster);
  const total = statusCounts.total;
  const submittedCount = statusCounts.submitted;
  const gradedCount = statusCounts.graded;
  const flaggedCount = submissions.filter(
    s => Array.isArray(s.writingEvents) && s.writingEvents.some(e => e && e.flagged)
  ).length;
  const criterionAnalytics = buildCriterionAnalytics(assignment, submissions.filter((submission) => SubmissionUtils.isSubmissionGraded(submission)));

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

      <div id="teacher-review-panel" class="teacher-ready-card" style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
          <div>
            <p class="mini-label" style="margin-bottom:4px;">Grade analytics</p>
            <p class="subtle">After you grade a class set, this shows where students collectively struggled on each criterion.</p>
          </div>
          <span class="pill">${gradedCount} graded so far</span>
        </div>
        ${criterionAnalytics.some((criterion) => criterion.gradedCount > 0) ? `
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

      <div class="student-list">
        ${roster.length === 0 && submissions.length === 0
          ? `<div class="empty-state compact-empty"><h3>No students yet</h3><p>Invite students to this class using the ✉ Invite students button.</p></div>`
          : roster.map(member => {
              const submission = submissions.find(s => s.studentId === member.id);
              if (!submission) return `
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
              const events = Array.isArray(submission.writingEvents) ? submission.writingEvents : [];
              const finalText = submission.finalText || submission.draftText || "";
              const startedAt = submission.startedAt || submission.updatedAt || submission.submittedAt;
              const endedAt = submission.submittedAt || submission.updatedAt || startedAt;
              const totalMinutes = startedAt && endedAt
                ? Math.max(1, Math.round((new Date(endedAt) - new Date(startedAt)) / 60000))
                : 0;
              const m = {
                largePasteCount: events.filter(e => e && e.flagged).length,
                finalWordCount: finalText.trim() ? finalText.trim().split(/\s+/).length : 0,
                revisionCount: events.length,
                totalMinutes,
              };

              const isGraded = SubmissionUtils.isSubmissionGraded(submission);
              const score = submission.teacherReview?.finalScore;
              return `
                <div class="submission-card simple-card">
                  <div class="card-top">
                    <div style="flex:1;">
                      <h3 style="margin:0 0 6px;">${escapeHtml(member.name)}</h3>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <span class="status-pill">${escapeHtml(getSubmissionStatusDisplay(submission.status))}</span>
                        ${isGraded ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ Graded${score !== "" && score != null ? ` · ${escapeHtml(String(score))}` : ""}</span>` : ""}
                        ${m.largePasteCount ? `<span class="warning-pill">⚠ Paste</span>` : ""}
                      </div>
                      <div class="pill-row" style="margin-top:6px;">
                        <span class="pill">${m.finalWordCount} words</span>
                        <span class="pill">${m.revisionCount} edits</span>
                        <span class="pill">${m.totalMinutes} min</span>
                      </div>
                    </div>
                    <button class="button" data-action="inspect-submission" data-student-id="${member.id}" data-submission-id="${submission.id}" style="flex-shrink:0;">Grade →</button>
                  </div>
                </div>
              `;
            }).join("")
        }
      </div>
    </section>
  `;
}

function renderTeacherGrading(assignment, submission) {
  if (!submission) return `<div class="empty-state"><p>No submission selected.</p></div>`;
  const events = Array.isArray(submission.writingEvents) ? submission.writingEvents : [];
  const finalText = submission.finalText || submission.draftText || "";
  const startedAt = submission.startedAt || submission.updatedAt || submission.submittedAt;
  const endedAt = submission.submittedAt || submission.updatedAt || startedAt;
  const totalMinutes = startedAt && endedAt
    ? Math.max(1, Math.round((new Date(endedAt) - new Date(startedAt)) / 60000))
    : 0;
  const metrics = {
    largePasteCount: events.filter(e => e && e.flagged).length,
    finalWordCount: finalText.trim() ? finalText.trim().split(/\s+/).length : 0,
    revisionCount: events.length,
    totalMinutes,
  };

  const reviewSummary = calculateTeacherReviewSummary(assignment, submission);
  const suggestedRowScoreMap = getTeacherReviewRowScoreMap(submission.teacherReview?.suggestedRowScores);
  const reviewScore = submission.teacherReview?.finalScore ?? "";
  const reviewNotes = submission.teacherReview?.finalNotes ?? "";
  const studentName = submission._studentName || getUserById(submission.studentId)?.name || "Student";
  const roster = getReviewRoster(assignment.id);
  const rosterIndex = roster.findIndex((student) => student.id === submission.studentId);
  const nextStudentId = getNextReviewStudentId(submission.studentId, assignment.id);
  const deadlinePassed = canMarkLateOrMissing(assignment);
  const currentStatus = submission.status || submission.teacherReview?.status || "not_started";
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
          <button class="button-ghost" data-action="next-review-student" ${!nextStudentId ? "disabled" : ""} style="font-size:0.85rem;">Next student →</button>
          <button class="button-ghost" data-action="download-work" style="font-size:0.85rem;">⬇ Grade sheet</button>
        </div>
      </div>

      <div class="review-grid ${rubricSchema ? "review-grid-stacked" : ""}">
        <div class="review-card">

          <div style="margin-bottom:16px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fafaf8;">
            <p class="mini-label" style="margin-bottom:8px;">Submission status</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${["draft", "submitted"].map((status) => {
                const isActive = currentStatus === status;
                return `<button class="button-ghost" data-action="set-review-status" data-status="${status}" style="background:${isActive ? "#dff3e4" : "#fff"};border-color:${isActive ? "#4f8f68" : "var(--line)"};color:${isActive ? "#1f5c38" : "var(--ink)"};">${escapeHtml(getSubmissionStatusDisplay(status))}</button>`;
              }).join("")}
              ${["late", "missing"].map((status) => {
                const isActive = currentStatus === status;
                return `<button class="button-ghost" data-action="set-review-status" data-status="${status}" style="background:${isActive ? "#fde7e7" : "#fff"};border-color:${isActive ? "#c56b6b" : "var(--line)"};color:${isActive ? "#8a2f2f" : "var(--ink)"};">${escapeHtml(getSubmissionStatusDisplay(status))}</button>`;
              }).join("")}
            </div>
            ${deadlinePassed ? `
              <p style="font-size:0.78rem;color:var(--muted);margin:8px 0 0;">Deadline has passed, so you can mark this student as late or missing.</p>
            ` : ""}
          </div>
          
          ${renderWritingBehaviour(submission, assignment)}
          <div style="margin-bottom:16px;">
            <p class="mini-label" style="margin-bottom:6px;">Student text</p>
            <div class="editor-with-lines review-editor-with-lines">
              <div class="line-gutter" id="student-text-annotate-gutter" aria-hidden="true"></div>
              <div id="student-text-annotate" data-line-gutter="student-text-annotate-gutter" onmouseup="captureAnnotationSelection()" onkeyup="captureAnnotationSelection()" ontouchend="captureAnnotationSelection()" style="background:#fafaf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:0.92rem;line-height:1.85;white-space:pre-wrap;word-break:break-word;min-height:320px;max-height:min(78vh,900px);overflow-y:auto;cursor:text;">${renderAnnotatedText(submission)}</div>
            </div>
          </div>

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

          <details style="margin-bottom:16px;">
            <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted);padding:6px 0;">▶ Writing process & heatmap</summary>
            <div style="margin-top:10px;">
              <div class="pill-row" style="margin-bottom:10px;">
                <span class="pill">${metrics.totalMinutes} min total</span>
                <span class="pill">${metrics.revisionCount} edits</span>
                <span class="pill">${metrics.finalWordCount} words</span>
                ${metrics.largePasteCount ? `<span class="warning-pill">⚠ ${metrics.largePasteCount} paste flag${metrics.largePasteCount > 1 ? "s" : ""}</span>` : ""}
              </div>
              ${renderWritingHeatmap(submission)}
            </div>
          </details>

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

          ${submission.teacherReview?.suggestedGrade ? `
            <div id="suggested-grade-panel" style="margin-bottom:16px;padding:14px;background:#f4efe6;border-radius:12px;border:1px solid var(--line);">
              <p class="mini-label" style="margin-bottom:6px;">AI suggested grade</p>
              <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px;">${submission.teacherReview.suggestedGrade.totalScore}/${submission.teacherReview.suggestedGrade.maxScore}</div>
              <p style="font-size:0.85rem;color:var(--muted);margin:0 0 10px;">${escapeHtml(submission.teacherReview.suggestedGrade.justification)}</p>
              ${safeArray(submission.teacherReview.suggestedGrade.criteria).length ? `
                <div style="display:grid;gap:6px;margin:0 0 10px;">
                  ${submission.teacherReview.suggestedGrade.criteria.map((criterion) => `
                    <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.82rem;padding:8px 10px;background:#fff;border:1px solid var(--line);border-radius:10px;">
                      <span>${escapeHtml(criterion.name)}</span>
                      <strong>${escapeHtml(criterion.bandLabel || "Band")} (${criterion.score}/${criterion.points})</strong>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
              ${submission.teacherReview.suggestedGrade.studentComment ? `
                <div style="background:#f0f7ee;border-left:3px solid var(--accent);padding:10px 12px;border-radius:8px;margin-bottom:10px;">
                  <p class="mini-label" style="margin-bottom:4px;">Suggested student comment</p>
                  <p style="font-size:0.85rem;margin:0 0 8px;">${escapeHtml(submission.teacherReview.suggestedGrade.studentComment)}</p>
                  <button class="button-ghost" data-action="use-suggested-comment" style="font-size:0.8rem;">Copy to notes</button>
                </div>
              ` : ""}
              <div style="display:flex;gap:8px;">
                <button class="button-secondary" data-action="accept-suggested-grade">Use this score</button>
                <button class="button-ghost" data-action="ignore-suggested-grade">Ignore</button>
              </div>
            </div>
          ` : ""}

            <div style="margin-bottom:16px;">
            <p class="mini-label" style="margin-bottom:8px;">Rubric</p>
            ${rubricSchema
              ? renderRubricSchemaLayout(rubricSchema, {
                  clickable: true,
                  compact: true,
                  rowScoreMap: reviewSummary.rowScoreMap,
                  suggestedRowScoreMap,
                  currentScore: reviewSummary.totalScore,
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
              <span style="font-size:0.95rem;font-weight:700;color:var(--ink);">Auto total: ${reviewSummary.totalScore}/${reviewSummary.maxScore}</span>
            </div>
          </div>

          <div class="field" style="margin-bottom:12px;">
            <label>Final score</label>
            <div style="padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fafaf8;font-weight:700;">
              ${reviewSummary.totalScore}/${reviewSummary.maxScore}
            </div>
            ${reviewScore !== "" && Number(reviewScore) !== Number(reviewSummary.totalScore) ? `
              <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Previous saved total: ${escapeHtml(String(reviewScore))}</p>
            ` : ""}
          </div>

          <div class="field" style="margin-bottom:12px;">
            <label for="teacher-review-notes">Teacher notes</label>
            <textarea id="teacher-review-notes" style="min-height:120px;">${escapeHtml(reviewNotes)}</textarea>
          </div>

          ${submission.teacherReview?.savedAt ? `
            <p style="font-size:0.8rem;color:var(--sage);margin-bottom:8px;">✓ Last saved ${escapeHtml(formatDateTime(submission.teacherReview.savedAt))}</p>
          ` : ""}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="button-secondary" data-action="generate-grade" ${ui.gradeSuggestionLoading ? "disabled" : ""}>${ui.gradeSuggestionLoading ? "Thinking…" : "Suggest Grade"}</button>
            ${ui.gradeSuggestionLoading ? `<span style="font-size:0.82rem;color:var(--muted);align-self:center;">AI is reviewing the submission…</span>` : ""}
            <button class="button-ghost" data-action="copy-lms-grade">Copy Grade</button>
            <button class="button" data-action="save-teacher-review">Submit grade</button>
          </div>

        </div>
      </div>
    </section>
  `;
}

function renderStudentWorkspace() {
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
        ${currentClasses.length > 0 && !assignment ? `
          <div class="upcoming-section">
            <p class="mini-label" style="margin-bottom:10px;">Your classes & assignments</p>
            ${currentClasses.map(cls => {
              const clsAssignments = state.assignments.filter(a => a.status === "published" && a.classId === cls.id);
              return `
                <div class="upcoming-class-block">
                  <div class="upcoming-class-header">
                    <strong>${escapeHtml(cls.name)}</strong>
                    ${cls.id !== currentClassId ? `<button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="switch-class" data-class-id="${cls.id}">Open</button>` : `<span class="pill">Current</span>`}
                  </div>
                  ${clsAssignments.length ? clsAssignments.map(a => `
                    <div class="upcoming-assignment-row">
                      <span>${escapeHtml(a.title)}</span>
                      <span style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                        ${a.deadline ? `<span class="${new Date(a.deadline) < new Date() ? "warning-pill" : "pill"}" style="font-size:0.75rem;">Due ${new Date(a.deadline).toLocaleDateString(undefined,{day:"numeric",month:"short"})}</span>` : ""}
                        <button class="button-ghost" style="font-size:0.8rem;min-height:30px;padding:0 10px;" data-action="open-assignment" data-class-id="${cls.id}" data-assignment-id="${a.id}">Start</button>
                      </span>
                    </div>
                  `).join("") : `<p class="subtle" style="font-size:0.85rem;margin:6px 0;">No published assignments yet.</p>`}
                </div>
              `;
            }).join("")}
          </div>
        ` : ""}
        <div class="field">
          <label for="student-assignment-select">Choose assignment</label>
          <select id="student-assignment-select" aria-label="Select assignment">
            ${assignments.length
              ? `
                ${assignmentBuckets.current.length ? `
                  <optgroup label="Current work">
                    ${assignmentBuckets.current.map(({ assignment: item }) => `<option value="${item.id}" ${ui.selectedStudentAssignmentId === item.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}
                  </optgroup>
                ` : ""}
                ${assignmentBuckets.submitted.length ? `
                  <optgroup label="Submitted work">
                    ${assignmentBuckets.submitted.map(({ assignment: item, isGraded }) => `<option value="${item.id}" ${ui.selectedStudentAssignmentId === item.id ? "selected" : ""}>${escapeHtml(item.title)}${isGraded ? " — Graded" : " — Awaiting review"}</option>`).join("")}
                  </optgroup>
                ` : ""}
              `
              : `<option value="">No assignments published yet</option>`
            }
          </select>
        </div>
        ${assignments.length ? `
          <div class="pill-row" style="margin-top:-4px;">
            <span class="pill">${assignmentBuckets.current.length} current</span>
            <span class="pill">${assignmentBuckets.submitted.length} submitted</span>
            ${hasOtherGradedWork ? `<span class="pill" style="color:var(--sage);border-color:var(--sage);">✓ Graded work available</span>` : ""}
          </div>
        ` : ""}
        ${hasOtherGradedWork ? `<p class="subtle" style="margin-top:8px;font-size:0.84rem;">Open any assignment marked <strong>Graded</strong> to view your teacher’s notes, rubric breakdown, and marked copy.</p>` : ""}
        ${
          !assignments.length
            ? `<div class="empty-state"><h3>Nothing here yet</h3><p>Your teacher hasn't published any assignments yet.</p></div>`
            : !assignment || !submission
              ? `<div class="empty-state"><h3>No assignment yet</h3><p>Choose an assignment from the dropdown above to get started.</p></div>`
              : `
                <div class="student-progress">
                  ${[1, 2, 3, 4].map((step) => `
                    <div class="progress-step ${ui.studentStep === step ? "active" : ui.studentStep > step ? "done" : ""}">
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
                    ${assignment.deadline ? `<span class="${new Date(assignment.deadline) < new Date() ? "warning-pill" : "pill"}">Due: ${escapeHtml(new Date(assignment.deadline).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"}))}</span>` : ""}
                    ${assignment.chatTimeLimit > 0 ? `<span class="pill">⏱ ${assignment.chatTimeLimit} min chat</span>` : ""}
                  </div>
                </div>
                ${renderStudentStep(assignment, submission)}
              `
        }
      </div>
    </section>
  `;
}

function renderStudentStep(assignment, submission) {
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
  const chatCount = chatHistory.filter((msg) => msg.role === "user").length;
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
      ${locked ? `
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
      ` : chatDisabled ? `
        <div class="teacher-ready-card">
          <p class="mini-label">Planning prompt</p>
          <p class="subtle" style="margin-bottom:10px;">Take a minute to jot down your main idea and one example you might use before you start drafting.</p>
          <textarea id="chat-skip-notes" class="chat-input" rows="3" placeholder="Optional: note your main idea here before you draft.">${escapeHtml(submission.outline?.partOne || "")}</textarea>
        </div>
      ` : `
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
      `}
      <div class="wizard-nav">
        ${locked || chatDisabled ? `<span></span>` : `
          <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex-wrap:wrap;">
            ${timeLimit > 0 && minsRemaining !== null ? `
              <div class="chat-timer ${minsRemaining <= 5 ? "chat-timer-urgent" : ""}">
                ${timeExpired ? "⏱ Time's up" : `⏱ ${minsRemaining}:${String(secsRemaining).padStart(2,'0')} left`}
              </div>
            ` : ""}
            <button class="button-ghost" data-action="skip-chat-to-draft">Skip chat for now</button>
          </div>
        `}
        <button class="button" data-action="student-next-step" data-step="2" ${!hasEnoughChat ? "disabled title='Have a conversation with the coach first'" : ""}>Next: Write Draft</button>
      </div>
    </div>
  `;
}

function renderStudentDraftStep(assignment, submission) {
  const feedbackEntries = getRenderableDraftFeedbackEntries(assignment, submission);
  const feedbackUsed = Number(safeArray(submission.feedbackHistory).length || 0);
  const feedbackLimit = Number(assignment.feedbackRequestLimit || 0);
  const feedbackDisabled = feedbackUsed >= feedbackLimit;
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
        <button class="button" data-action="student-next-step" data-step="3" ${!submission.draftText?.trim() ? "disabled title='Write your draft first'" : ""}>Next</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
    </div>
  `;
}

function renderStudentReviewStep(assignment, submission) {
  const feedbackEntries = safeArray(submission?.feedbackHistory);
  const feedbackLimit = Number(assignment?.feedbackRequestLimit ?? 3);
  const feedbackUsed = feedbackEntries.length;
  const feedbackDisabled = feedbackUsed >= feedbackLimit;

  return `
    <div class="step-card wizard-card">
      <div class="step-head">
        <div>
          <div class="step-number">3</div>
          <h3>Review feedback and write your final version</h3>
          <p class="subtle">Use the AI feedback on your draft to help you improve. Write your final version in the box below.</p>
        </div>
      </div>
      <div class="field-grid compact-grid">
        <div class="field inline-end">
          <button class="button-secondary" data-action="request-feedback" ${feedbackDisabled ? "disabled" : ""}>Get AI feedback (${feedbackUsed}/${feedbackLimit})</button>
        </div>
      </div>
      <div class="feedback-list">
        ${
          feedbackEntries.length
            ? feedbackEntries.slice().reverse().map((entry) => {
                const errorCodes = getErrorCodes();
                const items = safeArray(entry.items).map((item) => String(item || "").trim()).filter(Boolean);
                const hasCode = errorCodes.some(({code}) => items.some((item) => item.includes(`[${code}]`)));
                return `
                  <div class="feedback-card">
                    <strong>${escapeHtml(formatDateTime(entry.timestamp))}</strong>
                    <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    ${hasCode ? `
                      <div class="error-code-key">
                        <p>Code key</p>
                        <dl>${errorCodes.filter(({code}) => items.some((item) => item.includes(`[${code}]`))).map(({code, label}) => `<dt>${code}</dt><dd>${escapeHtml(label)}</dd>`).join("")}</dl>
                      </div>` : ""}
                  </div>`;
              }).join("")
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
        <button class="button-secondary" data-action="request-feedback" ${feedbackDisabled ? "disabled" : ""}>Get AI feedback (${feedbackUsed}/${feedbackLimit})</button>
        <button class="button" data-action="student-next-step" data-step="4" ${!submission.finalText?.trim() && !submission.draftText?.trim() ? "disabled" : ""}>Next</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
    </div>
  `;
}

function renderStudentFinalStep(assignment, submission) {
  const selfAssessment = submission.selfAssessment || {};
  const rubricSchema = assignment.uploadedRubricSchema || assignment.rubricSchema || getRubricSchema(assignment.rubric, assignment.uploadedRubricName || assignment.title);
  const selfAssessmentRowMap = getStudentSelfAssessmentRowScoreMap(submission);
  const selfAssessmentScore = Array.from(selfAssessmentRowMap.values()).reduce((sum, entry) => sum + Number(entry?.points ?? 0), 0);
  const teacherReviewRows = getTeacherReviewRowsForExport(assignment, submission);

  if (submission.teacherReview?.savedAt) {
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
      </div>
      <div class="wizard-nav">
        <button class="button-ghost" data-action="student-prev-step" data-step="3">Back</button>
        <span></span>
        <button class="button" data-action="submit-final" ${submission.status === "submitted" ? "disabled" : ""}>Submit assignment</button>
      </div>
      ${ui.notice ? `<div class="notice" style="margin-top:12px;">${escapeHtml(ui.notice)}</div>` : ""}
      ${submission.status === "submitted" ? `
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
            ${getTeacherReviewRowsForExport(assignment, submission).length ? `
              <div style="display:grid;gap:8px;margin:12px 0 14px;">
                ${getTeacherReviewRowsForExport(assignment, submission).map((row) => `
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
      ` : ""}
    </div>
  `;
}

function canAdvanceToStep(nextStep) {
  const submission = getStudentSubmission();
  const assignment = getStudentAssignment();
  if (!submission) {
    return false;
  }

  if (nextStep === 2) {
    const hasChat = isChatDisabled(assignment) || Boolean(submission.chatSkippedAt) || (submission.chatHistory || []).length >= 2;
    if (!hasChat) {
      ui.notice = "Have a short conversation with your writing coach first, or use Skip chat if you're ready to draft.";
      return false;
    }
  }

  if (nextStep === 3) {
    if (!submission.draftText.trim()) {
      ui.notice = "Write a draft before moving on.";
      return false;
    }
  }
  if (nextStep === 4) {
    if (!submission.finalText?.trim() && !submission.draftText?.trim()) {
      ui.notice = "Please write your final version before continuing.";
      return false;
    }
  }
  return true;
}

function applyTeacherAssistToDraft() {
  ui.teacherDraft.title = ui.teacherAssist.title;
  ui.teacherDraft.prompt = ui.teacherAssist.prompt;
  ui.teacherDraft.focus = ui.teacherAssist.focus;
  ui.teacherDraft.assignmentType = ui.teacherAssist.assignmentType;
  ui.teacherDraft.wordCountMin = ui.teacherAssist.wordCountMin;
  ui.teacherDraft.wordCountMax = ui.teacherAssist.wordCountMax;
  ui.teacherDraft.studentFocus = ui.teacherAssist.studentFocus.join("\n");
  ui.teacherDraft.rubric = ui.teacherAssist.rubric.map((item) => ({ ...item }));
}

async function saveTeacherAssignment() {
  console.log("[saveTeacherAssignment started]", {
    teacherAssist: ui.teacherAssist,
    teacherDraft: ui.teacherDraft,
    currentClassId,
  });

  ui.notice = "Saving assignment...";
  render();

  // Use the editable AI draft if present, otherwise fall back to teacherDraft
  const source = ui.teacherAssist || ui.teacherDraft;
  const editingAssignment = ui.editingAssignmentId
    ? state.assignments.find((item) => item.id === ui.editingAssignmentId) || null
    : null;
  const classSelect = document.getElementById("class-select");
  const selectedClassId = classSelect?.value && classSelect.value !== "__new__"
    ? classSelect.value
    : currentClassId;
  const draft = ui.teacherAssist
    ? {
        title: (ui.teacherAssist.title || "").trim(),
        prompt: (ui.teacherAssist.prompt || "").trim(),
        focus: ui.teacherDraft.focus || "",
        brief: ui.teacherDraft.brief || "",
        assignmentType: ui.teacherAssist.assignmentType || "response",
        languageLevel: ui.teacherDraft.languageLevel,
        totalPoints: ui.teacherDraft.totalPoints,
        wordCountMin: Number(ui.teacherAssist.wordCountMin || 250),
        wordCountMax: Number(ui.teacherAssist.wordCountMax || 400),
        ideaRequestLimit: Number(ui.teacherDraft.ideaRequestLimit || 3),
        feedbackRequestLimit: Number(ui.teacherDraft.feedbackRequestLimit || 2),
        disableChatbot: Boolean(ui.teacherDraft.disableChatbot),
        studentFocus: ui.teacherAssist.studentFocus || [],
        rubric: (ui.teacherAssist.rubric || []).filter((item) => (item.name || "").trim()),
      }
    : normalizeTeacherDraft(ui.teacherDraft);

  const inferredSettings = inferTeacherBriefSettings(ui.teacherDraft.brief);
  if (inferredSettings.assignmentType) {
    draft.assignmentType = inferredSettings.assignmentType;
  }
  if (inferredSettings.languageLevel) {
    draft.languageLevel = inferredSettings.languageLevel;
  }
  if (Number.isFinite(Number(inferredSettings.feedbackRequestLimit)) && Number(inferredSettings.feedbackRequestLimit) >= 0) {
    draft.feedbackRequestLimit = Number(inferredSettings.feedbackRequestLimit);
  }
  if (typeof inferredSettings.disableChatbot === "boolean") {
    draft.disableChatbot = inferredSettings.disableChatbot;
  }
  if (draft.disableChatbot) {
    draft.chatTimeLimit = -1;
  } else if (Number.isFinite(Number(inferredSettings.chatTimeLimit)) && Number(inferredSettings.chatTimeLimit) >= 0) {
    draft.chatTimeLimit = Number(inferredSettings.chatTimeLimit);
  }
  if (Number.isFinite(Number(inferredSettings.totalPoints)) && Number(inferredSettings.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
    draft.totalPoints = Number(inferredSettings.totalPoints);
  }

  ui.teacherDraft.assignmentType = draft.assignmentType;
  ui.teacherDraft.languageLevel = draft.languageLevel;
  ui.teacherDraft.feedbackRequestLimit = draft.feedbackRequestLimit;
  ui.teacherDraft.disableChatbot = Boolean(draft.disableChatbot);
  ui.teacherDraft.chatTimeLimit = Number(draft.chatTimeLimit ?? ui.teacherDraft.chatTimeLimit ?? 0);

  if (!draft.title || !draft.prompt) {
    ui.notice = "Add a student-facing title and prompt, or use Format With AI first.";
    render();
    return;
  }

  const studentFocusArray = Array.isArray(draft.studentFocus)
    ? draft.studentFocus
    : splitLines(draft.studentFocus);

  const assignment = {
    id: editingAssignment?.id || uid("assignment"),
    title: draft.title,
    prompt: draft.prompt,
    focus: draft.focus,
    brief: draft.brief,
    assignmentType: draft.assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: draft.wordCountMin,
    wordCountMax: draft.wordCountMax,
    ideaRequestLimit: draft.ideaRequestLimit,
    feedbackRequestLimit: draft.feedbackRequestLimit,
    disableChatbot: Boolean(draft.disableChatbot),
    studentFocus: studentFocusArray,
    rubricSchema: ui.teacherDraft.uploadedRubricSchema || null,
    rubric: ui.teacherDraft.uploadedRubricSchema?.criteria?.length
      ? safeArray(ui.teacherDraft.uploadedRubricSchema.criteria).map((criterion) => normalizeRubricRow({
          id: criterion.id,
          name: criterion.name,
          description: "",
          points: Number(criterion.maxScore || 0),
          pointsLabel: criterion.minScore !== criterion.maxScore
            ? `${criterion.minScore} – ${criterion.maxScore} points`
            : `${criterion.maxScore} points`,
          levels: safeArray(criterion.levels).map((level) => ({
            id: level.id,
            label: `${level.label} – ${level.score}`,
            points: Number(level.score || 0),
            description: level.description,
          })),
        }))
      : (draft.rubric.length ? draft.rubric : rubricForType(draft.assignmentType)),
    createdBy: editingAssignment?.createdBy || "teacher-1",
    createdAt: editingAssignment?.createdAt || new Date().toISOString(),
    status: editingAssignment?.status || "draft",
    deadline: ui.teacherDraft.deadline || "",
    chatTimeLimit: draft.disableChatbot ? -1 : Number(draft.chatTimeLimit || 0),
    uploadedRubricText: ui.teacherDraft.uploadedRubricText || "",
    uploadedRubricName: ui.teacherDraft.uploadedRubricName || "",
    uploadedRubricData: ui.teacherDraft.uploadedRubricData || null,
    uploadedRubricSchema: ui.teacherDraft.uploadedRubricSchema || null,
  };

  if (!selectedClassId) {
    ui.notice = "Please select or create a class before saving an assignment.";
    render();
    return;
  }
  currentClassId = selectedClassId;

  const payload = {
      title: assignment.title,
      prompt: assignment.prompt,
      focus: assignment.focus,
      brief: assignment.brief,
      assignment_type: assignment.assignmentType,
      language_level: assignment.languageLevel,
      word_count_min: assignment.wordCountMin,
      word_count_max: assignment.wordCountMax,
      feedback_request_limit: assignment.feedbackRequestLimit,
      student_focus: assignment.studentFocus,
      rubric: assignment.rubricSchema || assignment.rubric,
      deadline: assignment.deadline || null,
      chat_time_limit: assignment.chatTimeLimit,
      uploaded_rubric_text: assignment.uploadedRubricText,
      status: assignment.status || 'draft'
    };
  const data = editingAssignment
    ? await Auth.apiFetch(`/api/assignments/${editingAssignment.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      })
    : await Auth.apiFetch(`/api/classes/${selectedClassId}/assignments`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
  if (data.error) {
    ui.notice = "Could not save assignment: " + data.error;
    render();
    return;
  }

  const savedAssignmentId = data.assignment?.id || null;
  await loadTeacherClassContext(selectedClassId);
  ui.selectedAssignmentId = savedAssignmentId || state.assignments[0]?.id || null;
  ui.selectedReviewSubmissionId = null;
  ui.teacherDraft = createBlankTeacherDraft();
  ui.teacherAssist = null;
  ui.editingAssignmentId = null;
  ui.notice = editingAssignment
    ? "Assignment updated."
    : "Assignment created and ready to publish.";
  persistState();
  render();
}

// Expose for proxy buttons in teacher-assignment-choice.js
window.saveCurrentTeacherAssignment = saveTeacherAssignment;

async function handleIdeaRequest() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission) {
    return;
  }

  if (submission.ideaResponses.length >= assignment.ideaRequestLimit) {
    ui.notice = "You have used all your idea help for this assignment.";
    render();
    return;
  }

  ui.notice = "Preparing idea help...";
  render();
  let aiBullets;
  try {
    aiBullets = await requestStudentIdeasFromAi(assignment, submission);
  } catch (error) {
    console.error("Falling back to local idea help:", error);
    aiBullets = generateStudentIdeas(assignment, submission);
  }

  submission.ideaResponses.push({
    id: uid("idea"),
    requestedAt: new Date().toISOString(),
    aiBullets,
    rewrittenIdea: "",
    whyChosen: "",
  });
  submission.updatedAt = new Date().toISOString();
  ui.notice = "Short ideas added. Now pick one and explain it in your own words.";
  persistState();
  scheduleSubmissionSync();
  render();
}

async function handleFeedbackRequest() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission) {
    return;
  }

  if (submission.feedbackHistory.length >= assignment.feedbackRequestLimit) {
    ui.notice = "You have used all your draft checks for this assignment.";
    render();
    return;
  }

  ui.notice = "Checking your draft...";
  render();
  let items;
  try {
    items = await requestDraftFeedbackFromAi(assignment, submission);
  } catch (error) {
    console.error("Falling back to local draft feedback:", error);
    items = generateFeedback(assignment, submission);
  }

  submission.feedbackHistory.push({
    id: uid("feedback"),
    timestamp: new Date().toISOString(),
    items,
  });
  ui.latestDraftFeedbackByAssignmentId[assignment.id] = safeArray(items).slice();
  submission.updatedAt = new Date().toISOString();
  ui.notice = "Draft check added. Use it to improve your own writing.";
  persistState();
  await flushCurrentStudentWork();
  render();
}

function getRenderableDraftFeedbackEntries(assignment, submission) {
  const history = safeArray(submission?.feedbackHistory)
    .map((entry) => ({
      id: entry?.id || uid("feedback"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      items: safeArray(entry?.items).map((item) => String(item || "").trim()).filter(Boolean),
    }))
    .filter((entry) => entry.items.length);

  if (history.length) {
    return history;
  }

  const latestItems = safeArray(ui.latestDraftFeedbackByAssignmentId?.[assignment?.id])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!latestItems.length) {
    return [];
  }

  return [{
    id: uid("feedback"),
    timestamp: new Date().toISOString(),
    items: latestItems,
  }];
}

async function handleSubmission() {
  const submission = getStudentSubmission();
  const assignment = getStudentAssignment();
  if (!submission || !assignment) {
    return;
  }
  const finalEditor = document.getElementById("final-editor");
  const finalText = finalEditor ? finalEditor.value.trim() : submission.finalText?.trim();
  if (!finalText) {
    ui.notice = "Write your final text before submitting.";
    render();
    return;
  }
  submission.fluencySummary = calculateFluencySummary(submission);
  submission.finalText = finalText;
  const previousStatus = submission.status;
  const previousSubmittedAt = submission.submittedAt;
  const previousUpdatedAt = submission.updatedAt;
  const attemptedSubmittedAt = new Date().toISOString();
  submission.updatedAt = attemptedSubmittedAt;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  clearTimeout(submissionSyncTimer);
  submissionSyncTimer = null;
  ui.notice = "Submitting...";
  setDraftSaveMessage("Submitting…");
  persistState();
  render();
  await flushCurrentStudentWork();
  submitStudentSubmissionToServer({
    ...submission,
    status: "submitted",
    submittedAt: attemptedSubmittedAt,
    updatedAt: attemptedSubmittedAt,
  })
    .then(async (result) => {
      if (!result) {
        submission.status = previousStatus || "draft";
        submission.submittedAt = previousSubmittedAt || null;
        submission.updatedAt = new Date().toISOString();
        persistState();
        await queueSubmissionSync(submission);
        setDraftSaveMessage("Saved on this device.");
        ui.notice = "Submission failed. Your writing was saved, but it was not sent to your teacher. Please try Submit again.";
        render();
        window.requestAnimationFrame(() => {
          document.getElementById("submitted-confirmation")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        return;
      }
      const refreshed = getStudentSubmission();
      if (refreshed) {
        refreshed.status = "submitted";
        refreshed.submittedAt = refreshed.submittedAt || attemptedSubmittedAt;
        refreshed.updatedAt = refreshed.submittedAt;
      }
      rememberStudentStep(4);
      ui.notice = "";
      setDraftSaveMessage("Submitted successfully.");
      persistState();
      render();
      window.requestAnimationFrame(() => {
        document.getElementById("submitted-confirmation")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    })
    .catch(async (e) => {
      console.error("Submit sync failed:", e);
      submission.status = previousStatus || "draft";
      submission.submittedAt = previousSubmittedAt || null;
      submission.updatedAt = previousUpdatedAt || new Date().toISOString();
      persistState();
      await queueSubmissionSync(submission);
      setDraftSaveMessage("Saved on this device.");
      ui.notice = "Submission failed. Your writing was saved, but it was not sent to your teacher. Please try Submit again.";
      render();
      window.requestAnimationFrame(() => {
        document.getElementById("submitted-confirmation")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
}

function recordKeystrokeInterval() {
  const now = Date.now();
  if (lastKeystrokeAt !== null) {
    const interval = now - lastKeystrokeAt;
    if (interval >= 300 && interval <= 120000) {
      keystrokeBuffer.push({ gap: interval, at: now });
    }
  }
  lastKeystrokeAt = now;
}

function flushKeystrokeBuffer() {
  const submission = getStudentSubmission();
  if (!submission || !keystrokeBuffer.length) return;
  submission.keystrokeLog = submission.keystrokeLog || [];
  submission.keystrokeLog.push(...keystrokeBuffer);
  keystrokeBuffer = [];
  submission.fluencySummary = calculateFluencySummary(submission);
  submission.updatedAt = new Date().toISOString();
  persistState();
}

function scheduleKeystrokeFlush() {
  clearTimeout(keystrokeFlushTimer);
  keystrokeFlushTimer = setTimeout(flushKeystrokeBuffer, 5000);
}

function updateDraftSubmission(nextText) {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  const previousText = submission.draftText || "";
  const now = new Date().toISOString();
  const operation = getTextOperation(previousText, nextText);
  if (!operation) {
    return;
  }

  const type = determineEventType(operation);
  const pasteContent = ui.pendingPaste?.content || "";

  const isFlaggedPaste = type === "paste" && pasteContent.length >= LARGE_PASTE_LIMIT;

  submission.draftText = nextText;
  submission.updatedAt = now;
  submission.startedAt = submission.startedAt || now;
  submission.lastEditedAt = now;

  submission.writingEvents.push({
    id: uid("event"),
    timestamp: now,
    type,
    start: operation.start,
    end: operation.end,
    removedText: operation.removedText,
    insertedText: type === "paste" ? pasteContent : operation.insertedText,
    delta: operation.insertedText.length - operation.removedText.length,
    flagged: isFlaggedPaste,
    preview: trimTo(operation.insertedText || operation.removedText || nextText.slice(-40), 80),
  });

  ui.pendingPaste = null;
  persistState();
}

function determineEventType(operation) {
  if (ui.pendingPaste && Date.now() - ui.pendingPaste.timestamp < 1200) {
    return "paste";
  }
  if (operation.insertedText && operation.removedText) {
    return "replace";
  }
  if (operation.insertedText) {
    return "insert";
  }
  return "delete";
}

function getTextOperation(previousText, nextText) {
  if (previousText === nextText) {
    return null;
  }

  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1;
  }

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    end: previousEnd,
    removedText: previousText.slice(start, previousEnd),
    insertedText: nextText.slice(start, nextEnd),
  };
}

function renderPlaybackScreenOnly() {
  const submission = getSelectedReviewSubmission();
  const playbackScreen = document.getElementById("playback-screen");
  if (!submission || !playbackScreen) {
    return;
  }

  const playback = getPlaybackState(submission);
  playbackScreen.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(playback.text)}</pre>`;
}

const PLAYBACK_INTRA_EVENT_DELAY_MS = 60;

function getPlaybackSpeedMultiplier() {
  const speed = Number(ui.playback.speed || 1);
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function getPlaybackFrameDelayMs(frames, index) {
  const rawDelay = Math.max(0, Number(frames?.[index]?.delayMs || 0));
  return rawDelay / getPlaybackSpeedMultiplier();
}

function startPlayback(frames) {
  if (!frames.length) {
    return;
  }

  stopPlayback();
  ui.playback.isPlaying = true;
  const scheduleNextFrame = () => {
    if (ui.playback.index >= frames.length - 1) {
      stopPlayback();
      render();
      return;
    }
    const delay = getPlaybackFrameDelayMs(frames, ui.playback.index);
    ui.playback.timerId = window.setTimeout(() => {
      ui.playback.timerId = null;
      if (!ui.playback.isPlaying) return;
      if (ui.playback.index >= frames.length - 1) {
        stopPlayback();
        render();
        return;
      }
      ui.playback.index += 1;
      syncPlaybackUi();
      scheduleNextFrame();
    }, delay);
  };
  scheduleNextFrame();
}

function getEventTimeMs(event) {
  const parsed = Date.parse(event?.timestamp || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function countPlaybackOperations(event) {
  if (!event || event.type === "paste") return 1;
  return Math.max(1, String(event.removedText || "").length + String(event.insertedText || "").length);
}

function getIntraEventDelayMs(event, nextEventTimeMs, eventTimeMs) {
  const operationCount = countPlaybackOperations(event);
  if (operationCount <= 1) return 0;
  if (Number.isFinite(nextEventTimeMs) && Number.isFinite(eventTimeMs) && nextEventTimeMs > eventTimeMs) {
    return Math.max(0, Math.min(PLAYBACK_INTRA_EVENT_DELAY_MS, (nextEventTimeMs - eventTimeMs) / operationCount));
  }
  return PLAYBACK_INTRA_EVENT_DELAY_MS;
}

function finalizePlaybackFrameDelays(frames) {
  const startTime = Number(frames[0]?.timeMs) || 0;
  for (let i = 0; i < frames.length; i += 1) {
    const currentTime = Number(frames[i]?.timeMs);
    const nextTime = Number(frames[i + 1]?.timeMs);
    frames[i].elapsedMs = Number.isFinite(currentTime) ? Math.max(0, currentTime - startTime) : 0;
    frames[i].delayMs = Number.isFinite(currentTime) && Number.isFinite(nextTime)
      ? Math.max(0, nextTime - currentTime)
      : 0;
  }
  return frames;
}

function formatPlaybackDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPlaybackElapsedLabel(elapsedMs, totalMs) {
  const elapsed = formatPlaybackDuration(elapsedMs);
  const total = formatPlaybackDuration(totalMs);
  return totalMs > 0 ? `${elapsed} / ${total} recorded` : elapsed;
}

function stepPlayback(direction) {
  const submission = getSelectedReviewSubmission();
  const frames = submission ? getPlaybackFrames(submission) : [];
  if (!frames.length) {
    return;
  }

  stopPlayback();
  ui.playback.index = clamp(ui.playback.index + direction, 0, frames.length - 1);
  syncPlaybackUi();
}

function syncPlaybackUi() {
  const submission = getSelectedReviewSubmission();
  if (!submission) {
    return;
  }

  const playback = getPlaybackState(submission);
  const slider = document.getElementById("playback-slider");
  if (slider) {
    slider.value = String(playback.index);
  }

  const playbackScreen = document.getElementById("playback-screen");
  if (playbackScreen) {
    playbackScreen.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(playback.text)}</pre>`;
  }

  const playbackMeta = document.getElementById("playback-meta");
  if (playbackMeta) {
    playbackMeta.textContent = playback.timeLabel;
  }

  const playbackLabel = document.getElementById("playback-label");
  if (playbackLabel) {
    playbackLabel.textContent = playback.label;
  }
}

function updateDraftMeters() {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  updateTextContent("draft-word-count", String(wordCount(submission.draftText)));
  updateTextContent("draft-event-count", String(submission.writingEvents.length));
  updateTextContent(
    "draft-paste-count",
    String(submission.writingEvents.filter((entry) => entry.type === "paste" && entry.flagged).length)
  );
}

function updateFinalMeters() {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  updateTextContent("final-word-count", String(wordCount(submission.finalText || submission.draftText)));
}

function updateTextContent(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function getAssignments() {
  return state.assignments;
}

function getPublishedAssignments() {
  return state.assignments.filter((a) => a.status === "published" && (!a.classId || a.classId === currentClassId));
}

function getSelectedAssignment() {
  return state.assignments.find((assignment) => assignment.id === ui.selectedAssignmentId) || null;
}

function getStudentAssignment() {
  return state.assignments.find((assignment) =>
    assignment.id === ui.selectedStudentAssignmentId &&
    assignment.status === "published" &&
    (!assignment.classId || assignment.classId === currentClassId)
  ) || null;
}

function getStudentSubmissionForAssignment(assignmentId, studentId = ui.activeUserId) {
  if (!assignmentId || !studentId) return null;
  return state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === studentId) || null;
}

function getStudentAssignmentBuckets() {
  const publishedAssignments = getPublishedAssignments();
  const current = [];
  const submitted = [];

  publishedAssignments.forEach((assignment) => {
    const submission = getStudentSubmissionForAssignment(assignment.id);
    const status = submission?.status || "draft";
    const hasSubmitted = SubmissionUtils.isSubmissionSubmitted(submission) || ["late", "missing"].includes(status);
    const bucketItem = {
      assignment,
      submission,
      status,
      isGraded: SubmissionUtils.isSubmissionGraded(submission),
    };
    if (hasSubmitted) {
      submitted.push(bucketItem);
    } else {
      current.push(bucketItem);
    }
  });

  return { current, submitted };
}

function getAssignmentSubmissions(assignmentId) {
  return state.submissions.filter((submission) => submission.assignmentId === assignmentId);
}

function getSubmissionCountsForAssignment(assignmentId, roster = currentClassMembers) {
  return SubmissionUtils.getAssignmentSubmissionCounts(getAssignmentSubmissions(assignmentId), roster);
}

function getReviewRoster(assignmentId = ui.selectedAssignmentId) {
  if (currentClassMembers.length) {
    return currentClassMembers
      .filter((member) => member?.id !== currentProfile?.id)
      .map((member) => ({
        id: member.id,
        name: member.name || "Student",
      }));
  }

  const seen = new Set();
  return getAssignmentSubmissions(assignmentId)
    .filter((submission) => {
      if (seen.has(submission.studentId)) return false;
      seen.add(submission.studentId);
      return true;
    })
    .map((submission) => ({
      id: submission.studentId,
      name: submission._studentName || getUserById(submission.studentId)?.name || "Student",
    }));
}

function getReviewSubmissionForStudent(studentId, assignmentId = ui.selectedAssignmentId) {
  return state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === studentId) || null;
}

function ensureTeacherReviewSubmission(assignmentId, studentId) {
  if (!assignmentId || !studentId) return null;
  const existing = getReviewSubmissionForStudent(studentId, assignmentId);
  if (existing) return existing;

  const placeholder = createEmptySubmission(assignmentId, studentId);
  placeholder.id = `pending-review-${assignmentId}-${studentId}`;
  placeholder.status = "not_started";
  placeholder.startedAt = null;
  placeholder.updatedAt = new Date().toISOString();
  placeholder._studentName = currentClassMembers.find((member) => member.id === studentId)?.name || getUserById(studentId)?.name || "Student";
  state.submissions.push(placeholder);
  return placeholder;
}

function getSelectedReviewStudent() {
  return getReviewRoster().find((student) => student.id === ui.selectedReviewStudentId) || null;
}

function getSelectedReviewSubmission() {
  if (ui.selectedReviewStudentId) {
    return ensureTeacherReviewSubmission(ui.selectedAssignmentId, ui.selectedReviewStudentId);
  }
  const selected = state.submissions.find((submission) => submission.id === ui.selectedReviewSubmissionId) || null;
  if (selected) {
    ui.selectedReviewStudentId = selected.studentId;
  }
  return selected;
}

function getStudentSubmission() {
  if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
    return null;
  }

  return state.submissions.find((submission) => submission.assignmentId === ui.selectedStudentAssignmentId && submission.studentId === ui.activeUserId) || null;
}

function rememberStudentStep(step, assignmentId = ui.selectedStudentAssignmentId) {
  const nextStep = clamp(Number(step || 1), 1, 4);
  ui.studentStep = nextStep;
  if (!assignmentId) return nextStep;
  ui.studentStepOverrides = ui.studentStepOverrides || {};
  ui.studentStepOverrides[assignmentId] = nextStep;
  return nextStep;
}

function getRememberedStudentStep(assignmentId = ui.selectedStudentAssignmentId) {
  if (!assignmentId) return null;
  const remembered = Number(ui.studentStepOverrides?.[assignmentId] || 0);
  return remembered >= 1 && remembered <= 4 ? remembered : null;
}

function getStudentStepForSubmission(submission) {
  if (submission?.status === "submitted" || submission?.submittedAt) return 3;
  const hasFinalWork = Boolean(
    submission?.finalText?.trim() ||
    submission?.reflections?.improved?.trim() ||
    safeArray(submission?.selfAssessment?.rowScores).length
  );
  if (hasFinalWork) return 3;
  const hasDraftWork = Boolean(
    submission?.draftText?.trim() ||
    safeArray(submission?.writingEvents).length ||
    safeArray(submission?.feedbackHistory).length
  );
  if (hasDraftWork) return 2;
  return 1;
}

function ensureStudentSubmission() {
  const existing = getStudentSubmission();
  if (existing) {
    return existing;
  }

  if (!ui.selectedStudentAssignmentId || !ui.activeUserId) {
    return null;
  }

  const submission = createEmptySubmission(ui.selectedStudentAssignmentId, ui.activeUserId);
  state.submissions.push(submission);
  persistState();
  return submission;
}

function hydrateSelections() {
  if (!state.assignments.some((assignment) => assignment.id === ui.selectedAssignmentId)) {
    ui.selectedAssignmentId = state.assignments[0]?.id || null;
  }

  const published = getPublishedAssignments();
  if (!published.some((assignment) => assignment.id === ui.selectedStudentAssignmentId)) {
    const buckets = getStudentAssignmentBuckets();
    const savedAssignmentId = getSavedStudentAssignmentId();
    const preferredCurrentId = buckets.current[0]?.assignment?.id || null;
    const preferredSubmittedId = buckets.submitted[0]?.assignment?.id || null;
    const nextAssignmentId = published.some((assignment) => assignment.id === savedAssignmentId)
      ? savedAssignmentId
      : (preferredCurrentId || preferredSubmittedId || published[0]?.id || null);
    ui.selectedStudentAssignmentId = nextAssignmentId;
  }

  if (ui.selectedStudentAssignmentId) {
    saveStudentAssignmentId(ui.selectedStudentAssignmentId);
  }

  ui.studentStep = clamp(ui.studentStep, 1, 4);
  const studentSubmission = ensureStudentSubmission();
  if (studentSubmission) {
    const rememberedStep = getRememberedStudentStep(ui.selectedStudentAssignmentId);
    const derivedStep = getStudentStepForSubmission(studentSubmission);
    ui.studentStep = rememberedStep || derivedStep;
  }

  const reviewRoster = getReviewRoster(ui.selectedAssignmentId);
  if (!reviewRoster.some((student) => student.id === ui.selectedReviewStudentId)) {
    ui.selectedReviewStudentId = reviewRoster[0]?.id || null;
  }

  ui.selectedReviewSubmissionId = ui.selectedReviewStudentId
    ? getReviewSubmissionForStudent(ui.selectedReviewStudentId, ui.selectedAssignmentId)?.id || null
    : null;
}

function getPlaybackState(submission) {
  const frames = getPlaybackFrames(submission);
  const index = clamp(ui.playback.index, 0, Math.max(frames.length - 1, 0));
  ui.playback.index = index;
  const frame = frames[index] || { text: "", label: "No frames yet" };

  return {
    frames,
    index,
    text: frame.text,
    label: frame.label,
    elapsedMs: frame.elapsedMs || 0,
    totalMs: frames[frames.length - 1]?.elapsedMs || 0,
    timeLabel: formatPlaybackElapsedLabel(frame.elapsedMs || 0, frames[frames.length - 1]?.elapsedMs || 0),
  };
}

function getPlaybackFrames(submission) {
  const events = safeArray(submission.writingEvents);
  const eventSignature = events
    .map((event) => `${event?.timestamp || ""}:${event?.type || ""}:${event?.start ?? ""}:${event?.end ?? ""}:${String(event?.insertedText || "").length}:${String(event?.removedText || "").length}`)
    .join("|");
  if (submission._playbackCache && submission._playbackCache.eventSignature === eventSignature) {
    return submission._playbackCache.frames;
  }

  const firstEventTime = events.map(getEventTimeMs).find((time) => Number.isFinite(time)) || 0;
  let text = "";
  const frames = [
    {
      text: "",
      label: "Start",
      timeMs: firstEventTime,
    },
  ];

  const pushFrame = (frameText, label, timeMs) => {
    frames.push({
      text: frameText,
      label,
      timeMs: Number.isFinite(timeMs) ? timeMs : (frames[frames.length - 1]?.timeMs || firstEventTime),
    });
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const eventTimeMs = getEventTimeMs(event) ?? (frames[frames.length - 1]?.timeMs || firstEventTime);
    const nextEventTimeMs = events.slice(eventIndex + 1).map(getEventTimeMs).find((time) => Number.isFinite(time));
    const intraEventDelayMs = getIntraEventDelayMs(event, nextEventTimeMs, eventTimeMs);
    let operationIndex = 0;
    const hasStructuredOp = typeof event.start === "number" && typeof event.end === "number";
    if (!hasStructuredOp) {
      text = submission.draftText || text;
      pushFrame(text, `${titleCase(event.type)} • ${formatTime(event.timestamp)}`, eventTimeMs);
      continue;
    }

    if (event.removedText) {
      for (let i = 0; i < event.removedText.length; i += 1) {
        const removeIndex = event.start;
        text = text.slice(0, removeIndex) + text.slice(removeIndex + 1);
        pushFrame(text, `Delete • ${formatTime(event.timestamp)}`, eventTimeMs + (operationIndex * intraEventDelayMs));
        operationIndex += 1;
      }
    }

    if (event.insertedText) {
      if (event.type === "paste") {
        text = text.slice(0, event.start) + event.insertedText + text.slice(event.start);
        pushFrame(text, `Paste • ${formatTime(event.timestamp)}`, eventTimeMs + (operationIndex * intraEventDelayMs));
        continue;
      }

      for (let i = 0; i < event.insertedText.length; i += 1) {
        const char = event.insertedText[i];
        const insertIndex = event.start + i;
        text = text.slice(0, insertIndex) + char + text.slice(insertIndex);
        pushFrame(text, `${titleCase(event.type)} • ${formatTime(event.timestamp)}`, eventTimeMs + (operationIndex * intraEventDelayMs));
        operationIndex += 1;
      }
    }
  }

  if ((submission.draftText || "") !== text) {
    pushFrame(submission.draftText || "", "Current draft", frames[frames.length - 1]?.timeMs || firstEventTime);
  }

  finalizePlaybackFrameDelays(frames);
  submission._playbackCache = {
    eventSignature,
    frames,
  };
  return frames;
}

function getSubmissionStatusDisplay(status) {
  const labels = {
    not_started: "Not started",
    draft: "In progress",
    submitted: "Submitted",
    late: "Late",
    missing: "Missing",
    graded: "Graded",
  };
  return labels[status] || titleCase(String(status || "").replaceAll("_", " "));
}

function canMarkLateOrMissing(assignment) {
  if (!assignment?.deadline) return false;
  return Date.now() > Date.parse(assignment.deadline);
}

function getNextReviewStudentId(currentStudentId, assignmentId = ui.selectedAssignmentId) {
  const roster = getReviewRoster(assignmentId);
  const index = roster.findIndex((student) => student.id === currentStudentId);
  if (index === -1 || index === roster.length - 1) return null;
  return roster[index + 1]?.id || null;
}

function calculateMeanBurstLength(submission) {
  const events = safeArray(submission?.writingEvents);
  if (!events.length) return 0;
  const pauses = safeArray(submission?.keystrokeLog).map(e => e.gap);
  if (!pauses.length) {
    const insertEvents = events.filter(e => e.type === "insert" && e.insertedText);
    if (!insertEvents.length) return 0;
    return Math.round(
      insertEvents.reduce((sum, e) => sum + String(e.insertedText || "").length, 0) / insertEvents.length
    );
  }
  const longPauses = pauses.filter(g => g >= 2000).length;
  const totalChars = events
    .filter(e => e.type === "insert")
    .reduce((sum, e) => sum + String(e.insertedText || "").length, 0);
  if (!longPauses) return totalChars;
  return Math.round(totalChars / (longPauses + 1));
}

function calculatePauseFrequency(submission) {
  const pauses = safeArray(submission?.keystrokeLog).filter(e => e.gap >= 2000);
  const finalText = submission?.finalText || submission?.draftText || "";
  const words = wordCount(finalText);
  if (!words) return 0;
  return Math.round((pauses.length / words) * 100);
}

function groupDeletionEvents(events) {
  const groups = [];
  let current = null;
  for (const e of events) {
    if (e.type !== 'delete' && e.type !== 'replace') continue;
    const gap = current ? Date.parse(e.timestamp) - Date.parse(current.lastTimestamp) : Infinity;
    const sameDirection = current && e.start === current.lastStart - 1;
    if (current && gap < 500 && sameDirection) {
      current.totalChars += Math.abs(e.delta || 0);
      current.lastTimestamp = e.timestamp;
      current.lastStart = e.start;
    } else {
      if (current) groups.push(current);
      current = {
        firstTimestamp: e.timestamp,
        lastTimestamp: e.timestamp,
        firstStart: e.start,
        lastStart: e.start,
        prevEnd: e.end,
        totalChars: Math.abs(e.delta || 0),
        type: e.type
      };
    }
  }
  if (current) groups.push(current);
  return groups;
}

function calculateMicroCorrections(submission, groupedDeletions) {
  const events = safeArray(submission?.writingEvents);
  const finalText = submission?.finalText || submission?.draftText || "";
  const words = wordCount(finalText);
  if (!words || !groupedDeletions.length) return 0;
  // Layer 1: small deletions (≤3 chars), within 2s of previous event, near cursor position
  let count = 0;
  for (let i = 0; i < groupedDeletions.length; i++) {
    const g = groupedDeletions[i];
    if (g.totalChars > 3) continue;
    // Find preceding event to check gap and position
    const gTime = Date.parse(g.firstTimestamp);
    // Find the event just before this deletion in the full event list
    const prevEvent = events.slice().reverse().find(e => Date.parse(e.timestamp) < gTime);
    if (!prevEvent) continue;
    const gap = gTime - Date.parse(prevEvent.timestamp);
    if (gap > 2000) continue;
    const prevPos = prevEvent.end !== undefined ? prevEvent.end : prevEvent.start;
    if (Math.abs(g.firstStart - prevPos) > 5) continue;
    count++;
  }
  return Math.round((count / words) * 100);
}

function calculateLocalRevisions(submission, groupedDeletions) {
  const finalText = submission?.finalText || submission?.draftText || "";
  const words = wordCount(finalText);
  if (!words || !groupedDeletions.length) return 0;
  const events = safeArray(submission?.writingEvents);
  let count = 0;
  for (const g of groupedDeletions) {
    if (g.totalChars < 4 || g.totalChars > 50) continue;
    const gTime = Date.parse(g.firstTimestamp);
    const prevEvent = events.slice().reverse().find(e => Date.parse(e.timestamp) < gTime);
    if (!prevEvent) continue;
    const gap = gTime - Date.parse(prevEvent.timestamp);
    const prevPos = prevEvent.end !== undefined ? prevEvent.end : prevEvent.start;
    const cursorJump = Math.abs(g.firstStart - prevPos) > 10;
    if (gap >= 2000 && gap <= 30000) { count++; continue; }
    if (gap < 2000 && cursorJump) { count++; continue; }
  }
  return Math.round((count / words) * 100);
}

function calculateSubstantiveRevisions(submission, groupedDeletions) {
  const events = safeArray(submission?.writingEvents);
  let count = 0;
  for (const g of groupedDeletions) {
    if (g.totalChars > 50) { count++; continue; }
    // Also catch: deletion after a very long pause (30s+) in same region
    const gTime = Date.parse(g.firstTimestamp);
    const prevEvent = events.slice().reverse().find(e => Date.parse(e.timestamp) < gTime);
    if (!prevEvent) continue;
    const gap = gTime - Date.parse(prevEvent.timestamp);
    if (gap > 30000) count++;
  }
  return count;
}

function calculateSessionCount(submission) {
  const events = safeArray(submission?.writingEvents);
  if (!events.length) return 1;
  let sessions = 1;
  for (let i = 1; i < events.length; i++) {
    const gap = Date.parse(events[i].timestamp) - Date.parse(events[i - 1].timestamp);
    if (gap > 30 * 60 * 1000) sessions++;
  }
  return sessions;
}

function calculateFluencySummary(submission) {
  const events = safeArray(submission?.writingEvents);
  const groupedDeletions = groupDeletionEvents(events);
  return {
    meanBurstLength: calculateMeanBurstLength(submission),
    pauseFrequency: calculatePauseFrequency(submission),
    microCorrections: calculateMicroCorrections(submission, groupedDeletions),
    localRevisions: calculateLocalRevisions(submission, groupedDeletions),
    substantiveRevisions: calculateSubstantiveRevisions(submission, groupedDeletions),
    sessionCount: calculateSessionCount(submission),
    calculatedAt: new Date().toISOString(),
  };
}

function computeProcessMetrics(assignment, submission) {
  const events = submission.writingEvents;
  const firstTimestamp = events[0]?.timestamp || submission.startedAt || submission.updatedAt || new Date().toISOString();
  const lastTimestamp = events[events.length - 1]?.timestamp || submission.submittedAt || submission.updatedAt || firstTimestamp;
  const totalMinutes = Math.max(1, Math.round((Date.parse(lastTimestamp) - Date.parse(firstTimestamp)) / 60000) || 1);
  const draftWordCount = wordCount(submission.draftText);
  const finalWordCount = wordCount(submission.finalText || submission.draftText);
  const improvement = finalWordCount - draftWordCount;
  const similarity = similarityRatio(submission.draftText, submission.finalText || submission.draftText);
  const improvementLabel =
    similarity < 0.55
      ? "major revision"
      : similarity < 0.8
        ? "clear revision"
        : improvement
          ? `${improvement > 0 ? "+" : ""}${improvement} words`
          : "light edit";

  return {
    totalMinutes,
    revisionCount: events.length,
    largePasteCount: events.filter((entry) => entry.type === "paste" && entry.flagged).length,
    draftWordCount,
    finalWordCount,
    improvementLabel,
    targetHit: finalWordCount >= assignment.wordCountMin && finalWordCount <= assignment.wordCountMax,
  };
}

function generateTeacherAssist(draft) {
  const brief = draft.brief.trim();
  const keywords = extractKeywords(brief);
  const assignmentType = detectAssignmentType(brief);
  const mainTopic = keywords[0] || "the topic";
  const title = buildTitleFromBrief(brief, assignmentType, mainTopic);
  const ranges = inferWordRange(brief, assignmentType);
  const studentFocus = focusForType(assignmentType, mainTopic);
  const totalPoints = Number(draft.totalPoints || 20);
  const baseRubric = rubricForType(assignmentType);
  const pointsEach = Math.floor(totalPoints / baseRubric.length);
  const remainder = totalPoints - pointsEach * baseRubric.length;
  const rubric = baseRubric.map((item, i) => ({
    ...item,
    points: i === baseRubric.length - 1 ? pointsEach + remainder : pointsEach,
    bands: createScoreBandsForPoints(i === baseRubric.length - 1 ? pointsEach + remainder : pointsEach),
  }));

  return {
    title,
    prompt: studentPromptForType(assignmentType, mainTopic, draft.languageLevel),
    focus: `Keep the student focused on ${studentFocus[0].toLowerCase()}.`,
    assignmentType,
    languageLevel: draft.languageLevel,
    wordCountMin: ranges.min,
    wordCountMax: ranges.max,
    studentFocus,
    rubric,
  };
}

function detectAssignmentType(text) {
  const lower = text.toLowerCase();
  if (/\bargue\b|\bopinion\b|\bpersuade\b|\bshould\b/.test(lower)) return "argument";
  if (/\bnarrative\b|\bstory\b|\bpersonal\b|\bmemory\b/.test(lower)) return "narrative";
  if (/\bprocess\b|\bsteps\b|\bhow to\b|\bprocedure\b/.test(lower)) return "process";
  if (/\bdefin\b|\bmeaning\b|\bwhat is\b|\bconcept\b/.test(lower)) return "definition";
  if (/\bcompar\b|\bcontrast\b|\bdifference\b|\bsimilar\b/.test(lower)) return "compare";
  if (/\bexplain\b|\binform\b|\bresearch\b|\bhow\b|\bwhy\b/.test(lower)) return "informational";
  return "response";
}

function rubricForType(type) {
  const rubricSets = {
    argument: [
      createSimpleRubricCriterion("Claim & Support", "States a clear opinion and supports it with relevant reasons or examples.", 4),
      createSimpleRubricCriterion("Organization", "Organises ideas logically so the opinion is easy to follow from start to finish.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate the argument.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    narrative: [
      createSimpleRubricCriterion("Story Development", "Builds a clear event or moment with meaningful detail.", 4),
      createSimpleRubricCriterion("Sequencing", "Orders events clearly so the reader can follow what happens.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to tell the story.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    process: [
      createSimpleRubricCriterion("Task Completion", "Explains the full process clearly so the reader can complete it.", 4),
      createSimpleRubricCriterion("Step Sequence", "Presents the steps in a logical order with clear connections.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the process.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    definition: [
      createSimpleRubricCriterion("Concept Accuracy", "Explains the concept clearly and accurately for the reader.", 4),
      createSimpleRubricCriterion("Development", "Uses explanation, examples, or clarification to make the meaning clear.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the meaning.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    compare: [
      createSimpleRubricCriterion("Comparison", "Covers both subjects and highlights meaningful similarities or differences.", 4),
      createSimpleRubricCriterion("Organization", "Groups ideas clearly so the comparison is easy to follow.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to compare the subjects.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    informational: [
      createSimpleRubricCriterion("Content Accuracy", "Explains the topic clearly with relevant supporting detail.", 4),
      createSimpleRubricCriterion("Organization", "Organises information clearly so the explanation is easy to follow.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the topic.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    response: [
      createSimpleRubricCriterion("Task Response", "Answers the prompt clearly and stays focused on the main point.", 4),
      createSimpleRubricCriterion("Organization", "Presents ideas in a logical order that is easy for the reader to follow.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate ideas.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
    other: [
      createSimpleRubricCriterion("Task Response", "Addresses the writing task clearly and appropriately.", 4),
      createSimpleRubricCriterion("Organization", "Presents ideas in a logical order that is easy for the reader to follow.", 4),
      createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate ideas.", 4),
      createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
    ],
  };

  return rubricSets[type] || rubricSets.other;
}

function studentPromptForType(type, topic, languageLevel) {
  const levelIntro =
    ["A0", "A1"].includes(languageLevel)
      ? "Use very short, simple sentences."
      : languageLevel === "A2"
        ? "Write in clear, simple sentences."
        : languageLevel === "B1"
          ? "Write clearly and explain your thinking."
          : languageLevel === "B2"
            ? "Write clearly and develop your ideas with some detail."
            : "Write clearly, develop your ideas fully, and use precise language.";

  if (type === "process") {
    return `${levelIntro} Explain how to do or make ${topic}. Describe each step clearly and in the right order.`;
  }
  if (type === "definition") {
    return `${levelIntro} Explain what ${topic} means. Give a clear definition and use at least one example to help the reader understand.`;
  }
  if (type === "compare") {
    return `${levelIntro} Compare and contrast two things related to ${topic}. Show how they are similar and how they are different.`;
  }
  if (type === "argument") {
    return `${levelIntro} Write an opinion piece about ${topic}. Say what you believe, give at least one strong reason or example, and explain why it matters.`;
  }
  if (type === "narrative") {
    return `${levelIntro} Write about a real or imagined moment connected to ${topic}. Make the event clear, include details, and show why the moment matters.`;
  }
  if (type === "informational") {
    return `${levelIntro} Explain ${topic}. Teach the reader using clear facts, examples, or details.`;
  }
  return `${levelIntro} Write a clear response about ${topic}. Stay focused and support your ideas with examples or explanation.`;
}

function focusForType(type, topic) {
  if (type === "process") {
    return [
      `explaining each step of ${topic} clearly`,
      "putting the steps in the right order",
      "adding enough detail so someone can follow along",
      "checking that no steps are missing or confusing",
    ];
  }
  if (type === "definition") {
    return [
      `giving a clear, accurate meaning of ${topic}`,
      "using at least one example that helps the reader understand",
      "explaining any difficult words",
      "making sure the definition is complete and easy to follow",
    ];
  }
  if (type === "compare") {
    return [
      `identifying the key features of both sides of ${topic}`,
      "finding at least two clear similarities or differences",
      "organising your points so the comparison is easy to follow",
      "checking that both sides are treated fairly",
    ];
  }
  if (type === "argument") {
    return [
      `a clear opinion about ${topic}`,
      "one strong reason or example",
      "explaining why that example supports the opinion",
      "fixing confusing sentences before submitting",
    ];
  }
  if (type === "narrative") {
    return [
      `one clear moment about ${topic}`,
      "details that help the reader picture it",
      "a clear beginning, middle, and end",
      "fixing places that feel rushed or confusing",
    ];
  }
  if (type === "informational") {
    return [
      `a clear explanation of ${topic}`,
      "facts or examples that teach the reader",
      "explaining one idea at a time",
      "checking that the writing is easy to understand",
    ];
  }
  return [
    `answering the question about ${topic}`,
    "using at least one helpful example",
    "explaining your thinking clearly",
    "improving the draft before submitting",
  ];
}

function inferWordRange(brief, assignmentType) {
  const match = brief.match(/(\d{2,4})\s*(?:to|-)\s*(\d{2,4})/);
  if (match) {
    return {
      min: Number(match[1]),
      max: Number(match[2]),
    };
  }

  if (assignmentType === "narrative") {
    return { min: 300, max: 500 };
  }
  return { min: 250, max: 400 };
}

function buildTitleFromBrief(brief, assignmentType, topic) {
  const cleaned = trimTo(brief.replace(/\s+/g, " ").trim(), 70);
  if (cleaned) {
    const firstSentence = cleaned.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 12) {
      return titleCase(trimTo(firstSentence, 46));
    }
  }
  return `${titleCase(assignmentType)} Writing: ${titleCase(topic)}`;
}

function getAssignmentRubricSummaryForAi(assignment) {
  return serializeRubricSchemaForPrompt(
    assignment?.uploadedRubricSchema || assignment?.rubricSchema || assignment?.rubric,
    assignment?.uploadedRubricName || assignment?.title || "Assignment rubric"
  ) || "No rubric provided.";
}

function buildDraftLinesWithPasteMarkers(submission) {
  const text = String(submission?.draftText || "");
  const flaggedRanges = safeArray(submission?.writingEvents)
    .filter((event) => event?.type === "paste" && event?.flagged && typeof event?.start === "number")
    .map((event) => ({
      start: Number(event.start || 0),
      end: Number(event.end ?? event.start ?? 0) + String(event.insertedText || "").length,
    }));
  const editor = document.getElementById("draft-editor");
  const metrics = getElementLineWrapMetrics(editor);
  return buildWrappedLineEntries(text, metrics).map((entry) => ({
    number: entry.number,
    text: entry.text,
    pasted: flaggedRanges.some((range) => entry.start < range.end && entry.end > range.start),
  }));
}

function buildAiIdeaRequest(assignment, submission) {
  const previousIdea = submission.ideaResponses.at(-1)?.rewrittenIdea || "";
  return {
    maxTokens: 450,
    temperature: 0.4,
    system: `You are a supportive writing coach helping a ${assignment.languageLevel || "B1"} student plan before drafting.

Return ONLY a JSON array of exactly 4 short bullet ideas.

Rules:
- Do not write any full assignment sentences for the student to copy.
- Give planning ideas only.
- Keep the language simple.
- Each bullet should be one sentence, practical, and specific to the task.
- If the student already has one idea, give a different angle or stronger example option.`,
    prompt: `Assignment title: ${assignment.title}
Assignment type: ${assignment.assignmentType}
Student-facing task:
${assignment.prompt}

Current outline or idea notes:
${previousIdea || "No saved idea yet."}

Rubric summary:
${getAssignmentRubricSummaryForAi(assignment)}

Respond with a JSON array of 4 short planning bullets.`,
  };
}

function buildAiFeedbackRequest(assignment, submission) {
  const lines = buildDraftLinesWithPasteMarkers(submission).filter((line) => String(line.text || "").trim());
  const previousFeedback = safeArray(submission.feedbackHistory)
    .flatMap((entry) => safeArray(entry.items))
    .slice(-12)
    .join("\n- ");
  const responseShape = `["feedback item 1", "feedback item 2", "feedback item 3"]`;

  return {
    maxTokens: 750,
    temperature: 0.2,
    system: `You are a careful writing teacher giving feedback to an ESL student.

Return ONLY a JSON array of 2 to 4 feedback strings.

Rules:
- Use the student's real visible line numbers.
- Ignore [PASTED] lines for judging quality, but still count them in line numbering.
- Point to specific measurable problems in the student's own writing.
- Quote a short snippet when helpful.
- Do NOT rewrite the sentence for the student.
- Do NOT repeat the same issue twice.
- On very short drafts, give at most two line-specific issues, then switch to structure/length guidance.
- Match the assignment type. A paragraph task should not be treated like a multi-paragraph essay.
- Prefer issues involving grammar, punctuation, spelling, logic, missing support, weak topic sentence, or weak ending.
- Keep the language simple and direct for a ${assignment.languageLevel || "B1"} student.`,
    prompt: `Assignment title: ${assignment.title}
Assignment type: ${assignment.assignmentType}
Expected length: ${assignment.wordCountMin}-${assignment.wordCountMax} words
Student-facing task:
${assignment.prompt}

Rubric summary:
${getAssignmentRubricSummaryForAi(assignment)}

Draft with visible line numbers:
${stringifyLinesWithMarkers(lines)}

Previous feedback already given (avoid repeating these ideas):
- ${previousFeedback || "None"}

Respond with only a JSON array like:
${responseShape}`,
  };
}

function buildAiGradeSuggestionRequest(assignment, submission) {
  const rubricOptions = safeArray(assignment?.rubric).map((criterion) => ({
    criterionId: criterion.id,
    criterionName: criterion.name,
    criterionDescription: criterion.description || "",
    maxPoints: Number(criterion.points || 0),
    bands: getCriterionBands(criterion).map((band) => ({
      bandId: band.id || `band-${criterion.id}-${band.points}`,
      label: band.label,
      points: Number(band.points || 0),
      description: band.description || "",
    })),
  }));
  const metrics = computeProcessMetrics(assignment, submission);

  return {
    maxTokens: 1400,
    temperature: 0.1,
    system: `You are a careful teacher helping draft a rubric-aligned grade suggestion.

Return ONLY a JSON object.

Rules:
- Use only the provided criterionId and bandId values.
- Be conservative and teacher-safe.
- Consider the final writing first, then process evidence.
- Very short or underdeveloped work should score low.
- Do not invent criteria or bands.
- Keep reasons short and concrete.`,
    prompt: `Assignment title: ${assignment.title}
Assignment type: ${assignment.assignmentType}
Word target: ${assignment.wordCountMin}-${assignment.wordCountMax}
Prompt:
${assignment.prompt}

Rubric options:
${JSON.stringify(rubricOptions, null, 2)}

Student final text:
${submission.finalText || "(blank)"}

Student draft text:
${submission.draftText || "(blank)"}

Student reflection:
${submission.reflections?.improved || "(blank)"}

Process metrics:
${JSON.stringify({
  finalWordCount: metrics.finalWordCount,
  revisionCount: metrics.revisionCount,
  largePasteCount: metrics.largePasteCount,
  feedbackCount: safeArray(submission.feedbackHistory).length,
  outlineComplete: isOutlineComplete(submission, assignment),
}, null, 2)}

Respond with ONLY this JSON shape:
{
  "criteria": [
    { "criterionId": "criterion-id", "bandId": "band-id", "reason": "short reason" }
  ],
  "justification": "2-4 sentence teacher-facing summary",
  "studentComment": "2-4 sentence student-facing summary"
}`,
  };
}

async function requestStudentIdeasFromAi(assignment, submission) {
  const response = await requestAiGenerate(buildAiIdeaRequest(assignment, submission), {
    retries: 1,
    timeoutMs: 22000,
  });
  const parsed = parseJsonResponse(response.response, []);
  const ideas = safeArray(parsed)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!ideas.length) {
    throw new Error("AI returned no usable ideas.");
  }
  return ideas;
}

async function requestDraftFeedbackFromAi(assignment, submission) {
  const response = await requestAiGenerate(buildAiFeedbackRequest(assignment, submission), {
    retries: 1,
    timeoutMs: 24000,
  });
  const parsed = parseJsonResponse(response.response, []);
  const items = safeArray(parsed)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!items.length) {
    throw new Error("AI returned no usable feedback.");
  }
  return items;
}

function mapAiGradeSuggestionToReview(assignment, submission, parsed) {
  const criteria = safeArray(parsed?.criteria);
  if (!criteria.length) {
    throw new Error("AI grade suggestion returned no criteria.");
  }

  const rowScores = [];
  const reasons = [];
  for (const selection of criteria) {
    const criterion = safeArray(assignment?.rubric).find((entry) => entry.id === selection?.criterionId);
    if (!criterion) continue;
    const band = getCriterionBands(criterion).find((entry) => (
      (entry.id || `band-${criterion.id}-${entry.points}`) === selection?.bandId
    ));
    if (!band) continue;
    rowScores.push(buildTeacherReviewRowScore(criterion, band));
    if (selection?.reason) {
      reasons.push({
        criterionId: criterion.id,
        name: criterion.name,
        reason: String(selection.reason).trim(),
      });
    }
  }

  if (!rowScores.length) {
    throw new Error("AI grade suggestion did not match any rubric bands.");
  }

  const summary = calculateTeacherReviewSummary(assignment, null, rowScores);
  return {
    generatedAt: new Date().toISOString(),
    criteria: safeArray(assignment?.rubric).map((criterion) => {
      const selected = rowScores.find((entry) => entry.criterionId === criterion.id);
      return {
        criterionId: criterion.id,
        name: criterion.name,
        points: criterion.points,
        score: Number(selected?.points || 0),
        bandLabel: selected?.label || "",
        bandId: selected?.bandId || "",
        reason: reasons.find((entry) => entry.criterionId === criterion.id)?.reason || "",
      };
    }),
    rowScores,
    totalScore: summary.totalScore,
    maxScore: summary.maxScore,
    justification: String(parsed?.justification || "").trim() || buildGradeJustification(assignment, submission, computeProcessMetrics(assignment, submission), summary.totalScore, summary.maxScore),
    studentComment: String(parsed?.studentComment || "").trim() || buildSuggestedStudentComment(assignment, submission, computeProcessMetrics(assignment, submission), summary.totalScore, summary.maxScore),
  };
}

async function requestGradeSuggestionFromAi(assignment, submission) {
  const response = await requestAiGenerate(buildAiGradeSuggestionRequest(assignment, submission), {
    retries: 1,
    timeoutMs: 26000,
  });
  const parsed = parseJsonResponse(response.response, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned invalid grade suggestion JSON.");
  }
  return mapAiGradeSuggestionToReview(assignment, submission, parsed);
}

function generateStudentIdeas(assignment, submission) {
  const topic = extractKeywords(`${assignment.title} ${assignment.prompt}`)[0] || "the topic";
  const type = assignment.assignmentType || "response";
  const previousIdea = submission.ideaResponses.at(-1)?.rewrittenIdea || "";

  if (type === "argument") {
    return [
      `Choose one clear opinion about ${topic}.`,
      `Think of one real example that supports your opinion about ${topic}.`,
      "Add one sentence that explains why your example matters.",
      previousIdea ? "Try a different reason so you have another option." : "Think of another reason in case you want a backup idea.",
    ];
  }

  if (type === "narrative") {
    return [
      `Pick one moment connected to ${topic}.`,
      "Think about what you saw, heard, or felt.",
      "Decide how the moment begins and ends.",
      "Choose one small detail that will help the reader picture it.",
    ];
  }

  return [
    `Choose one main idea about ${topic}.`,
    "Think of one fact, example, or reason that fits.",
    "Explain the idea in a way a classmate would understand.",
    previousIdea ? "Try another angle if your first idea feels too broad." : "Keep your topic small and clear.",
  ];
}

const SPECIFIC_FEEDBACK_SPELLING_PATTERNS = [
  { pattern: /\bteh\b/i, hint: 'the word "teh"' },
  { pattern: /\balot\b/i, hint: 'the word "alot"' },
  { pattern: /\bdefinately\b|\bdefinitly\b/i, hint: 'the word used for "definitely"' },
  { pattern: /\bbecuase\b|\bbecausee\b/i, hint: 'the word used for "because"' },
  { pattern: /\bconclu[sz]ion\b/i, hint: 'the word "conclusion"' },
  { pattern: /\bhappyness\b|\bhapiness\b/i, hint: 'the word used for "happiness"' },
  { pattern: /\bfreind\b/i, hint: 'the word used for "friend"' },
  { pattern: /\bwich\b/i, hint: 'the word used for "which"' },
];

function sentenceExcerpt(sentence = "", maxLength = 48) {
  const clean = String(sentence || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return trimTo(clean, maxLength);
}

function getFeedbackLineNumber(text = "", startIndex = 0) {
  const editor = document.getElementById("draft-editor");
  const metrics = getElementLineWrapMetrics(editor);
  const entries = buildWrappedLineEntries(text, metrics);
  const matchingEntry = entries.find((entry) => startIndex >= entry.start && startIndex <= entry.end);
  return matchingEntry?.number || 1;
}

function buildFeedbackSentenceEntries(text = "", pasteEvents = []) {
  const draftText = String(text || "");
  const rawSentences = splitSentences(draftText);
  const flaggedRanges = safeArray(pasteEvents)
    .filter((event) => event?.flagged && typeof event?.start === "number")
    .map((event) => ({
      start: Number(event.start || 0),
      end: Number(event.end ?? event.start ?? 0) + String(event.insertedText || "").length,
    }));

  let cursor = 0;
  return rawSentences.map((sentence) => {
    const trimmed = String(sentence || "").trim();
    const start = trimmed ? draftText.indexOf(trimmed, cursor) : -1;
    const safeStart = start >= 0 ? start : cursor;
    const end = safeStart + trimmed.length;
    cursor = Math.max(cursor, end);
    const lineNumber = getFeedbackLineNumber(draftText, safeStart);
    const overlapsPaste = flaggedRanges.some((range) => safeStart < range.end && end > range.start);
    return {
      text: trimmed,
      start: safeStart,
      end,
      lineNumber,
      overlapsPaste,
    };
  }).filter((entry) => entry.text);
}

function sentenceReference(entry, snippet = "") {
  const excerpt = snippet || sentenceExcerpt(entry?.text || "");
  const lineNumber = Number(entry?.lineNumber || 0) || 1;
  return excerpt ? `Line ${lineNumber} ("${excerpt}")` : `Line ${lineNumber}`;
}

function findSpecificSentenceFeedback(sentenceEntries = [], { singleParagraphTask = false, rubricFeedbackText = "", processTask = false } = {}) {
  const specifics = [];
  const seenIssueKeys = new Set();

  const pushIssue = (message, issueKey = message) => {
    if (!message || seenIssueKeys.has(issueKey)) return;
    seenIssueKeys.add(issueKey);
    specifics.push(message);
  };

  sentenceEntries.forEach((entry) => {
    const sentence = entry.text;
    const label = sentenceReference(entry);
    const isVeryShortSentence = wordCount(sentence) > 0 && wordCount(sentence) < 4;

    if (/^[a-z]/.test(sentence)) {
      pushIssue(`${label} starts with a lowercase letter. Fix the first word and then check whether the rest of the sentence also needs grammar or punctuation corrections.`, `lowercase-start:${entry.lineNumber}`);
    }

    const lowercaseIMatch = sentence.match(/\bi(?:\s+\w+){0,2}/);
    if (lowercaseIMatch) {
      pushIssue(`${sentenceReference(entry, lowercaseIMatch[0])} uses "i" in lowercase. Check that exact phrase and correct the capitalization.`, `lowercase-i:${entry.lineNumber}`);
    }

    const repeatedWordMatch = sentence.match(/\b([a-z']+)\s+\1\b/i);
    if (repeatedWordMatch) {
      pushIssue(`${sentenceReference(entry, repeatedWordMatch[0])} repeats a word. Remove the repetition and make sure the sentence still sounds natural.`, `repeat-word:${entry.lineNumber}`);
    }

    const weakTransitionMatch = sentence.match(/\bto conclusion\b|\bin other hand\b|\bon other hand\b|\bin the another hand\b/i);
    if (weakTransitionMatch) {
      pushIssue(`${sentenceReference(entry, weakTransitionMatch[0])} uses a transition phrase that does not sound correct. Recheck that phrase and the punctuation around it.`, `weak-transition:${entry.lineNumber}`);
    }

    if (wordCount(sentence) > 28) {
      pushIssue(`${label} is very long. Break it into two clearer sentences and check where the punctuation should go.`, `long-sentence:${entry.lineNumber}`);
    }

    if (wordCount(sentence) > 20 && (sentence.match(/,/g) || []).length >= 2) {
      pushIssue(`${label} has several commas and may be joining too many ideas together. Check whether one comma should become a full stop instead.`, `comma-heavy:${entry.lineNumber}`);
    }

    if (isVeryShortSentence && /mechanics|punctuation|spelling|grammar/.test(rubricFeedbackText)) {
      pushIssue(`${label} is very short. Check whether it is a complete sentence with both a subject and a verb.`, `short-sentence:${entry.lineNumber}`);
    }

    for (const issue of SPECIFIC_FEEDBACK_SPELLING_PATTERNS) {
      if (issue.pattern.test(sentence)) {
        const match = sentence.match(issue.pattern);
        pushIssue(`${sentenceReference(entry, match?.[0] || issue.hint)} may have a spelling problem. Check that exact word carefully and correct it.`, `spelling:${entry.lineNumber}`);
        break;
      }
    }

    if (/[a-z][.!?][A-Z]/.test(sentence.replace(/\s+/g, ""))) {
      pushIssue(`${label} may be missing a space after punctuation. Check the place where one sentence seems to run straight into the next one.`, `missing-space:${entry.lineNumber}`);
    }
  });

  if (singleParagraphTask && /topic sentence|main idea/.test(rubricFeedbackText) && sentenceEntries[0]?.text && wordCount(sentenceEntries[0].text) < 6) {
    pushIssue(`${sentenceReference(sentenceEntries[0])} is too short to clearly introduce the paragraph. Make the main idea more precise there.`);
  }

  if (singleParagraphTask && /concluding sentence|restates? the main idea|final comment/.test(rubricFeedbackText) && sentenceEntries.length) {
    const finalEntry = sentenceEntries[sentenceEntries.length - 1];
    const finalSentence = finalEntry.text;
    if (wordCount(finalSentence) < 7 && wordCount(finalSentence) >= 4) {
      pushIssue(`${sentenceReference(finalEntry)} feels too brief to work as a conclusion. Add a clearer final thought there.`, `weak-conclusion:${finalEntry.lineNumber}`);
    }
  }

  if (processTask && sentenceEntries.length) {
    const missingStepWordEntry = sentenceEntries.find((entry) => !/\bfirst\b|\bnext\b|\bthen\b|\bafter that\b|\bfinally\b|\blast\b/i.test(entry.text));
    if (missingStepWordEntry && sentenceEntries.length > 1) {
      pushIssue(`${sentenceReference(missingStepWordEntry)} could use a clearer step signal so the reader can follow the order more easily.`);
    }
  }

  return specifics;
}

function generateFeedback(assignment, submission) {
  const pasteEvents = (submission.writingEvents || []).filter(e => e.type === "paste" && e.flagged);
  const originalText = String(submission.draftText || "").trim();
  const hasFlaggedPaste = pasteEvents.length > 0;
  const sentenceEntries = buildFeedbackSentenceEntries(originalText, pasteEvents);
  const nonPastedSentenceEntries = sentenceEntries.filter((entry) => !entry.overlapsPaste);
  const text = nonPastedSentenceEntries.map((entry) => entry.text).join(" ").trim();
  const words = wordCount(text);
  const paragraphs = splitParagraphs(text);
  const sentences = nonPastedSentenceEntries.map((entry) => entry.text);
  const singleParagraphTask = assignmentUsesSingleParagraph(assignment);
  const finalSentence = sentences[sentences.length - 1] || "";
  const processTask = assignment?.assignmentType === "process";
  const essayTask = assignmentLikelyEssay(assignment);
  const rubricFeedbackText = getAssignmentRubricFeedbackText(assignment);
  const firstSentence = sentences[0] || "";

  if (!text) {
    return [
      "Start with one clear sentence that says what this piece will be about.",
      "Use one of your saved ideas to help you begin.",
    ];
  }

  // Primary checks — triggered by what's actually in the draft
  const primaryPool = [];
  const mechanicsFocused = /mechanics|punctuation|spelling|grammar/.test(rubricFeedbackText);
  const veryShortResponse = sentences.length <= 2 || words < Math.max(80, Number(assignment.wordCountMin || 0) * 0.4);

  primaryPool.push(...findSpecificSentenceFeedback(nonPastedSentenceEntries, {
    singleParagraphTask,
    rubricFeedbackText,
    processTask,
  }));

  if (hasFlaggedPaste) {
    primaryPool.push("Your draft contains pasted content. Please remove it and rewrite that section in your own words before requesting feedback.");
  }

  if (words < assignment.wordCountMin * 0.7) {
    primaryPool.push("Your draft is still short. Can you add one more example or explanation?");
  }

  if (essayTask && paragraphs.length < 3) {
    primaryPool.push("This still reads more like notes than an essay. Can you shape it into a clear introduction, body, and conclusion?");
  } else if (!singleParagraphTask && paragraphs.length < 2) {
    primaryPool.push("Could you split this into at least two parts so the reader can follow your thinking more easily?");
  }

  if (singleParagraphTask && /topic sentence|main idea/.test(rubricFeedbackText) && wordCount(firstSentence) < 6) {
    primaryPool.push("Look at your first sentence. Does it clearly state the main idea of the whole paragraph?");
  }

  if (singleParagraphTask && /supporting|detail|example|fact/.test(rubricFeedbackText) && !/\bbecause\b|\bfor example\b|\bfor instance\b|\bsuch as\b/i.test(text)) {
    primaryPool.push("Your paragraph needs a stronger supporting detail. Add one clear example, fact, or explanation that directly supports your main idea.");
  }

  if (singleParagraphTask && /concluding sentence|restates? the main idea|final comment/.test(rubricFeedbackText) && (wordCount(finalSentence) < 7 || finalSentence.toLowerCase() === firstSentence.toLowerCase())) {
    primaryPool.push("Check your last sentence. Does it give the reader a clear final thought about the paragraph instead of just stopping suddenly?");
  }

  if (essayTask && /organization|coherence|unity|body paragraph|introduction|conclusion/.test(rubricFeedbackText)) {
    const weakParagraph = paragraphs.find((paragraph) => wordCount(paragraph) < 35);
    if (weakParagraph) {
      primaryPool.push("One paragraph still feels thin. Which paragraph needs another example or explanation so it can do its job more clearly?");
    } else if (!paragraphs.every((paragraph) => splitSentences(paragraph).length >= 2)) {
      primaryPool.push("Check each paragraph separately. Does every paragraph have a clear topic sentence and enough support to match its role in the essay?");
    }
  }

  const missingEndPunctuationIndex = sentences.findIndex((sentence, index) => index === sentences.length - 1 && !/[.!?]["')\]]?$/.test(sentence));
  if (missingEndPunctuationIndex !== -1) {
    const entry = nonPastedSentenceEntries[missingEndPunctuationIndex];
    primaryPool.push(`${sentenceReference(entry, sentences[missingEndPunctuationIndex])} does not end with clear punctuation. Add the correct end mark and then reread the whole sentence.`);
  }

  if (!/\bbecause\b|\bfor example\b|\bfor instance\b|\bsuch as\b/i.test(text)) {
    primaryPool.push("Add a sentence that gives a reason or example so your writing feels stronger.");
  }

  if (processTask && !/\bfirst\b|\bnext\b|\bthen\b|\bafter that\b|\bfinally\b|\blast\b/i.test(text)) {
    primaryPool.push("Add clearer step words like first, next, then, or finally so the reader can follow your process.");
  }

  if (processTask && !/\byou should\b|\byou need to\b|\bit helps\b|\bthis helps\b|\bso that\b/i.test(text)) {
    primaryPool.push("Pick one step and explain why it helps, not just what the step is.");
  }

  if ((text.match(/\bthis\b|\bit\b|\bthey\b/gi) || []).length >= 5) {
    primaryPool.push("A few words like 'this' or 'it' may be unclear. Which one needs a more exact word?");
  }

  if (/sentence variety/.test(rubricFeedbackText) && hasLowSentenceVariety(sentences)) {
    primaryPool.push("Many of your sentences sound the same length. Could you combine one idea and shorten another so the writing has more variety?");
  }

  if (mechanicsFocused) {
    const shortFragments = nonPastedSentenceEntries.find(({ text: sentence }) => wordCount(sentence) > 0 && wordCount(sentence) < 4);
    if (shortFragments) {
      primaryPool.push(`${sentenceReference(shortFragments, shortFragments.text)} is very short. Check whether it is a complete sentence with both a subject and a verb.`);
    }
  }

  // Secondary checks — always available but only used when primary ones are exhausted or repeated
  const secondaryPool = [
    singleParagraphTask
      ? "Underline your topic sentence. Does every other sentence clearly support that one idea?"
      : "Read each paragraph and ask: does every sentence clearly support that paragraph’s job?",
    singleParagraphTask ? "Read each sentence and ask: does it clearly support your one main idea?" : "Check that each paragraph has one main job.",
    "Pick one sentence and check it word by word for spelling, capitals, and end punctuation before you submit again.",
    "Find the weakest sentence in your draft. Add one clear detail, or cut one unclear part, so the meaning becomes stronger.",
    !/\b(in conclusion|to conclude|overall|finally|to sum up)\b/i.test(finalSentence) || wordCount(finalSentence) < 8
      ? "Look at your final sentence. Does it clearly restate your main idea in your own words?"
      : "Read your final sentence aloud and check whether every word sounds deliberate rather than rushed.",
    "Choose one sentence that feels awkward and rewrite only that sentence more clearly in your own words.",
  ];

  // Collect all items already given in previous feedback rounds
  const normalizeFeedbackItem = (item) => String(item || "").toLowerCase().replace(/\s+/g, " ").trim();
  const previousItems = new Set(submission.feedbackHistory.flatMap((entry) => safeArray(entry.items).map(normalizeFeedbackItem)));

  // Filter each pool to only items not already given
  const dedupeFeedbackList = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = normalizeFeedbackItem(item);
      if (!key || previousItems.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const freshPrimary = dedupeFeedbackList(primaryPool);
  const freshSecondary = dedupeFeedbackList(secondaryPool);

  if (veryShortResponse) {
    const shortDraftPrompts = dedupeFeedbackList([
      essayTask
        ? "Your draft is still too short to show a full essay structure. Add more writing before you ask for another detailed check."
        : "Your draft is still very short. Add at least one or two more complete sentences before your next feedback check.",
      singleParagraphTask
        ? "Focus first on finishing the paragraph: a clear topic sentence, supporting detail, and a stronger final sentence."
        : "Focus first on finishing the structure of the piece before worrying about smaller grammar details.",
    ]);
    const targeted = freshPrimary.slice(0, 2);
    return [...targeted, ...shortDraftPrompts].slice(0, 4);
  }

  const combined = [...freshPrimary, ...freshSecondary];

  if (!combined.length) {
    return [
      "You have already used the main AI checks for this draft. Revise the issues you already found, then ask your teacher if you need more help.",
      "Read the whole draft once aloud and correct any sentence that still sounds awkward, unclear, or incomplete.",
    ];
  }

  return combined.slice(0, 4);
}

function getChatbotSystemPrompt(assignment) {
  const typeGuide = {
    argument:      "help the student identify a clear opinion, find one strong reason or example, and think about why it matters",
    narrative:     "help the student identify one specific moment, recall sensory details, and think about why the moment matters to them",
    process:       "help the student think through the steps in order, spot what might be unclear, and consider what the reader needs to know to follow along",
    definition:    "help the student explain what the term really means, think of a concrete example, and consider why understanding it matters",
    compare:       "help the student identify key features of both subjects, find meaningful similarities and differences, and decide which difference matters most",
    informational: "help the student identify their main idea, think of supporting facts or examples, and consider how to explain it clearly to a reader",
    response:      "help the student fully understand the question, form a clear answer, and find support for their thinking",
    other:         "help the student clarify what they want to say, find support for their ideas, and plan how to structure their response",
  };

 const focus = typeGuide[assignment.assignmentType] || typeGuide.other;

  return `You are a supportive writing coach helping a student plan their writing. Your role is to ${focus}.

RULES:
1. Ask ONE question at a time. Keep it short and friendly.
2. NEVER write text the student could copy into their assignment.
3. If a student seems stuck or says they don't know, don't keep pushing. Instead, offer a simple, structured prompt like: "What are your two or three main ideas?" or "Which of those ideas would make the most sense to write about first?"
4. Help the student organise their thinking by asking questions like: "What is the most important thing you want to say?", "Which idea would come first — and why?", "What example could you use to explain that?"
5. If the student asks you to write for them, gently redirect with a question instead.
6. Match your vocabulary to CEFR level ${assignment.languageLevel} — keep it simple and encouraging.
7. Never repeat the same question twice in a conversation.
8. After two or three useful student replies, briefly check whether they already have enough ideas to begin drafting. Ask a choice-style question such as: "Do you feel ready to draft now, or do you want one more planning question?"
9. If the student seems ready, tell them clearly to click the Next button to move into the draft area. Do not tell them to write sentences in the chat.
10. Do not accept vague ideas too quickly. If the student gives something broad like "ask the teacher" or "do research", ask a follow-up such as "What exactly would you ask?" or "Why would that help?" before moving on.
11. Before you move from one main idea or step to the next, ask whether the student feels satisfied with the current one or wants to develop it a little more.
12. If the student gives a weak first step, ask them to make it more specific before you accept it. For example, turn "ask the teacher" into one concrete question they could ask.
13. When the assignment is about process or steps, help the student improve each step before moving to the next one.
14. Never say "share it here" or ask the student to draft their first sentence in chat. The chat is only for planning.

Assignment title: "${assignment.title}"
Task: "${assignment.prompt}"

Start by asking the student what topic or idea they are thinking about. If they struggle to answer, suggest they think about two or three possible ideas and pick the one they feel most confident about.`;
}

function flashScrollTarget(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.boxShadow = "0 0 0 3px rgba(91,42,134,0.28)";
  el.style.transition = "box-shadow 0.2s ease";
  window.setTimeout(() => {
    el.style.boxShadow = "";
  }, 1600);
}

function scrollToAnnotation(annotationId) {
  flashScrollTarget(document.getElementById(`annotation-${annotationId}`));
}

function scrollToComment(annotationId) {
  flashScrollTarget(document.getElementById(`comment-${annotationId}`));
}

function preserveTeacherTextScroll(fn) {
  const container = document.getElementById("student-text-annotate");
  const scrollTop = container ? container.scrollTop : 0;
  fn();
  requestAnimationFrame(() => {
    const nextContainer = document.getElementById("student-text-annotate");
    if (nextContainer) {
      nextContainer.scrollTop = scrollTop;
    }
  });
}

function captureAnnotationSelection() {
  const container = document.getElementById("student-text-annotate");
  const selection = window.getSelection();
  if (!container || !selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  if (!selectedText) return;
  const commonNode = range.commonAncestorContainer;
  if (container.contains(commonNode)) {
    ui.lastAnnotationSelection = selectedText;
  }
}

function getAnnotationDisplayLabel(annotation, index = null) {
  const code = String(annotation?.code || "NOTE").trim() || "NOTE";
  return Number.isInteger(index) ? `${code} ${index + 1}` : code;
}

function renderAnnotatedText(submission, options = {}) {
  const {
    annotationClickTarget = "comment",
    includeClickHandlers = true,
    idPrefix = "",
  } = options;
  const text = submission?.finalText || submission?.draftText || "No text submitted yet.";
  const annotations = submission?.teacherReview?.annotations || [];
  const flaggedPastes = (submission?.writingEvents || []).filter(
    (e) => e.type === "paste" && e.flagged && e.insertedText
  );

  const highlights = [];
  const pasteHighlights = [];
  const searchStarts = new Map();

  const findNextSequentialIndex = (needle) => {
    if (!needle) return -1;
    const start = Number(searchStarts.get(needle) || 0);
    let idx = text.indexOf(needle, start);
    if (idx === -1 && start > 0) {
      idx = text.indexOf(needle);
    }
    if (idx !== -1) {
      searchStarts.set(needle, idx + Math.max(needle.length, 1));
    }
    return idx;
  };

  for (const paste of flaggedPastes) {
    const startHint = Number.isFinite(Number(paste.start)) ? Number(paste.start) : -1;
    const idx = startHint >= 0 && text.slice(startHint, startHint + paste.insertedText.length) === paste.insertedText
      ? startHint
      : findNextSequentialIndex(paste.insertedText);
    if (idx !== -1) {
      const end = idx + paste.insertedText.length;
      const pasteHighlight = {
        start: idx,
        end,
        type: "paste",
        annotationIds: [],
        annotationCodes: [],
        annotationLabels: [],
      };
      pasteHighlights.push(pasteHighlight);
      highlights.push(pasteHighlight);
    }
  }

  searchStarts.clear();
  safeArray(annotations).forEach((ann, index) => {
    const idx = findNextSequentialIndex(ann.selectedText);
    if (idx !== -1) {
      const end = idx + ann.selectedText.length;
      const overlappingPastes = pasteHighlights.filter((range) => idx < range.end && end > range.start);
      const overlapsPaste = overlappingPastes.length > 0;
      const annotationLabel = getAnnotationDisplayLabel(ann, index);
      overlappingPastes.forEach((paste) => {
        paste.annotationIds.push(ann.id || uid("ann"));
        paste.annotationCodes.push(ann.code);
        paste.annotationLabels.push(annotationLabel);
      });

      highlights.push({
        start: idx,
        end,
        code: ann.code,
        label: annotationLabel,
        type: "annotation",
        id: ann.id || uid("ann"),
        overlapsPaste,
      });
    }
  });

  if (!highlights.length) return escapeHtml(text);

  highlights.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    if (a.type === b.type) return 0;
    return a.type === "paste" ? -1 : 1;
  });

  let result = "";
  let cursor = 0;

  for (const h of highlights) {
    if (h.start < cursor) continue;

    result += escapeHtml(text.slice(cursor, h.start));
    const segment = escapeHtml(text.slice(h.start, h.end));

    if (h.type === "paste") {
      const pasteTitle = h.annotationLabels?.length
        ? `Pasted content — teacher review required. Also tagged: ${h.annotationLabels.join(", ")}`
        : "Pasted content — teacher review required";
      const overlayCodes = h.annotationLabels?.length
        ? `<sup style="font-size:0.76em;color:#5b2a86;font-weight:800;margin-left:4px;background:rgba(255,255,255,0.82);padding:1px 4px;border-radius:999px;">${escapeHtml(h.annotationLabels.join("/"))}</sup>`
        : "";
      const overlayTarget = annotationClickTarget === "annotation" ? "scrollToAnnotation" : "scrollToComment";
      const overlayIds = includeClickHandlers && h.annotationIds?.length ? ` onclick="${overlayTarget}('${escapeAttribute(h.annotationIds[0])}')"` : "";
      const overlayStyle = h.annotationCodes?.length ? "border:2px solid #5b2a86;" : "";
      const pasteAnchors = safeArray(h.annotationIds)
        .map((id) => `<span id="${escapeAttribute(`${idPrefix}annotation-${id}`)}"></span>`)
        .join("");
      result += `<mark class="paste-highlight"${overlayIds} style="${overlayStyle}" title="${escapeAttribute(pasteTitle)}">${pasteAnchors}${segment}<sup style="font-size:0.7em;color:#9b4dca;font-weight:700;">PASTE</sup>${overlayCodes}</mark>`;
    } else {
      const markId = `${idPrefix}annotation-${h.id}`;
      const clickHandler = includeClickHandlers
        ? ` onclick="${annotationClickTarget === "annotation" ? "scrollToAnnotation" : "scrollToComment"}('${escapeAttribute(h.id)}')"`
        : "";
      if (h.overlapsPaste) {
        result += `<mark id="${escapeAttribute(markId)}"${clickHandler} style="background:rgba(91,42,134,0.10);border:2px solid #5b2a86;color:inherit;border-radius:4px;padding:2px 4px;scroll-margin-top:120px;cursor:pointer;" title="Click to jump to comment">${segment}<sup style="font-size:0.7em;color:#5b2a86;font-weight:700;margin-left:3px;">${escapeHtml(h.label || h.code)}</sup></mark>`;
      } else {
        result += `<mark id="${escapeAttribute(markId)}"${clickHandler} style="background:#fff176;color:#2f2416;border-radius:4px;padding:2px 4px;scroll-margin-top:120px;cursor:pointer;" title="Click to jump to comment">${segment}<sup style="font-size:0.7em;color:var(--accent-deep);font-weight:700;margin-left:3px;">${escapeHtml(h.label || h.code)}</sup></mark>`;
      }
    }

    cursor = h.end;
  }

  result += escapeHtml(text.slice(cursor));
  return result;
}

function downloadStudentWork(assignment, submission) {
  const student = getUserById(submission.studentId);
  const studentName = student?.name || "Student";
  const reviewRows = getTeacherReviewRowsForExport(assignment, submission);
  const totalScore = calculateTeacherReviewSummary(assignment, submission).totalScore;
  const maxScore = reviewRows.reduce((sum, row) => sum + row.maxPoints, 0);
  const currentStatus = submission.status || submission.teacherReview?.status || "not_started";
  const chatLines = (submission.chatHistory || []).map((m) => `
    <div class="msg msg-${m.role}">
      <strong>${m.role === "assistant" ? "Coach" : studentName}</strong>
      <p>${escapeHtml(m.content)}</p>
    </div>`).join("");

  const events = submission.writingEvents || [];
  const hasMarkedCopy = Boolean(
    safeArray(submission.teacherReview?.annotations).length ||
    safeArray(submission.writingEvents).some((entry) => entry?.type === "paste" && entry?.flagged && entry?.insertedText)
  );
  const annotations = safeArray(submission.teacherReview?.annotations);
  const annotatedCopyHtml = renderAnnotatedText(submission, {
    annotationClickTarget: "comment",
    idPrefix: "sheet-",
  });
  const finalSubmissionHtml = hasMarkedCopy
    ? `<div class="marked-copy">${annotatedCopyHtml}</div>`
    : `<pre>${escapeHtml(submission.finalText || "No final text.")}</pre>`;
  const insertCount = events.filter(e => e.type === "insert").length;
  const deleteCount = events.filter(e => e.type === "delete").length;
  const pasteCount = events.filter(e => e.type === "paste").length;
  const flaggedCount = events.filter(e => e.flagged).length;
  const totalChars = events.reduce((sum, e) => sum + Math.abs(e.delta || 0), 0);
  const eventSummary = `
    <tr><td>Insertions</td><td>${insertCount} events</td></tr>
    <tr><td>Deletions</td><td>${deleteCount} events</td></tr>
    <tr><td>Pastes</td><td>${pasteCount} events${flaggedCount ? ` (${flaggedCount} flagged ⚠)` : ""}</td></tr>
    <tr><td>Total characters changed</td><td>${totalChars.toLocaleString()}</td></tr>
    <tr><td>Total editing events</td><td>${events.length}</td></tr>
  `;

  const rubricLines = reviewRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.criterion)}</td>
      <td>${escapeHtml(row.description || "—")}</td>
      <td>${escapeHtml(row.selectedLabel || "Not scored")}${row.selectedDescription ? `<div style="margin-top:4px;color:#667063;">${escapeHtml(row.selectedDescription)}</div>` : ""}</td>
      <td>${row.selectedPoints}/${row.maxPoints}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escapeHtml(assignment.title)} — ${escapeHtml(studentName)} Grade Sheet</title>
	<style>
	  :root{--accent-deep:#844125}
	  body{font-family:Georgia,serif;max-width:820px;margin:40px auto;color:#1f2a1f;line-height:1.6}
  h1{font-size:1.5rem;border-bottom:2px solid #a55233;padding-bottom:8px}
  h2{font-size:1.1rem;margin-top:32px;color:#a55233}
  .meta{color:#667063;font-size:.9rem;margin-bottom:24px}
  .section{margin-top:24px}
  .msg{margin:10px 0;padding:10px 14px;border-radius:8px}
  .msg-assistant{background:#f4efe6;border-left:3px solid #a55233}
  .msg-user{background:#edf4ea;border-left:3px solid #6f8868}
  .msg strong{display:block;font-size:.8rem;margin-bottom:4px;color:#667063}
  .msg p{margin:0}
  pre{white-space:pre-wrap;word-break:break-word;background:#f8f3ea;padding:16px;border-radius:8px;font-size:.92rem}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th{text-align:left;padding:6px 10px;background:#f4efe6}
  td{padding:6px 10px;border-bottom:1px solid #ddd2c2}
	  mark{background:#fff176;border-radius:3px;padding:1px 2px;}
	  .marked-copy{white-space:pre-wrap;word-break:break-word;background:#fffdf8;border:1px solid #ddd2c2;padding:16px;border-radius:8px;font-size:.92rem}
	  .paste-highlight{background:#ead8ff;border-radius:3px;padding:1px 2px;}
	  .annotation-row{cursor:pointer}
	  .annotation-row:hover{background:#fff9e6}
	  [id^="sheet-annotation-"],[id^="sheet-comment-"]{scroll-margin-top:24px}
	  sup{font-size:0.7em;color:#a55233;font-weight:700;}
	  @media print{body{margin:20px}}
	</style>
	<script>
	  function flashScrollTarget(el) {
	    if (!el) return;
	    el.scrollIntoView({ behavior: "smooth", block: "center" });
	    el.style.boxShadow = "0 0 0 3px rgba(91,42,134,0.28)";
	    el.style.transition = "box-shadow 0.2s ease";
	    window.setTimeout(function () { el.style.boxShadow = ""; }, 1600);
	  }
	  function scrollToAnnotation(annotationId) {
	    flashScrollTarget(document.getElementById("sheet-annotation-" + annotationId));
	  }
	  function scrollToComment(annotationId) {
	    flashScrollTarget(document.getElementById("sheet-comment-" + annotationId));
	  }
	</script>
	</head>
<body>
<h1>${escapeHtml(assignment.title)}</h1>
<div class="meta">
  Student: <strong>${escapeHtml(studentName)}</strong> &nbsp;|&nbsp;
  Status: <strong>${escapeHtml(getSubmissionStatusDisplay(currentStatus))}</strong> &nbsp;|&nbsp;
  Submitted: <strong>${submission.submittedAt ? escapeHtml(formatDateTime(submission.submittedAt)) : "Not yet submitted"}</strong>
  ${assignment.deadline ? `&nbsp;|&nbsp; Deadline: <strong>${escapeHtml(new Date(assignment.deadline).toLocaleString())}</strong>` : ""}
</div>

<h2>Assignment</h2>
<p>${escapeHtml(assignment.prompt)}</p>

<h2>Teacher grade summary</h2>
<p><strong>Total score:</strong> ${totalScore}/${maxScore}</p>
${submission.teacherReview?.finalNotes ? `<p><strong>Overall feedback:</strong> ${escapeHtml(submission.teacherReview.finalNotes)}</p>` : ""}

<h2>Rubric breakdown</h2>
<table>
  <thead><tr><th>Criterion</th><th>Description</th><th>Selected band</th><th>Score</th></tr></thead>
  <tbody>${rubricLines || "<tr><td colspan='4'>No rubric available.</td></tr>"}</tbody>
</table>

<h2>1 — Coaching conversation</h2>
${chatLines || "<p><em>No conversation recorded.</em></p>"}

<h2>2 — Draft writing log</h2>
<table>
  <thead><tr><th>Event type</th><th>Summary</th></tr></thead>
  <tbody>${events.length ? eventSummary : "<tr><td colspan='2'>No events recorded.</td></tr>"}</tbody>
</table>

<h2>Draft text</h2>
<pre>${escapeHtml(submission.draftText || "No draft.")}</pre>

	<h2>3 — Final submission</h2>
	${finalSubmissionHtml}

	${annotations.length ? `
	<h2>Teacher annotations</h2>
	<table>
	  <thead><tr><th>Code</th><th>Selected text</th><th>Note</th></tr></thead>
	  <tbody>${annotations.map((ann, i) => `
	    <tr id="sheet-comment-${escapeAttribute(ann.id)}" class="annotation-row" onclick="scrollToAnnotation('${escapeAttribute(ann.id)}')" title="Jump to highlighted text">
	      <td><strong>${escapeHtml(getAnnotationDisplayLabel(ann, i))}</strong></td>
	      <td style="background:#fff9e6;">"${escapeHtml(ann.selectedText)}"</td>
	      <td>${escapeHtml(ann.note || "")}</td>
    </tr>`).join("")}
  </tbody>
</table>` : ""}

  <h2>Reflection — what I improved</h2>
  <p>${escapeHtml(submission.reflections?.improved || "—")}</p>

</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const currentClass = currentClasses.find(c => c.id === currentClassId);
  const className = currentClass?.name || "class";
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `${(assignment.title || "assignment").replace(/\s+/g, "-")}-${studentName.replace(/\s+/g, "-")}-${className.replace(/\s+/g, "-")}-${dateStr}-grade-sheet.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
 URL.revokeObjectURL(url);
}

function getOutlineFields(assignment, submission) {
  const type = assignment.assignmentType || "response";
  const topic = extractKeywords(`${assignment.title} ${assignment.prompt}`)[0] || "your topic";
  const outline = submission.outline || {};

  if (type === "process") {
    return {
      fields: [
        { key: "partOne", label: "What you are explaining how to do", placeholder: "I am going to explain how to..." },
        { key: "partTwo", label: "The key steps", placeholder: "The main steps are..." },
        { key: "partThree", label: "Final step or result", placeholder: "At the end, the reader will be able to..." },
      ],
      values: outline,
    };
  }
  if (type === "definition") {
    return {
      fields: [
        { key: "partOne", label: "The term and its core meaning", placeholder: `${topic} means...` },
        { key: "partTwo", label: "An example that shows the meaning", placeholder: "For example..." },
        { key: "partThree", label: "Why this definition matters", placeholder: "Understanding this is important because..." },
      ],
      values: outline,
    };
  }
  if (type === "compare") {
    return {
      fields: [
        { key: "partOne", label: "What you are comparing", placeholder: "I am comparing ... and ..." },
        { key: "partTwo", label: "Key similarities", placeholder: "Both are similar because..." },
        { key: "partThree", label: "Key differences", placeholder: "The main difference is..." },
      ],
      values: outline,
    };
  }
  if (type === "argument") {
    return {
      fields: [
        { key: "partOne", label: "My claim", placeholder: `I believe...` },
        { key: "partTwo", label: "My best reason or example", placeholder: `One strong reason or example is...` },
        { key: "partThree", label: "How I will explain it", placeholder: `This matters because...` },
      ],
      values: outline,
    };
  }

  if (type === "narrative") {
    return {
      fields: [
        { key: "partOne", label: "Beginning", placeholder: "At the start..." },
        { key: "partTwo", label: "Important moment", placeholder: "The key moment is..." },
        { key: "partThree", label: "Ending or meaning", placeholder: "At the end, the reader should understand..." },
      ],
      values: outline,
    };
  }

  return {
    fields: [
      { key: "partOne", label: "Main idea", placeholder: `I am explaining ${topic} by saying...` },
      { key: "partTwo", label: "Example or fact", placeholder: "One example or fact is..." },
      { key: "partThree", label: "Why it matters", placeholder: "This matters because..." },
    ],
    values: outline,
  };
}

function isOutlineComplete(submission, assignment) {
  const config = getOutlineFields(assignment, submission);
  return config.fields.every((field) => String(submission.outline?.[field.key] || "").trim());
}

function renderTextWithPasteHighlights(text, writingEvents) {
  if (!text) return "";
  const flaggedPastes = (writingEvents || []).filter(e => e.type === "paste" && e.flagged && e.insertedText);
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

function gradeSubmission(assignment, submission) {
  const rubric = assignment.rubric.length ? assignment.rubric : rubricForType(assignment.assignmentType);
  const metrics = computeProcessMetrics(assignment, submission);
  const finalText = submission.finalText || "";
  const draftText = submission.draftText || "";
  const paragraphs = splitParagraphs(finalText);
  const evidenceSignals = (finalText.match(/\bfor example\b|\bbecause\b|\bfor instance\b|\bsuch as\b/gi) || []).length;
  const revisionStrength = 1 - similarityRatio(draftText, submission.finalText || draftText);
  const reflectionsComplete = Boolean(submission.reflections.improved.trim());
  const outlineComplete = isOutlineComplete(submission, assignment);
  const flaggedPasteCount = safeArray(submission.writingEvents).filter((entry) => entry.type === "paste" && entry.flagged).length;
  const finalWordCount = wordCount(finalText);
  const draftWordCount = wordCount(draftText);
  const minimalSubmission = finalWordCount <= 1 && draftWordCount <= 1;
  const severelyUnderdeveloped = !minimalSubmission && finalWordCount < Math.max(15, Math.min(Math.round((assignment.wordCountMin || 0) * 0.15), 40));

  const criteria = rubric.map((criterion) => {
    let scoreRatio = 0.65;
    const name = `${criterion.name} ${criterion.description}`.toLowerCase();

    if (minimalSubmission) {
      scoreRatio = 0;
    } else if (severelyUnderdeveloped) {
      scoreRatio = clamp01(
        0.04 +
        (finalWordCount >= 8 ? 0.08 : 0) +
        (evidenceSignals ? 0.04 : 0) +
        (reflectionsComplete ? 0.04 : 0) +
        (outlineComplete ? 0.04 : 0)
      );
    } else
    if (name.includes("claim") || name.includes("opinion") || name.includes("main idea") || name.includes("task")) {
      scoreRatio = clamp01((metrics.targetHit ? 0.25 : 0.15) + (paragraphs.length >= 2 ? 0.25 : 0.12) + (hasOpeningClaim(finalText) ? 0.3 : 0.18));
    } else if (name.includes("reason") || name.includes("evidence") || name.includes("example") || name.includes("detail") || name.includes("support")) {
      scoreRatio = clamp01(0.25 + Math.min(evidenceSignals, 3) * 0.18 + (wordCount(finalText) >= assignment.wordCountMin ? 0.2 : 0.1));
    } else if (name.includes("organization") || name.includes("clarity") || name.includes("sequence")) {
      scoreRatio = clamp01(0.25 + (paragraphs.length >= 3 ? 0.25 : 0.12) + (averageSentenceLength(finalText) < 24 ? 0.25 : 0.1) + (metrics.revisionCount > 6 ? 0.15 : 0.08));
    } else {
      scoreRatio = clamp01(0.22 + revisionStrength * 0.28 + (reflectionsComplete ? 0.14 : 0.05) + (outlineComplete ? 0.14 : 0.04) + (submission.feedbackHistory.length ? 0.08 : 0.03) - Math.min(flaggedPasteCount, 2) * 0.08);
    }

    const rawScore = Math.round(scoreRatio * criterion.points);
    const suggestedBand = findClosestBand(criterion, rawScore);
    const suggestedRowScore = suggestedBand
      ? buildTeacherReviewRowScore(criterion, suggestedBand)
      : buildTeacherReviewRowScore(criterion, {
          id: `band-${criterion.id}-${rawScore}`,
          label: `${rawScore}`,
          points: rawScore,
        });

    return {
      criterionId: criterion.id,
      name: criterion.name,
      points: criterion.points,
      score: suggestedRowScore.points,
      bandLabel: suggestedRowScore.label,
      bandId: suggestedRowScore.bandId,
      reason: buildCriterionReason(criterion.name, metrics, revisionStrength, reflectionsComplete, evidenceSignals),
    };
  });

  if (minimalSubmission) {
    criteria.forEach((criterion) => {
      criterion.score = 0;
      criterion.reason = "There is almost no submitted writing here, so this criterion cannot earn credit yet.";
    });
  } else if (severelyUnderdeveloped) {
    criteria.forEach((criterion) => {
      criterion.score = Math.min(criterion.score, Math.round(criterion.points * 0.25));
      criterion.reason = `The submission is far below the expected length, so scoring is capped until the student develops the writing further.${flaggedPasteCount ? ` The process also shows ${flaggedPasteCount} large paste event${flaggedPasteCount === 1 ? "" : "s"}, so authorship confidence should be checked.` : ""}`;
    });
  }

  const totalScore = criteria.reduce((sum, item) => sum + item.score, 0);
  const maxScore = criteria.reduce((sum, item) => sum + item.points, 0);
  const rowScores = criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    criterionName: criterion.name,
    bandId: criterion.bandId,
    label: criterion.bandLabel,
    points: criterion.score,
    maxPoints: criterion.points,
  }));

  return {
    generatedAt: new Date().toISOString(),
    criteria,
    rowScores,
    totalScore,
    maxScore,
    justification: buildGradeJustification(assignment, submission, metrics, totalScore, maxScore),
    studentComment: buildSuggestedStudentComment(assignment, submission, metrics, totalScore, maxScore),
  };
}

function buildCriterionReason(name, metrics, revisionStrength, reflectionsComplete, evidenceSignals) {
  const lower = name.toLowerCase();
  const pasteConcern = metrics.largePasteCount ? ` The process also shows ${metrics.largePasteCount} large paste event${metrics.largePasteCount === 1 ? "" : "s"}, so authorship confidence should be checked.` : "";
  if (lower.includes("claim") || lower.includes("opinion") || lower.includes("main idea") || lower.includes("task")) {
    return (metrics.targetHit ? "The final piece stays on task and fits the assignment range." : "The piece answers the task, but the central idea could be clearer or fuller.") + pasteConcern;
  }
  if (lower.includes("reason") || lower.includes("evidence") || lower.includes("example") || lower.includes("detail") || lower.includes("support")) {
    return (evidenceSignals ? "The writing includes examples or explanation cues that support the main idea." : "The piece would be stronger with a clearer example or more explanation.") + pasteConcern;
  }
  if (lower.includes("organization") || lower.includes("clarity") || lower.includes("sequence")) {
    return (metrics.revisionCount >= 2 ? "The writing process shows some reworking, which supports a clearer final structure." : "The final piece is readable, though the revision process appears light.") + pasteConcern;
  }
  return reflectionsComplete ? `The student completed the reflection, and the draft-to-final change suggests ${revisionStrength > 0.35 ? "meaningful" : "some"} revision.${pasteConcern}` : `The process is visible, but the reflection is incomplete or thin.${pasteConcern}`;
}

function isJibberish(text) {
  if (!text || text.trim().length < 3) return true;
  const t = text.trim();
  const wordList = t.split(/\s+/);
  if (wordList.length < 2 && t.length < 8) return true;
  const uniqueChars = new Set(t.toLowerCase().replace(/\s/g, "")).size;
  if (uniqueChars < 4 && t.length > 5) return true;
  return false;
}

function assessChatEngagement(chatHistory) {
  const studentMessages = (chatHistory || []).filter((m) => m.role === "user");
  if (!studentMessages.length) return { engaged: false, messageCount: 0, note: "No chat engagement — student did not use the coaching conversation." };
  const dismissivePhrases = /\b(no need|nothing else|idk|i don't know|dont know|skip|done|no thanks|nah|ok|okay)\b/i;
  const meaningful = studentMessages.filter((m) => {
    const content = String(m.content || "").trim();
    const words = content.split(/\s+/).filter(Boolean);
    if (dismissivePhrases.test(content) && words.length <= 4) return false;
    return !isJibberish(content) && words.length >= 5;
  });
  const ratio = meaningful.length / studentMessages.length;
  const engaged = meaningful.length >= 2 && ratio >= 0.5;
  return {
    engaged,
    messageCount: studentMessages.length,
    note: engaged && ratio >= 0.75
      ? `Student engaged meaningfully in the coaching chat (${studentMessages.length} messages).`
      : engaged
        ? `Student used the chat but some responses were brief or underdeveloped (${studentMessages.length} messages).`
        : `Student chat responses were mostly too short or unclear to show real thinking (${studentMessages.length} messages).`,
  };
}

function assessOutlineEngagement(submission, assignment) {
  const config = getOutlineFields(assignment, submission);
  const fields = config?.fields || [];
  const results = fields.map((field) => {
    const val = String(submission.outline?.[field.key] || "").trim();
    return { label: field.label, value: val, jibberish: isJibberish(val), empty: !val };
  });
  const empties = results.filter((r) => r.empty).length;
  const jibberish = results.filter((r) => !r.empty && r.jibberish).length;
  return {
    complete: empties === 0 && jibberish === 0,
    note: empties > 0
      ? `${empties} outline field${empties > 1 ? "s were" : " was"} left blank.`
      : jibberish > 0
        ? `${jibberish} outline field${jibberish > 1 ? "s appear" : " appears"} to contain placeholder or jibberish text rather than real thinking.`
        : "Outline was completed thoughtfully.",
  };
}

function buildSuggestedStudentComment(assignment, submission, metrics, totalScore, maxScore) {
  const chat = assessChatEngagement(submission.chatHistory);
  const outline = assessOutlineEngagement(submission, assignment);
  const reflection = submission.reflections.improved.trim();
  const pasteFlags = metrics.largePasteCount;
  const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const opening = scorePercent >= 80
    ? "Well done on this assignment."
    : scorePercent >= 60
      ? "You have made a reasonable attempt at this assignment."
      : "This assignment needed more effort and care.";

  const chatComment = chat.engaged
    ? "Your coaching conversation showed real engagement with your ideas before writing."
    : chat.messageCount === 0
      ? "You did not use the coaching chat — working through your ideas there first would have strengthened your writing."
      : "Your responses in the coaching chat were quite brief. Try to explain your thinking more fully next time.";

  const outlineComment = outline.complete
    ? "Your outline showed you had planned your writing carefully."
    : "Your outline was not fully or thoughtfully completed — planning your ideas before drafting makes a real difference to the quality of your writing.";

  const writingComment = metrics.targetHit
    ? "Your final piece met the expected length."
    : "Your final piece did not meet the expected word count — make sure you develop your ideas fully.";

  const revisionComment = metrics.revisionCount >= 4
    ? "Your editing process shows you revised your work, which is good practice."
    : "There was very little revision between your draft and final piece — always review and improve your writing before submitting.";

  const reflectionComment = reflection
    ? "Your reflection on what you improved showed self-awareness."
    : "You did not complete the reflection on what you improved — this is an important part of the writing process.";

  const pasteComment = pasteFlags
    ? ` Note: the system detected ${pasteFlags} large paste event${pasteFlags > 1 ? "s" : ""} in your writing log — all work should be your own.`
    : "";

  return `${opening} ${chatComment} ${outlineComment} ${writingComment} ${revisionComment} ${reflectionComment}${pasteComment}`;
}

function buildGradeJustification(assignment, submission, metrics, totalScore, maxScore) {
  const reflectionComplete = submission.reflections.improved.trim();
  const outlineAssessment = assessOutlineEngagement(submission, assignment);
  const chatAssessment = assessChatEngagement(submission.chatHistory);
  const pasteFlags = metrics.largePasteCount;
  const authorshipNote = pasteFlags
    ? ` The process log includes ${pasteFlags} large paste event${pasteFlags === 1 ? "" : "s"}, so authorship should be verified.`
    : " No large paste concerns detected.";
  return `Suggested score: ${totalScore}/${maxScore}. The final piece is ${metrics.targetHit ? "within" : "outside"} the target word range and includes ${submission.writingEvents.length} tracked edit events. ${outlineAssessment.note} ${chatAssessment.note} ${reflectionComplete ? "The student completed the reflection." : "The revision reflection is incomplete."}${authorshipNote}`;
}

function normalizeTeacherDraft(draft) {
  return {
    brief: draft.brief.trim(),
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    focus: draft.focus.trim(),
    assignmentType: draft.assignmentType,
    languageLevel: draft.languageLevel,
    totalPoints: Number(draft.totalPoints || 20),
    wordCountMin: Number(draft.wordCountMin || 0),
    wordCountMax: Number(draft.wordCountMax || 0),
    ideaRequestLimit: Number(draft.ideaRequestLimit || 0),
    feedbackRequestLimit: Number(draft.feedbackRequestLimit || 0),
    disableChatbot: Boolean(draft.disableChatbot),
    studentFocus: draft.studentFocus.trim(),
    rubric: draft.rubric.map((item) => ({
      ...item,
      name: item.name.trim(),
      description: item.description.trim(),
      points: Number(item.points || 0),
    })),
  };
}

function applyAiSettingsToTeacherDraft(parsed = {}) {
  const allowedLevels = new Set(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
  const inferred = inferTeacherBriefSettings(ui.teacherDraft.brief);

  if (inferred.assignmentType) {
    ui.teacherDraft.assignmentType = inferred.assignmentType;
  } else if (parsed.assignmentType) {
    ui.teacherDraft.assignmentType = parsed.assignmentType;
  }
  if (allowedLevels.has(String(inferred.languageLevel || "").trim())) {
    ui.teacherDraft.languageLevel = String(inferred.languageLevel).trim();
  } else if (allowedLevels.has(String(parsed.languageLevel || "").trim())) {
    ui.teacherDraft.languageLevel = String(parsed.languageLevel).trim();
  }
  if (Number.isFinite(Number(inferred.feedbackRequestLimit)) && Number(inferred.feedbackRequestLimit) >= 0) {
    ui.teacherDraft.feedbackRequestLimit = Number(inferred.feedbackRequestLimit);
  } else if (Number.isFinite(Number(parsed.feedbackRequestLimit)) && Number(parsed.feedbackRequestLimit) >= 0) {
    ui.teacherDraft.feedbackRequestLimit = Number(parsed.feedbackRequestLimit);
  }
  if (typeof inferred.disableChatbot === "boolean") {
    ui.teacherDraft.disableChatbot = inferred.disableChatbot;
  } else if (typeof parsed.disableChatbot === "boolean") {
    ui.teacherDraft.disableChatbot = parsed.disableChatbot;
  }
  if (ui.teacherDraft.disableChatbot) {
    ui.teacherDraft.chatTimeLimit = -1;
  } else if (Number.isFinite(Number(inferred.chatTimeLimit)) && Number(inferred.chatTimeLimit) >= 0) {
    ui.teacherDraft.chatTimeLimit = Number(inferred.chatTimeLimit);
  } else if (Number.isFinite(Number(parsed.chatTimeLimit)) && Number(parsed.chatTimeLimit) >= 0) {
    ui.teacherDraft.chatTimeLimit = Number(parsed.chatTimeLimit);
  } else if (ui.teacherDraft.disableChatbot) {
    ui.teacherDraft.chatTimeLimit = -1;
  }
  if (Number.isFinite(Number(inferred.totalPoints)) && Number(inferred.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
    ui.teacherDraft.totalPoints = Number(inferred.totalPoints);
  } else if (Number.isFinite(Number(parsed.totalPoints)) && Number(parsed.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
    ui.teacherDraft.totalPoints = Number(parsed.totalPoints);
  }

  const deadlineDate = String(parsed.deadlineDate || "").trim();
  const deadlineTime = String(parsed.deadlineTime || "").trim();
  if (deadlineDate) {
    ui.teacherDraft.deadline = combineDeadlineParts(deadlineDate, deadlineTime || getDeadlineTimePart(ui.teacherDraft.deadline) || "09:00");
  }
}

function createEmptySubmission(assignmentId, studentId) {
  return {
    id: uid("submission"),
    assignmentId,
    studentId,
    ideaResponses: [],
    draftText: "",
    finalText: "",
    reflections: {
      improved: "",
    },
    outline: {
      partOne: "",
      partTwo: "",
      partThree: "",
    },
    feedbackHistory: [],
    writingEvents: [],
    focusAnnotations: [],
    chatHistory: [],
    chatStartedAt: null,
    chatSkippedAt: null,
    chatExpiredAt: null,
    chatElapsedMs: 0,
    chatResumedAt: null,
    teacherReview: createDefaultTeacherReview(),
    status: "draft",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    submittedAt: null,
  };
}

function createBlankState() {
  return {
    users: [],
    assignments: [],
    submissions: [],
  };
}

function normalizeState(rawState) {
  const fallback = createBlankState();
  const users = safeArray(rawState?.users).length ? rawState.users : fallback.users;
  const assignments = safeArray(rawState?.assignments).map(normalizeAssignment);
  const submissions = safeArray(rawState?.submissions).map(normalizeSubmission);

  return {
    users: users.map((user) => ({
      id: user.id || uid("user"),
      name: user.name || "User",
      role: user.role || "student",
    })),
    assignments,
    submissions,
  };
}

function schemaCriterionToRubricRow(criterion) {
  return normalizeRubricRow({
    id: criterion.id,
    name: criterion.name,
    description: "",
    points: Number(criterion.maxScore || 0),
    pointsLabel: criterion.minScore !== criterion.maxScore
      ? `${criterion.minScore} – ${criterion.maxScore} points`
      : `${criterion.maxScore} points`,
    levels: safeArray(criterion.levels).map((level) => ({
      id: level.id,
      label: `${level.label} – ${level.score}`,
      points: Number(level.score || 0),
      description: level.description,
    })),
  });
}

function normalizeAssignment(assignment) {
  const assignmentType = assignment?.assignmentType || detectAssignmentType(`${assignment?.brief || ""} ${assignment?.prompt || ""}`);
  const languageLevel = assignment?.languageLevel || "middle school";
  const ranges = {
    min: Number(assignment?.wordCountMin || 250),
    max: Number(assignment?.wordCountMax || 400),
  };
  const rubricSchema = assignment?.uploadedRubricSchema
    || assignment?.rubricSchema
    || getRubricSchema(assignment?.rubric, assignment?.uploadedRubricName || assignment?.title || "Uploaded rubric");
  const normalizedRubric = rubricSchema?.criteria?.length
    ? safeArray(rubricSchema.criteria).map(schemaCriterionToRubricRow)
    : (safeArray(assignment?.rubric).length ? assignment.rubric.map(normalizeRubricRow) : rubricForType(assignmentType));
  const uploadedRubricData = assignment?.uploadedRubricData
    || (rubricSchema ? rubricSchemaToMatrixData(rubricSchema, assignment?.uploadedRubricName || assignment?.title || "Uploaded rubric") : getMatrixRubricData(assignment?.rubric));
  const uploadedRubricText = assignment?.uploadedRubricText
    || serializeRubricSchemaForPrompt(rubricSchema, assignment?.uploadedRubricName || assignment?.title || "Uploaded rubric")
    || serializeRubricDataForPrompt(uploadedRubricData)
    || "";

  return {
    id: assignment?.id || uid("assignment"),
    title: assignment?.title || buildTitleFromBrief(assignment?.brief || assignment?.prompt || "", assignmentType, "topic"),
    prompt: assignment?.prompt || studentPromptForType(assignmentType, "the topic", languageLevel),
    focus: assignment?.focus || "",
    brief: assignment?.brief || "",
    assignmentType,
    languageLevel,
    wordCountMin: ranges.min,
    wordCountMax: Math.max(ranges.max, ranges.min),
    ideaRequestLimit: Number(assignment?.ideaRequestLimit ?? 3),
    feedbackRequestLimit: Number(assignment?.feedbackRequestLimit ?? 2),
    disableChatbot: isChatDisabled(assignment),
    studentFocus: safeArray(assignment?.studentFocus).length ? assignment.studentFocus : focusForType(assignmentType, "the topic"),
    rubricType: rubricSchema?.criteria?.length ? "matrix" : getAssignmentRubricType(assignment),
    rubricSchema: rubricSchema || null,
    uploadedRubricSchema: rubricSchema || null,
    rubric: normalizedRubric,
    rubricMeta: assignment?.rubricMeta || { reminderRules: [] },
    createdBy: assignment?.createdBy || "teacher-1",
    createdAt: assignment?.createdAt || new Date().toISOString(),
    classId: assignment?.classId || assignment?.class_id || "",
    status: assignment?.status || "published",
    deadline: assignment?.deadline || "",
    chatTimeLimit: isChatDisabled(assignment) ? -1 : Number(assignment?.chatTimeLimit ?? 0),
    uploadedRubricText,
    uploadedRubricName: assignment?.uploadedRubricName || rubricSchema?.title || "",
    uploadedRubricData,
  };
}

function normalizeRubricRow(item) {
  const points = Math.max(1, Number(item?.points || 4));
  const bands = safeArray(item?.bands).map((band) => ({
    id: band?.id || uid("band"),
    label: band?.label || "",
    points: Number(band?.points ?? 0),
    description: band?.description || "",
  }));
  const levels = safeArray(item?.levels).map((level) => ({
    id: level?.id || uid("level"),
    label: level?.label || "",
    points: Number(level?.points ?? 0),
    description: level?.description || "",
  }));

  return {
    id: item?.id || uid("rubric"),
    name: item?.name || item?.subcriterion || "Criterion",
    description: item?.description || "",
    points,
    section: item?.section || "",
    subcriterion: item?.subcriterion || "",
    pointsLabel: item?.pointsLabel || "",
    bands: levels.length ? bands : (bands.length ? bands : createScoreBandsForPoints(points)),
    levels,
  };
}

function normalizeSubmission(submission) {
  return {
    id: submission?.id || uid("submission"),
    assignmentId: submission?.assignmentId || "",
    studentId: submission?.studentId || "",
    ideaResponses: safeArray(submission?.ideaResponses).map((idea) => ({
      id: idea?.id || uid("idea"),
      requestedAt: idea?.requestedAt || new Date().toISOString(),
      aiBullets: safeArray(idea?.aiBullets),
      rewrittenIdea: idea?.rewrittenIdea || "",
      whyChosen: idea?.whyChosen || "",
    })),
    draftText: submission?.draftText || "",
    finalText: submission?.finalText || "",
    finalUnlocked: submission?.finalUnlocked || false,
    reflections: {
      improved: submission?.reflections?.improved || "",
    },
    outline: {
      partOne: submission?.outline?.partOne || "",
      partTwo: submission?.outline?.partTwo || "",
      partThree: submission?.outline?.partThree || "",
    },
    feedbackHistory: safeArray(submission?.feedbackHistory).map((entry) => ({
      id: entry?.id || uid("feedback"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      items: safeArray(entry?.items),
    })),
    writingEvents: safeArray(submission?.writingEvents).map((entry) => ({
      id: entry?.id || uid("event"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      type: entry?.type || "insert",
      start: typeof entry?.start === "number" ? entry.start : null,
      end: typeof entry?.end === "number" ? entry.end : null,
      removedText: entry?.removedText || "",
      insertedText: entry?.insertedText || "",
      delta: Number(entry?.delta || 0),
      flagged: Boolean(entry?.flagged),
      preview: entry?.preview || "",
    })),
    focusAnnotations: safeArray(submission?.focusAnnotations).map((entry) => ({
      id: entry?.id || uid("focus"),
      timestamp: entry?.timestamp || new Date().toISOString(),
      label: entry?.label || "Writing focus",
    })),
    teacherReview: createDefaultTeacherReview(submission?.teacherReview),
    chatHistory: safeArray(submission?.chatHistory).map((msg) => ({
      role: msg?.role || "user",
      content: msg?.content || "",
      timestamp: msg?.timestamp || new Date().toISOString(),
    })),
    chatStartedAt: submission?.chatStartedAt || null,
    chatSkippedAt: submission?.chatSkippedAt || null,
    chatExpiredAt: submission?.chatExpiredAt || null,
    chatElapsedMs: Number(submission?.chatElapsedMs || 0),
    chatResumedAt: submission?.chatResumedAt || null,
    status: submission?.status || "draft",
    startedAt: submission?.startedAt || null,
    updatedAt: submission?.updatedAt || new Date().toISOString(),
    submittedAt: submission?.submittedAt || null,
    selfAssessment: submission?.selfAssessment || {},
    _studentName: submission?._studentName || "",
    keystrokeLog: safeArray(submission?.keystrokeLog),
    fluencySummary: submission?.fluencySummary || {},
  };
}

function createDemoState() {
  const state = createBlankState();

  const assignment = {
    id: "assignment-demo-1",
    title: "Should Schools Require Uniforms",
    prompt: "Write an opinion piece about school uniforms. Say what you believe, give at least one strong reason or example, and explain why it matters.",
    focus: "Keep the student focused on a clear opinion.",
    brief: "My middle school students need a short opinion piece about whether school uniforms help learning.",
    assignmentType: "argument",
    languageLevel: "middle school",
    wordCountMin: 300,
    wordCountMax: 450,
    ideaRequestLimit: 3,
    feedbackRequestLimit: 2,
    studentFocus: [
      "a clear opinion about uniforms",
      "one strong reason or example",
      "explaining why that example supports the opinion",
      "fixing confusing sentences before submitting",
    ],
    rubric: rubricForType("argument"),
    createdBy: "teacher-1",
    createdAt: "2026-04-17T08:00:00.000Z",
    status: "published",
    chatTimeLimit: 0,
    deadline: "",
  };

  const submissionOne = createEmptySubmission(assignment.id, "student-1");
  submissionOne.id = "submission-demo-1";
  submissionOne.ideaResponses = [
    {
      id: "idea-demo-1",
      requestedAt: "2026-04-17T08:15:00.000Z",
      aiBullets: [
        "Choose one clear opinion about uniforms.",
        "Think of one real example that supports your opinion.",
        "Add one sentence that explains why your example matters.",
      ],
      rewrittenIdea: "I think uniforms help students focus because people compare clothes less.",
      whyChosen: "It feels realistic and easy to explain with a school example.",
    },
  ];
  submissionOne.draftText = "School uniforms can help students focus on learning because they reduce pressure to compete over clothes. In many schools, students notice brands and outfits before class even starts. That can make some students feel left out or distracted.\n\nFor example, a student who cannot afford popular clothes might spend the morning worrying about what others think instead of paying attention in class. Uniforms do not erase every social problem, but they can lower one daily distraction. Schools should require them if the goal is to create a calmer learning environment.";
  submissionOne.finalText = "Schools should require uniforms because they help students focus more on learning and less on showing status through clothing. When everyone arrives dressed in a similar way, there is less pressure to compare brands, trends, or how much money a family can spend on outfits.\n\nFor example, a student who cannot afford popular clothes may spend the morning feeling self-conscious in the hallway before class begins. That attention is then pulled away from learning. Uniforms do not solve every social problem in a school, but they remove one common distraction that affects confidence and concentration.\n\nSome people argue that uniforms limit self-expression. However, students still have many ways to show personality through their ideas, friendships, and activities. A school is mainly a place for learning, so a dress policy that reduces daily pressure is a reasonable tradeoff. Uniforms should be required because they support a calmer and more focused school environment.";
  submissionOne.reflections = {
    improved: "I added a counterargument and explained my example more clearly.",
    feedbackUsed: "I used the feedback about making my example clearer and putting the counterargument in its own paragraph.",
  };
  submissionOne.feedbackHistory = [
    {
      id: "feedback-demo-1",
      timestamp: "2026-04-17T08:32:00.000Z",
      items: [
        "Your example is useful, but explain more clearly why it supports your main idea.",
        "Could you put your counterargument in its own paragraph?",
      ],
    },
  ];
  submissionOne.writingEvents = [
    {
      id: "e1",
      timestamp: "2026-04-17T08:18:00.000Z",
      type: "insert",
      start: 0,
      end: 0,
      removedText: "",
      insertedText: "School uniforms can help students focus on learning because they reduce pressure to compete over clothes.",
      delta: 102,
      flagged: false,
      preview: "School uniforms can help students focus",
    },
    {
      id: "e2",
      timestamp: "2026-04-17T08:23:00.000Z",
      type: "insert",
      start: 102,
      end: 102,
      removedText: "",
      insertedText: " In many schools, students notice brands and outfits before class even starts. That can make some students feel left out or distracted.\n\nFor example, a student who cannot afford popular clothes might spend the morning worrying about what others think instead of paying attention in class.",
      delta: 303,
      flagged: false,
      preview: "In many schools, students notice brands",
    },
    {
      id: "e3",
      timestamp: "2026-04-17T08:28:00.000Z",
      type: "insert",
      start: 405,
      end: 405,
      removedText: "",
      insertedText: " Uniforms do not erase every social problem, but they can lower one daily distraction. Schools should require them if the goal is to create a calmer learning environment.",
      delta: 173,
      flagged: false,
      preview: "Uniforms do not erase every social problem",
    },
  ];
  submissionOne.focusAnnotations = [
    { id: "f1", timestamp: "2026-04-17T08:20:00.000Z", label: "clear opinion about uniforms" },
    { id: "f2", timestamp: "2026-04-17T08:25:00.000Z", label: "one strong reason or example" },
  ];
  submissionOne.status = "submitted";
  submissionOne.startedAt = "2026-04-17T08:18:00.000Z";
  submissionOne.updatedAt = "2026-04-17T08:39:00.000Z";
  submissionOne.submittedAt = "2026-04-17T08:39:00.000Z";

  const submissionTwo = createEmptySubmission(assignment.id, "student-2");
  submissionTwo.id = "submission-demo-2";
  submissionTwo.ideaResponses = [
    {
      id: "idea-demo-2",
      requestedAt: "2026-04-17T09:02:00.000Z",
      aiBullets: [
        "Choose one clear opinion about uniforms.",
        "Think of one real example that supports your opinion.",
        "Add one sentence that explains why your example matters.",
      ],
      rewrittenIdea: "I think uniforms save time in the morning.",
      whyChosen: "It is practical and easy to explain.",
    },
  ];
  submissionTwo.draftText = "Uniforms can save students time in the morning because they do not have to choose what to wear every day. This can make school mornings less stressful.\n\nSome students may not like wearing the same style often, but schools can still set reasonable options.";
  submissionTwo.feedbackHistory = [
    {
      id: "feedback-demo-2",
      timestamp: "2026-04-17T09:14:00.000Z",
      items: [
        "Add one real example instead of staying general.",
        "Can you explain why the counterpoint does not change your opinion?",
      ],
    },
  ];
  submissionTwo.writingEvents = [
    {
      id: "e4",
      timestamp: "2026-04-17T09:03:00.000Z",
      type: "insert",
      start: 0,
      end: 0,
      removedText: "",
      insertedText: "Uniforms can save students time in the morning because they do not have to choose what to wear every day.",
      delta: 106,
      flagged: false,
      preview: "Uniforms can save students time",
    },
    {
      id: "e5",
      timestamp: "2026-04-17T09:09:00.000Z",
      type: "paste",
      start: 106,
      end: 106,
      removedText: "",
      insertedText: " This can make school mornings less stressful.\n\nSome students may not like wearing the same style often, but schools can still set reasonable options.",
      delta: 147,
      flagged: true,
      preview: "This can make school mornings less stressful",
    },
  ];
  submissionTwo.focusAnnotations = [
    { id: "f3", timestamp: "2026-04-17T09:05:00.000Z", label: "one strong reason or example" },
  ];
  submissionTwo.startedAt = "2026-04-17T09:03:00.000Z";
  submissionTwo.updatedAt = "2026-04-17T09:14:00.000Z";

  state.assignments.push(assignment);
  state.submissions.push(submissionOne, submissionTwo);
  return state;
}

function loadState(profile = currentProfile) {
  return loadStateSnapshot({
    storageKey: STORAGE_KEY,
    backupKey: STORAGE_BACKUP_KEY,
    normalizeState,
    createBlankState,
    currentProfile: profile,
  });
}

async function syncSubmissionToServer(submission) {
  if (!submission?.assignmentId || currentProfile?.role !== "student") return;
  try {
    let serverId = looksLikeServerSubmissionId(submission.id) ? submission.id : null;
    if (!serverId) {
      const existing = await Auth.apiFetch(`/api/assignments/${submission.assignmentId}/my-submission`);
      if (existing?.error) {
        throw new Error(existing.error);
      }
      serverId = existing.submission?.id;
      if (!serverId) {
        throw new Error("Submission record was not created on the server.");
      }
    }
    const payload = buildSubmissionServerPayload(submission);
    let result = await Auth.apiFetch(`/api/submissions/${serverId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (result?.error && looksLikeServerSubmissionId(submission.id)) {
      const existing = await Auth.apiFetch(`/api/assignments/${submission.assignmentId}/my-submission`);
      if (!existing?.error && existing?.submission?.id) {
        serverId = existing.submission.id;
        result = await Auth.apiFetch(`/api/submissions/${serverId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
    }
    if (result?.error) {
      throw new Error(result.error);
    }
    // Update local submission ID to match server
    submission.id = serverId;
    if (result?.submission) {
      const mapped = mapServerSubmission(result.submission);
      const index = state.submissions.findIndex((entry) => entry.assignmentId === mapped.assignmentId && entry.studentId === mapped.studentId);
      if (index >= 0) {
        state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
      } else {
        state.submissions.push(mapped);
      }
      persistState();
    }
    return true;
  } catch (e) {
    console.error("Could not sync submission to server:", e.message, e);
    ui.notice = "We couldn't save to the server just now. Your work is still on this device.";
    setDraftSaveMessage("Saved on this device.");
    return false;
  }
}

function looksLikeServerSubmissionId(id) {
  return Boolean(id && !String(id).startsWith("submission-"));
}

async function submitStudentSubmissionToServer(submission) {
  if (!submission?.assignmentId || currentProfile?.role !== "student") return false;
  const payload = buildSubmissionServerPayload(submission, {
    status: "submitted",
    submitted_at: submission.submittedAt || new Date().toISOString(),
  });

  try {
    const result = await Auth.apiFetch(`/api/assignments/${submission.assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result?.error || !result?.submission) {
      throw new Error(result?.error || "Submission failed.");
    }
    const mapped = mapServerSubmission(result.submission);
    const index = state.submissions.findIndex((entry) => entry.assignmentId === mapped.assignmentId && entry.studentId === mapped.studentId);
    if (index >= 0) {
      state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
    } else {
      state.submissions.push(mapped);
    }
    persistState();
    return true;
  } catch (error) {
    console.error("Could not submit work to server:", error.message, error);
    return false;
  }
}

function persistState() {
  const result = persistStateSnapshot({
    state,
    currentProfile,
    storageKey: STORAGE_KEY,
    backupKey: STORAGE_BACKUP_KEY,
  });
  if (!result.ok) {
    console.error("Could not persist local state:", result.error);
    if (!storageWarningShown) {
      storageWarningShown = true;
      ui.notice = "Local backup storage is full. Your latest work may not be fully backed up on this device.";
    }
    return;
  }

  if (result.mode === "fallback" && !storageWarningShown) {
    storageWarningShown = true;
    ui.notice = "Local backup storage is nearly full. praxis saved a smaller backup on this device.";
  }
}

function getStudentUsers() {
  return state.users.filter((user) => user.role === "student");
}

function getUserById(id) {
  return state.users.find((user) => user.id === id) || null;
}

function updateStudentDisplayName(studentId, nextName) {
  const name = String(nextName || "").trim();
  if (!studentId || !name) return;
  state.users = state.users.map((user) => user.id === studentId ? { ...user, name } : user);
  currentClassMembers = currentClassMembers.map((member) => member.id === studentId ? { ...member, name } : member);
  state.submissions = state.submissions.map((submission) => submission.studentId === studentId ? { ...submission, _studentName: name } : submission);
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function wordCount(text) {
  return (String(text || "").trim().match(/\b[\w'-]+\b/g) || []).length;
}

function splitLines(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function splitParagraphs(text) {
  return String(text || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

let lineMeasureCanvas = null;

function getLineMeasureContext() {
  if (!lineMeasureCanvas) {
    lineMeasureCanvas = document.createElement("canvas");
  }
  return lineMeasureCanvas.getContext("2d");
}

function getElementLineWrapMetrics(element) {
  if (!element) return null;
  const style = window.getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize || "16") || 16;
  const lineHeight = parseFloat(style.lineHeight) || (fontSize * 1.65);
  const paddingLeft = parseFloat(style.paddingLeft || "0") || 0;
  const paddingRight = parseFloat(style.paddingRight || "0") || 0;
  const availableWidth = Math.max(80, element.clientWidth - paddingLeft - paddingRight);
  return {
    font: style.font || `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "sans-serif"}`,
    lineHeight,
    width: availableWidth,
  };
}

function buildWrappedLineEntries(text = "", metrics) {
  const ctx = getLineMeasureContext();
  if (ctx && metrics?.font) {
    ctx.font = metrics.font;
  }
  const measureText = (value) => {
    if (!ctx) return String(value || "").length;
    return ctx.measureText(String(value || "")).width;
  };
  return LineNumberUtils.buildWrappedLineEntries(text, metrics, measureText);
}

function renderLineNumberGutter(entries = []) {
  return safeArray(entries).map((entry) => {
    const label = entry.isFirstVisualRow && (entry.logicalNumber % 5 === 0 || entry.logicalNumber === 1) ? String(entry.logicalNumber) : "";
    return `<div class="line-gutter-row">${escapeHtml(label)}</div>`;
  }).join("");
}

function refreshLineNumberGutterForElement(element) {
  if (!element) return;
  const gutterId = element.dataset.lineGutter;
  if (!gutterId) return;
  const gutter = document.getElementById(gutterId);
  if (!gutter) return;
  const text = element.value ?? element.textContent ?? "";
  const metrics = getElementLineWrapMetrics(element);
  const entries = buildWrappedLineEntries(text, metrics);
  gutter.innerHTML = renderLineNumberGutter(entries);
  gutter.scrollTop = element.scrollTop;
}

function refreshAllLineNumberGutters() {
  document.querySelectorAll("[data-line-gutter]").forEach((element) => {
    refreshLineNumberGutterForElement(element);
  });
}

function splitSentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function extractKeywords(text) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "into", "have", "will",
    "about", "should", "because", "students", "student", "write", "using", "need", "short",
    "piece", "grade", "clear", "simple", "their", "them", "give",
  ]);
  const counts = {};
  const matches = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  for (const word of matches) {
    if (!stopWords.has(word)) {
      counts[word] = (counts[word] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
}

function trimTo(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function renderProductWordmark(tagName = "span", className = "") {
  const cls = className ? ` class="${className}"` : "";
  return `<${tagName}${cls}>pr<span class="brand-accent-letter">a</span>x<span class="brand-accent-letter">i</span>s</${tagName}>`;
}

function renderBrandGlyph() {
  return `<img src="favicon-256.png" alt="" aria-hidden="true" width="64" height="64" style="display:block;border-radius:14px;">`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderEventSummary(entry) {
  const core = `${formatTime(entry.timestamp)} • ${entry.delta >= 0 ? "+" : ""}${entry.delta} chars`;
  if (entry.type === "paste") {
    return `${core}. ${entry.flagged ? "Large paste flagged." : "Paste captured."} ${entry.preview}`;
  }
  return `${core}. ${entry.preview || "Draft updated."}`;
}

function similarityRatio(a, b) {
  const wordsA = new Set((String(a || "").toLowerCase().match(/[a-z']+/g) || []).filter(Boolean));
  const wordsB = new Set((String(b || "").toLowerCase().match(/[a-z']+/g) || []).filter(Boolean));
  const union = new Set([...wordsA, ...wordsB]);
  if (!union.size) {
    return 1;
  }
  let intersection = 0;
  union.forEach((word) => {
    if (wordsA.has(word) && wordsB.has(word)) {
      intersection += 1;
    }
  });
  return intersection / union.size;
}

function averageSentenceLength(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return 0;
  }
  return wordCount(text) / sentences.length;
}

function hasOpeningClaim(text) {
  const firstParagraph = splitParagraphs(text)[0] || text;
  return wordCount(firstParagraph) >= 12;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
