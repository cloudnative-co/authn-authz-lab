# Lesson 13 technical design

## Purpose

Lesson 13 executes the Web Authentication API in Chromium and verifies the resulting ceremonies at a separate RP service. It demonstrates registration, username-bound authentication, single-use challenge transactions, origin and RP ID binding, user verification, account-bound user handles, assertion signatures, and redacted evidence.

## Normative basis

- W3C Web Authentication Level 3 Candidate Recommendation Snapshot, 26 May 2026
- Chrome DevTools Protocol WebAuthn domain
- Playwright 1.61.1 CDPSession and browser installation contract
- SimpleWebAuthn server 13.3.2 verification contract

Level 3 remains a Candidate Recommendation. The lesson does not claim complete conformance or future stability.

## Origins and RP ID

The managed process listens on `127.0.0.1`, while the browser uses the exact origin `http://localhost:<managed-port>`. The server accepts only its socket authority or exact `localhost:<managed-port>` Host values. The course uses RP ID `localhost`, which contains no scheme or port.

Loopback HTTP is a training deviation permitted for the `localhost` WebAuthn origin. Production deployment requires HTTPS, an explicit RP ID/origin inventory, secure cookies, and deployment-specific security review.

## Account and user handle

The RP creates one 64-byte cryptographically random user handle when the scenario account is created. It stores the bytes on the account and supplies them as `PublicKeyCredentialUserEntity.id` for every registration. Email, username, stable cross-RP IDs, and hashes of PII are not used.

The handle is omitted in observations, logs, runtime evidence, and assessment evidence. Not even its digest is stored as evidence.

## Transactions

Registration and authentication options are tied to independent 192-bit random transaction IDs. Each record contains a server-generated challenge, ceremony kind, account binding where applicable, creation time, and absolute expiry. Finish consumes the transaction before verification, so successful, failed, and replayed submissions cannot reuse it.

Expired records are swept before lookup. The default lifetime is two minutes. A browser tab is not the security boundary; closing or retaining a tab does not change server transaction reuse rules.

## Registration

1. An existing password-authenticated, CSRF-protected session requests options.
2. The RP supplies `rp.id=localhost`, a 64-byte account handle, ES256, resident key required, UV required, and `attestation=none`.
3. Chromium calls `navigator.credentials.create()` against a CDP CTAP2 virtual authenticator.
4. The RP verifies challenge, exact origin, RP ID hash, UP, UV, and the registration object.
5. Only after successful verification does the RP store credential ID, public key, counter, transports, account mapping, device type, backup state, and active state.

`none` attestation has no device attestation signature. The implementation therefore does not label registration as device-signature verification. Private-key possession is exercised by the subsequent authentication assertion.

## Username-bound authentication

The RP resolves the submitted course identifier before options are generated and puts only active credentials for that account into `allowCredentials`. Chromium calls `navigator.credentials.get()`.

Before invoking the protocol verifier, the RP requires the returned credential to be active and mapped to the bound account, then compares the returned user handle with the stored account handle. The protocol verifier checks challenge, exact origin, RP ID hash, UV, assertion signature, and counter behavior.

On success, the RP updates the counter and backup state before issuing a host-only HttpOnly SameSite=Lax session cookie. Secure is disabled only for loopback HTTP.

## Negative fixtures

| Boundary | Fixture | Other valid properties |
| --- | --- | --- |
| failed registration | mutate options challenge before actual create | authenticator creates a structurally valid credential |
| challenge | mutate challenge before actual get | origin, RP ID, signature are internally consistent with mutated challenge |
| origin | actual get from another localhost port | challenge, RP ID, user handle, signature are valid |
| RP ID | request foreign RP ID from trusted page | browser rejects before assertion generation |
| signature | flip one bit after actual get | challenge, origin, RP ID, authenticator data unchanged |
| replay | resubmit successful transaction and assertion | payload is byte-for-byte the prior success |
| user handle | flip one byte only | assertion signature and authenticator data unchanged |

The RP uses generic external failures. Fixed internal reasons are retained without raw verifier messages or protocol values.

## signCount

The server persists the verifier's new counter. A non-increasing non-zero value can be treated as a risk signal and the selected library rejects it, but the lesson never labels it proof of cloning. Zero counters remain valid and do not prove either safety or compromise.

## Browser dependency and lifecycle

`npm ci` installs the pinned Playwright package. It does not satisfy the separate Chromium binary prerequisite. `doctor` launches and closes Chromium and returns `PREREQUISITE_PLAYWRIGHT_CHROMIUM` with an explicit `npx playwright install chromium` recovery path when unavailable.

Each demo/check launches one browser, creates an isolated context and virtual authenticator, and closes all contexts and the browser in `finally`. The alternate-origin server binds an ephemeral loopback port and closes in `finally`. Neither is a persistent course resource.

## Evidence boundary

Allowed evidence: API names, status codes, counts, exact origin label, ceremony type, required boolean flags, device/backup categories, fixed rejection reasons, and limitation labels.

Forbidden evidence: passwords, session/CSRF tokens, challenges, user handles, credential IDs, public keys, attestation objects, assertions, signatures, raw counters, scenario IDs, hostnames, home paths, and IP addresses.

## Explicit limitations

- CDP virtual authenticator is not hardware or OS authenticator proof.
- Automatic presence simulation is not a real user gesture.
- `isUserVerified` is a fixture flag, not biometric or PIN proof.
- No real passkey synchronization or cross-device authentication is tested.
- No attestation trust policy is implemented.
- No production datastore, encryption at rest, HSM, or multi-region transaction store is implemented.
- Only the macOS arm64 Node 24 profile has been locally exercised; human pilot and fixed revision are pending.

