function stripTrailingSlash(value) {
  const raw = String(value || "");
  let end = raw.length;
  while (end > 0 && raw[end - 1] === "/") end -= 1;
  return raw.slice(0, end);
}

function normalizeHost(value) {
  let host = String(value || "").split(",")[0].trim().toLowerCase();
  if (host.startsWith("http://")) host = host.slice(7);
  if (host.startsWith("https://")) host = host.slice(8);
  const slashIndex = host.indexOf("/");
  if (slashIndex >= 0) host = host.slice(0, slashIndex);
  if (host.endsWith(":443")) host = host.slice(0, -4);
  if (host.endsWith(":80")) host = host.slice(0, -3);
  return host;
}

function isLocalHost(value) {
  const host = normalizeHost(value);
  return host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("[::1]:");
}

function getConfiguredBaseUrl(env = process.env) {
  return stripTrailingSlash(
    env.PUBLIC_APP_URL ||
    env.APP_URL ||
    env.SITE_URL ||
    env.PUBLIC_SITE_URL ||
    ""
  );
}

function getSafeRedirectPath(originalUrl = "/") {
  const raw = String(originalUrl || "/").trim();

  if (!raw || raw.includes("\r") || raw.includes("\n")) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.startsWith("/\\")) return "/";

  return raw;
}

function getCanonicalRedirectTarget({ method, host, originalUrl = "/", configuredBase }) {
  const verb = String(method || "GET").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return "";

  const base = stripTrailingSlash(configuredBase);
  const lowerBase = base.toLowerCase();
  if (!lowerBase.startsWith("http://") && !lowerBase.startsWith("https://")) return "";
  if (isLocalHost(base) || isLocalHost(host)) return "";

  const canonicalHost = normalizeHost(base);
  const requestHost = normalizeHost(host);
  if (!canonicalHost || !requestHost || canonicalHost === requestHost) return "";

  const path = getSafeRedirectPath(originalUrl);
  if (path.startsWith("/api/")) return "";

  return `${base}${path}`;
}

module.exports = {
  getCanonicalRedirectTarget,
  getConfiguredBaseUrl,
  getSafeRedirectPath,
  isLocalHost,
  normalizeHost,
};
