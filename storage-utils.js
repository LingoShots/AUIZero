(function initStorageUtils(global) {
  function safeReadJson(key, fallback = null) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeWriteJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function isQuotaError(error) {
    if (!error) return false;
    return error?.name === "QuotaExceededError"
      || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || Number(error?.code) === 22
      || Number(error?.code) === 1014;
  }

  function buildStateSnapshot(state, currentProfile) {
    const assignments = Array.isArray(state?.assignments)
      ? state.assignments.map((assignment) => ({ ...assignment }))
      : [];
    const users = Array.isArray(state?.users)
      ? state.users
        .filter((user) => currentProfile?.role === "student" ? user?.id === currentProfile?.id : false)
        .map((user) => ({ ...user }))
      : [];
    const submissions = Array.isArray(state?.submissions) ? state.submissions : [];

    let persistedSubmissions = [];
    if (currentProfile?.role === "student" && currentProfile?.id) {
      persistedSubmissions = submissions
        .filter((submission) => submission?.studentId === currentProfile.id)
        .map((submission) => ({ ...submission }));
    }

    return {
      users,
      assignments,
      submissions: persistedSubmissions,
    };
  }

  function buildFallbackStateSnapshot(state, currentProfile) {
    const snapshot = buildStateSnapshot(state, currentProfile);
    snapshot.submissions = snapshot.submissions.map((submission) => ({
      ...submission,
      writingEvents: [],
      chatHistory: [],
      focusAnnotations: [],
      teacherReview: submission?.teacherReview
        ? {
            finalScore: submission.teacherReview.finalScore || 0,
            status: submission.teacherReview.status || "pending",
          }
        : undefined,
    }));
    return snapshot;
  }

  function loadStateSnapshot({
    storageKey,
    backupKey,
    normalizeState,
    createBlankState,
  }) {
    const primary = safeReadJson(storageKey);
    if (primary) {
      return normalizeState(primary);
    }

    const backup = safeReadJson(backupKey);
    if (backup) {
      return normalizeState(backup);
    }

    const blank = normalizeState(createBlankState());
    safeWriteJson(storageKey, blank);
    safeWriteJson(backupKey, blank);
    return blank;
  }

  function persistStateSnapshot({
    state,
    currentProfile,
    storageKey,
    backupKey,
  }) {
    const snapshot = buildStateSnapshot(state, currentProfile);
    const primaryWrite = safeWriteJson(storageKey, snapshot);
    if (primaryWrite.ok) {
      safeWriteJson(backupKey, snapshot);
      return { ok: true, mode: "full" };
    }

    if (!isQuotaError(primaryWrite.error)) {
      return { ok: false, error: primaryWrite.error, mode: "full" };
    }

    const fallbackSnapshot = buildFallbackStateSnapshot(state, currentProfile);
    const fallbackWrite = safeWriteJson(storageKey, fallbackSnapshot);
    if (fallbackWrite.ok) {
      safeWriteJson(backupKey, fallbackSnapshot);
      return { ok: true, mode: "fallback", error: primaryWrite.error };
    }

    return { ok: false, error: fallbackWrite.error || primaryWrite.error, mode: "fallback" };
  }

  global.StorageUtils = {
    buildFallbackStateSnapshot,
    buildStateSnapshot,
    isQuotaError,
    loadStateSnapshot,
    persistStateSnapshot,
    safeReadJson,
    safeWriteJson,
  };
})(window);
