const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { webcrypto } = require("node:crypto");
const context = vm.createContext({
  window: {},
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
});
vm.runInContext(
  fs.readFileSync(
    require("node:path").join(__dirname, "../peps/vault.js"),
    "utf8",
  ),
  context,
);
const vault = context.window.PepsVault;

test("password and recovery key open the same encrypted history; wrong credentials cannot", async () => {
  const recovery = vault.recoverySecret();
  assert.match(recovery, /^[a-f0-9]{8}(-[a-f0-9]{8}){7}$/);
  const state = {
    profileName: "Test Name",
    checkins: { "2026-10-17": { weight: 201.8 } },
  };
  const created = await vault.create(
    "user-one",
    "test-only-long-password",
    recovery,
    state,
  );
  assert.ok(!JSON.stringify(created.row).includes("Test Name"));
  assert.ok(!JSON.stringify(created.row).includes("201.8"));
  assert.equal(
    await vault.unwrap(created.row, "test-only-long-password"),
    created.raw,
  );
  assert.equal(
    await vault.unwrap(created.row, recovery.toUpperCase(), true),
    created.raw,
  );
  await assert.rejects(vault.unwrap(created.row, "wrong-password"));
  await assert.rejects(vault.unwrap(created.row, vault.recoverySecret(), true));
  const recovered = await vault.dataKey(
    await vault.unwrap(created.row, recovery, true),
  );
  assert.equal(
    JSON.stringify(
      await vault.decrypt(recovered, created.row.payload, "user-one", "state"),
    ),
    JSON.stringify(state),
  );
  await assert.rejects(
    vault.decrypt(recovered, created.row.payload, "user-two", "state"),
  );
  await assert.rejects(
    vault.decrypt(recovered, created.row.payload, "user-one", "password"),
  );
  const rebound = { ...created.row, user_id: "user-two" };
  await assert.rejects(vault.unwrap(rebound, "test-only-long-password"));
  const rotated = {
    ...created.row,
    password_wrap: await vault.wrap(
      created.raw,
      "new-long-password",
      "user-one",
      "password",
    ),
  };
  assert.equal(await vault.unwrap(rotated, "new-long-password"), created.raw);
  assert.equal(await vault.unwrap(rotated, recovery, true), created.raw);
  await assert.rejects(vault.unwrap(rotated, "test-only-long-password"));
});
