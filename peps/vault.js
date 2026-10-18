(function () {
  "use strict";
  const iterations = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const bytes = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const random = (length) => crypto.getRandomValues(new Uint8Array(length));
  const aad = (id, purpose) => encoder.encode(`peps-vault:v1:${id}:${purpose}`);

  async function passwordKey(secret, salt) {
    const source = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", iterations, salt: bytes(salt) },
      source,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async function encrypt(key, value, id, purpose) {
    const iv = random(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(id, purpose) },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    return { iv: b64(iv), ciphertext: b64(ciphertext) };
  }
  async function decrypt(key, envelope, id, purpose) {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(envelope.iv),
        additionalData: aad(id, purpose),
      },
      key,
      bytes(envelope.ciphertext),
    );
    return JSON.parse(decoder.decode(plaintext));
  }
  async function dataKey(raw) {
    return crypto.subtle.importKey("raw", bytes(raw), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  function recoverySecret() {
    return Array.from(random(32), (n) => n.toString(16).padStart(2, "0"))
      .join("")
      .match(/.{8}/g)
      .join("-");
  }
  function normalizeRecovery(value) {
    const normalized = value.toLowerCase().replace(/[\s-]/g, "");
    if (!/^[a-f0-9]{64}$/.test(normalized))
      throw new Error("Enter the full recovery key.");
    return normalized;
  }
  async function wrap(raw, secret, id, purpose) {
    const salt = b64(random(16));
    return {
      salt,
      ...(await encrypt(await passwordKey(secret, salt), raw, id, purpose)),
    };
  }
  async function unwrap(row, secret, recovery = false) {
    if (row.format !== 1)
      throw new Error("This vault needs a newer version of Peps.");
    const purpose = recovery ? "recovery" : "password";
    const envelope = recovery ? row.recovery_wrap : row.password_wrap;
    const key = await passwordKey(
      recovery ? normalizeRecovery(secret) : secret,
      envelope.salt,
    );
    return decrypt(key, envelope, row.user_id, purpose);
  }
  async function create(id, password, recovery, state) {
    const raw = b64(random(32));
    const key = await dataKey(raw);
    return {
      raw,
      key,
      row: {
        user_id: id,
        format: 1,
        password_wrap: await wrap(raw, password, id, "password"),
        recovery_wrap: await wrap(
          raw,
          normalizeRecovery(recovery),
          id,
          "recovery",
        ),
        payload: await encrypt(key, state, id, "state"),
      },
    };
  }
  window.PepsVault = {
    create,
    unwrap,
    dataKey,
    wrap,
    encrypt,
    decrypt,
    recoverySecret,
  };
})();
