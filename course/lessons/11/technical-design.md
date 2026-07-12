# Lesson 11 technical design: OpenID Connect Authorization Code Flow

## Goal and separation from OAuth authorization

OpenID Connect adds an identity layer. The RP uses the same three fixed origins as Lesson 10 but treats an ID Token as an authentication assertion and an access token only as API authorization material. An access token can never create an RP login session.

## Discovery, JWKS, and token delivery

1. RP generates state, PKCE verifier, and 256-bit nonce in a five-minute server-side transaction.
2. Authentication request includes `openid email profile:read`; password and consent stay at the OP.
3. Browser callback contains code, state, and RFC 9207 issuer parameter, but never an ID Token.
4. RP consumes state, compares the response issuer to fixed configuration, then exchanges code at the Token Endpoint.
5. RP fetches `/.well-known/openid-configuration` over HTTP. The returned issuer must exactly equal the configured issuer, and the configured JWKS URI and RS256 support must be present.
6. RP fetches JWKS over HTTP and delegates JWS/JWT processing to `jose` 6.2.3. ID Token is a JWT; this lab uses a signed JWS, does not implement encrypted JWE, allowlists RS256, and verifies signature, issuer, audience, expiry, issued-at age, required claims, and nonce.
7. Only after every check passes does RP issue a random app-session cookie whose digest, expiry, and opaque subject are stored server-side.

The OP's `/interaction/*` routes and opaque `ref` are private login/consent state. They are not OIDC Authentication Request parameters and do not reuse the standardized `request` parameter.

The RP validates that `sub` is a non-empty string no longer than 255 characters. Local uniqueness and non-reassignment are issuer contracts, not properties a single login can prove. The external account correlation key is `(iss, sub)` when more than one issuer is accepted. `email` is emitted only when `email` scope is granted and remains a changeable attribute, never the subject identifier.

## One-fault rejection matrix

The scenario injects faults through an in-memory constructor queue that has no public HTTP control surface:

- signature: valid claims, same `kid`, signature from an unpublished second key
- issuer: correctly signed token with only `iss` wrong
- audience: correctly signed token with only `aud` wrong
- expiry: correctly signed but expired token
- nonce: correctly signed token with only nonce wrong
- token confusion: opaque access token substituted for ID Token

Every case reaches the same real callback, discovery, JWKS, and library validation code. Public errors are generic; evidence contains only fixed rejection reasons.

## Cookie boundary

Missing, malformed, expired, or duplicate app-session cookies produce the same 403 result. Duplicate cookie names are invalid rather than accepting whichever value a parser happens to choose. On production HTTPS the session cookie must add `Secure`; loopback HTTP omission is a documented training deviation.

## Evidence and omissions

No ID/access token, state, nonce, verifier, code, cookie, password, key, or secret appears in runtime evidence. Evidence records only role, fixed origin, method/path, status, fixed reason, and booleans.

This slice omits UserInfo, refresh tokens, logout/session-management protocols, pairwise subject generation, dynamic registration, encrypted JWE ID Tokens, key rotation/cache rollover, distributed replay stores, `auth_time`/ACR/AMR policy, and production TLS operations.

Primary specifications and library: [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636), [`jose`](https://github.com/panva/jose).
