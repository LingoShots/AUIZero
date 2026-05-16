const {
  STORAGE_KEY,
  RUBRIC_LIBRARY_KEY,
  STORAGE_BACKUP_KEY,
  ACTIVE_CLASS_KEY,
  ACTIVE_STUDENT_ASSIGNMENT_KEY,
  CUSTOM_ERROR_CODES_KEY,
  LARGE_PASTE_LIMIT,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  REVIEW_REFRESH_MS,
  ADMIN_REFRESH_MS,
  BASE_ERROR_CODES,
  loadCustomErrorCodes,
  saveCustomErrorCodes,
  getErrorCodes,
  getErrorCodeLabel,
} = window.AppConstants;
const {
  buildDeadlineTimeOptions,
  combineDeadlineParts,
  getDeadlineDatePart,
  getDeadlineTimePart,
} = window.DeadlineUtils;
const {
  loadStateSnapshot,
  persistStateSnapshot,
  safeReadJson,
} = window.StorageUtils;
const {
  getStudentFeedbackButtonState,
  getTeacherGenerateButtonState,
  parseJsonResponse,
  stringifyLinesWithMarkers,
} = window.AiAssistUtils;
const {
  createScoreBandsForPoints,
  getCriterionBands,
  buildTeacherReviewRowScore,
  getTeacherReviewRowScoreMap,
  getStudentSelfAssessmentRowScoreMap,
  getStudentSelfAssessmentCompletion,
  resetTeacherReviewForReopen,
  findClosestBand,
  buildCriterionAnalytics,
} = window.ReviewUtils;
const calculateTeacherReviewSummaryCore = window.ReviewUtils.calculateTeacherReviewSummary;
const {
  getAdminClassDetailSignature,
} = window.AdminUtils;

// App state — now server-backed
let currentProfile = null;
let currentClasses = [];
let currentClassId = null;
let currentClassMembers = [];
let reviewRefreshTimer = null;
let adminClassRefreshTimer = null;
let storageWarningShown = false;
let adminProcessRecomputePromise = null;

function getProfileScopedStorageKey(baseKey, profile = currentProfile) {
  if (!profile?.id || !profile?.role) return baseKey;
  return `${baseKey}:${profile.role}:${profile.id}`;
}

function isAdminTeacherView() {
  return ui.role === "admin" && currentProfile?.role === "admin" && ui.adminViewingAsTeacher;
}
if (typeof window !== "undefined") window.isAdminTeacherView = isAdminTeacherView;
function isSubmissionDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "submission";
  } catch (_) {
    return false;
  }
}
if (typeof window !== "undefined") window.isSubmissionDebugEnabled = isSubmissionDebugEnabled;
function isEmailDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "email";
  } catch (_) {
    return false;
  }
}
if (typeof window !== "undefined") window.isEmailDebugEnabled = isEmailDebugEnabled;
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
  draftFeedbackLoading: false,
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
  showPasswordModal: false,
  adminView: "teachers",
  adminSelectedTeacherId: null,
  adminSelectedClassId: null,
  adminSelectedClassName: "",
  adminViewingAsTeacher: false,
  adminTeachers: [],
  adminClassDetail: null,
  adminSelectedAssignmentId: null,
  adminStudentFlagSavingId: null,
  adminCefrBenchmarks: null,
  adminCefrBenchmarksLoading: false,
  adminCefrBenchmarksError: null,
  adminProcessRecomputeLoading: false,
  adminProcessRecomputeResult: null,
  adminProcessRecomputeError: null,
  gradeSuggestionLoading: false,
  gradeSubmitting: false,
  studentSubmitting: false,
  assignmentSaving: false,
  savedAssignmentFocusId: null,
  publishingAssignmentId: null,
  pendingFinalScoreOverride: null,
  reopenSubmissionPrompt: null,
  latestSubmissionDebug: null,
  latestEmailDebug: null,
};

let state = { assignments: [], submissions: [], users: [] };
let teacherAssistAbortController = null;
const authUiState = {
  signupRole: "student",
};

if (typeof window !== "undefined") {
  window.AppState = {
    get ui() { return ui; },
    get state() { return state; },
    get currentProfile() { return currentProfile; },
    get currentClasses() { return currentClasses; },
    get currentClassId() { return currentClassId; },
    get currentClassMembers() { return currentClassMembers; },
    get appEl() { return appEl; },
    get authUiState() { return authUiState; },
    render: () => render(),
  };
}

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
window.getSavedStudentAssignmentId = getSavedStudentAssignmentId;

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
window.saveStudentAssignmentId = saveStudentAssignmentId;

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
    classes.map((cls) => window.ApiService.loadClassAssignments(cls.id))
  );
  const classAssignments = assignmentResults.map((result) => (
    result.status === "fulfilled" ? safeArray(result.value) : []
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

function rubricLibraryDedupKey(entry = {}) {
  if (entry?.schema?.criteria?.length) return JSON.stringify(entry.schema);
  if (entry?.text) return entry.text;
  if (entry?.data) return JSON.stringify(entry.data);
  return entry?.id || "";
}

function formatCriterionPointsLabel(criterion = {}) {
  const minScore = criterion.minScore;
  const maxScore = criterion.maxScore;
  return minScore === maxScore
    ? `${maxScore} points`
    : `${minScore} – ${maxScore} points`;
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
window.getSavedRubricLibrary = getSavedRubricLibrary;

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
  if (Number(ui.teacherDraft.uploadedRubricSchema?.totalPoints || 0) > 0) {
    ui.teacherDraft.totalPoints = Number(ui.teacherDraft.uploadedRubricSchema.totalPoints);
  }
  ui.selectedSavedRubricId = savedRubric.id;
  ui.teacherAssist = null;
  ui.notice = `Loaded saved rubric "${savedRubric.name}". You can save manually or use Format With AI.`;
  render();
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

function isTeacherAssignmentSaveReady() {
  return Boolean(
    ui.teacherAssist ||
    ((ui.teacherDraft?.title || "").trim() && (ui.teacherDraft?.prompt || "").trim())
  );
}

function getTeacherAssignmentSaveLabel() {
  if (ui.assignmentSaving) return "Saving...";
  return ui.editingAssignmentId ? "Update assignment" : "Save assignment";
}
window.getTeacherAssignmentSaveLabel = getTeacherAssignmentSaveLabel;

function syncTeacherAssignmentSaveButtons() {
  const saveReady = isTeacherAssignmentSaveReady();
  document.querySelectorAll('[data-action="save-assignment"]').forEach((button) => {
    button.disabled = Boolean(ui.aiAssistLoading || ui.assignmentSaving) || !saveReady;
    if (ui.assignmentSaving) {
      button.textContent = "Saving...";
    }
  });
}

function syncDraftFeedbackButtons() {
  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  const feedbackButton = getStudentFeedbackButtonState({
    loading: ui.draftFeedbackLoading,
    feedbackUsed: Number(submission?.feedbackHistory?.length || 0),
    feedbackLimit: Number(assignment?.feedbackRequestLimit ?? 0),
  });
  document.querySelectorAll('[data-action="request-feedback"]').forEach((button) => {
    button.disabled = feedbackButton.disabled;
    button.textContent = feedbackButton.label;
  });
  document.querySelectorAll('[data-action="prompt-request-feedback"]').forEach((button) => {
    button.disabled = feedbackButton.disabled;
    button.textContent = ui.draftFeedbackLoading ? "Checking…" : "Yes, get AI feedback";
  });
}

function getRemainingStudentFeedbackChecks(assignment, submission) {
  const limit = Number(assignment?.feedbackRequestLimit ?? 0);
  const used = Number(submission?.feedbackHistory?.length || 0);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}
if (typeof window !== "undefined") window.getRemainingStudentFeedbackChecks = getRemainingStudentFeedbackChecks;
function shouldPromptForFinalDraftFeedback(assignment, submission) {
  const { remaining } = getRemainingStudentFeedbackChecks(assignment, submission);
  return remaining > 0 && !ui.draftFeedbackLoading;
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
if (typeof window !== "undefined") window.inferTeacherBriefSettings = inferTeacherBriefSettings;

function isChatDisabled(config = {}) {
  return Boolean(config?.disableChatbot) || Number(config?.chatTimeLimit ?? 0) < 0;
}
if (typeof window !== "undefined") window.isChatDisabled = isChatDisabled;
function getVisibleChatTimeLimit(config = {}) {
  return isChatDisabled(config) ? 0 : Number(config?.chatTimeLimit ?? 0);
}
window.getVisibleChatTimeLimit = getVisibleChatTimeLimit;

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
if (typeof window !== "undefined") window.isChatSessionExpired = isChatSessionExpired;
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
    writingBehaviourExcluded: Boolean(review?.writingBehaviourExcluded),
    writingBehaviourExcludedAt: review?.writingBehaviourExcludedAt || null,
    writingBehaviourExclusionReason: review?.writingBehaviourExclusionReason || "",
  };
}
if (typeof window !== "undefined") window.createDefaultTeacherReview = createDefaultTeacherReview;

function calculateTeacherReviewSummary(assignment, submission, rowScores = submission?.teacherReview?.rowScores) {
  return calculateTeacherReviewSummaryCore(assignment, submission, rowScores, { rubricForType });
}

async function syncTeacherReviewToServer(submission) {
  if (!submission?.id || String(submission.id).startsWith("submission-")) return;
  try {
    await window.ApiService.patchSubmission(submission.id, {
      teacher_review: submission.teacherReview,
    });
  } catch (error) {
    console.error("Could not sync teacher review:", error.message, error);
  }
}

async function upsertTeacherReviewSubmission(assignment, submission) {
  return window.ApiService.saveTeacherReviewSubmission(assignment, submission);
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
if (typeof window !== "undefined") window.getTeacherReviewRowsForExport = getTeacherReviewRowsForExport;
function getSubmissionStudentName(submission) {
  const studentId = submission?.studentId || submission?.student_id || "";
  return String(
    submission?._studentName ||
    currentClassMembers.find((member) => member?.id === studentId)?.name ||
    getUserById(studentId)?.name ||
    (currentProfile?.role === "student" && currentProfile?.id === studentId ? currentProfile.name : "") ||
    "Student"
  ).trim() || "Student";
}

function getTeacherFinalScoreForDisplay(assignment, submission) {
  const rubricTotal = calculateTeacherReviewSummary(assignment, submission).totalScore;
  const savedFinalScore = submission?.teacherReview?.finalScore;
  return savedFinalScore !== "" && savedFinalScore != null ? savedFinalScore : rubricTotal;
}

function getAnnotationCodeMeaning(annotation) {
  const code = String(annotation?.code || "").trim();
  if (code === "NOTE") return "Teacher note";
  return String(annotation?.label || getErrorCodeLabel(code) || "").trim();
}

function getAnnotationLegendRows(annotations) {
  const seen = new Set();
  return safeArray(annotations)
    .map((annotation) => {
      const code = String(annotation?.code || "").trim();
      const meaning = getAnnotationCodeMeaning(annotation);
      return { code, meaning };
    })
    .filter(({ code, meaning }) => {
      if (!code || !meaning || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function buildLmsGradeText(assignment, submission) {
  const studentName = getSubmissionStudentName(submission);
  const rows = getTeacherReviewRowsForExport(assignment, submission);
  const rubricTotal = calculateTeacherReviewSummary(assignment, submission).totalScore;
  const total = getTeacherFinalScoreForDisplay(assignment, submission);
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

  if (String(total) !== String(rubricTotal)) {
    lines.push(`Rubric subtotal: ${rubricTotal}/${maxScore}`);
  }

  if (submission.teacherReview?.finalNotes) {
    lines.push("", "Teacher feedback:", submission.teacherReview.finalNotes.trim());
  }

  if (annotations.length) {
    lines.push(
      "",
      "Annotation comments:",
      ...annotations.map((annotation, index) => `- ${getAnnotationDisplayLabel(annotation, index)}: "${annotation.selectedText}"${getAnnotationCodeMeaning(annotation) ? ` — ${getAnnotationCodeMeaning(annotation)}` : ""}${annotation.note ? ` — ${annotation.note}` : ""}`)
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


function stopPlayback() {
  ui.playback.isPlaying = false;
  if (ui.playback.timerId) {
    window.clearTimeout(ui.playback.timerId);
    ui.playback.timerId = null;
  }
}
window.stopPlayback = stopPlayback;

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
    window.AccountSecurity.renderResetPasswordScreen({
      appEl,
      productName: PRODUCT_NAME,
      auth: Auth,
      onBeforeRender: stopTeacherReviewPolling,
      onCancel: () => {
        window.location.href = "/";
      },
      onSuccess: () => {
        window.history.replaceState({}, "", "/");
        renderAuthScreen();
      },
    });
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
  ui.showPasswordModal = false;
  ui.adminViewingAsTeacher = false;
  ui.adminView = "teachers";
  ui.adminSelectedTeacherId = null;
  ui.adminSelectedClassId = null;
  ui.adminSelectedClassName = "";
  ui.adminTeachers = [];
  ui.adminClassDetail = null;
  ui.adminSelectedAssignmentId = null;
  ui.adminProcessRecomputeLoading = false;
  ui.adminProcessRecomputeResult = null;
  ui.adminProcessRecomputeError = null;
  ui.latestSubmissionDebug = null;
  ui.latestEmailDebug = null;
  ui.notice = "";
}
async function bootApp(profile) {
  if (!profile?.id || !profile?.role) {
    resetAppShellState();
    renderAuthScreen();
    return;
  }
  currentProfile = profile;
  storageWarningShown = false;
  state = loadState(profile);
  ui.teacherDraft = createBlankTeacherDraft();
  ui.role = profile.role;
  ui.activeUserId = profile.id;
  if (profile.role !== "admin") {
    ui.adminViewingAsTeacher = false;
    ui.adminView = "teachers";
    ui.adminSelectedTeacherId = null;
    ui.adminSelectedClassId = null;
    ui.adminSelectedClassName = "";
    ui.adminClassDetail = null;
    ui.adminSelectedAssignmentId = null;
  }

  // Auto-join class if arriving via invite link
  try { await Auth.joinClassIfInvited(); } catch(e) { console.warn("Join class skipped:", e.message); }

  if (profile.role === 'admin' && !isAdminTeacherView()) {
    await loadAdminData();
    render();
    return;
  }

  if (profile.role === 'teacher' || isAdminTeacherView()) {
    state.assignments = [];
    state.submissions = [];
    currentClassMembers = [];
    try {
      const data = await Auth.apiFetch('/api/classes');
      if (data?.error) throw new Error(data.error);
      currentClasses = data.classes || [];
      currentClassId = await resolveTeacherStartingClass(profile, currentClasses);
      if (currentClassId) {
        await loadTeacherClassContext(currentClassId);
      } else {
        persistState();
      }
    } catch (error) {
      console.error("Could not load teacher classes:", error.message, error);
      currentClasses = [];
      currentClassId = null;
      currentClassMembers = [];
      state.assignments = [];
      state.submissions = [];
      ui.notice = "We couldn't load your classes from the server just now. Please refresh in a moment.";
      persistState();
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
if (typeof window !== "undefined") window.bootApp = bootApp;
async function refreshWorkspaceAfterAccountSecurity() {
  if (!currentProfile) {
    render();
    return;
  }

  const preferredClassId = currentClassId;
  try {
    if (currentProfile.role === "student") {
      await refreshStudentClasses(preferredClassId);
      await loadStudentAssignmentsForCurrentClass();
      hydrateSelections();
      if (ui.selectedStudentAssignmentId) {
        await loadStudentSubmissionForAssignment(ui.selectedStudentAssignmentId);
      }
    } else if (currentProfile.role === "teacher" || isAdminTeacherView()) {
      // Preserve the already-loaded teacher workspace. A password action should
      // never be allowed to replace classes/students with an empty transient response.
      currentClassId = preferredClassId || currentClassId;
    }
  } catch (error) {
    console.error("Could not refresh workspace after account security action:", error);
    ui.notice = "Password updated. Refresh the page if your class list looks out of date.";
  }
  render();
}

async function loadAdminCefrBenchmarks() {
  ui.adminCefrBenchmarksLoading = true;
  ui.adminCefrBenchmarksError = null;
  render();
  try {
    const data = await Auth.apiFetch('/api/admin/writing-process/benchmarks');
    if (data.error) {
      ui.adminCefrBenchmarksError = data.error;
    } else {
      ui.adminCefrBenchmarks = data.byLevel || {};
    }
  } catch (err) {
    ui.adminCefrBenchmarksError = err.message || 'Failed to load benchmark data';
  }
  ui.adminCefrBenchmarksLoading = false;
  render();
}

async function refreshStaleAdminProcessAnalyses() {
  if (adminProcessRecomputePromise) {
    return adminProcessRecomputePromise;
  }
  ui.adminProcessRecomputeLoading = true;
  ui.adminProcessRecomputeError = null;
  render();

  adminProcessRecomputePromise = Auth.apiFetch('/api/admin/process-analytics/recompute-stale', {
    method: 'POST',
    body: JSON.stringify({ limit: 50 }),
  })
    .then(async (data) => {
      if (data?.error) {
        ui.adminProcessRecomputeError = data.error;
      } else {
        ui.adminProcessRecomputeResult = data.result || null;
        await loadAdminCefrBenchmarks();
      }
    })
    .catch((error) => {
      ui.adminProcessRecomputeError = error.message || 'Failed to update writing process analytics';
    })
    .finally(() => {
      ui.adminProcessRecomputeLoading = false;
      adminProcessRecomputePromise = null;
      render();
    });

  return adminProcessRecomputePromise;
}

async function loadAdminData() {
  const data = await Auth.apiFetch('/api/admin/teachers');
  ui.adminTeachers = data.teachers || [];
  loadAdminCefrBenchmarks();
  refreshStaleAdminProcessAnalyses();
}

async function refreshAdminClassDetail({ keepNotice = false, silent = false } = {}) {
  if (!ui.adminSelectedClassId) return;
  const data = await Auth.apiFetch(`/api/admin/classes/${ui.adminSelectedClassId}/detail`);
  if (data.error) {
    if (!silent) {
      ui.notice = `Could not refresh admin class data: ${data.error}`;
    }
    return;
  }
  ui.adminClassDetail = data;
  if (ui.adminSelectedAssignmentId && !safeArray(data.assignments).some((assignment) => assignment.id === ui.adminSelectedAssignmentId)) {
    ui.adminSelectedAssignmentId = null;
    ui.notice = "This assignment no longer exists. Admin data refreshed.";
  } else if (!keepNotice && !silent) {
    ui.notice = "Admin data refreshed.";
  }
}

function stopAdminClassPolling() {
  if (adminClassRefreshTimer) {
    window.clearInterval(adminClassRefreshTimer);
    adminClassRefreshTimer = null;
  }
}

async function refreshAdminClassDetailIfChanged() {
  if (
    currentProfile?.role !== "admin"
    || isAdminTeacherView()
    || ui.adminView !== "class"
    || !ui.adminSelectedClassId
    || document.visibilityState !== "visible"
  ) {
    return;
  }

  const currentSignature = getAdminClassDetailSignature(ui.adminClassDetail);
  await refreshAdminClassDetail({ keepNotice: true, silent: true });
  const nextSignature = getAdminClassDetailSignature(ui.adminClassDetail);
  if (currentSignature !== nextSignature) {
    render();
  }
}

function syncAdminClassPolling() {
  const shouldPoll =
    currentProfile?.role === "admin"
    && !isAdminTeacherView()
    && ui.adminView === "class"
    && Boolean(ui.adminSelectedClassId);

  if (!shouldPoll) {
    stopAdminClassPolling();
    return;
  }

  if (adminClassRefreshTimer) {
    return;
  }

  adminClassRefreshTimer = window.setInterval(() => {
    refreshAdminClassDetailIfChanged().catch((error) => {
      console.error("Could not refresh admin class data:", error);
    });
  }, ADMIN_REFRESH_MS);
}

async function loadTeacherClassContext(classId) {
  currentClassId = classId || null;
  saveActiveClassId(currentProfile, currentClassId);
  ui.selectedAssignmentId = null;
  ui.selectedReviewSubmissionId = null;
  ui.selectedReviewStudentId = null;

  if (!currentClassId) {
    currentClassMembers = [];
    state.assignments = [];
    state.submissions = [];
    persistState();
    return;
  }

  let membersData = null;
  let assignData = null;
  try {
    [membersData, assignData] = await Promise.all([
      Auth.apiFetch(`/api/classes/${currentClassId}/members`),
      Auth.apiFetch(`/api/classes/${currentClassId}/assignments`)
    ]);
  } catch (error) {
    console.error("Could not load teacher class context:", error.message, error);
    currentClassMembers = [];
    state.assignments = [];
    state.submissions = [];
    ui.notice = "We couldn't load this class from the server just now.";
    persistState();
    return;
  }

  if (membersData?.error || assignData?.error) {
    currentClassMembers = [];
    state.assignments = [];
    state.submissions = [];
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
    state.assignments = [];
    ui.notice = "We couldn't load assignments from the server just now.";
    persistState();
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
  const serverStatus = String(server.status || "").trim().toLowerCase();
  const serverReviewStatus = String(serverReview.status || "").trim().toLowerCase();
  const serverIsOpenForEditing = ["draft", "returned", "reopened"].includes(serverStatus);
  const serverReviewIsOpen = ["draft", "returned", "reopened", "ungraded", ""].includes(serverReviewStatus);
  // Detect a server-side reopen. Older reopened rows can still carry annotation
  // metadata, so do not let old comments make the cached graded state win.
  const serverReopenDetected = serverIsOpenForEditing && (serverReviewIsOpen || !serverHasReview);

  const mergedTeacherReview = serverReopenDetected
    ? resetTeacherReviewForReopen(serverReview)
    : (serverHasReview || !localHasReview
        ? createDefaultTeacherReview({
            ...localReview,
            ...serverReview,
            rowScores: safeArray(serverReview.rowScores).length ? serverReview.rowScores : localReview.rowScores,
            suggestedRowScores: safeArray(serverReview.suggestedRowScores).length ? serverReview.suggestedRowScores : localReview.suggestedRowScores,
            annotations: safeArray(serverReview.annotations).length ? serverReview.annotations : localReview.annotations,
          })
        : localReview);
  const reviewedStatus = ["graded", "late", "missing"].includes(server.status)
    ? server.status
    : (mergedTeacherReview.savedAt ? "graded" : "");

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
    status: serverReopenDetected ? (serverStatus || "draft") : (reviewedStatus || prefer(server.status, local.status, { isEmpty: (value) => !value })),
    teacherReview: mergedTeacherReview,
    updatedAt: serverReopenDetected ? server.updatedAt : (localIsNewer ? local.updatedAt : server.updatedAt),
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
      writingBehaviourExcluded: Boolean(serverSubmission?.teacher_review?.writingBehaviourExcluded),
      writingBehaviourExcludedAt: serverSubmission?.teacher_review?.writingBehaviourExcludedAt || null,
      writingBehaviourExclusionReason: serverSubmission?.teacher_review?.writingBehaviourExclusionReason || "",
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
      ids.map((assignmentId) => globalThis.ApiService.loadAssignmentSubmissions(assignmentId))
    );

    state.submissions = results.flat();
  } catch (error) {
    console.error("Could not load teacher submissions:", error.message, error);
  }
}

async function loadStudentSubmissionForAssignment(assignmentId) {
  if (!assignmentId) return null;
  const localSubmission = state.submissions.find((submission) => submission.assignmentId === assignmentId && submission.studentId === ui.activeUserId) || null;
  try {
    const mapped = await globalThis.ApiService.loadMySubmission(assignmentId);
    if (!mapped) {
      return localSubmission;
    }
    const index = state.submissions.findIndex((submission) => submission.assignmentId === mapped.assignmentId && submission.studentId === mapped.studentId);
    if (index >= 0) {
      state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
    } else {
      state.submissions.push(mapped);
    }
    reconcileStudentStepAfterSubmissionRefresh(index >= 0 ? state.submissions[index] : mapped);
    if (isSubmissionDebugEnabled()) {
      await loadSubmissionDebugState(assignmentId);
    }
    persistState();
    return index >= 0 ? state.submissions[index] : mapped;
  } catch (error) {
    console.error("Could not load student submission:", error.message, error);
    ui.notice = "We couldn't refresh your work from the server just now. Showing your saved device copy.";
    return localSubmission;
  }
}

async function loadSubmissionDebugState(assignmentId = ui.selectedStudentAssignmentId) {
  if (!assignmentId || currentProfile?.role !== "student") return null;
  try {
    const result = await Auth.apiFetch(`/api/debug/submission-state?assignmentId=${encodeURIComponent(assignmentId)}`);
    ui.latestSubmissionDebug = result?.error
      ? { error: result.error, checkedAt: new Date().toISOString() }
      : result;
    return ui.latestSubmissionDebug;
  } catch (error) {
    ui.latestSubmissionDebug = { error: error.message, checkedAt: new Date().toISOString() };
    return ui.latestSubmissionDebug;
  }
}

async function loadEmailDebugState(assignmentId = ui.selectedAssignmentId, studentId = ui.selectedReviewStudentId) {
  if (!assignmentId || !studentId || !(currentProfile?.role === "teacher" || isAdminTeacherView())) return null;
  try {
    const params = new URLSearchParams({ assignmentId, studentId });
    const result = await Auth.apiFetch(`/api/notifications/diagnose-submission?${params.toString()}`);
    ui.latestEmailDebug = result?.error
      ? { error: result.error, checkedAt: new Date().toISOString() }
      : result;
    return ui.latestEmailDebug;
  } catch (error) {
    ui.latestEmailDebug = { error: error.message, checkedAt: new Date().toISOString() };
    return ui.latestEmailDebug;
  }
}

async function loadStudentSubmissionsForAssignments(assignmentIds) {
  const ids = safeArray(assignmentIds).filter(Boolean);
  if (!ids.length || currentProfile?.role !== "student") return [];

  try {
    const serverSubmissions = await globalThis.ApiService.loadStudentSubmissions(ids);
    serverSubmissions.forEach((mapped) => {
      const index = state.submissions.findIndex(
        (submission) => submission.assignmentId === mapped.assignmentId && submission.studentId === mapped.studentId
      );
      if (index >= 0) {
        state.submissions[index] = mergeStudentSubmission(state.submissions[index], mapped);
        reconcileStudentStepAfterSubmissionRefresh(state.submissions[index]);
      } else {
        state.submissions.push(mapped);
        reconcileStudentStepAfterSubmissionRefresh(mapped);
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
    (currentProfile?.role !== "teacher" && !isAdminTeacherView())
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
if (typeof window !== "undefined") window.stopTeacherReviewPolling = stopTeacherReviewPolling;

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
if (typeof window !== "undefined") window.getActiveChatElapsedMs = getActiveChatElapsedMs;
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
if (typeof window !== "undefined") window.resumeActiveChatSession = resumeActiveChatSession;
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
          pointsLabel: formatCriterionPointsLabel(criterion),
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
    submission.teacherReview.annotations.push({
      id: uid("ann"),
      code,
      label: getAnnotationCodeMeaning({ code }),
      selectedText: annotationText,
      note,
    });
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
    await saveCurrentDraftFromEditor();
    render();
    return;
  }

  if (action === "save-draft-and-next") {
    const submission = getStudentSubmission();
    if (!submission) return;
    if (isStudentSubmissionLocked(submission)) {
      rememberStudentStep(4);
      ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
      render();
      return;
    }

    const saved = await saveCurrentDraftFromEditor({ renderAfter: false });
    if (!submission.draftText?.trim()) {
      ui.notice = "Write your draft first, then save and continue.";
      render();
      return;
    }
    if (!submission.finalText?.trim()) {
      submission.finalText = submission.draftText;
      submission.updatedAt = new Date().toISOString();
      persistState();
      scheduleSubmissionSync();
    }
    rememberStudentStep(3);
    ui.notice = saved
      ? "Draft saved. Your draft has been copied into the final version box."
      : "We couldn't save to the server just now. Your work is still on this device and you can keep going.";
    render();
    window.requestAnimationFrame(() => {
      document.querySelector(".wizard-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  if (action === "refresh-submission-debug") {
    await loadSubmissionDebugState(ui.selectedStudentAssignmentId);
    render();
    return;
  }

  if (action === "refresh-email-debug") {
    await loadEmailDebugState(ui.selectedAssignmentId, ui.selectedReviewStudentId);
    render();
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
    ui.notice = "";
    render();
    await refreshAdminClassDetail({ keepNotice: true });
    render();
    return;
  }

  if (action === "admin-toggle-test-student") {
    const studentId = target.dataset.studentId;
    if (!studentId || !ui.adminClassDetail) return;
    const member = safeArray(ui.adminClassDetail.members).find((item) => item?.id === studentId);
    if (!member) return;
    const currentlyTest = Boolean(member.is_test_account);
    const nextTest = !currentlyTest;
    ui.adminStudentFlagSavingId = studentId;
    render();
    const data = await Auth.apiFetch(`/api/admin/students/${studentId}/flags`, {
      method: "PATCH",
      body: JSON.stringify({
        isTestAccount: nextTest,
      }),
    });
    if (data.error) {
      ui.notice = data.needsMigration
        ? "Test account labels need one Supabase migration before they can save. Apply the PR 165 profile admin flags migration, then try again."
        : `Could not update student flags: ${data.error}`;
      ui.adminStudentFlagSavingId = null;
      render();
      return;
    }
    ui.notice = nextTest
      ? "Student marked as a test account. Their submissions will be ignored by future writing behaviour analytics."
      : "Student unmarked as a test account.";
    await refreshAdminClassDetail({ keepNotice: true });
    ui.adminStudentFlagSavingId = null;
    render();
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

  if (action === "account-security-change-password") {
    ui.showPasswordModal = true;
    render();
    window.requestAnimationFrame(() => document.getElementById("account-password-input")?.focus());
    return;
  }

  if (action === "account-security-dismiss") {
    window.AccountSecurity?.dismissUpgradePrompt(currentProfile);
    await refreshWorkspaceAfterAccountSecurity();
    return;
  }

  if (action === "account-security-cancel") {
    ui.showPasswordModal = false;
    render();
    return;
  }

  if (action === "account-security-save") {
    const passwordInput = document.getElementById("account-password-input");
    const confirmInput = document.getElementById("account-password-confirm");
    const errEl = document.getElementById("account-password-error");
    const password = passwordInput?.value || "";
    const confirm = confirmInput?.value || "";
    const validation = window.AccountSecurity?.validatePasswordPair(password, confirm) || { ok: false, message: "Password could not be checked." };
    if (errEl) {
      errEl.style.display = "none";
    }
    if (!validation.ok) {
      if (errEl) {
        errEl.textContent = validation.message;
        errEl.style.display = "block";
      }
      return;
    }
    try {
      await Auth.updatePassword(password);
      window.AccountSecurity?.markPasswordUpdated(currentProfile);
      ui.showPasswordModal = false;
      ui.notice = "Password updated.";
      await refreshWorkspaceAfterAccountSecurity();
    } catch (error) {
      if (errEl) {
        errEl.textContent = error.message;
        errEl.style.display = "block";
      }
    }
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
    if (canAdvanceToStep(4)) {
      rememberStudentStep(4);
      ui.notice = "";
    }
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
    ui.publishingAssignmentId = assignmentId;
    ui.savedAssignmentFocusId = null;
    ui.notice = newStatus === "published" ? "Publishing assignment..." : "Moving assignment back to draft...";
    render();
    try {
      await window.ApiService.setAssignmentStatus(assignmentId, newStatus);
      await loadTeacherClassContext(currentClassId);
      ui.selectedAssignmentId = assignmentId;
      ui.notice = newStatus === "published"
        ? "Assignment published — students in this class can now see it."
        : "Assignment moved back to draft.";
      persistState();
    } catch (error) {
      ui.notice = "Could not update assignment: " + error.message;
    } finally {
      ui.publishingAssignmentId = null;
      render();
    }
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
    try {
  	  await window.ApiService.deleteAssignment(assignmentId);
	} catch (error) {
      ui.notice = `Could not delete assignment: ${error.message}`;
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
      const reviewList = document.getElementById("student-review-list");
      if (reviewList) {
        reviewList.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

  });

  return;
}
  if (action === "student-next-step") {
    const submission = getStudentSubmission();
    if (isStudentSubmissionLocked(submission)) {
      rememberStudentStep(4);
      ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
      render();
      return;
    }
    const nextStep = Number(target.dataset.step);
    if (nextStep === 2) {
      const notes = document.getElementById("chat-skip-notes");
      if (notes && submission) {
        submission.outline.partOne = notes.value.trim();
        submission.updatedAt = new Date().toISOString();
        persistState();
        scheduleSubmissionSync();
      }
    }
    if (nextStep === 3) {
      const assignment = getStudentAssignment();

      if (submission && !submission.finalText?.trim() && submission.draftText?.trim()) {
        submission.finalText = submission.draftText;
        submission.updatedAt = new Date().toISOString();
        persistState();
      }
  
    }
    if (nextStep === 4) {
      const assignment = getStudentAssignment();
      const finalEditor = document.getElementById("final-editor");
      if (submission && finalEditor) {
        submission.finalText = finalEditor.value;
        submission.updatedAt = new Date().toISOString();
        persistState();
        scheduleSubmissionSync();
        scheduleAutoSave();
      }
      if (shouldPromptForFinalDraftFeedback(assignment, submission)) {
        ui.showDraftFeedbackPrompt = true;
        ui.notice = "";
        render();
        return;
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
    if (isStudentSubmissionLocked(submission)) {
      rememberStudentStep(4);
      ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
      render();
      return;
    }
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
    const submission = getStudentSubmission();
    if (isStudentSubmissionLocked(submission)) {
      rememberStudentStep(4);
      ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
      render();
      return;
    }
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
    if (isEmailDebugEnabled()) {
      await loadEmailDebugState(ui.selectedAssignmentId, ui.selectedReviewStudentId);
    }
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
    if (isEmailDebugEnabled()) {
      await loadEmailDebugState(ui.selectedAssignmentId, ui.selectedReviewStudentId);
    }
    render();
    return;
  }

  if (action === "previous-review-student") {
    const previousStudentId = getPreviousReviewStudentId(ui.selectedReviewStudentId, ui.selectedAssignmentId);
    if (!previousStudentId) return;
    stopPlayback();
    ui.selectedReviewStudentId = previousStudentId;
    ui.selectedReviewSubmissionId = getReviewSubmissionForStudent(previousStudentId, ui.selectedAssignmentId)?.id || null;
    ui.teacherView = "grading";
    ui.playback.index = 0;
    ui.playback.touched = false;
    ui.notice = "";
    if (isEmailDebugEnabled()) {
      await loadEmailDebugState(ui.selectedAssignmentId, ui.selectedReviewStudentId);
    }
    render();
    return;
  }

  if (action === "inspect-paste-flag") {
    const pasteId = target.dataset.pasteId;
    if (!pasteId) return;
    const highlight = document.getElementById(`paste-highlight-${pasteId}`);
    if (highlight) {
      flashScrollTarget(highlight);
      return;
    }
    const card = document.getElementById(`paste-evidence-${pasteId}`);
    if (card) {
      if (card.tagName === "DETAILS") {
        card.open = true;
      }
      flashScrollTarget(card);
    }
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
    syncPlaybackUi();
    return;
  }

  if (action === "playback-step") {
    const direction = Number(target.dataset.direction);
    ui.playback.touched = true;
    stepPlayback(direction);
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

  if (action === "toggle-submission-behaviour-exclusion") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) return;
    submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
    const previousReview = createDefaultTeacherReview(submission.teacherReview);
    const nextFlag = !submission.teacherReview.writingBehaviourExcluded;
    submission.teacherReview.writingBehaviourExcluded = nextFlag;
    submission.teacherReview.writingBehaviourExcludedAt = nextFlag ? new Date().toISOString() : null;
    submission.teacherReview.writingBehaviourExclusionReason = nextFlag
      ? "Teacher flagged this submission from the grading screen."
      : "";
    ui.notice = nextFlag
      ? "Submission flagged. Future writing behaviour analytics should ignore this submission."
      : "Submission flag removed.";
    render();
    try {
      const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
      replaceSubmissionInState(savedSubmission);
      ui.selectedReviewSubmissionId = savedSubmission.id;
      persistState();
    } catch (error) {
      submission.teacherReview = previousReview;
      ui.notice = `Could not update submission flag: ${error.message}`;
    }
    render();
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
    submission.teacherReview.finalNotes = submission.teacherReview.suggestedGrade.studentComment || "";
    submission.teacherReview.status = "graded";
    submission.teacherReview.acceptedAt = new Date().toISOString();
    ui.notice = "Suggested grade and comment copied — review and submit when ready.";
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
    if (isStudentSubmissionLocked(submission)) {
      rememberStudentStep(4);
      ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
      render();
      return;
    }
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
       if (ui.gradeSubmitting) {
         return;
       }
       // Capture editable inputs BEFORE render() wipes the DOM.
       const finalScoreInput = document.getElementById("teacher-review-final-score");
       const overrideRaw = finalScoreInput ? finalScoreInput.value : "";
       const notesInput = document.getElementById("teacher-review-notes");
       const notesValue = notesInput ? notesInput.value.trim() : "";
       const overrideNum = overrideRaw === "" ? null : Number(overrideRaw);
       const validOverride = overrideNum !== null && !Number.isNaN(overrideNum) ? overrideNum : null;
       ui.gradeSubmitting = true;
       // Stash the captured override so the re-render between now and the
       // server response shows what the teacher typed, not the stale value.
       ui.pendingFinalScoreOverride = validOverride;
       render();
       const previousStatus = submission.status;
       const previousReview = createDefaultTeacherReview(submission.teacherReview);
       try {
         submission.teacherReview = createDefaultTeacherReview(submission.teacherReview);
         const summary = calculateTeacherReviewSummary(assignment, submission);
         submission.teacherReview.rubricType = getAssignmentRubricType(assignment);
         submission.teacherReview.finalScore = validOverride === null ? summary.totalScore : validOverride;
         submission.teacherReview.finalNotes = notesValue;
         submission.teacherReview.status = "graded";
         submission.teacherReview.savedAt = new Date().toISOString();
         submission.status = "graded";
         const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
         replaceSubmissionInState(savedSubmission);
         ui.selectedReviewSubmissionId = savedSubmission.id;
         ui.notice = "Grade submitted to student.";
         persistState();
       } catch (error) {
         submission.status = previousStatus;
         submission.teacherReview = previousReview;
         ui.notice = `Could not submit grade: ${error.message}`;
         console.error("Could not submit grade:", error);
       } finally {
         ui.gradeSubmitting = false;
         ui.pendingFinalScoreOverride = null;
         render();
       }
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
    const previousStatus = submission.status;
    const previousReview = createDefaultTeacherReview(submission.teacherReview);
    submission.status = nextStatus;
    submission.teacherReview.status = nextStatus;
    submission.updatedAt = new Date().toISOString();

    try {
      const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
      replaceSubmissionInState(savedSubmission);
      ui.selectedReviewSubmissionId = savedSubmission.id;
      ui.notice = `Marked ${savedSubmission._studentName || "student"} as ${getSubmissionStatusDisplay(nextStatus).toLowerCase()}.`;
      persistState();
    } catch (error) {
      submission.status = previousStatus;
      submission.teacherReview = previousReview;
      ui.notice = `Could not update status: ${error.message}`;
      console.error("Could not update status:", error);
    }
    render();
    return;
  }

  if (action === "open-reopen-submission-modal") {
    const submission = getSelectedReviewSubmission();
    if (!submission) return;
    ui.reopenSubmissionPrompt = {
      submissionId: submission.id,
      studentName: submission._studentName || getUserById(submission.studentId)?.name || "this student",
    };
    render();
    return;
  }

  if (action === "close-reopen-submission-modal") {
    ui.reopenSubmissionPrompt = null;
    render();
    return;
  }

  if (action === "confirm-reopen-submission") {
    const submission = getSelectedReviewSubmission();
    const assignment = getSelectedAssignment();
    if (!submission || !assignment) {
      ui.reopenSubmissionPrompt = null;
      render();
      return;
    }

    const previousStatus = submission.status;
    const previousReview = createDefaultTeacherReview(submission.teacherReview);
    submission.status = "draft";
    submission.teacherReview = resetTeacherReviewForReopen(createDefaultTeacherReview(submission.teacherReview));
    submission.updatedAt = new Date().toISOString();

    try {
      const savedSubmission = await upsertTeacherReviewSubmission(assignment, submission);
      replaceSubmissionInState(savedSubmission);
      ui.selectedReviewSubmissionId = savedSubmission.id;
      ui.reopenSubmissionPrompt = null;
      ui.notice = `Reopened ${savedSubmission._studentName || "student"} for editing and resubmission.`;
      persistState();
    } catch (error) {
      submission.status = previousStatus;
      submission.teacherReview = previousReview;
      ui.notice = `Could not reopen submission: ${error.message}`;
      console.error("Could not reopen submission:", error);
    }
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
    syncTeacherAssignmentSaveButtons();
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
    syncTeacherAssignmentSaveButtons();
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

    updateFinalSubmission(target.value);
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
    updateOutlineProcessEvent(target.dataset.outlineField, target.value);
    scheduleAutoSave();
    return;
  }
}

function handlePaste(event) {
  if (event.target.id !== "draft-editor" && event.target.id !== "final-editor" && !event.target.dataset?.outlineField) {
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
    stopAdminClassPolling();
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
      ${window.AccountSecurity?.renderUpgradeBanner(currentProfile) || ""}
      ${ui.role === "admin" && !isAdminTeacherView() ? renderAdminWorkspace() : ui.role === "teacher" || isAdminTeacherView() ? renderTeacherWorkspace() : renderStudentWorkspace()}
    </div>
  ` + renderInvitePanel() + renderPasteWarning() + renderClassModal() + renderDraftFeedbackModal() + renderReopenSubmissionModal() + (window.AccountSecurity?.renderChangePasswordModal(ui.showPasswordModal) || "");

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
    document.querySelectorAll("#draft-editor, #final-editor, [data-outline-field]").forEach(el => {
      if (!el || el.dataset.keystrokeListenerAttached) return;
      el.addEventListener("keydown", () => {
        recordKeystrokeInterval();
        scheduleKeystrokeFlush();
      });
      el.dataset.keystrokeListenerAttached = "true";
    });
  });

  syncTeacherReviewPolling();
  syncAdminClassPolling();
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
      if (Number(ui.teacherDraft.uploadedRubricSchema?.totalPoints || 0) > 0) {
        ui.teacherDraft.totalPoints = Number(ui.teacherDraft.uploadedRubricSchema.totalPoints);
      }
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

function renderAdminWorkspace() {
  if (isAdminTeacherView()) return renderTeacherWorkspace();

  if (ui.adminView === "class" && ui.adminSelectedClassId) {
    return renderAdminClassDetail();
  }

  if (ui.adminView === "teacher" && ui.adminSelectedTeacherId) {
    return renderAdminTeacherDetail();
  }

  return renderAdminTeacherList();
}

async function saveCurrentDraftFromEditor({ renderAfter = false } = {}) {
  const submission = getStudentSubmission();
  if (!submission) return false;
  const draftEditor = document.getElementById("draft-editor");
  if (draftEditor) {
    submission.draftText = draftEditor.value;
  }
  submission.updatedAt = new Date().toISOString();
  persistState();
  setDraftSaveMessage("Saving...");
  const saved = await flushCurrentStudentWork();
  showAutosaveIndicator(saved ? "Draft saved" : "Saved on this device");
  setDraftSaveMessage(saved ? "Draft saved." : "Saved on this device.");
  ui.notice = saved ? "Draft saved." : "We couldn't save to the server just now, but your draft is still on this device.";
  if (renderAfter) {
    render();
  }
  return saved;
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
    if (!isOutlineComplete(submission, assignment)) {
      ui.notice = "Complete the outline first. It gives you a plan to draft from and helps your teacher see your planning process.";
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
  if (ui.assignmentSaving) {
    return;
  }
  console.log("[saveTeacherAssignment started]", {
    teacherAssist: ui.teacherAssist,
    teacherDraft: ui.teacherDraft,
    currentClassId,
  });

  ui.assignmentSaving = true;
  ui.notice = "Saving assignment...";
  render();

  try {
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
          pointsLabel: formatCriterionPointsLabel(criterion),
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

  const savedAssignment = await window.ApiService.saveAssignment(
  selectedClassId,
  assignment,
  editingAssignment?.id || null
);

const savedAssignmentId = savedAssignment?.id || null;
  await loadTeacherClassContext(selectedClassId);
  ui.selectedAssignmentId = savedAssignmentId || state.assignments[0]?.id || null;
  ui.selectedReviewSubmissionId = null;
  ui.teacherDraft = createBlankTeacherDraft();
  ui.teacherAssist = null;
  ui.editingAssignmentId = null;
  ui.savedAssignmentFocusId = savedAssignmentId;
  ui.notice = editingAssignment
    ? "Assignment updated."
    : "Assignment created. Review it in the assignment tray, then publish when ready.";
  persistState();
  ui.assignmentSaving = false;
  render();
  if (savedAssignmentId && !editingAssignment) {
    window.requestAnimationFrame(() => {
      document.getElementById(`assignment-card-${savedAssignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  } catch (error) {
    ui.notice = "Could not save assignment: " + error.message;
  } finally {
    if (ui.assignmentSaving) {
      ui.assignmentSaving = false;
      render();
    }
  }
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
  if (ui.draftFeedbackLoading) {
    return;
  }

  const assignment = getStudentAssignment();
  const submission = getStudentSubmission();
  if (!assignment || !submission) {
    return;
  }
  if (isStudentSubmissionLocked(submission)) {
    rememberStudentStep(4);
    ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
    render();
    return;
  }

  if (submission.feedbackHistory.length >= assignment.feedbackRequestLimit) {
    ui.notice = "You have used all your draft checks for this assignment.";
    render();
    return;
  }

  ui.draftFeedbackLoading = true;
  ui.notice = "Checking your draft...";
  syncDraftFeedbackButtons();
  render();

  let shouldScrollToFeedbackNotice = false;
  const draftTextAtRequest = String(submission.draftText || "");
  try {
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
      draftTextAtRequest,
      draftWordCountAtRequest: wordCount(draftTextAtRequest),
    });
    ui.latestDraftFeedbackByAssignmentId[assignment.id] = safeArray(items).slice();
    submission.updatedAt = new Date().toISOString();
    ui.notice = "Draft check added. Use it to improve your own writing.";
    shouldScrollToFeedbackNotice = true;
    persistState();
    await flushCurrentStudentWork();
  } finally {
    ui.draftFeedbackLoading = false;
    render();
    if (shouldScrollToFeedbackNotice) {
      window.requestAnimationFrame(() => {
        document.querySelector(".wizard-card .notice")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }
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
if (typeof window !== "undefined") window.getRenderableDraftFeedbackEntries = getRenderableDraftFeedbackEntries;
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
  if (ui.studentSubmitting) {
    return;
  }
  const submission = getStudentSubmission();
  const assignment = getStudentAssignment();
  if (!submission || !assignment) {
    return;
  }
  if (isStudentSubmissionLocked(submission)) {
    rememberStudentStep(4);
    ui.notice = "This assignment has already been submitted. Ask your teacher if you need to submit again.";
    render();
    return;
  }
  const finalEditor = document.getElementById("final-editor");
  const finalText = finalEditor ? finalEditor.value.trim() : submission.finalText?.trim();
  if (!finalText) {
    ui.notice = "Write your final text before submitting.";
    render();
    return;
  }
  const rubricSchema = assignment.uploadedRubricSchema || assignment.rubricSchema || getRubricSchema(assignment.rubric, assignment.uploadedRubricName || assignment.title);
  const selfAssessmentCompletion = getStudentSelfAssessmentCompletion(rubricSchema, submission);
  if (!selfAssessmentCompletion.isComplete) {
    rememberStudentStep(4);
    ui.notice = "Please rate yourself on all rubric items before submitting.";
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
  ui.studentSubmitting = true;
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
        ui.studentSubmitting = false;
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
      ui.studentSubmitting = false;
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
      ui.studentSubmitting = false;
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

function buildProcessWritingEvent(previousText, nextText, { phase = "draft", field = "" } = {}) {
  const creator = window.PraxisWritingProcess?.createWritingEvent;
  if (creator) {
    return creator({
      previousText,
      nextText,
      pendingPaste: ui.pendingPaste,
      phase,
      field,
      idFactory: () => uid("event"),
      largePasteLimit: LARGE_PASTE_LIMIT,
    });
  }

  const operation = getTextOperation(previousText, nextText);
  if (!operation) return null;
  const type = determineEventType(operation);
  const pasteContent = ui.pendingPaste?.content || "";
  const insertedText = type === "paste" ? pasteContent : operation.insertedText;
  const isLargeSingleInsert = !pasteContent && insertedText.length >= LARGE_PASTE_LIMIT && !operation.removedText;
  return {
    id: uid("event"),
    timestamp: new Date().toISOString(),
    type,
    phase,
    field,
    start: operation.start,
    end: operation.end,
    removedText: operation.removedText,
    insertedText,
    delta: operation.insertedText.length - operation.removedText.length,
    flagged: (type === "paste" && insertedText.length >= LARGE_PASTE_LIMIT) || isLargeSingleInsert,
    detectionReason: isLargeSingleInsert ? "large_single_insert_without_paste_event" : "",
    preview: trimTo(insertedText || operation.removedText || nextText.slice(-40), 80),
  };
}

function updateDraftSubmission(nextText) {
  const submission = getStudentSubmission();
  if (!submission) {
    return;
  }

  const previousText = submission.draftText || "";
  const now = new Date().toISOString();
  const event = buildProcessWritingEvent(previousText, nextText, { phase: "draft", field: "draftText" });
  if (!event) {
    return;
  }

  submission.draftText = nextText;
  submission.updatedAt = now;
  submission.startedAt = submission.startedAt || now;
  submission.lastEditedAt = now;
  event.timestamp = now;
  submission.writingEvents.push(event);

  ui.pendingPaste = null;
  persistState();
}

function updateFinalSubmission(nextText) {
  const submission = getStudentSubmission();
  if (!submission) return;
  const previousText = submission.finalText || submission.draftText || "";
  const now = new Date().toISOString();
  const event = buildProcessWritingEvent(previousText, nextText, { phase: "final", field: "finalText" });
  if (event) {
    event.timestamp = now;
    submission.writingEvents.push(event);
  }
  if (!submission.finalUnlocked) submission.finalUnlocked = true;
  submission.finalText = nextText;
  submission.updatedAt = now;
  submission.startedAt = submission.startedAt || now;
  submission.lastEditedAt = now;
  ui.pendingPaste = null;
  persistState();
}

function updateOutlineProcessEvent(field, nextText) {
  const submission = getStudentSubmission();
  if (!submission || !field) return;
  submission.outline = submission.outline || {};
  const previousText = submission.outline[field] || "";
  const event = buildProcessWritingEvent(previousText, nextText, { phase: "coach_outline", field });
  submission.outline[field] = nextText;
  submission.updatedAt = new Date().toISOString();
  if (event) {
    event.timestamp = submission.updatedAt;
    submission.writingEvents = submission.writingEvents || [];
    submission.writingEvents.push(event);
  }
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

function formatCompactDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function getWritingTimeSummary(submission) {
  const eventTimes = safeArray(submission?.writingEvents)
    .map((event) => Date.parse(event?.timestamp || ""))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  const fallbackStart = Date.parse(submission?.startedAt || submission?.updatedAt || submission?.submittedAt || "");
  const fallbackEnd = Date.parse(submission?.submittedAt || submission?.updatedAt || submission?.startedAt || "");
  const start = eventTimes[0] ?? (Number.isFinite(fallbackStart) ? fallbackStart : null);
  const end = eventTimes[eventTimes.length - 1] ?? (Number.isFinite(fallbackEnd) ? fallbackEnd : start);
  const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
  const editCount = safeArray(submission?.writingEvents).length;
  const finalWords = wordCount(submission?.finalText || submission?.draftText || "");
  return {
    durationMs,
    durationLabel: durationMs === 0 && editCount ? "under 1 sec" : formatCompactDuration(durationMs),
    editCount,
    finalWords,
  };
}
window.getWritingTimeSummary = getWritingTimeSummary;

function calculateMeanBurstLength(submission) {
  const events = safeArray(submission?.writingEvents);
  if (!events.length) return 0;
  const minPauseMs = window.PraxisWritingProcess?.LONG_PAUSE_MIN_MS || 2000;
  const maxThinkingPauseMs = window.PraxisWritingProcess?.THINKING_PAUSE_MAX_MS || 120000;
  const pauses = safeArray(submission?.keystrokeLog).map(e => e.gap);
  if (!pauses.length) {
    const insertEvents = events.filter(e => e.type === "insert" && e.insertedText);
    if (!insertEvents.length) return 0;
    return Math.round(
      insertEvents.reduce((sum, e) => sum + String(e.insertedText || "").length, 0) / insertEvents.length
    );
  }
  const longPauses = pauses.filter(g => g >= minPauseMs && g <= maxThinkingPauseMs).length;
  const totalChars = events
    .filter(e => e.type === "insert")
    .reduce((sum, e) => sum + String(e.insertedText || "").length, 0);
  if (!longPauses) return totalChars;
  return Math.round(totalChars / (longPauses + 1));
}

function calculatePauseFrequency(submission) {
  const minPauseMs = window.PraxisWritingProcess?.LONG_PAUSE_MIN_MS || 2000;
  const maxThinkingPauseMs = window.PraxisWritingProcess?.THINKING_PAUSE_MAX_MS || 120000;
  const pauses = safeArray(submission?.keystrokeLog).filter(e => e.gap >= minPauseMs && e.gap <= maxThinkingPauseMs);
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
    const prevPos = prevEvent.end === undefined ? prevEvent.start : prevEvent.end;
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
    const prevPos = prevEvent.end === undefined ? prevEvent.start : prevEvent.end;
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
    largePasteCount: getPasteEvidenceItems(submission).length,
    draftWordCount,
    finalWordCount,
    improvementLabel,
    targetHit: finalWordCount >= assignment.wordCountMin && finalWordCount <= assignment.wordCountMax,
  };
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
    .filter((event) => isPasteLikeWritingEvent(event) && typeof event?.start === "number")
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
  "studentComment": "3-5 sentence comment to give the student about their work"
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
  const pasteEvents = (submission.writingEvents || []).filter((entry) => isPasteLikeWritingEvent(entry));
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
if (typeof window !== "undefined") window.getAnnotationDisplayLabel = getAnnotationDisplayLabel;
function getSubmissionReviewText(submission) {
  return String(submission?.finalText || submission?.draftText || "");
}
window.getSubmissionReviewText = getSubmissionReviewText;

function getFlaggedPasteEvents(submission) {
  return safeArray(submission?.writingEvents)
    .filter((event) => isPasteLikeWritingEvent(event) && String(event?.insertedText || ""));
}

function getPasteEvidenceItems(submission) {
  const text = getSubmissionReviewText(submission);
  const searchStarts = new Map();
  return getFlaggedPasteEvents(submission).map((event, index) => {
    const pastedText = String(event.insertedText || "");
    const id = String(event.id || `paste-${index}`);
    const startHint = Number.isFinite(Number(event.start)) ? Number(event.start) : -1;
    let start = startHint >= 0 && text.slice(startHint, startHint + pastedText.length) === pastedText
      ? startHint
      : -1;
    if (start === -1 && pastedText) {
      const previousStart = Number(searchStarts.get(pastedText) || 0);
      start = text.indexOf(pastedText, previousStart);
      if (start === -1 && previousStart > 0) {
        start = text.indexOf(pastedText);
      }
    }
    if (start !== -1) {
      searchStarts.set(pastedText, start + Math.max(pastedText.length, 1));
    }
    let highlightStart = start;
    let highlightEnd = start === -1 ? -1 : start + pastedText.length;
    let foundApproximate = false;
    if (start === -1 && startHint >= 0 && text.length && pastedText) {
      const candidate = text.slice(startHint);
      const sample = candidate.slice(0, Math.min(120, candidate.length));
      if (sample && pastedText.startsWith(sample)) {
        highlightStart = startHint;
        highlightEnd = text.length;
        foundApproximate = true;
      }
    }
    return {
      id,
      event,
      text: pastedText,
      kind: event.type === "paste" ? "paste" : "bulk_insert",
      timestamp: event.timestamp || submission?.updatedAt || new Date().toISOString(),
      charCount: pastedText.length,
      preview: trimTo(pastedText.replace(/\s+/g, " ").trim(), 180),
      excerpt: window.PasteEvidenceUtils?.buildStartExcerpt
        ? window.PasteEvidenceUtils.buildStartExcerpt(pastedText)
        : {
            preview: trimTo(pastedText.replace(/\s+/g, " ").trim(), 180),
            truncated: pastedText.length > 180,
          },
      start,
      end: start === -1 ? -1 : start + pastedText.length,
      foundExact: start !== -1,
      foundApproximate,
      canHighlight: start !== -1 || foundApproximate,
      highlightStart,
      highlightEnd,
    };
  });
}
window.getPasteEvidenceItems = getPasteEvidenceItems;

function downloadStudentWork(assignment, submission) {
  const studentName = getSubmissionStudentName(submission);
  const reviewRows = getTeacherReviewRowsForExport(assignment, submission);
  const rubricScore = calculateTeacherReviewSummary(assignment, submission).totalScore;
  const totalScore = getTeacherFinalScoreForDisplay(assignment, submission);
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
    safeArray(submission.writingEvents).some((entry) => isPasteLikeWritingEvent(entry) && entry?.insertedText)
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
  const flaggedCount = events.filter((entry) => isPasteLikeWritingEvent(entry)).length;
  const totalChars = events.reduce((sum, e) => sum + Math.abs(e.delta || 0), 0);
  const annotationLegendRows = getAnnotationLegendRows(annotations);
  const eventSummary = `
    <tr><td>Insertions</td><td>${insertCount} events</td></tr>
    <tr><td>Deletions</td><td>${deleteCount} events</td></tr>
    <tr><td>Pastes</td><td>${pasteCount} events${flaggedCount ? ` (${flaggedCount} flagged ⚠)` : ""}</td></tr>
    <tr><td>Total characters changed</td><td>${totalChars.toLocaleString()}</td></tr>
    <tr><td>Total editing events</td><td>${events.length}</td></tr>
  `;

  const rubricLines = reviewRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.criterion)}${row.description ? `<div style="margin-top:4px;color:#667063;font-size:.82rem;">${escapeHtml(row.description)}</div>` : ""}</td>
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
${String(totalScore) === String(rubricScore) ? "" : `<p><strong>Rubric subtotal:</strong> ${rubricScore}/${maxScore}</p>`}
${submission.teacherReview?.finalNotes ? `<p><strong>Overall feedback:</strong> ${escapeHtml(submission.teacherReview.finalNotes)}</p>` : ""}

<h2>Rubric breakdown</h2>
<table>
  <thead><tr><th>Criterion</th><th>Selected band</th><th>Score</th></tr></thead>
  <tbody>${rubricLines || "<tr><td colspan='3'>No rubric available.</td></tr>"}</tbody>
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
	${annotationLegendRows.length ? `
	<table>
	  <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
	  <tbody>${annotationLegendRows.map(({ code, meaning }) => `
	    <tr>
	      <td><strong>${escapeHtml(code)}</strong></td>
	      <td>${escapeHtml(meaning)}</td>
	    </tr>`).join("")}
	  </tbody>
	</table>` : ""}
	<table>
	  <thead><tr><th>Code</th><th>Selected text</th><th>Comment</th></tr></thead>
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
if (typeof window !== "undefined") window.getOutlineFields = getOutlineFields;
function isOutlineComplete(submission, assignment) {
  const config = getOutlineFields(assignment, submission);
  return config.fields.every((field) => String(submission.outline?.[field.key] || "").trim());
}
if (typeof window !== "undefined") window.isOutlineComplete = isOutlineComplete;
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
  const flaggedPasteCount = safeArray(submission.writingEvents).filter((entry) => isPasteLikeWritingEvent(entry)).length;
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
    ? ` Note: the writing log recorded ${pasteFlags} large paste event${pasteFlags > 1 ? "s" : ""} — all work should be your own.`
    : "";

  return `${opening} ${chatComment} ${outlineComment} ${writingComment} ${revisionComment} ${reflectionComment}${pasteComment}`;
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
window.createEmptySubmission = createEmptySubmission;

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
   pointsLabel: formatCriterionPointsLabel(criterion),
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
  const rubricTotalPoints = Number(rubricSchema?.totalPoints || normalizedRubric.reduce((sum, row) => sum + Number(row?.points || 0), 0) || assignment?.totalPoints || 20);

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
    totalPoints: Number.isFinite(rubricTotalPoints) ? rubricTotalPoints : 20,
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
      phase: entry?.phase || "draft",
      field: entry?.field || "",
      start: typeof entry?.start === "number" ? entry.start : null,
      end: typeof entry?.end === "number" ? entry.end : null,
      removedText: entry?.removedText || "",
      insertedText: entry?.insertedText || "",
      delta: Number(entry?.delta || 0),
      flagged: Boolean(entry?.flagged),
      detectionReason: entry?.detectionReason || "",
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
  const storageKey = getProfileScopedStorageKey(STORAGE_KEY, profile);
  const backupKey = getProfileScopedStorageKey(STORAGE_BACKUP_KEY, profile);
  const hasScopedState = Boolean(
    window.localStorage.getItem(storageKey) || window.localStorage.getItem(backupKey)
  );
  if (hasScopedState) {
    return loadStateSnapshot({
      storageKey,
      backupKey,
      normalizeState,
      createBlankState,
      currentProfile: profile,
    });
  }

  const legacySnapshot = safeReadJson(STORAGE_KEY) || safeReadJson(STORAGE_BACKUP_KEY);
  if (legacySnapshot) {
    const migrated = normalizeState(legacySnapshot);
    if (profile?.role === "student" && profile?.id) {
      migrated.users = migrated.users.filter((user) => user?.id === profile.id);
      migrated.submissions = migrated.submissions.filter((submission) => submission?.studentId === profile.id);
      migrated.assignments = [];
      return migrated;
    }
  }

  return loadStateSnapshot({
    storageKey,
    backupKey,
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

  try {
    const mapped = await globalThis.ApiService.submitStudentSubmission(
      submission.assignmentId,
      submission,
      {
        status: "submitted",
        submitted_at: submission.submittedAt || new Date().toISOString(),
      }
    );
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
  const storageKey = getProfileScopedStorageKey(STORAGE_KEY, currentProfile);
  const backupKey = getProfileScopedStorageKey(STORAGE_BACKUP_KEY, currentProfile);
  const result = persistStateSnapshot({
    state,
    currentProfile,
    storageKey,
    backupKey,
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
if (typeof window !== "undefined") window.persistState = persistState;
function getStudentUsers() {
  return state.users.filter((user) => user.role === "student");
}

function getUserById(id) {
  return state.users.find((user) => user.id === id) || null;
}
if (typeof window !== "undefined") window.getUserById = getUserById;
function updateStudentDisplayName(studentId, nextName) {
  const name = String(nextName || "").trim();
  if (!studentId || !name) return;
  state.users = state.users.map((user) => user.id === studentId ? { ...user, name } : user);
  currentClassMembers = currentClassMembers.map((member) => member.id === studentId ? { ...member, name } : member);
  state.submissions = state.submissions.map((submission) => submission.studentId === studentId ? { ...submission, _studentName: name } : submission);
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
if (typeof window !== "undefined") window.extractKeywords = extractKeywords;


function renderProductWordmark(tagName = "span", className = "") {
  const cls = className ? ` class="${className}"` : "";
  return `<${tagName}${cls}>pr<span class="brand-accent-letter">a</span>x<span class="brand-accent-letter">i</span>s</${tagName}>`;
}

function renderBrandGlyph() {
  return `<img src="favicon-256.png" alt="" aria-hidden="true" width="64" height="64" style="display:block;border-radius:14px;">`;
}


function renderEventSummary(entry) {
  const core = `${formatTime(entry.timestamp)} • ${entry.delta >= 0 ? "+" : ""}${entry.delta} chars`;
  if (entry.type === "paste") {
    return `${core}. ${entry.flagged ? "Large paste flagged." : "Paste captured."} ${entry.preview}`;
  }
  if (isLargeSingleInsertEvent(entry)) {
    return `${core}. Large single insert flagged as paste-like evidence. ${entry.preview}`;
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

