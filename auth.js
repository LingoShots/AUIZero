// auth.js — loaded before app.js
const Auth = (() => {
  let session = null;
  let profile = null;

  function getSession() { return session; }
  function getProfile() { return profile; }
  function getToken() { return session?.access_token || null; }

  function authHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function apiFetch(path, options = {}) {
    let res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    if (res.status === 401) {
      const restored = await restoreSession();
      if (restored && getToken()) {
        res = await fetch(path, {
          ...options,
          headers: { ...authHeaders(), ...(options.headers || {}) }
        });
      }
    }
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text || `Request failed (${res.status})` };
    }
  }

  async function signIn(email, password, stayLoggedIn = true) {
    const data = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    session = data.session;
    profile = data.profile;
    if (stayLoggedIn) {
      localStorage.setItem('auizero_session', JSON.stringify(session));
      sessionStorage.removeItem('auizero_session');
    } else {
      sessionStorage.setItem('auizero_session', JSON.stringify(session));
      localStorage.removeItem('auizero_session');
    }
   return profile;
  }
  async function signUp(email, password, name, role) {
    const data = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role })
    }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    // Auto sign in after signup
    return signIn(email, password);
  }

  async function signOut() {
    await fetch('/api/auth/signout', {
      method: 'POST',
      headers: authHeaders()
    });
    session = null;
    profile = null;
    localStorage.removeItem('auizero_session');
    sessionStorage.removeItem('auizero_session');
  }

  async function restoreSession() {
    const stored = localStorage.getItem('auizero_session') || sessionStorage.getItem('auizero_session');
    if (!stored) return null;
    try {
      session = JSON.parse(stored);
      let data = await fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.json());
      if (data.error && session?.refresh_token) {
        // Access token expired — try refreshing with the refresh token
        const refreshData = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        }).then(r => r.json());
        if (refreshData.session) {
          session = refreshData.session;
          const storage = localStorage.getItem('auizero_session') ? localStorage : sessionStorage;
          storage.setItem('auizero_session', JSON.stringify(session));
          data = await fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.json());
        }
      }
      if (data.error) {
        session = null;
        profile = null;
        localStorage.removeItem('auizero_session');
        sessionStorage.removeItem('auizero_session');
        return null;
      }
      profile = data.profile;
      return profile;
    } catch {
      session = null;
      profile = null;
      localStorage.removeItem('auizero_session');
      sessionStorage.removeItem('auizero_session');
      return null;
    }
  }

async function getInviteInfo(classId) {
    try {
      const res = await fetch(`/api/classes/${classId}/invite`);
      return await res.json();
    } catch { return null; }
  }

  async function joinClassIfInvited() {
    const params = new URLSearchParams(window.location.search);
    const classId = params.get('join');
    // Clear the URL param immediately regardless
    if (classId) window.history.replaceState({}, '', window.location.pathname);
    if (!classId) return;
    if (!session) return;
    try {
      const res = await fetch(`/api/classes/${classId}/join`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) console.warn('Could not join class:', res.status);
    } catch(e) {
      console.warn('Join class error:', e.message);
    }
  }

  async function requestPasswordReset(email) {
    const redirectTo = `${window.location.origin}/?reset=1`;
    const data = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo })
    }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    return true;
  }

  async function consumeRecoverySessionFromUrl() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const type = hash.get('type');
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (type !== 'recovery' || !accessToken) return false;
    session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: hash.get('token_type') || 'bearer',
    };
    window.history.replaceState({}, '', `${window.location.pathname}?reset=1`);
    return true;
  }

  async function updatePassword(password) {
    const data = await fetch('/api/auth/update-password', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ password })
    }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    return true;
  }

  return { getSession, getProfile, getToken, authHeaders, apiFetch, signIn, signUp, signOut, restoreSession, joinClassIfInvited, getInviteInfo, requestPasswordReset, consumeRecoverySessionFromUrl, updatePassword };
})();
