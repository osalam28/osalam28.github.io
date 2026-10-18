const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const three = "33333333-3333-4333-8333-333333333333";
const four = "44444444-4444-4444-8444-444444444444";

(async () => {
  const db = new PGlite();
  const as = async (role, id, query) => {
    await db.exec(
      `begin; set local role ${role}; set local request.jwt.claim.sub = '${id}';`,
    );
    try {
      return await db.query(query);
    } finally {
      await db.exec("rollback;");
    }
  };
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      insert into auth.users values ('${one}', 'one@example.test', now()), ('${two}', 'two@example.test', now()),
        ('${three}', 'reserved@example.test', null), ('${four}', 'replacement@example.test', now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create table public.peptide_calendar_sync(id text primary key, salt text, iv text, ciphertext text);
      insert into public.peptide_calendar_sync values ('legacy-one', 'salt', 'iv', 'encrypted-legacy');
      insert into public.peptide_calendar_sync values ('legacy-reserved', 'salt', 'iv', 'reserved-encrypted-history');
      grant select, insert, update on public.peptide_calendar_sync to anon;
    `);
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../supabase/migrations/20261017_private_accounts.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      `insert into public.peps_legacy_owners values ('${one}', 'legacy-one');`,
    );
    const insert = (id) =>
      `insert into public.peps_private_vaults (user_id, format, password_wrap, recovery_wrap, payload) values ('${id}',1,'{}','{}','{"ciphertext":"opaque"}')`;
    await db.exec(
      `begin; set local role authenticated; set local request.jwt.claim.sub = '${one}'; ${insert(one)}; commit;`,
    );
    await assert.rejects(
      as("anon", "", "select * from public.peps_private_vaults"),
      /permission denied/,
    );
    await assert.rejects(as("anon", "", insert(two)), /permission denied/);
    assert.equal(
      (
        await as(
          "authenticated",
          one,
          "select * from public.peps_private_vaults",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await as(
          "authenticated",
          two,
          "select * from public.peps_private_vaults",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      as("authenticated", two, insert(one)),
      /row-level security/,
    );
    assert.equal(
      (
        await as(
          "authenticated",
          two,
          `update public.peps_private_vaults set payload='{}' where user_id='${one}' returning user_id`,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      as(
        "authenticated",
        one,
        `update public.peps_private_vaults set user_id='${two}'`,
      ),
      /permission denied/,
    );
    await db.exec("insert into public.peps_legacy_reservations values ('reserved@example.test', 'legacy-reserved');");
    await assert.rejects(as("anon", "", "select * from public.peps_legacy_reservations"), /permission denied/);
    await assert.rejects(as("authenticated", three, "select * from public.peps_legacy_reservations"), /permission denied/);
    await assert.rejects(as("authenticated", two, "update public.peps_legacy_reservations set email='two@example.test'"), /permission denied/);
    assert.equal((await as("authenticated", three, "select public.peps_read_legacy_vault() as vault")).rows[0].vault, null, "Unverified email cannot claim a reservation");
    assert.equal((await as("authenticated", two, "select public.peps_read_legacy_vault() as vault")).rows[0].vault, null, "Different verified user cannot claim a reservation");
    assert.equal((await db.query("select count(*)::int as n from public.peps_legacy_reservations")).rows[0].n, 1);
    await db.exec(`update auth.users set email_confirmed_at=now() where id='${three}';`);
    await db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub='${three}'; select public.peps_read_legacy_vault(); commit;`);
    assert.equal((await db.query(`select legacy_id from public.peps_legacy_owners where user_id='${three}'`)).rows[0].legacy_id, 'legacy-reserved');
    assert.equal((await db.query("select count(*)::int as n from public.peps_legacy_reservations")).rows[0].n, 0);
    await db.exec(`update auth.users set email='changed@example.test' where id='${three}'; update auth.users set email='reserved@example.test' where id='${four}';`);
    assert.match(JSON.stringify((await as("authenticated", three, "select public.peps_read_legacy_vault()")).rows), /reserved-encrypted-history/, "Ownership remains pinned to UUID after email change");
    assert.equal((await as("authenticated", four, "select public.peps_read_legacy_vault() as vault")).rows[0].vault, null, "Reusing an email never grants the former owner's history");
    await assert.rejects(
      as("authenticated", one, "delete from public.peps_private_vaults"),
      /permission denied/,
    );
    assert.equal(
      (
        await as(
          "authenticated",
          one,
          `update public.peps_private_vaults set payload='{}' where revision=1 returning revision`,
        )
      ).rows[0].revision,
      2,
    );
    assert.equal(
      (
        await as(
          "authenticated",
          one,
          `update public.peps_private_vaults set payload='{}' where revision=99 returning user_id`,
        )
      ).rows.length,
      0,
    );
    assert.match(
      JSON.stringify(
        (
          await as(
            "authenticated",
            one,
            "select public.peps_read_legacy_vault()",
          )
        ).rows,
      ),
      /encrypted-legacy/,
    );
    assert.ok(
      !JSON.stringify(
        (
          await as(
            "authenticated",
            two,
            "select public.peps_read_legacy_vault()",
          )
        ).rows,
      ).includes("encrypted-legacy"),
    );
    await assert.rejects(
      as("anon", "", "select public.peps_read_legacy_vault()"),
      /permission denied/,
    );
    await assert.rejects(
      as(
        "authenticated",
        two,
        `insert into public.peps_legacy_owners values ('${two}','legacy-one')`,
      ),
      /permission denied/,
    );
    await db.exec(
      fs.readFileSync(
        path.join(__dirname, "../supabase/cutover-legacy-access.sql"),
        "utf8",
      ),
    );
    await assert.rejects(
      as("anon", "", "select * from public.peptide_calendar_sync"),
      /permission denied/,
    );
    await assert.rejects(
      as("authenticated", one, "select * from public.peptide_calendar_sync"),
      /permission denied/,
    );
    assert.match(
      JSON.stringify(
        (
          await as(
            "authenticated",
            one,
            "select public.peps_read_legacy_vault()",
          )
        ).rows,
      ),
      /encrypted-legacy/,
    );
    console.log(
      "PASS: PostgreSQL (PGlite) RLS blocks anonymous and cross-account access; owner-only legacy migration and cutover verified",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
