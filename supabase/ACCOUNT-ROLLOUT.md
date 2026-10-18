# Peps Private Accounts

## Self-Service Signup (2026-10-18)

The new frontend adds Create account to the Peps sign-in page. It requests a
verification email using `signInWithOtp` with `shouldCreateUser: true`; no password,
recovery key, or health data is collected before email verification. The existing
`type=email` callback opens private-account setup for users without a vault and
password sign-in for existing vaults. Existing records are never replaced by signup.
After setup, new users reach the existing first-peptide flow including cycle setup.

Launch requires explicit owner approval to enable Allow new users to sign up in
Supabase. Keep Confirm email enabled, anonymous access disabled, and RLS unchanged.
Install `email/confirmation.html` with subject `Verify your email for Peps` before
opening signup; retain the custom magic-link template for returning users and
repeat email requests. Both templates must use fragment token hashes with type=email.
The owner approved public signup on 2026-10-18. The verification template is saved
and Allow new users to sign up is enabled in the live project. Confirm email remains
enabled; anonymous sign-ins remain disabled. Verify the deployed frontend before
announcing the release.

Email verification still expires under the shared Email OTP expiration setting
(3600 seconds at inspection). Users can request another email themselves; this is
not a non-expiring authentication link. The resend UI enforces a 60-second cooldown
in memory, with Supabase rate limits authoritative across reloads and devices.
The local auth tests cover new signup, resend/errors, existing-user protection,
cycle onboarding, expired-link renewal, recovery, and legacy transfer. They mock
email delivery; production inbox delivery still requires a user-controlled test.

## Initial Invitation Rollout

Status: invitation-only login launched on 2026-10-17 at `https://omarsalam.io/peps/`.
Frontend commit: `0b85799ea782a3dd8be9aee2675d271ba6ce1ec3`; Pages run
`39101310631` succeeded. Live account assets matched local source byte-for-byte.
The additive account schema and legacy-access cutover are installed. The original
encrypted profile remains intact. The owner's approved invitation was sent and
Supabase shows its invitation/confirmation-send timestamp; mailbox receipt and
user-controlled password setup/history transfer are still awaiting the owner.
Do not invite additional users until the real-email acceptance checks below pass.
No existing records are deleted or rewritten by the additive migration.

## User Flow

- Invitation-only: an administrator invites an email address through Supabase Auth.
- The email opens Peps; an explicit Continue action consumes its one-time token.
- For a verified user whose setup is incomplete, use the customized Magic Link
  email (subject `Your Peps account link`) instead of a password-reset email.
  The `type=email` callback resumes setup only when there is no vault. An existing
  vault still requires the account password; an email link cannot decrypt history.
- Invite, recovery, and account-link templates use the versioned entry query
  `?auth=20261017-accounts-v3` to avoid reusing a stale open or cached entry page.
- First visit: first name, one new-password field, and a generated recovery key to keep privately.
- Returning visit: email and one password. The Auth session can refresh, but the history key is memory-only; reopening the app requires the password again.
- Forgot password: email link, personal recovery key, and one new-password field.
- Missing both password and recovery key: history cannot be recovered. Do not add an admin bypass or silently replace the vault with an empty one.
- The normal first-peptide wizard remains responsible for schedule, cycle duration, vial setup, dose plan, and review.

## Encryption and Trust

Each account gets a random 256-bit AES-GCM data key. History and profile name are encrypted in the browser. The key is wrapped independently with the user's password and a random 256-bit recovery secret, using PBKDF2-SHA256 (600,000 iterations). Each encryption uses a fresh 96-bit nonce and binds its purpose and user UUID as authenticated data.

The database stores ciphertext and wrapped keys, never a recovery secret, raw data key, password, protocol, check-in, or profile name. Supabase Auth still knows email addresses and authentication metadata. No plaintext history cache is created by the new account path; Auth tokens are stored by the official SDK. JSON export is intentionally plaintext and must be kept private.

This protects stored history from a database reader, subject to password strength. It cannot protect against an operator deploying malicious JavaScript, compromised user devices, or stolen passwords/recovery keys. Do not market this as protection from all actions of the website owner or as an independently audited encryption system.

Authenticated RLS additionally restricts each user to their own UUID. A revision check prevents a stale device silently overwriting a newer save. On conflict, preserve/export unsynced state before signing out and reloading. Do not promise automatic merging or offline writes in this release.

## Sender and Email Delivery

The owner verified `auth.omarsalam.io` and saved custom Resend SMTP settings.
The saved sender display name is `Peptide Tracker`; the configured setup used
`noreply@auth.omarsalam.io`. Supabase accepted the owner's test invitation;
inbox receipt is not yet confirmed. Public signup and anonymous sign-in are
disabled, email confirmation remains enabled, and the minimum password length
was lowered from 12 to 6 characters at the owner's explicit request.
Supabase requires at least six characters. Short passwords weaken protection
against offline guessing of the encrypted history; encryption parameters are unchanged.
Invitation and recovery templates are saved with subjects `You're invited to Peps`
and `Reset your Peps password`. The Site URL and sole allowed redirect are saved
as exactly `https://omarsalam.io/peps/`.
An existing mailbox is not required. A sending provider such as Resend verifies domain ownership through DNS and sends mail using that domain. A send-only address does not receive replies.

1. Owner creates a Resend account and verifies the sending subdomain using the provider's exact DNS records. Do not replace existing website/email DNS records or create duplicate SPF policies. Leave tracking disabled for authentication emails.
2. In Supabase Authentication > Email > SMTP Settings, configure the approved sender and provider credentials. For Resend: host `smtp.resend.com`, port `465`, username `resend`, password the sending API key. Enter credentials directly in the provider/dashboard; never commit them or paste them into the frontend.
3. Install `email/invite.html`, `email/recovery.html`, and `email/magic-link.html` and their subjects from `email/subjects.json`. Sender, subjects, and body are configurable in Supabase. Do not include health information in emails.
4. Set Supabase Auth Site URL to exactly `https://omarsalam.io/peps/`, including the final slash. Add that exact redirect URL to the allowlist. Avoid wildcard production redirects.
5. The custom templates use a token hash in the fragment. The app removes it from the address bar and verifies it only after Continue. Default Supabase confirmation-link templates are not compatible with this callback implementation.
6. Disable public signup; keep email/password Auth and email confirmation enabled. Disable anonymous signup and unneeded identity providers. Keep the minimum password length aligned with the app at 6 characters (owner-approved policy). Retain rate limits; verify password-reset and invite expiry settings.

The built-in Supabase mailer is test-only and cannot invite arbitrary external recipients. SMTP configuration is a launch prerequisite, not an optional branding task.

References: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Resend setup](https://resend.com/docs/send-with-supabase-smtp).

## Existing Profiles and Cutover

1. Obtain the actual email addresses of existing users privately. The user must control the mailbox. Do not put their addresses, legacy passwords, or private exports in this public repository.
2. Back up existing encrypted rows and inspect the live schema/policies. The historical SQL in the workspace is not proof of the current production configuration.
3. Apply `migrations/20261017_private_accounts.sql` once. It creates separate vault, ownership, and email-reservation tables. This migration is already installed in the hosted project; do not rerun it. Hosted checks confirmed RLS on all three tables, denied anonymous vault access, denied client ownership-table access, and authenticated-only execution of the legacy helper. The original encrypted records matched their pre-install fingerprint exactly. At launch, old login grants were revoked; anonymous REST reads of all four tables returned permission-denied responses.
4. Before inviting an existing user, an administrator reserves their verified legacy row for their approved email in `peps_legacy_reservations`. Keep real addresses out of this repository. Example shape only: `insert into public.peps_legacy_reservations (email, legacy_id) values (<lowercase approved email>, <verified legacy row ID>);` Upon first authenticated setup, `peps_read_legacy_vault()` requires the matching email to be confirmed in `auth.users`, atomically consumes the reservation, and binds ownership to the immutable Auth UUID. Subsequent email changes do not transfer ownership. Clients cannot create/read/edit reservations directly. Existing Auth users can instead be bound directly by an administrator in `peps_legacy_owners`. Do not infer ownership from first names or editable metadata. Invite only after the new frontend is ready and the recipient/send is authorized.
5. Coordinate a cutover window. Apply `cutover-legacy-access.sql` to revoke direct legacy access; change the launch switch to true and deploy the versioned assets. Cached older clients will lose sync access and must refresh. Never reopen anonymous access as a rollback shortcut.
6. Existing users enter their previous profile password once during setup. The owner-bound RPC supplies only their encrypted legacy row. The browser decrypts it, re-encrypts it with the new vault key, and inserts the new account row. The original encrypted row remains intact as backup. Check all historical weights, dose completions, cycles, and schedule changes after transfer.
7. Only then invite additional users. New users have empty stacks; they cannot select or claim an existing user's profile.
8. After verified migration, remove the retired profile code and old plaintext browser cache keys in a separate cleanup. Until then, manually clear legacy cache keys on devices that used the previous app. No plaintext cache is read or written by the new path.

## Verification

Local test tools: Playwright with Chrome; `@electric-sql/pglite@0.3.14` for PostgreSQL policy tests.

```sh
node --test tests/peps-vault.test.cjs tests/peps-titration.test.cjs
NODE_PATH=/tmp/peps-qa/node_modules node tests/peps-accounts.cjs
NODE_PATH=/tmp/peps-auth-build/node_modules node tests/peps-account-rls.cjs
NODE_PATH=/tmp/peps-qa/node_modules node tests/peps-experience.cjs
NODE_PATH=/tmp/peps-qa/node_modules node tests/peps-stack-editor.cjs
NODE_PATH=/tmp/peps-qa/node_modules node tests/peps-duration-setup.cjs
```

Browser tests intercept every Supabase request; they do not create users or send email. PGlite executes policies against local PostgreSQL, not the hosted project. Passing these does not establish production readiness.

Before launch, verify an authorized test invitation delivered to a real inbox, new-user setup on mobile, cross-device sign-in, a reset/recovery cycle, expired/reused links, hosted RLS denial for anonymous and different users, and one authorized legacy migration. Confirm no private plaintext appears in outgoing database requests. Obtain an independent security review before a broad health-data launch.

Bundled client: `@supabase/supabase-js@2.118.0`, built with `esbuild@0.25.12` from its official npm package, browser IIFE global `supabase`. License in `peps/vendor/LICENSE-supabase`.
