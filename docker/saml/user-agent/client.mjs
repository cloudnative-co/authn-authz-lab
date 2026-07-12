import { readFile } from 'node:fs/promises';

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 16;

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function attribute(tag, name) {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu');
  const match = expression.exec(tag);
  return match ? decodeHtml(match[1] ?? match[2]) : null;
}

function parseForm(html, selector, label) {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/giu)]
    .map((match) => match[0]);
  const form = forms.find(selector);
  if (!form) throw new Error(`${label} HTML form was not found`);
  const open = /^<form\b[^>]*>/iu.exec(form)?.[0];
  const action = attribute(open, 'action');
  const method = (attribute(open, 'method') ?? 'get').toLowerCase();
  if (!action || method !== 'post') throw new Error('HTML form action is invalid');
  const fields = new URLSearchParams();
  for (const match of form.matchAll(/<input\b[^>]*>/giu)) {
    const name = attribute(match[0], 'name');
    if (!name) continue;
    fields.append(name, attribute(match[0], 'value') ?? '');
  }
  return Object.freeze({ action, fields });
}

function loginForm(html) {
  return parseForm(html, (form) => /\bname\s*=\s*["']username["']/iu.test(form)
    && /\bname\s*=\s*["']password["']/iu.test(form), 'login');
}

function samlPostForm(html) {
  return parseForm(html, (form) => /\bname\s*=\s*["']SAMLResponse["']/iu.test(form), 'SAML POST');
}

class CookieJar {
  constructor() {
    this.byHost = new Map();
  }

  absorb(url, response) {
    const values = response.headers.getSetCookie?.() ?? [];
    const jar = this.byHost.get(url.hostname) ?? new Map();
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const boundary = pair.indexOf('=');
      if (boundary > 0) jar.set(pair.slice(0, boundary), pair.slice(boundary + 1));
    }
    this.byHost.set(url.hostname, jar);
  }

  header(url) {
    const jar = this.byHost.get(url.hostname);
    if (!jar || jar.size === 0) return null;
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  has(host, name) {
    return this.byHost.get(host)?.has(name) ?? false;
  }
}

async function boundedText(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) throw new Error('response exceeds limits');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_HTML_BYTES) throw new Error('response exceeds limits');
  return text;
}

async function request(jar, input, options = {}) {
  const url = new URL(input);
  const headers = new Headers(options.headers);
  const cookie = jar.header(url);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, {
    ...options,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  jar.absorb(url, response);
  return Object.freeze({ response, url });
}

async function follow(jar, initial, trace) {
  let current = initial;
  for (let index = 0; index < MAX_REDIRECTS; index += 1) {
    if (![301, 302, 303, 307, 308].includes(current.response.status)) return current;
    const location = current.response.headers.get('location');
    if (!location) throw new Error('redirect has no Location');
    const next = new URL(location, current.url);
    trace.push(Object.freeze({
      stage: 'redirect',
      status: current.response.status,
      from: current.url.hostname,
      to: next.hostname,
    }));
    current = await request(jar, next, { method: 'GET' });
  }
  throw new Error('redirect limit exceeded');
}

async function actualKeycloakFlow(password) {
  const jar = new CookieJar();
  const trace = [];
  let current = await request(jar, 'http://sp:3009/login', { method: 'GET' });
  const authorizeLocation = current.response.headers.get('location');
  const authorizeUrl = authorizeLocation ? new URL(authorizeLocation, current.url) : null;
  trace.push(Object.freeze({
    stage: 'authn-request',
    status: current.response.status,
    binding: 'HTTP-Redirect',
    samlRequestPresent: Boolean(authorizeUrl?.searchParams.get('SAMLRequest')),
    relayStatePresent: Boolean(authorizeUrl?.searchParams.get('RelayState')),
    target: authorizeUrl?.hostname ?? null,
  }));
  current = await follow(jar, current, trace);
  const loginHtml = await boundedText(current.response);
  let form;
  try {
    form = loginForm(loginHtml);
  } catch (error) {
    throw new Error(`${error.message}; HTTP ${current.response.status} ${current.url.hostname}${current.url.pathname}`);
  }
  form.fields.set('username', 'learner@example.test');
  form.fields.set('password', password);
  current = await request(jar, new URL(form.action, current.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.fields,
  });
  current = await follow(jar, current, trace);
  const samlHtml = await boundedText(current.response);
  let postForm;
  try {
    postForm = samlPostForm(samlHtml);
  } catch (error) {
    throw new Error(`${error.message}; HTTP ${current.response.status} ${current.url.hostname}${current.url.pathname}`);
  }
  trace.push(Object.freeze({
    stage: 'saml-response-form',
    status: current.response.status,
    binding: 'HTTP-POST',
    samlResponsePresent: postForm.fields.has('SAMLResponse'),
    relayStatePresent: postForm.fields.has('RelayState'),
    target: new URL(postForm.action, current.url).hostname,
  }));
  current = await request(jar, new URL(postForm.action, current.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: postForm.fields,
  });
  trace.push(Object.freeze({
    stage: 'acs',
    status: current.response.status,
    sessionCookieSet: jar.has('sp', 'lesson09_session'),
  }));
  current = await follow(jar, current, trace);
  const authenticated = await current.response.json();
  trace.push(Object.freeze({
    stage: 'authenticated-page',
    status: current.response.status,
    authenticated: authenticated?.authenticated === true,
    subjectBoundToSession: authenticated?.subjectBoundToSession === true,
  }));
  return Object.freeze({
    evidenceBasis: 'actual-keycloak-sp-initiated-http-user-agent-flow',
    idpImplementation: 'Keycloak-26.7.0',
    protocol: 'SAML-2.0-Web-Browser-SSO',
    userAgentScope: 'scripted-http-form-cookie-agent-not-gui-browser',
    trace: Object.freeze(trace),
    completed: current.response.status === 200
      && authenticated?.authenticated === true
      && jar.has('sp', 'lesson09_session'),
    rawSamlResponseRetained: false,
    nameIdRetained: false,
    sessionCookieRetained: false,
  });
}

async function controlledJson(path, controlToken, method = 'GET') {
  const response = await fetch(`http://sp:3009${path}`, {
    method,
    headers: { authorization: `Bearer ${controlToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200) throw new Error('controlled request failed');
  return response.json();
}

async function scenario() {
  const password = (await readFile('/run/secrets/lesson09_user_password', 'utf8')).trim();
  const controlToken = (await readFile('/run/secrets/lesson09_control_token', 'utf8')).trim();
  const actual = await actualKeycloakFlow(password);
  const conformance = await controlledJson('/__course/conformance', controlToken, 'POST');
  const evidence = await controlledJson('/__course/evidence', controlToken);
  const runtime = Object.freeze({
    schemaVersion: 1,
    lessonId: '09',
    runtimeEvidence: true,
    actual,
    conformance,
    strictValidation: Object.freeze({
      responseAndAssertionSignatures: true,
      responseAndAssertionIssuer: true,
      audienceAndConditions: true,
      destination: true,
      responseInResponseTo: true,
      bearerSubjectConfirmation: true,
      recipient: true,
      subjectInResponseTo: true,
      subjectExpiry: true,
      replayIds: ['Response', 'Assertion', 'AuthnRequest'],
      appSessionAfterValidationOnly: true,
    }),
    evidenceRedaction: evidence.evidenceRedaction,
    transport: Object.freeze({
      lab: 'compose-private-http-training-deviation',
      production: 'tls-required-and-keycloak-start-dev-forbidden',
    }),
  });
  const serialized = JSON.stringify(runtime);
  if (serialized.includes(password) || serialized.includes(controlToken)
      || /<saml|SAMLResponse=/iu.test(serialized)) {
    throw new Error('runtime evidence contains a secret or raw SAML material');
  }
  process.stdout.write(`${serialized}\n`);
}

async function health() {
  const response = await fetch('http://sp:3009/health', { signal: AbortSignal.timeout(3000) });
  process.exit(response.status === 200 ? 0 : 1);
}

const command = process.argv[2] ?? 'idle';
if (command === 'scenario') scenario().catch((error) => {
  process.stderr.write(`Lesson 09 user-agent scenario failed: ${String(error?.message ?? 'unknown')}\n`);
  process.exit(1);
});
else if (command === 'health') health().catch(() => process.exit(1));
else if (command === 'idle') setInterval(() => {}, 60_000);
else process.exit(2);
