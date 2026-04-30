(function () {
  const PASSWORD_REQUIREMENT_TEXT = "Use at least 8 characters and at least 1 number. Symbols are allowed.";
  const PASSWORD_UPGRADE_DISMISS_PREFIX = "praxis-password-upgrade-dismissed-v1";

  function validatePassword(password) {
    const value = String(password || "");
    if (value.length < 8) {
      return { ok: false, message: "Password must be at least 8 characters." };
    }
    if (!/\d/.test(value)) {
      return { ok: false, message: "Password must include at least 1 number." };
    }
    return { ok: true, message: "" };
  }

  function validatePasswordPair(password, confirm) {
    const strength = validatePassword(password);
    if (!strength.ok) return strength;
    if (password !== confirm) {
      return { ok: false, message: "Passwords do not match." };
    }
    return { ok: true, message: "" };
  }

  function getDismissKey(profile) {
    return `${PASSWORD_UPGRADE_DISMISS_PREFIX}:${profile?.id || "anonymous"}`;
  }

  function shouldShowUpgradePrompt(profile) {
    if (!profile?.id) return false;
    try {
      return window.localStorage.getItem(getDismissKey(profile)) !== "1";
    } catch (_) {
      return false;
    }
  }

  function dismissUpgradePrompt(profile) {
    if (!profile?.id) return;
    try {
      window.localStorage.setItem(getDismissKey(profile), "1");
    } catch (_) {
      // Ignore localStorage failures; this is only a non-blocking reminder.
    }
  }

  function markPasswordUpdated(profile) {
    dismissUpgradePrompt(profile);
  }

  function renderUpgradeBanner(profile) {
    if (!shouldShowUpgradePrompt(profile)) return "";
    return `
      <div class="notice" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <span><strong>Account security:</strong> ${PASSWORD_REQUIREMENT_TEXT}</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button-secondary" data-action="account-security-change-password" style="min-height:34px;padding:0 14px;">Change password</button>
          <button class="button-ghost" data-action="account-security-dismiss" style="min-height:34px;padding:0 14px;">Not now</button>
        </span>
      </div>
    `;
  }

  function renderChangePasswordModal(show) {
    if (!show) return "";
    return `
      <div style="position:fixed;inset:0;background:rgba(10,18,33,0.38);z-index:1000;display:grid;place-items:center;padding:20px;">
        <div style="background:rgba(255,255,255,0.96);border:1px solid var(--line);border-radius:20px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(21,39,74,0.16);backdrop-filter:blur(16px);">
          <p class="mini-label" style="margin-bottom:6px;">Account security</p>
          <h3 style="margin:0 0 8px;">Change your password</h3>
          <p class="subtle" style="margin:0 0 16px;">${PASSWORD_REQUIREMENT_TEXT}</p>
          <div class="field-stack">
            <div class="field">
              <label for="account-password-input">New password</label>
              <input id="account-password-input" type="password" placeholder="8+ characters, 1 number" autocomplete="new-password" />
            </div>
            <div class="field">
              <label for="account-password-confirm">Confirm password</label>
              <input id="account-password-confirm" type="password" placeholder="Repeat your new password" autocomplete="new-password" />
            </div>
            <p id="account-password-error" style="display:none;margin:0;font-size:0.88rem;color:var(--danger);"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
              <button class="button-ghost" type="button" data-action="account-security-cancel">Cancel</button>
              <button class="button" type="button" data-action="account-security-save">Save password</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  window.AccountSecurity = {
    PASSWORD_REQUIREMENT_TEXT,
    validatePassword,
    validatePasswordPair,
    shouldShowUpgradePrompt,
    dismissUpgradePrompt,
    markPasswordUpdated,
    renderUpgradeBanner,
    renderChangePasswordModal,
  };
})();
