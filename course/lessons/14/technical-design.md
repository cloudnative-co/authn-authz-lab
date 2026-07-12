# Lesson 14 technical design

## Purpose

Lesson 14 extends the actual WebAuthn RP from Lesson 13 with discoverable authentication, two independent credentials for one account, RP-side credential revocation, backup flag observation, second-credential recovery, account disable, and session invalidation.

## Normative basis

- W3C Web Authentication Level 3 Candidate Recommendation Snapshot, 26 May 2026
- Chrome DevTools Protocol WebAuthn credential and virtual authenticator properties
- Playwright 1.61.1 CDPSession
- SimpleWebAuthn server 13.3.2

The lesson uses the same exact `http://localhost:<managed-port>` origin and RP ID `localhost` as Lesson 13. Loopback HTTP is a training deviation.

## Discoverable authentication

The RP calls `generateAuthenticationOptions` without `allowCredentials`. No username or account ID is attached to the authentication transaction. Chromium calls `navigator.credentials.get()` and the discoverable credential returns a user handle.

The RP resolves the credential record by credential ID, requires it to be active, and compares the returned user handle against the account's stored 64-byte handle. Only then does it verify challenge, exact origin, RP ID hash, UV, signature, and counter behavior.

The client-provided user handle never directly selects an arbitrary account.

## Two-authenticator model

One Chromium process owns two isolated browser contexts. Each context has one CDP CTAP2 internal virtual authenticator. The same RP account handle is registered once on each authenticator, producing two independent RP credential records.

The first authenticator has backup eligibility/state false. The second has both true so the verifier and RP storage paths observe a multi-device/backed-up category. This is an injected fixture, not observed cloud synchronization.

## RP revocation

Credential revocation requires an authenticated session and a matching CSRF token. The RP marks its record inactive and retains it for rejection and audit. It does not call CDP credential removal.

The scenario compares `WebAuthn.getCredentials` counts before and after RP revocation. The count remains unchanged. The first authenticator can still create a valid assertion, but the RP rejects it before signature verification because its credential record is inactive. The external response remains generic.

## Recovery

The second credential is registered before the first is revoked. After the first assertion is rejected, the second authenticator performs an empty-allowCredentials ceremony. Its user handle maps to the same account, its active credential verifies, and the RP issues a new session.

This proves only a pre-enrolled second-credential path. It does not implement identity proofing or recovery after every credential is lost.

## Backup flags

BE is immutable backup eligibility for the credential source. BS is the current backup state reported in authenticator data and can change. The RP stores the verifier's device type and backup state on registration and successful authentication.

CDP `defaultBackupEligibility` and `defaultBackupState` configure assertions emitted by the fixture. A true value does not identify a provider, move a credential, test encryption, or prove another device can use it.

## Account and session invalidation

Account disable increments a server-side session generation, clears all sessions and pending transactions, and prevents new successful authentication. Existing browser cookies become unresolved and `/me` returns 401. A cryptographically valid assertion created after disable receives the same generic 422 verification failure.

Credential validity is not sufficient authorization to use a disabled application account.

## signCount

The RP stores counter updates from successful verification. Counter behavior remains a risk signal, not clone proof. Multi-device credentials commonly use a zero counter; the lab accepts zero-to-zero through the verifier and records no clone conclusion.

## Evidence boundary

Allowed: API names, status codes, credential counts, active/revoked counts, boolean BE/BS observations, device category, fixed reason, session count, and limitation labels.

Forbidden: passwords, tokens, CSRF values, challenges, user handles, credential IDs, public keys, authenticator data, attestation objects, assertions, signatures, raw counters, scenario IDs, hostnames, home paths, and IP addresses.

## Explicit limitations

- Virtual backup flags do not prove real synchronization.
- No authenticator picker UI or real account selection is assessed.
- No OS PIN, biometric, device unlock, or real user gesture is assessed.
- No provider account recovery, cross-device flow, or QR transport is assessed.
- No endpoint-management remote deletion is implemented.
- Helpdesk identity proofing, approvals, notification, waiting periods, and audit are design exercises.
- Only the macOS arm64 Node 24 profile has been locally exercised; fixed revision and human pilot are pending.

