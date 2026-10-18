(function () {
  "use strict";
  const config = window.PepsAccountConfig;
  if (!config?.enabled) return;
  const vault = window.PepsVault;
  const client = window.supabase.createClient(
    window.PepsConfig.url,
    window.PepsConfig.key,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "peps-auth-v1",
      },
    },
  );
  const table = "peps_private_vaults";
  const fault = (message, code) => Object.assign(new Error(message), { code });
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  async function user() {
    const data = check(await client.auth.getUser());
    if (!data.user) throw fault("Please sign in again.", "session_expired");
    return data.user;
  }
  async function read(id) {
    return check(
      await client.from(table).select("*").eq("user_id", id).maybeSingle(),
    );
  }
  async function legacy() {
    return check(await client.rpc("peps_read_legacy_vault"));
  }
  async function setPassword(identity, password) {
    const result = await client.auth.updateUser({ password });
    if (result.error?.code === "same_password") {
      // A previous attempt may have changed Auth but failed to save the key wrap.
      const confirmed = check(
        await client.auth.signInWithPassword({
          email: identity.email,
          password,
        }),
      );
      if (confirmed.user.id !== identity.id)
        throw fault("Please sign in again.", "session_expired");
    } else check(result);
  }
  async function describe() {
    const identity = await user();
    const row = await read(identity.id);
    return {
      hasVault: !!row,
      hasLegacy: !row && !!(await legacy()),
      email: identity.email,
    };
  }
  function storeFor(identity, initialRow, initialKey, initialState) {
    let row = initialRow,
      key = initialKey,
      closed = false;
    let saved = JSON.stringify(initialState),
      queue = Promise.resolve();
    function ensureOpen() {
      if (closed)
        throw fault("This session has been locked.", "session_expired");
    }
    async function persist(snapshot) {
      ensureOpen();
      const serialized = JSON.stringify(snapshot);
      if (serialized === saved) return;
      const payload = await vault.encrypt(key, snapshot, identity.id, "state");
      ensureOpen();
      const result = await client
        .from(table)
        .update({ payload })
        .eq("user_id", identity.id)
        .eq("revision", row.revision)
        .select("*")
        .maybeSingle();
      const updated = check(result);
      if (!updated)
        throw fault(
          "Another device updated your history. Export your unsynced changes before signing out and loading the latest version.",
          "conflict",
        );
      ensureOpen();
      row = updated;
      saved = serialized;
    }
    return {
      save(state) {
        const snapshot = JSON.parse(JSON.stringify(state));
        queue = queue.catch(() => {}).then(() => persist(snapshot));
        return queue;
      },
      async sync(state) {
        await queue;
        ensureOpen();
        if (JSON.stringify(state) !== saved) await this.save(state);
        const current = await read(identity.id);
        if (!current)
          throw fault(
            "Your encrypted history could not be found.",
            "vault_missing",
          );
        const data = await vault.decrypt(
          key,
          current.payload,
          identity.id,
          "state",
        );
        ensureOpen();
        row = current;
        saved = JSON.stringify(data);
        return data;
      },
      close() {
        closed = true;
        key = null;
        saved = "";
        row = null;
      },
    };
  }
  async function open(email, password, options = {}) {
    const mode = options.mode || "signin";
    if (mode === "signin") {
      check(
        await client.auth.signInWithPassword({ email: email.trim(), password }),
      );
    }
    const identity = await user();
    let row = await read(identity.id),
      key,
      state;
    if (row) {
      let raw;
      try {
        raw = await vault.unwrap(
          row,
          mode === "recover" ? options.recovery : password,
          mode === "recover",
        );
      } catch {
        throw fault(
          mode === "recover"
            ? "That recovery key could not unlock this account."
            : "Your login worked, but your history could not be unlocked. Use password recovery with your recovery key.",
          "vault_locked",
        );
      }
      key = await vault.dataKey(raw);
      state = await vault.decrypt(key, row.payload, identity.id, "state");
      if (mode === "recover") {
        if (password.length < 6)
          throw fault("Use at least 6 characters.", "weak_password");
        const password_wrap = await vault.wrap(
          raw,
          password,
          identity.id,
          "password",
        );
        // The recovery wrap stays intact if either network operation fails.
        await setPassword(identity, password);
        try {
          row = check(
            await client
              .from(table)
              .update({ password_wrap })
              .eq("user_id", identity.id)
              .eq("revision", row.revision)
              .select("*")
              .maybeSingle(),
          );
        } catch {
          throw fault(
            "Your password changed, but recovery could not finish. Your encrypted history is safe. Retry with the same recovery key and new password.",
            "recovery_save_failed",
          );
        }
        if (!row)
          throw fault(
            "Your password changed, but history changed on another device. Retry recovery with the same recovery key.",
            "conflict",
          );
      }
      raw = null;
    } else {
      if (mode === "signin")
        throw fault(
          "Finish setting up your encrypted account.",
          "setup_required",
        );
      if (password.length < 6)
        throw fault("Use at least 6 characters.", "weak_password");
      if (!options.savedRecovery)
        throw fault(
          "Keep your recovery key somewhere safe before continuing.",
          "recovery_required",
        );
      const previous = await legacy();
      state = window.PepsCore.starterState(identity.id);
      state.profileName =
        String(options.name || "You")
          .trim()
          .slice(0, 80) || "You";
      if (previous) {
        if (!options.legacyPassword)
          throw fault(
            "Enter your previous profile password to transfer your history.",
            "legacy_password_required",
          );
        try {
          const oldKey = await window.PepsCrypto.keyFrom(
            options.legacyPassword,
            previous.salt,
          );
          state = await window.PepsCrypto.decrypt(oldKey, previous);
          state.profileId = identity.id;
        } catch {
          throw fault(
            "The previous profile password could not unlock your history.",
            "legacy_password_required",
          );
        }
      }
      const prepared = await vault.create(
        identity.id,
        password,
        options.recovery,
        state,
      );
      await setPassword(identity, password);
      // Insert only: concurrent setup must never overwrite an existing vault.
      row = check(
        await client.from(table).insert(prepared.row).select("*").single(),
      );
      key = prepared.key;
      prepared.raw = null;
    }
    return {
      user: identity,
      state,
      created: false,
      store: storeFor(identity, row, key, state),
    };
  }
  window.PepsAccounts = {
    enabled: true,
    open,
    describe,
    async verify(tokenHash, type) {
      if (!["invite", "recovery"].includes(type))
        throw fault("This account link is not supported.", "invalid_link");
      check(await client.auth.verifyOtp({ token_hash: tokenHash, type }));
    },
    async reset(email) {
      check(
        await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: config.redirectUrl,
        }),
      );
    },
    async signOut() {
      check(await client.auth.signOut({ scope: "local" }));
    },
    onSignOut(callback) {
      client.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") callback();
      });
    },
  };
})();
