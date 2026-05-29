import http from 'node:http';
import { authenticateBasicAuth } from './auth/basic.js';
import { authenticateWithPassword } from './auth/password.js';
import { authorizeProjectAction, listReadableProjects } from './auth/authorization.js';
import { AuthorizationServer } from './auth/oauth.js';
import { parseCookie, sessionCookie, SessionStore } from './auth/session.js';
import { createSeedData } from './data/seed.js';

export function createApp() {
  const store = createSeedData();
  const sessions = new SessionStore();
  const oauth = new AuthorizationServer();
  oauth.registerClient({
    clientId: 'report-app',
    clientSecret: 'report-app-secret',
    redirectUris: ['http://localhost:4000/callback'],
    allowedScopes: ['project:read'],
  });

  async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

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

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const body = await readJson(req);
      const token = oauth.issueClientCredentialsToken({
        clientId: body.client_id,
        clientSecret: body.client_secret,
        scopes: body.scope?.split(' ') ?? [],
      });
      if (!token) return send(res, 401, { error: 'invalid_client_or_scope' });
      return send(res, 200, { access_token: token, token_type: 'Bearer' });
    }

    if (req.method === 'GET' && url.pathname === '/reports/projects') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const access = token ? oauth.introspect(token, ['project:read']) : null;
      if (!access) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, { projects: listReadableProjects(store, 'user_alice').map((project) => project.name) });
    }

    return send(res, 404, { error: 'not_found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  createApp().listen(port, () => {
    console.log(`Mini Project App listening on http://localhost:${port}`);
  });
}
