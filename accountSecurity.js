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

  function escapeHtml(value = "") {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderResetPasswordScreen({
    appEl,
    productName = "praxis",
    auth,
    onBeforeRender,
    onCancel,
    onSuccess,
  } = {}) {
    if (!appEl || !auth?.updatePassword) return;
    if (typeof onBeforeRender === "function") onBeforeRender();
    document.title = `${productName} · Reset password`;
    appEl.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;padding:20px;">
        <div style="width:100%;max-width:400px;background:rgba(255,255,255,0.92);border:1px solid rgba(217,227,240,0.92);border-radius:20px;padding:32px;box-shadow:0 18px 42px rgba(21,39,74,0.10);backdrop-filter:blur(16px);">
          <h1 style="margin:0 0 8px;font-family:'Manrope','Avenir Next','Segoe UI',sans-serif;font-size:1.35rem;letter-spacing:-0.03em;">Reset your password</h1>
          <p class="subtle" style="margin:0 0 16px;">Choose a new password for your ${escapeHtml(productName)} account.</p>
          <div class="field-stack">
            <div class="field">
              <label for="reset-password-input">New password</label>
              <input id="reset-password-input" type="password" placeholder="8+ characters, 1 number" autocomplete="new-password" />
            </div>
            <div class="field">
              <label for="reset-password-confirm">Confirm password</label>
              <input id="reset-password-confirm" type="password" placeholder="Repeat your new password" autocomplete="new-password" />
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
      if (typeof onCancel === "function") {
        onCancel();
      } else {
        window.location.href = "/";
      }
    });
    appEl.querySelector("[data-reset-action='save']")?.addEventListener("click", async () => {
      const password = document.getElementById("reset-password-input")?.value || "";
      const confirm = document.getElementById("reset-password-confirm")?.value || "";
      const errEl = document.getElementById("reset-password-error");
      if (errEl) errEl.style.display = "none";
      const validation = validatePasswordPair(password, confirm);
      if (!validation.ok) {
        if (errEl) {
          errEl.textContent = validation.message;
          errEl.style.display = "block";
          errEl.style.color = "var(--danger)";
        }
        return;
      }
      try {
        await auth.updatePassword(password);
        if (errEl) {
          errEl.textContent = "Password updated. You can sign in now.";
          errEl.style.display = "block";
          errEl.style.color = "var(--sage)";
        }
        setTimeout(() => {
          if (typeof onSuccess === "function") onSuccess();
        }, 800);
      } catch (error) {
        if (errEl) {
          errEl.textContent = error.message;
          errEl.style.display = "block";
          errEl.style.color = "var(--danger)";
        }
      }
    });
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
    renderResetPasswordScreen,
  };
})();
