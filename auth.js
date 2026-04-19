// auth.js — loaded before app.js
const Auth = (() => {
  let session = null;
  let profile = null;

  function getSession() { return session; }
  function getProfile() { return profile; }
  function getToken() { return session?.access_token || null; }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    };
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    return res.json();
  }

  async function signIn(email, password) {
    const data = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    session = data.session;
    profile = data.profile;
    localStorage.setItem('auizero_session', JSON.stringify(session));
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
  }

  async function restoreSession() {
    const stored = localStorage.getItem('auizero_session');
    if (!stored) return null;
    try {
      session = JSON.parse(stored);
      const data = await fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.json());
      if (data.error) {
        session = null;
        localStorage.removeItem('auizero_session');
        return null;
      }
      profile = data.profile;
      return profile;
    } catch {
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
    if (!classId || !session) return;
    await fetch(`/api/classes/${classId}/join`, {
      method: 'POST',
      headers: authHeaders()
    });
    window.history.replaceState({}, '', window.location.pathname);
  }

  return { getSession, getProfile, getToken, authHeaders, apiFetch, signIn, signUp, signOut, restoreSession, joinClassIfInvited, getInviteInfo };
})();
