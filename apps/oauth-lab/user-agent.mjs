import { randomOpaque } from './crypto.mjs';
import { TRAINING_RESOURCE_OWNER } from './resource-owner.mjs';

function hiddenRequest(html) {
  const match = /<input type="hidden" name="ref" value="([A-Za-z0-9_-]{43})">/u.exec(html);
  if (!match) throw new Error('browser could not find the server-side request reference');
  return match[1];
}

export function createCookieJarUserAgent({ scenarioId = null } = {}) {
  const jars = new Map();

  function cookieHeader(origin) {
    const jar = jars.get(origin);
    if (!jar || jar.size === 0) return undefined;
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function receiveCookies(origin, headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
    if (values.length === 0) return;
    const jar = jars.get(origin) ?? new Map();
    for (const value of values) {
      const first = value.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator < 1) continue;
      jar.set(first.slice(0, separator), first.slice(separator + 1));
    }
    jars.set(origin, jar);
  }

  async function request(url, options = {}) {
    const target = new URL(url);
    const headers = new Headers(options.headers);
    if (scenarioId) headers.set('x-course-scenario-id', scenarioId);
    const stored = cookieHeader(target.origin);
    if (stored) headers.set('cookie', stored);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(target, {
        ...options,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      receiveCookies(target.origin, response.headers);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ request });
}

export async function runBrowserAuthorizationFlow({
  config,
  lessonId,
  scope,
  projectId,
  tamperState = false,
  scenarioId = null,
  userAgent = createCookieJarUserAgent({ scenarioId }),
  resourceOwner = TRAINING_RESOURCE_OWNER,
} = {}) {
  const start = new URL(`/lesson/${lessonId}/start`, config.clientOrigin);
  if (scope) start.searchParams.set('scope', scope);
  if (projectId) start.searchParams.set('project', projectId);
  const started = await userAgent.request(start);
  const authorizationLocation = started.headers.get('location');
  const authorize = await userAgent.request(authorizationLocation);
  const loginReference = hiddenRequest(await authorize.text());
  const loggedIn = await userAgent.request(`${config.issuer}/interaction/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ref: loginReference,
      identifier: resourceOwner.identifier,
      password: resourceOwner.password,
    }),
  });
  const consent = await userAgent.request(loggedIn.headers.get('location'));
  const consentReference = hiddenRequest(await consent.text());
  const granted = await userAgent.request(`${config.issuer}/interaction/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ref: consentReference, decision: 'allow' }),
  });
  const callback = new URL(granted.headers.get('location'));
  if (tamperState) callback.searchParams.set('state', randomOpaque());
  const callbackResponse = await userAgent.request(callback);
  if (lessonId === '11' && callbackResponse.status === 302) {
    const authenticated = await userAgent.request(callbackResponse.headers.get('location'));
    return Object.freeze({
      statuses: Object.freeze({
        start: started.status,
        authorize: authorize.status,
        login: loggedIn.status,
        consent: consent.status,
        grant: granted.status,
        callback: callbackResponse.status,
        final: authenticated.status,
      }),
      callbackOutcome: callbackResponse.headers.get('x-course-outcome'),
      resourceStatus: callbackResponse.headers.get('x-course-resource-status'),
      resourceChallenge: callbackResponse.headers.get('x-course-resource-challenge'),
      finalBody: await authenticated.text(),
    });
  }
  return Object.freeze({
    statuses: Object.freeze({
      start: started.status,
      authorize: authorize.status,
      login: loggedIn.status,
      consent: consent.status,
      grant: granted.status,
      callback: callbackResponse.status,
      final: callbackResponse.status,
    }),
    callbackOutcome: callbackResponse.headers.get('x-course-outcome'),
    resourceStatus: callbackResponse.headers.get('x-course-resource-status'),
    resourceChallenge: callbackResponse.headers.get('x-course-resource-challenge'),
    finalBody: await callbackResponse.text(),
  });
}
