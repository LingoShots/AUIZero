// core-utils.js
// Pure primitive helpers shared across all modules.
// Loaded first in index.html so every module can use these as bare globals.
// Exposes window.CoreUtils plus each function directly on window for back-compat.

(function (root) {
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

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function wordCount(text) {
    return (String(text || "").trim().match(/\b[\w'-]+\b/g) || []).length;
  }

  function trimTo(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  const CoreUtils = {
    escapeHtml,
    escapeAttribute,
    titleCase,
    uid,
    wordCount,
    trimTo,
    clamp,
    clamp01,
    formatDateTime,
    formatTime,
    safeArray,
  };

  root.CoreUtils = CoreUtils;
  Object.assign(root, CoreUtils);
})(typeof window !== "undefined" ? window : globalThis);
