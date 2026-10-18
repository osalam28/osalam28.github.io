(function () {
  "use strict";
  if (!window.PepsAccounts?.enabled) return;
  const accounts = window.PepsAccounts;
  const byId = (id) => document.getElementById(id);
  let mode = "signin",
    busy = false,
    recovery = "",
    token = "",
    linkType = "";
  let hasLegacy = false;
  let pendingEmail = "",
    resendTimer;
  const sentAt = new Map();
  function updateResend() {
    if (mode !== "sent") return;
    const remaining = Math.max(
      0,
      Math.ceil(((sentAt.get(pendingEmail.toLowerCase()) || 0) + 60000 - Date.now()) / 1000),
    );
    const button = byId("accountSubmit");
    button.disabled = busy || remaining > 0;
    button.textContent = remaining ? `Resend in ${remaining}s` : "Resend email";
  }
  function readLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("token_hash")) {
      token = params.get("token_hash");
      linkType = params.get("type");
      mode = ["invite", "recovery", "email"].includes(linkType) ? "link" : "invalid";
    } else if (params.has("error") || params.has("access_token")) {
      mode = "invalid";
    } else return false;
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  readLink();
  function status(message, error = false) {
    const element = byId("accountStatus");
    element.textContent = message;
    element.classList.toggle("form-error", error);
  }
  function screen() {
    clearInterval(resendTimer);
    const link = mode === "link",
      reset = mode === "reset",
      setup = mode === "setup";
    const signup = mode === "signup",
      sent = mode === "sent";
    const recover = mode === "recover",
      invalid = mode === "invalid";
    const password = !link && !reset && !invalid && !signup && !sent;
    const title = {
      signin: "Welcome back",
      signup: "Join Peps",
      sent: "Check your email",
      setup: "Create your account",
      recover: "Recover your account",
      reset: "Forgot your password?",
      invalid: "This link is unavailable",
      link: linkType === "invite" ? "Your invitation is ready"
        : linkType === "email" ? "Continue to Peps" : "Reset your password",
    }[mode];
    const action = {
      signin: "Sign in",
      signup: "Send verification email",
      sent: "Resend email",
      link: "Continue",
      setup: "Create account",
      recover: "Save new password",
      reset: "Send reset email",
    }[mode];
    byId("authScreen").innerHTML = `
      <form class="auth-card account-card" id="accountForm">
        <a class="account-brand" href="./" aria-label="Peps home">peps.</a>
        <h1 id="accountTitle" tabindex="-1">${title}</h1>
        ${invalid ? "<p>This link has expired, has already been used, or is invalid. Request a fresh email to continue.</p>" : ""}
        ${link ? "<p>Continue to verify your email address.</p>" : ""}
        ${signup ? '<p>Verify your email, then set up your private account.</p>' : ""}
        ${sent ? '<p>We sent a verification link to <strong id="pendingEmail"></strong>.</p><p>Check your inbox and spam folder. Use the newest email to continue. If the link expires, request another here.</p>' : ""}
        ${!link && !invalid && !sent ? '<label><span>Email</span><input id="accountEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required /></label>' : ""}
        ${setup ? '<label><span>First name</span><input id="accountName" autocomplete="given-name" maxlength="80" required /></label>' : ""}
        ${password ? `<label><span>${setup || recover ? "New password" : "Password"}</span><div class="account-password"><input id="accountPassword" type="password" autocomplete="${setup || recover ? "new-password" : "current-password"}" ${setup || recover ? 'minlength="6" aria-describedby="passwordHint"' : ""} required /><button type="button" class="icon-button" id="toggleAccountPassword" aria-label="Show password" title="Show password"><i data-lucide="eye"></i></button></div></label>${setup || recover ? '<p class="auth-note" id="passwordHint">At least 6 characters.</p>' : ""}` : ""}
        ${setup ? '<section class="recovery-key"><h2>Your recovery key</h2><p>Keep this in a password manager or another safe place. Without your password or this key, your history cannot be recovered.</p><code id="newRecoveryKey"></code><button type="button" id="downloadRecoveryKey" class="secondary-button"><i data-lucide="download"></i> Download key</button><label class="recovery-ack"><input id="savedRecoveryKey" type="checkbox" required /><span>I have saved my recovery key.</span></label></section>' : ""}
        ${recover ? '<label><span>Recovery key</span><textarea id="recoveryKeyInput" rows="3" autocomplete="off" autocapitalize="none" spellcheck="false" required></textarea></label><p class="auth-note">Your key unlocks your encrypted history. Peps cannot recover it for you.</p>' : ""}
        ${setup && hasLegacy ? '<label><span>Previous profile password</span><input id="legacyPasswordInput" type="password" autocomplete="off" required /></label><p class="auth-note">A one-time transfer of your existing history. The original encrypted copy will be kept.</p>' : ""}
        ${!invalid ? `<button class="primary-button" id="accountSubmit" type="submit">${action}</button>` : ""}
        <p id="accountStatus" role="status" aria-live="polite"></p>
        ${mode === "signin" ? '<button type="button" class="account-text-button" data-account-mode="reset">Forgot password?</button><div class="account-new"><span>New to Peps?</span><button type="button" class="secondary-button" data-account-mode="signup"><i data-lucide="user-plus" aria-hidden="true"></i> Create account</button></div>' : `${invalid ? `<button type="button" class="secondary-button" data-account-mode="${linkType === "recovery" ? "reset" : "signup"}">Request a new link</button>` : ""}${sent ? '<button type="button" class="account-text-button" data-account-mode="signup">Use a different email</button>' : ""}<button type="button" class="account-text-button" data-account-mode="signin">Back to sign in</button>`}
      </form>`;
    if (setup) byId("newRecoveryKey").textContent = recovery;
    if (signup) byId("accountEmail").value = pendingEmail;
    if (sent) {
      byId("pendingEmail").textContent = pendingEmail;
      updateResend();
      resendTimer = setInterval(updateResend, 1000);
    }
    window.lucide?.createIcons();
  }
  async function prepare() {
    const info = await accounts.describe();
    hasLegacy = info.hasLegacy;
    mode = info.hasVault ? (linkType === "email" ? "signin" : "recover") : "setup";
    if (!info.hasVault) recovery ||= window.PepsVault.recoverySecret();
    screen();
    byId("accountEmail").value = info.email;
    byId("accountEmail").readOnly = true;
    byId("accountTitle").focus();
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = byId("accountSubmit");
    button.disabled = true;
    byId("accountForm").setAttribute("aria-busy", "true");
    status("Working...");
    try {
      if (mode === "link") {
        await accounts.verify(token, linkType);
        token = "";
        await prepare();
      } else if (mode === "signup" || mode === "sent") {
        const email = mode === "signup" ? byId("accountEmail").value.trim() : pendingEmail;
        if (Date.now() - (sentAt.get(email.toLowerCase()) || 0) < 60000) {
          status("Please wait a minute before requesting another email.", true);
        } else {
          await accounts.register(email);
          pendingEmail = email;
          sentAt.set(email.toLowerCase(), Date.now());
          mode = "sent";
          screen();
          byId("accountTitle").focus();
        }
      } else if (mode === "reset") {
        await accounts.reset(byId("accountEmail").value);
        status(
          "If this email has an account, a password-reset email is on its way. Check your inbox and spam folder.",
        );
      } else {
        await window.PepsCore.unlock(
          byId("accountEmail").value,
          byId("accountPassword").value,
          {
            mode,
            name: byId("accountName")?.value,
            recovery:
              mode === "recover" ? byId("recoveryKeyInput").value : recovery,
            savedRecovery: !!byId("savedRecoveryKey")?.checked,
            legacyPassword: byId("legacyPasswordInput")?.value,
          },
        );
        recovery = "";
        byId("accountForm").reset();
        byId("authScreen").hidden = true;
        document.body.classList.remove("locked");
        window.PepsApp.navigate("dashboard");
        window.PepsRender();
        status("");
      }
    } catch (error) {
      if (error.code === "setup_required") {
        try {
          await prepare();
        } catch {
          status("Account setup is unavailable. Please try again.", true);
        }
      } else {
        const messages = {
          invalid_credentials: "Email or password is incorrect.",
          email_not_confirmed: "Verify your email address before signing in.",
          otp_expired: "This link has expired or has already been used. Request a new one.",
          signup_disabled: "New accounts are temporarily unavailable. Please try again later.",
          otp_disabled: "New accounts are temporarily unavailable. Please try again later.",
          over_email_send_rate_limit:
            "Please wait before requesting another email.",
          over_request_rate_limit:
            "Too many attempts. Please wait and try again.",
          weak_password: "Use at least 6 characters.",
          same_password: "Choose a different password.",
        };
        const localCodes = [
          "vault_locked",
          "conflict",
          "legacy_password_required",
          "recovery_required",
          "session_expired",
          "recovery_save_failed",
        ];
        if (mode === "link" && error.code === "otp_expired") {
          token = "";
          mode = "invalid";
          screen();
          byId("accountTitle").focus();
        }
        status(
          messages[error.code] ||
            (localCodes.includes(error.code)
              ? error.message
              : "Unable to complete this request. Your history has not been replaced. Please try again."),
          true,
        );
      }
    } finally {
      busy = false;
      const current = byId("accountSubmit");
      if (current) current.disabled = false;
      updateResend();
      byId("accountForm")?.removeAttribute("aria-busy");
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    screen();
    byId("authScreen").addEventListener("submit", submit);
    byId("authScreen").addEventListener("click", async (event) => {
      if (busy) return;
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.accountMode) {
        recovery = "";
        mode = target.dataset.accountMode;
        screen();
        byId("accountTitle").focus();
      } else if (target.id === "toggleAccountPassword") {
        const input = byId("accountPassword"),
          visible = input.type === "password";
        input.type = visible ? "text" : "password";
        target.setAttribute(
          "aria-label",
          visible ? "Hide password" : "Show password",
        );
        target.title = visible ? "Hide password" : "Show password";
        target.innerHTML = `<i data-lucide="${visible ? "eye-off" : "eye"}"></i>`;
        window.lucide?.createIcons();
      } else if (target.id === "downloadRecoveryKey") {
        const file = new Blob(
          [
            `Peps recovery key\n\n${recovery}\n\nKeep this key private. It is required to recover encrypted history after a password reset.\n`,
          ],
          { type: "text/plain" },
        );
        const url = URL.createObjectURL(file),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "peps-recovery-key.txt";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    accounts.onSignOut(() => {
      window.PepsExperience.closeEditor();
      window.PepsCore.lock();
      document.body.classList.add("locked");
      byId("authScreen").hidden = false;
      mode = "signin";
      recovery = "";
      screen();
    });
    byId("lockBtn").title = "Sign out";
  });
  window.addEventListener("hashchange", async () => {
    if (busy) {
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    if (!readLink()) return;
    try {
      if (window.PepsCore.account) {
        await window.PepsCore.flush();
        window.PepsCore.lock();
        window.PepsExperience.closeEditor();
      }
      recovery = "";
      document.body.classList.add("locked");
      byId("authScreen").hidden = false;
      screen();
    } catch {
      token = "";
      window.PepsApp.toast(
        "Save or export your changes before opening an account link.",
      );
    }
  });
})();
