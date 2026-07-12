# Lesson 10 technical design: OAuth 2.0 Authorization Code + PKCE

## Goal and protocol boundary

This lesson demonstrates delegated API authorization, not application login. One process owns three real HTTP listeners, but each listener has a separate fixed origin and role:

| Origin | Role | Trust boundary |
|---|---|---|
| `http://127.0.0.1:4100` | Authorization Server | authenticates the Resource Owner, collects consent, issues code/token, introspects token |
| `http://127.0.0.1:4101` | public OAuth Client | creates state/PKCE, handles callback, calls API; has no client secret |
| `http://127.0.0.1:4102` | Resource API | accepts Bearer and authenticates to introspection back-channel |

The origins are immutable configuration. `Host` and `Origin` never become issuer or endpoint inputs.

## Authorization Code + PKCE transaction

1. Client generates a 256-bit state and verifier. Its server-side transaction is indexed by the state digest and expires after five minutes.
2. Client sends `code_challenge=BASE64URL(SHA256(verifier))` and `code_challenge_method=S256` to the Authorization Endpoint.
3. AS first establishes trusted `client_id` and exact registered `redirect_uri`. Unknown/ambiguous/unregistered values return 400 without redirect. Later protocol errors return to the trusted callback with `state` when valid and RFC 9207 `iss`.
4. Password is posted only to AS. Consent is a separate POST.
5. AS stores only the digest of a 256-bit opaque, short-lived code. Code metadata binds client, redirect, PKCE challenge, scopes, subject, nonce, and expiry.
6. Token Endpoint accepts form POST from the registered public client (`token_endpoint_auth_method=none`). It consumes the code before checking all bindings and PKCE, so any attempt is one-time and replay fails closed.
7. Client never sends state to the Token Endpoint. The opaque access token is also stored digest-only.

Login and consent use `/interaction/*` with an opaque `ref`. This is private AS interaction state, not an OAuth wire parameter and specifically not the standardized `request` parameter used by JAR/Request Objects.

## Resource API and introspection

The Resource API receives Bearer over HTTP and calls the AS introspection endpoint using separate back-channel credentials. It requires `active`, exact audience, `Bearer`, expected client, valid expiry, subject, and `project:read`.

- no credential: 401 with `Bearer realm="lesson-10-api"`
- malformed/inactive/wrong-audience token: 401 with `error="invalid_token"`
- active token without `project:read`: 403 with `error="insufficient_scope"` and required scope

An inactive introspection response contains only `active:false`. The token, back-channel secret, and metadata values are not recorded as evidence.

## Negative cases

The scenario changes one condition per transaction: callback state, verifier, replayed code, or redirect URI. A dependency-injected client fault queue exists only in the in-process scenario object; no HTTP route can enable it.

## Evidence and lifecycle

Evidence fields are allowlisted to role, fixed origin, method/path without query, status, fixed reason, and booleans. Password, state, verifier, code, access token, cookies, secrets, and keys are never projected.

The lab binds listeners transactionally and closes listeners already opened when a later bind fails. Stop is idempotent. Shared course-runner registration is intentionally outside this lesson-specific slice.

## Training deviation and omissions

HTTP and cookies without `Secure` are used only on loopback so learners can inspect traffic. Production requires HTTPS, certificate validation, and `Secure` cookies. This slice intentionally omits refresh/revocation, dynamic registration, PAR/JAR/JARM, DPoP/mTLS, distributed persistence, consent history, and key/secret rotation.

Primary specifications: [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636), [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662), [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207), [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700).
