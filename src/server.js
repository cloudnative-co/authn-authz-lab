import http from 'node:http';
import { authenticateBasicAuth } from './auth/basic.js';
import { authorizeProjectAction, listReadableProjects } from './auth/authorization.js';
import { AuthorizationServer } from './auth/oauth.js';
import { buildDiscoveryDocument, buildJwks } from './auth/oidc.js';
import { authenticateWithPassword } from './auth/password.js';
import { parseCookie, sessionCookie, SessionStore } from './auth/session.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './auth/totp.js';
import { createSeedData } from './data/seed.js';

// Distinguishes a malformed request body from any other handler error so the
// top-level guard can answer 400 instead of 500.
class InvalidJsonError extends Error {}

export function createApp({ issuer } = {}) {
  const store = createSeedData();
  const sessions = new SessionStore();
  const totpSecrets = new Map();

  // The issuer is a static, trusted configuration value. It is never derived
  // from the request Host, which a caller could spoof to forge iss/aud and the
  // discovery document.
  const resolvedIssuer = issuer ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const oauth = new AuthorizationServer({
    issuer: resolvedIssuer,
    resolveUser: (userId) => store.users.find((user) => user.id === userId) ?? null,
  });
  for (const client of store.oauthClients) {
    oauth.registerClient(client);
  }

  async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readJson(req) {
    const raw = await readRawBody(req);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new InvalidJsonError('request body is not valid JSON');
    }
  }

  function send(res, status, value, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(value));
  }

  function currentUser(req) {
    const sessionId = parseCookie(req.headers.cookie).session_id;
    const userId = sessions.resolve(sessionId);
    return store.users.find((user) => user.id === userId) ?? null;
  }

  function ldapConfigFromEnv(env = process.env) {
    if (!env.LDAP_URL) return null;
    return {
      url: env.LDAP_URL,
      baseDn: env.LDAP_BASE_DN ?? 'dc=example,dc=test',
      bindDn: env.LDAP_BIND_DN ?? 'cn=admin,dc=example,dc=test',
      bindPassword: env.LDAP_BIND_PASSWORD ?? 'admin-password',
    };
  }

  // The container features (LDAP / Kerberos / SAML) are imported lazily inside
  // their handlers so `npm start` / `npm test` never load node-saml, ldapts or
  // the native kerberos module when those services are not configured. The SAML
  // SP is built once from the environment and cached.
  let samlProviderResolved = false;
  let samlProvider = null;
  async function getSamlProvider() {
    if (samlProviderResolved) return samlProvider;
    const { samlConfigFromEnv, createSamlServiceProvider } = await import('./auth/saml.js');
    const config = samlConfigFromEnv();
    samlProvider = config ? createSamlServiceProvider(config) : null;
    samlProviderResolved = true;
    return samlProvider;
  }

  const server = http.createServer(async (req, res) => {
   try {
    // Only the path/query of req.url are used; the base host is irrelevant.
    const url = new URL(req.url, oauth.issuer);

    if (req.method === 'POST' && url.pathname === '/login') {
      const body = await readJson(req);
      const user = authenticateWithPassword(store, body.email, body.password);
      if (!user) return send(res, 401, { error: 'invalid_credentials' });
      const sessionId = sessions.create(user.id);
      return send(res, 200, { user: { id: user.id, email: user.email } }, { 'set-cookie': sessionCookie(sessionId) });
    }

    if (req.method === 'POST' && url.pathname === '/logout') {
      const sessionId = parseCookie(req.headers.cookie).session_id;
      sessions.destroy(sessionId);
      return send(res, 204, {});
    }

    if (req.method === 'GET' && url.pathname === '/me') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login_required' });
      return send(res, 200, { id: user.id, email: user.email });
    }

    const projectDeleteMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
    if (req.method === 'DELETE' && projectDeleteMatch) {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login_required' });
      const decision = authorizeProjectAction(store, user.id, projectDeleteMatch[1], 'project.delete');
      if (!decision.allowed) return send(res, 403, { error: decision.reason, role: decision.role });
      return send(res, 200, { deleted: projectDeleteMatch[1] });
    }

    if (req.method === 'GET' && url.pathname === '/basic/me') {
      const user = authenticateBasicAuth(store, req.headers.authorization);
      if (!user) return send(res, 401, { error: 'basic_auth_required' }, { 'www-authenticate': 'Basic realm="Mini Project App"' });
      return send(res, 200, { id: user.id, email: user.email });
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, buildDiscoveryDocument(oauth.issuer));
    }

    if (req.method === 'GET' && url.pathname === '/oauth/jwks') {
      return send(res, 200, buildJwks(oauth.keyPair));
    }

    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      // A real AS renders a consent screen here before issuing the code. This
      // sample authenticates the resource owner by session cookie and skips
      // consent to keep the authorization-code + PKCE flow readable.
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login_required' });
      const result = oauth.handleAuthorizationRequest(url.searchParams, user.id);
      if (result.redirect) {
        res.writeHead(302, { location: result.location });
        return res.end();
      }
      return send(res, 400, { error: result.error, error_description: result.error_description });
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const result = oauth.handleTokenRequest(req.headers, await readRawBody(req));
      return send(res, result.status, result.body, { ...result.headers, 'content-type': 'application/json;charset=UTF-8' });
    }

    if (req.method === 'POST' && url.pathname === '/oauth/introspect') {
      const result = oauth.handleIntrospectionRequest(req.headers, await readRawBody(req));
      return send(res, result.status, result.body, { ...result.headers, 'content-type': 'application/json;charset=UTF-8' });
    }

    if (req.method === 'GET' && url.pathname === '/reports/projects') {
      const result = oauth.authenticateBearer(req.headers, 'project:read');
      if (!result.ok) {
        const headers = result.wwwAuthenticate ? { 'www-authenticate': result.wwwAuthenticate } : {};
        return send(res, result.status, { error: result.error ?? 'unauthorized' }, headers);
      }
      // Scope the response to the token subject (RFC 9068). A delegated user
      // token only sees what that user may read; a machine client
      // (client_credentials, sub === client_id) gets an org-wide report view.
      const { sub, client_id: clientId } = result.payload;
      let projects;
      if (store.users.some((user) => user.id === sub)) {
        projects = listReadableProjects(store, sub).map((project) => project.name);
      } else if (sub === clientId) {
        projects = store.projects.map((project) => project.name);
      } else {
        projects = [];
      }
      return send(res, 200, { projects });
    }

    if (req.method === 'POST' && url.pathname === '/mfa/totp/setup') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login_required' });
      const secret = generateTotpSecret();
      totpSecrets.set(user.id, secret);
      return send(res, 200, {
        secret,
        otpauth_uri: buildOtpauthUri({ issuer: 'Mini Project App', accountName: user.email, secret }),
      });
    }

    if (req.method === 'POST' && url.pathname === '/mfa/totp/verify') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login_required' });
      const secret = totpSecrets.get(user.id);
      if (!secret) return send(res, 400, { error: 'totp_not_enrolled' });
      const body = await readJson(req);
      if (!verifyTotp(body.token, secret)) return send(res, 401, { error: 'invalid_totp' });
      return send(res, 200, { verified: true });
    }

    // --- LDAP directory login (06). Requires the slapd container. ---
    if (req.method === 'POST' && url.pathname === '/login/ldap') {
      const config = ldapConfigFromEnv();
      if (!config) return send(res, 503, { error: 'ldap_unavailable' });
      const body = await readJson(req);
      const { authenticateWithDirectory } = await import('./auth/ldap.js');
      let profile;
      try {
        profile = await authenticateWithDirectory({ ...config, email: body.email, password: body.password });
      } catch (error) {
        return send(res, 502, { error: 'ldap_error', detail: error.message });
      }
      if (!profile) return send(res, 401, { error: 'invalid_credentials' });
      return send(res, 200, { authenticated: true, dn: profile.dn, email: profile.email, groups: profile.groups });
    }

    // --- SPNEGO / Kerberos protected resource (07). Requires the KDC + keytab. ---
    if (req.method === 'GET' && url.pathname === '/kerberos/me') {
      const { createNegotiateHandler } = await import('./auth/spnego.js');
      const result = await createNegotiateHandler()(req.headers.authorization);
      if (!result.ok) {
        return send(res, result.status, result.body ?? { error: 'negotiate_required' }, result.headers ?? {});
      }
      return send(res, 200, { principal: result.principal }, result.headers ?? {});
    }

    // --- SAML SP-initiated SSO (09). Requires the Keycloak IdP. ---
    if (req.method === 'GET' && url.pathname === '/login/saml') {
      const sp = await getSamlProvider();
      if (!sp) return send(res, 503, { error: 'saml_unavailable' });
      const { getLoginRedirectUrl } = await import('./auth/saml.js');
      const location = await getLoginRedirectUrl(sp, url.searchParams.get('RelayState') ?? '');
      res.writeHead(302, { location });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/saml/acs') {
      const sp = await getSamlProvider();
      if (!sp) return send(res, 503, { error: 'saml_unavailable' });
      const params = new URLSearchParams(await readRawBody(req));
      const samlResponse = params.get('SAMLResponse');
      if (!samlResponse) return send(res, 400, { error: 'missing_saml_response' });
      const saml = await import('./auth/saml.js');
      if (process.env.DEBUG_SAML === '1') {
        console.log('--- decoded SAMLResponse XML ---');
        console.log(saml.decodeSamlResponseXml(samlResponse));
      }
      let profile;
      try {
        profile = await saml.validateSamlResponse(sp, samlResponse);
      } catch (error) {
        return send(res, 401, { error: 'saml_validation_failed', detail: error.message });
      }
      return send(res, 200, { authenticated: true, nameId: profile.nameID, attributes: profile.attributes ?? {} });
    }

    return send(res, 404, { error: 'not_found' });
   } catch (error) {
      // Last-resort guard: a handler exception must never crash the process.
      if (error instanceof InvalidJsonError) {
        return send(res, 400, { error: 'invalid_json' });
      }
      console.error('unhandled request error:', error);
      if (!res.headersSent) {
        return send(res, 500, { error: 'internal_error' });
      }
      return res.end();
    }
  });

  // Configure the issuer once the real listening origin is known (e.g. an
  // ephemeral test port). Still a static, trusted value set at startup.
  server.setIssuer = (value) => {
    oauth.issuer = value;
    oauth.resource = `${value}/api`;
  };

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  createApp({ issuer: `http://localhost:${port}` }).listen(port, () => {
    console.log(`Mini Project App listening on http://localhost:${port}`);
  });
}
