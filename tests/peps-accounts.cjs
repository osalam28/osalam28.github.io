const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const users = new Map([
  [
    "one@example.test",
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "one@example.test",
      password: "",
    },
  ],
  [
    "two@example.test",
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "two@example.test",
      password: "",
    },
  ],
  [
    "legacy@example.test",
    {
      id: "33333333-3333-4333-8333-333333333333",
      email: "legacy@example.test",
      password: "",
    },
  ],
]);
const rows = new Map(),
  legacyRows = new Map(),
  requests = [],
  errors = [];
const tokenFor = (user) =>
  [
    "e30",
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
const safeUser = (user) => ({
  id: user.id,
  email: user.email,
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
});
const session = (user) => ({
  access_token: tokenFor(user),
  refresh_token: `refresh-${user.id}`,
  expires_in: 3600,
  token_type: "bearer",
  user: safeUser(user),
});
let recoverFailure = false;

async function mock(route) {
  const request = route.request(),
    url = new URL(request.url()),
    method = request.method();
  const body = request.postData() ? request.postDataJSON() : null;
  const bearer = request.headers().authorization?.split(" ")[1];
  let identity;
  try {
    identity = [...users.values()].find(
      (u) =>
        u.id === JSON.parse(Buffer.from(bearer.split(".")[1], "base64url")).sub,
    );
  } catch {}
  const reply = (json, status = 200) =>
    route.fulfill({
      status,
      json,
      headers: {
        "x-supabase-api-version": "2024-01-01",
        "access-control-expose-headers": "x-supabase-api-version",
      },
    });
  requests.push({ path: url.pathname, method });
  if (url.pathname === "/auth/v1/verify") {
    const user = users.get(
      body.token_hash === "invite-one" || body.token_hash === "recover-one" || body.token_hash === "email-one"
        ? "one@example.test"
        : body.token_hash === "invite-two"
          ? "two@example.test"
          : body.token_hash === "invite-legacy"
            ? "legacy@example.test"
            : "invalid",
    );
    return user
      ? reply(session(user))
      : reply({ code: "otp_expired", msg: "Expired" }, 403);
  }
  if (url.pathname === "/auth/v1/token") {
    const user = users.get(body.email);
    return user && user.password === body.password
      ? reply(session(user))
      : reply({ code: "invalid_credentials", msg: "Invalid credentials" }, 400);
  }
  if (url.pathname === "/auth/v1/user") {
    if (!identity) return reply({ code: "bad_jwt", msg: "Invalid token" }, 401);
    if (method === "PUT") {
      if (identity.password === body.password)
        return reply({ code: "same_password", msg: "Same password" }, 422);
      identity.password = body.password;
    }
    return reply(safeUser(identity));
  }
  if (url.pathname === "/auth/v1/logout" || url.pathname === "/auth/v1/recover")
    return reply({});
  if (!identity) return reply({ message: "Unauthorized" }, 401);
  if (url.pathname === "/rest/v1/rpc/peps_read_legacy_vault")
    return reply(legacyRows.get(identity.id) || null);
  if (url.pathname !== "/rest/v1/peps_private_vaults")
    throw new Error(`Unexpected API ${url.pathname}`);
  const selected = url.searchParams.get("user_id")?.replace(/^eq\./, "");
  let row = rows.get(identity.id);
  if (method === "POST") {
    assert.equal(body.user_id, identity.id);
    if (row) return reply({ code: "23505", message: "duplicate" }, 409);
    row = { ...body, revision: 1, updated_at: new Date().toISOString() };
    rows.set(identity.id, row);
  } else if (method === "PATCH") {
    if (body.password_wrap && recoverFailure) {
      recoverFailure = false;
      return reply({ message: "Test network failure" }, 503);
    }
    if (
      selected !== identity.id ||
      Number(url.searchParams.get("revision")?.replace(/^eq\./, "")) !==
        row?.revision
    )
      return reply(null);
    row = {
      ...row,
      ...body,
      revision: row.revision + 1,
      updated_at: new Date().toISOString(),
    };
    rows.set(identity.id, row);
  } else if (selected !== identity.id) row = undefined;
  return reply(
    request.headers().accept?.includes("object+json")
      ? row || null
      : row
        ? [row]
        : [],
  );
}
async function signIn(page, email, password) {
  const field = page.locator("#accountEmail");
  if (await field.isEditable()) await field.fill(email);
  else assert.equal(await field.inputValue(), email);
  await page.locator("#accountPassword").fill(password);
  await page.locator("#accountSubmit").click();
}
async function signOut(page) {
  await page.locator('.app-nav [data-nav="settings"]').click();
  await page.locator('[data-settings-tab="preferences"]').click();
  await page.locator("#lockBtn").click();
  await page.locator("#accountPassword").waitFor({ state: "visible" });
}
async function create(page, base, hash, email, name, password, legacyPassword, type = "invite") {
  const verificationCount = requests.filter(
    (r) => r.path === "/auth/v1/verify",
  ).length;
  await page.goto(`${base}/peps/?auth=20261017-accounts-v3#token_hash=${hash}&type=${type}`);
  await page.waitForFunction(() => !location.hash);
  assert.equal(new URL(page.url()).hash, "", "Secret removed from URL");
  assert.equal(new URL(page.url()).search, "?auth=20261017-accounts-v3", "Versioned entry URL retained");
  assert.equal(
    requests.filter((r) => r.path === "/auth/v1/verify").length,
    verificationCount,
    "No auto-consumption by link scanning",
  );
  await page.locator("#accountSubmit").click();
  await page.locator("#newRecoveryKey").waitFor();
  assert.equal(await page.locator("#accountEmail").inputValue(), email);
  const recovery = await page.locator("#newRecoveryKey").textContent();
  assert.equal(await page.locator("#accountPassword").getAttribute("minlength"), "6");
  assert.equal(await page.evaluate(async () => {
    try {
      await PepsAccounts.open("", "short", { mode: "setup" });
    } catch (error) {
      return error.code;
    }
  }), "weak_password", "Setup rejects fewer than six characters before saving");
  await page.locator("#accountName").fill(name);
  await page.locator("#accountPassword").fill(password);
  assert.equal(
    await page
      .locator('#accountForm input[autocomplete="new-password"]')
      .count(),
    1,
  );
  assert.equal(
    await page.locator('#accountForm input[type="password"]').count(),
    legacyPassword ? 2 : 1,
  );
  await page.locator("#toggleAccountPassword").click();
  assert.equal(
    await page.locator("#accountPassword").getAttribute("type"),
    "text",
  );
  await page.locator("#toggleAccountPassword").click();
  await page.screenshot({
    path: `/tmp/peps-account-setup-${hash}.png`,
    fullPage: true,
  });
  await page.locator("#savedRecoveryKey").check();
  if (legacyPassword) {
    await page.locator("#legacyPasswordInput").fill("wrong-legacy-password");
    await page.locator("#accountSubmit").click();
    await page
      .getByText(
        "The previous profile password could not unlock your history.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      rows.has(users.get(email).id),
      false,
      "Failed transfer never creates an empty replacement",
    );
    await page.locator("#legacyPasswordInput").fill(legacyPassword);
  }
  await page.locator("#accountSubmit").click();
  await page.locator("#authScreen").waitFor({ state: "hidden" });
  return recovery;
}
(async () => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      "." + (name.endsWith("/") ? name + "index.html" : name),
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      let content = fs.readFileSync(file);
      if (file.endsWith("/account-config.js"))
        content = content.toString().replace("enabled: false", "enabled: true");
      res.setHeader(
        "Content-Type",
        { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[
          path.extname(file)
        ] || "text/plain",
      );
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://*.supabase.co/**", mock);
    const recovery = await create(
      page,
      base,
      "invite-one",
      "one@example.test",
      "Private Test Name",
      "long-test-password-one",
    );
    assert.equal(await page.evaluate(() => PepsCore.state.stack.length), 0);
    await page.evaluate(async () => {
      PepsCore.saveCheckin({ weight: 201.8, notes: "private-test-note" });
      PepsCore.savePeptide({ id: 'private-goal-test', name: 'private-goal-peptide', doseAmount: 1, doseUnit: 'mg',
        startDate: PepsCore.helpers.todayString(), frequency: 'daily', times: ['AM'],
        dosePlans: [{ effectiveDate: PepsCore.helpers.todayString(), startDate: PepsCore.helpers.todayString(), unit: 'mg', repeat: 'restart', stages: [{day:1, amount:1}, {day:8, amount:1.5}] }],
        goalReview: { enabled: true, reviewedGoal: 205, reviewedAt: PepsCore.helpers.todayString(), decision: 'keep' } });
      PepsCore.state.goals = { weightGoal: 205 };
      PepsCore.commit();
      await PepsCore.flush();
    });
    assert.ok(
      !JSON.stringify([...rows.values()]).includes("private-test-note"),
    );
    assert.ok(
      !JSON.stringify([...rows.values()]).includes("Private Test Name"),
    );
    assert.ok(!JSON.stringify([...rows.values()]).includes("201.8"));
    assert.ok(!JSON.stringify([...rows.values()]).includes("private-goal-peptide"));
    assert.ok(!JSON.stringify([...rows.values()]).includes("reviewedGoal"));
    assert.ok(!JSON.stringify([...rows.values()]).includes("dosePlans"));
    const local = await page.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!local.includes("private-test-note"));
    assert.ok(!local.includes(recovery));
    await signOut(page);
    assert.equal(
      await page.evaluate(() => Object.keys(PepsCore.state.checkins).length),
      0,
    );
    await page.goto(`${base}/peps/?auth=20261017-accounts-v3#token_hash=email-one&type=email`);
    await page.getByRole("heading", { name: "Continue to Peps" }).waitFor();
    await page.locator("#accountSubmit").click();
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    assert.equal(await page.locator("#recoveryKeyInput").count(), 0);
    assert.equal(await page.locator("#newRecoveryKey").count(), 0);
    assert.equal(await page.evaluate(() => PepsCore.account), null, "Email link alone cannot unlock existing encrypted history");
    await signIn(page, "one@example.test", "wrong-test-password");
    await page
      .getByText("Email or password is incorrect.", { exact: true })
      .waitFor();
    await signIn(page, "one@example.test", "long-test-password-one");
    await page.locator("#authScreen").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => Object.values(PepsCore.state.checkins)[0].weight,
      ),
      201.8,
    );
    assert.equal(await page.evaluate(() => PepsCore.findPeptide('private-goal-test').goalReview.reviewedGoal), 205);
    assert.equal(await page.evaluate(() => PepsCore.findPeptide('private-goal-test').dosePlans[0].stages[1].amount), 1.5);
    assert.equal(await page.evaluate(() => PepsProtocol.goalInfo().reviewDue), false);
    await signOut(page);
    await create(
      page,
      base,
      "invite-two",
      "two@example.test",
      "Second Name",
      "test-2",
    );
    assert.equal(
      await page.evaluate(() => Object.keys(PepsCore.state.checkins).length),
      0,
    );
    await signOut(page);

    await signIn(page, "two@example.test", "test-2");
    await page.locator("#authScreen").waitFor({ state: "hidden" });
    await signOut(page);

    await page.goto(`${base}/peps/#token_hash=recover-one&type=recovery`);
    await page.locator("#accountSubmit").click();
    await page.locator("#recoveryKeyInput").waitFor();
    assert.equal(await page.locator("#accountPassword").getAttribute("minlength"), "6");
    await page.locator("#accountPassword").fill("reset1");
    await page.locator("#recoveryKeyInput").fill("0".repeat(64));
    await page.locator("#accountSubmit").click();
    await page
      .getByText("That recovery key could not unlock this account.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      users.get("one@example.test").password,
      "long-test-password-one",
      "Wrong recovery key does not change login password",
    );
    await page.locator("#recoveryKeyInput").fill(recovery);
    assert.equal(await page.evaluate(async (recoveryKey) => {
      try {
        await PepsAccounts.open("", "short", { mode: "recover", recovery: recoveryKey });
      } catch (error) {
        return error.code;
      }
    }, recovery), "weak_password", "Recovery rejects fewer than six characters before changing Auth");
    assert.equal(users.get("one@example.test").password, "long-test-password-one");
    recoverFailure = true;
    await page.locator("#accountSubmit").click();
    await page
      .getByText(/Your password changed, but recovery could not finish/)
      .waitFor();
    assert.equal(
      users.get("one@example.test").password,
      "reset1",
    );
    await page.locator("#accountSubmit").click();
    await page.locator("#authScreen").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => Object.values(PepsCore.state.checkins)[0].weight,
      ),
      201.8,
    );
    await signOut(page);
    await signIn(page, "one@example.test", "reset1");
    await page.locator("#authScreen").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => Object.values(PepsCore.state.checkins)[0].notes,
      ),
      "private-test-note",
    );
    const userId = users.get("one@example.test").id;
    rows.set(userId, {
      ...rows.get(userId),
      revision: rows.get(userId).revision + 1,
    });
    const conflict = await page.evaluate(async () => {
      PepsCore.saveCheckin({ weight: 200.9 });
      try {
        await PepsCore.flush();
      } catch (error) {
        return error.code;
      }
    });
    assert.equal(conflict, "conflict");
    await page.close();

    const fresh = await browser.newPage();
    await fresh.route("https://*.supabase.co/**", mock);
    for (const width of [320, 390, 1440]) {
      await fresh.setViewportSize({ width, height: 844 });
      await fresh.goto(`${base}/peps/`);
      await fresh.locator("#accountEmail").waitFor();
      assert.ok(
        await fresh.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await fresh.screenshot({
        path: `/tmp/peps-account-signin-${width}.png`,
        fullPage: true,
      });
    }
    const legacy = await fresh.evaluate(async () => {
      const state = PepsCore.starterState("legacy-test");
      state.profileName = "Legacy Test";
      state.checkins = {
        "2026-01-01": { weight: 230 },
        "2026-10-17": { weight: 201 },
      };
      state.completedDoses = { "2026-10-17": { "test-am": { done: true } } };
      state.stack = [
        {
          id: "test",
          name: "Cycle Test",
          powderMg: 10,
          bacMl: 2,
          doseAmount: 1,
          doseUnit: "mg",
          startDate: "2026-10-01",
          times: ["AM"],
          frequency: "daily",
          duration: {
            mode: "cycle",
            onDays: 56,
            offDays: 21,
            restart: "auto",
            starts: [],
          },
        },
      ];
      const salt = PepsCrypto.b64(crypto.getRandomValues(new Uint8Array(16)));
      return {
        salt,
        ...(await PepsCrypto.encrypt(
          await PepsCrypto.keyFrom("old-test-password", salt),
          state,
        )),
      };
    });
    legacyRows.set(users.get("legacy@example.test").id, legacy);
    await create(
      fresh,
      base,
      "invite-legacy",
      "legacy@example.test",
      "Legacy Test",
      "new-legacy-test-password",
      "old-test-password",
      "email",
    );
    const migrated = await fresh.evaluate(() => PepsCore.state);
    assert.equal(migrated.checkins["2026-01-01"].weight, 230);
    assert.equal(migrated.stack[0].duration.onDays, 56);
    assert.equal(migrated.completedDoses["2026-10-17"]["test-am"].done, true);
    assert.deepEqual(
      legacyRows.get(users.get("legacy@example.test").id),
      legacy,
    );
    await signOut(fresh);
    await fresh.locator('[data-account-mode="reset"]').click();
    await fresh.locator("#accountEmail").fill("unknown@example.test");
    await fresh.locator("#accountSubmit").click();
    await fresh.getByText(/If this email has an account/).waitFor();
    await fresh.goto(`${base}/peps/#token_hash=expired&type=invite`);
    await fresh.locator("#accountSubmit").click();
    await fresh.getByText(/This link has expired/).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: invitations, encrypted persistence, isolated accounts, recovery failure/retry, conflict protection, legacy migration, expired links, and mobile layouts",
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
