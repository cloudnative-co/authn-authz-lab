import {
  parseSessionCookie,
  serializeSessionCookie,
  SessionCookieError,
} from '../../../../packages/session/session-cookie.mjs';
import {
  HttpRequestError,
  readJson,
  requestPath,
  sendJson,
  sendRequestError,
} from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
} from '../scenario-http.mjs';
import { webauthnBrowserScript, webauthnLessonHtml } from './browser-page.mjs';
import { createWebAuthnCourseService } from './webauthn-service.mjs';

function exactLessonId(value) {
  if (!['13', '14'].includes(value)) throw new TypeError('lessonId must be 13 or 14');
  return value;
}

function sendText(response, status, body, contentType) {
  const payload = Buffer.from(body, 'utf8');
  response.statusCode = status;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', payload.length);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'none'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  response.end(payload);
}

function cookieOptions(lessonId) {
  return Object.freeze({ name: `course_webauthn_${lessonId}_session`, secure: false });
}

function requestSession(request, options) {
  try {
    return parseSessionCookie(request.headers.cookie ?? '', options);
  } catch (error) {
    if (error instanceof SessionCookieError) return null;
    throw error;
  }
}

function csrfToken(request) {
  const value = request.headers['x-csrf-token'];
  return typeof value === 'string' ? value : null;
}

function publicResult(result) {
  const { sessionToken: ignoredSessionToken, ...publicFields } = result;
  void ignoredSessionToken;
  return publicFields;
}

function sendServiceResult(response, result, lessonId) {
  const headers = result.ok && result.sessionToken
    ? {
      'set-cookie': serializeSessionCookie(result.sessionToken, {
        ...cookieOptions(lessonId),
        maxAgeSeconds: 30 * 60,
      }),
    }
    : {};
  sendJson(response, result.status, publicResult(result), headers);
}

export async function createWebAuthnScenario({ lessonId, expectedOrigin } = {}) {
  const service = await createWebAuthnCourseService({ lessonId, expectedOrigin, rpID: 'localhost' });
  return Object.freeze({ service });
}

export function createWebAuthnLessonHttpHandler({
  lessonId: lessonIdInput,
  registry,
  scenarioFactory = createWebAuthnScenario,
} = {}) {
  const lessonId = exactLessonId(lessonIdInput);
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory must be a function');
  const controlRoot = `/__course/lessons/${lessonId}`;
  const apiRoot = `/api/lessons/${lessonId}`;
  const pagePath = `/lessons/${lessonId}`;
  const scriptPath = `${pagePath}/browser.js`;
  const cookies = cookieOptions(lessonId);

  function requireScenario(request, response) {
    const scenario = scenarioFromRequest(request, registry, lessonId);
    if (!scenario) sendScenarioMissing(response);
    return scenario?.value ?? null;
  }

  return async function handleWebAuthnLesson(request, response) {
    const path = requestPath(request);
    if (request.method === 'GET' && path === pagePath) {
      sendText(response, 200, webauthnLessonHtml(lessonId), 'text/html; charset=utf-8');
      return true;
    }
    if (request.method === 'GET' && path === scriptPath) {
      sendText(response, 200, webauthnBrowserScript(lessonId), 'text/javascript; charset=utf-8');
      return true;
    }
    if (request.method === 'POST' && path === `${controlRoot}/scenarios`) {
      const port = request.socket.localPort;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        sendJson(response, 500, { error: { code: 'LOCAL_ORIGIN_UNAVAILABLE' } });
        return true;
      }
      await createScenario({
        response,
        registry,
        lessonId,
        factory: () => scenarioFactory({ lessonId, expectedOrigin: `http://localhost:${port}` }),
      });
      return true;
    }
    if (request.method === 'DELETE' && path === `${controlRoot}/scenarios`) {
      deleteScenario({ request, response, registry, lessonId });
      return true;
    }
    if (![
      `${controlRoot}/observe`,
      `${controlRoot}/disable-account`,
      `${apiRoot}/login/password`,
      `${apiRoot}/registration/options`,
      `${apiRoot}/registration/verify`,
      `${apiRoot}/authentication/options`,
      `${apiRoot}/authentication/verify`,
      `${apiRoot}/me`,
      `${apiRoot}/credentials`,
      `${apiRoot}/credentials/revoke`,
    ].includes(path)) return false;

    const scenario = requireScenario(request, response);
    if (!scenario) return true;
    const { service } = scenario;
    try {
      if (request.method === 'GET' && path === `${controlRoot}/observe`) {
        sendJson(response, 200, service.observe());
        return true;
      }
      if (request.method === 'POST' && path === `${controlRoot}/disable-account`) {
        const input = await readJson(request);
        const changed = service.disableAccount(input?.accountId);
        sendJson(response, changed ? 200 : 404, {
          schemaVersion: 1,
          lessonId,
          labControl: 'account-disable-and-session-invalidation',
          changed,
        });
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/login/password`) {
        const input = await readJson(request);
        const result = await service.passwordLogin(input?.identifier, input?.password);
        sendServiceResult(response, result, lessonId);
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/registration/options`) {
        await readJson(request);
        const result = await service.startRegistration(
          requestSession(request, cookies),
          csrfToken(request),
        );
        sendServiceResult(response, result, lessonId);
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/registration/verify`) {
        const input = await readJson(request);
        const result = await service.finishRegistration(
          requestSession(request, cookies),
          csrfToken(request),
          input?.transactionId,
          input?.response,
        );
        sendServiceResult(response, result, lessonId);
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/authentication/options`) {
        const input = await readJson(request);
        const result = await service.startAuthentication({
          identifier: input?.identifier ?? null,
          discoverable: input?.discoverable ?? false,
        });
        sendServiceResult(response, result, lessonId);
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/authentication/verify`) {
        const input = await readJson(request);
        const result = await service.finishAuthentication(input?.transactionId, input?.response);
        sendServiceResult(response, result, lessonId);
        return true;
      }
      if (request.method === 'GET' && path === `${apiRoot}/me`) {
        sendServiceResult(response, service.currentUser(requestSession(request, cookies)), lessonId);
        return true;
      }
      if (request.method === 'GET' && path === `${apiRoot}/credentials`) {
        sendServiceResult(response, service.listCredentials(requestSession(request, cookies)), lessonId);
        return true;
      }
      if (request.method === 'POST' && path === `${apiRoot}/credentials/revoke`) {
        const input = await readJson(request);
        const result = service.revokeCredential(
          requestSession(request, cookies),
          csrfToken(request),
          input?.credentialReference,
        );
        sendServiceResult(response, result, lessonId);
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof HttpRequestError) sendRequestError(response, error);
      else if (error instanceof TypeError) sendJson(response, 400, { error: { code: 'REQUEST_INVALID' } });
      else throw error;
      return true;
    }
  };
}

