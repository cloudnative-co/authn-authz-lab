# Lesson 12 technical design

## Purpose

Lesson 12 demonstrates an actual RFC 6238 TOTP calculation inside a bounded HTTP authentication flow. The implementation must prove the boundary between password verification, factor enrollment, pre-authentication, second-factor verification, and application-session issuance without persisting learner-visible secrets as evidence.

## Normative and interoperability basis

- RFC 4226: HMAC-based OTP and dynamic truncation
- RFC 6238: time-derived counter, algorithm options, validation window, and one-time acceptance
- NIST SP 800-63B-4: OTP replay resistance, protected key handling, account-level rate limiting, and phishing-resistance classification
- Google Authenticator Key URI Format: provisioning URI interoperability convention, not an RFC 6238 requirement

The RFC 6238 Appendix B vectors are an executable conformance oracle. A second implementation, OTPAuth 9.5.1, is an independent interoperability oracle. Neither oracle proves production key management or authenticator UI behavior.

## Cryptographic profile

| Parameter | Lesson value | Reason |
| --- | --- | --- |
| Secret | 20 random bytes | 160-bit per-factor training secret |
| Encoding | canonical uppercase Base32, no padding | provisioning interoperability |
| HMAC | SHA-1 | common TOTP interoperability profile |
| Digits | 6 | common manual-entry profile |
| Period | 30 seconds | RFC 6238 recommended default |
| Window | current plus one adjacent step in either direction | bounded drift demonstration |
| Replay state | highest accepted counter per factor | accepted counter cannot be reused |

The package also supports SHA-256, SHA-512, and 6–8 digits so that all RFC vectors can be checked. The HTTP lesson intentionally fixes one profile rather than negotiating parameters.

## State model

### Enrollment transaction

Created only after the password authenticator succeeds. It contains a subject, expiry, and a secret after provisioning starts. It is not an authenticated application session and is addressed by a random, digest-indexed, host-only cookie.

Enrollment becomes active only after a current TOTP verifies. The accepted confirmation counter is stored immediately, preventing that code from being used for the first login.

### Pre-authentication transaction

Created only after password verification for an already enrolled subject. It authorizes only the second-factor endpoint and has a five-minute absolute lifetime. It cannot authorize `/me`.

### Application session

Created only after a TOTP or unused recovery code succeeds. It records the subject, the two authentication methods, and an absolute expiry. Only this token can authorize `/me`.

All three token types are canonical 256-bit random values. The service indexes records by SHA-256 digest and never emits raw tokens in observation output.

## HTTP contract

| Method and path | Input | Success | Failure boundary |
| --- | --- | --- | --- |
| `POST /enrollment/password` | identifier, password | 201 and enrollment cookie | password-service response |
| `POST /enrollment/start` | enrollment cookie | 200 and provisioning material | 403 unavailable transaction |
| `POST /enrollment/confirm` | cookie, TOTP | 201 and one-time recovery display | generic 422 or 429 |
| `POST /login/password` | identifier, password | 200 and pre-auth cookie | password-service response or 409 unenrolled |
| `POST /login/second-factor` | pre-auth cookie, method, code | 200 and session cookie | generic 422, 403 transaction, or 429 |
| `GET /me` | session cookie | 200 subject and methods | 403 unavailable session |

The loopback training server uses HTTP, so `Secure` is disabled. Cookies remain `HttpOnly`, `SameSite=Lax`, `Path=/`, and host-only. Production use requires HTTPS, `Secure`, deployment-level CSRF analysis, and a complete session policy.

## Verification and replay algorithm

1. Calculate the current counter with `floor(timeMs / (period * 1000))`.
2. Calculate an expected code for each permitted adjacent counter.
3. Compare fixed-width ASCII codes with a timing-safe comparison.
4. If no code matches, return the internal reason `invalid-or-expired`.
5. If matching counters are all at or below the factor's last accepted counter, return `replayed`.
6. Otherwise, accept the highest eligible matching counter and persist it before session issuance.

External clients receive the same `INVALID_SECOND_FACTOR` body for malformed, wrong, expired, replayed, used-recovery, and invalid-method inputs. Internal events retain only a fixed reason and never include codes or secrets.

## Rate limiting

Second-factor failures are counted by stable subject ID, not transaction cookie. Reissuing pre-authentication cannot reset the counter. The training threshold is three failures in 30 seconds, followed by a 30-second block and `Retry-After`.

This threshold exists to make the branch observable in a short lesson. It is not a production recommendation. Production design must consider distributed attempts, risk signals, denial of service, user notification, and recovery.

A successful second-factor authentication clears previous failed attempts for that subject.

## Recovery codes

Four independent 160-bit random codes are generated after enrollment confirmation. Raw values are returned once. Each server record contains a random 128-bit salt, a domain-separated SHA-256 digest, and a used timestamp. High entropy, rather than password stretching, provides offline-guess resistance in this training design.

Verification calculates every unused record's candidate digest before selecting a match. A matched record is marked used before an application session is returned. Recovery-code replay uses the generic second-factor rejection.

The lesson does not implement helpdesk identity proofing, factor reset approval, notification, or global session revocation.

## Evidence boundary

Allowed observation fields include status codes, algorithm names, digits, period, window size, boolean state properties, counts, authentication method names, fixed event types, and limitation labels.

The following values are forbidden from runtime and assessment evidence:

- passwords and password hashes
- TOTP secrets and provisioning URIs
- TOTP and recovery codes
- enrollment, pre-authentication, and session tokens
- full token digests and accepted counters
- scenario identifiers

The scripted scenario necessarily handles provisioning material in memory. It reduces the result to boolean and categorical evidence before `runtime.json` is written.

## Explicit limitations

- No QR rendering or real mobile authenticator UI is tested.
- No authenticator clock drift or device-time correction is tested.
- Secret storage is in-memory and not production-approved.
- The loopback HTTP transport is not production-approved.
- `otpauth://` is an ecosystem convention rather than an RFC 6238 provisioning standard.
- TOTP is not phishing-resistant and the lesson does not imply otherwise.
- Recovery operations beyond a single-use code are design exercises.
