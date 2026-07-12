import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  AndFilter,
  Attribute,
  Change,
  Client,
  EqualityFilter,
  InsufficientAccessError,
  PresenceFilter,
} from 'ldapts';

import {
  authenticateDirectoryLogin,
  validLesson08Password,
  validLesson08Principal,
} from './directory-login-flow.mjs';

const PORT = Number(process.env.PORT ?? '3008');
const LDAP_URL = 'ldaps://dc.ad.example.test:636';
const LDAP_SERVER_NAME = 'dc.ad.example.test';
const BASE_DN = 'DC=ad,DC=example,DC=test';
const SERVICE_DN = 'svc-course@AD.EXAMPLE.TEST';
const MAX_BODY_BYTES = 4096;
const SESSION_TTL_MS = 15 * 60_000;
const ROLE_MAPPING = Object.freeze(new Map([
  ['CourseAppViewer', 'viewer'],
  ['CourseAppEditor', 'editor'],
]));
const ORGANIZATION_GROUP = 'Engineering';
const sessions = new Map();

async function readSecret(path) {
  const value = await readFile(path, 'utf8');
  if (Buffer.byteLength(value, 'utf8') < 20
      || Buffer.byteLength(value, 'utf8') > 256
      || /[\u0000\r\n]/u.test(value)) {
    throw new Error('runtime secret is invalid');
  }
  return value;
}

const [ca, servicePassword, stableIdKey, controlToken] = await Promise.all([
  readFile('/ca-public/ca.crt'),
  readSecret('/run/secrets/lesson08_service_password'),
  readSecret('/run/secrets/lesson08_stable_id_key'),
  readSecret('/run/secrets/lesson08_control_token'),
]);

function directoryClient() {
  return new Client({
    url: LDAP_URL,
    connectTimeout: 3000,
    timeout: 5000,
    tlsOptions: {
      ca: [ca],
      servername: LDAP_SERVER_NAME,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  });
}

async function withClient(operation) {
  const client = directoryClient();
  try {
    return await operation(client);
  } finally {
    if (client.isConnected) await client.unbind().catch(() => undefined);
  }
}

function singleString(value, name) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 512) {
    throw new Error(`${name} is invalid`);
  }
  return candidate;
}

function singleBuffer(value, name) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!Buffer.isBuffer(candidate) || candidate.length !== 16) throw new Error(`${name} is invalid`);
  return candidate;
}

function opaqueStableId(objectGuid) {
  return `usr_${createHmac('sha256', stableIdKey).update(objectGuid).digest('base64url').slice(0, 24)}`;
}

function userRecord(entry) {
  const objectGuid = singleBuffer(entry.objectGUID, 'objectGUID');
  const userAccountControl = Number(singleString(entry.userAccountControl, 'userAccountControl'));
  if (!Number.isSafeInteger(userAccountControl)) throw new Error('userAccountControl is invalid');
  return Object.freeze({
    dn: singleString(entry.dn, 'dn'),
    objectGuid,
    stableId: opaqueStableId(objectGuid),
    disabled: (userAccountControl & 2) === 2,
  });
}

async function searchUserByPrincipal(client, principal) {
  const result = await client.search(BASE_DN, {
    scope: 'sub',
    sizeLimit: 2,
    timeLimit: 5,
    filter: new AndFilter({ filters: [
      new EqualityFilter({ attribute: 'objectClass', value: 'user' }),
      new EqualityFilter({ attribute: 'userPrincipalName', value: principal }),
    ] }),
    attributes: ['objectGUID', 'userAccountControl'],
    explicitBufferAttributes: ['objectGUID'],
  });
  if (result.searchEntries.length !== 1) return null;
  return userRecord(result.searchEntries[0]);
}

async function searchUserByGuid(client, objectGuid) {
  const result = await client.search(BASE_DN, {
    scope: 'sub',
    sizeLimit: 2,
    timeLimit: 5,
    filter: new AndFilter({ filters: [
      new EqualityFilter({ attribute: 'objectClass', value: 'user' }),
      new EqualityFilter({ attribute: 'objectGUID', value: objectGuid }),
    ] }),
    attributes: ['objectGUID', 'userAccountControl'],
    explicitBufferAttributes: ['objectGUID'],
  });
  if (result.searchEntries.length !== 1) return null;
  return userRecord(result.searchEntries[0]);
}

async function searchGroups(client, userDn) {
  const result = await client.search(BASE_DN, {
    scope: 'sub',
    sizeLimit: 16,
    timeLimit: 5,
    filter: new AndFilter({ filters: [
      new EqualityFilter({ attribute: 'objectClass', value: 'group' }),
      new EqualityFilter({ attribute: 'member', value: userDn }),
    ] }),
    attributes: ['cn'],
  });
  return result.searchEntries.map((entry) => singleString(entry.cn, 'cn')).sort();
}

function mappedRoles(groups) {
  return [...new Set(groups.map((group) => ROLE_MAPPING.get(group)).filter(Boolean))].sort();
}

async function resolveDirectoryStateByPrincipal(principal) {
  return withClient(async (client) => {
    await client.bind(SERVICE_DN, servicePassword);
    const user = await searchUserByPrincipal(client, principal);
    if (!user) return null;
    const groups = await searchGroups(client, user.dn);
    return Object.freeze({ ...user, groups, roles: mappedRoles(groups) });
  });
}

async function resolveDirectoryStateByGuid(objectGuid) {
  return withClient(async (client) => {
    await client.bind(SERVICE_DN, servicePassword);
    const user = await searchUserByGuid(client, objectGuid);
    if (!user) return null;
    const groups = await searchGroups(client, user.dn);
    return Object.freeze({ ...user, groups, roles: mappedRoles(groups) });
  });
}

async function bindResolvedUser(userDn, password) {
  return withClient(async (client) => client.bind(userDn, password));
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object is required');
  return value;
}

function sessionToken(request) {
  const header = request.headers.authorization;
  const match = typeof header === 'string' ? /^Session ([A-Za-z0-9_-]{32,128})$/u.exec(header) : null;
  return match?.[1] ?? null;
}

function activeSession(request) {
  const token = sessionToken(request);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return { token, session };
}

function controlAuthorized(request) {
  const supplied = request.headers['x-course-control'];
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(controlToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function health() {
  await withClient(async (client) => {
    await client.bind(SERVICE_DN, servicePassword);
    const result = await client.search(BASE_DN, {
      scope: 'base',
      sizeLimit: 1,
      timeLimit: 5,
      filter: new PresenceFilter({ attribute: 'objectClass' }),
      attributes: ['1.1'],
    });
    if (result.searchEntries.length !== 1) throw new Error('directory base is unavailable');
  });
}

async function login(request, response) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    send(response, 422, { code: 'DIRECTORY_AUTH_FAILED' });
    return;
  }
  if (!validLesson08Principal(body.principal) || !validLesson08Password(body.password)) {
    send(response, 422, { code: 'DIRECTORY_AUTH_FAILED' });
    return;
  }
  try {
    const authentication = await withClient(async (serviceClient) => authenticateDirectoryLogin({
      principal: body.principal,
      password: body.password,
      bindService: () => serviceClient.bind(SERVICE_DN, servicePassword),
      searchUser: (principal) => searchUserByPrincipal(serviceClient, principal),
      bindResolvedUser,
      searchGroups: (userDn) => searchGroups(serviceClient, userDn),
      mapRoles: mappedRoles,
    }));
    if (!authentication.authenticated) throw new Error('generic rejection');
    const state = authentication.state;
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, {
      directoryDn: state.dn,
      objectGuid: Buffer.from(state.objectGuid),
      stableId: state.stableId,
      groups: state.groups,
      roles: state.roles,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    send(response, 200, {
      code: 'DIRECTORY_AUTHENTICATED',
      sessionToken: token,
      principal: { stableId: state.stableId, roles: state.roles },
      protocol: {
        transport: 'LDAPS',
        caVerified: true,
        hostnameVerified: true,
        operations: authentication.operations,
      },
    });
  } catch {
    send(response, 422, { code: 'DIRECTORY_AUTH_FAILED' });
  }
}

function readSession(request, response) {
  const active = activeSession(request);
  if (!active) {
    send(response, 401, { code: 'APP_SESSION_INVALID' });
    return;
  }
  send(response, 200, {
    code: 'APP_SESSION_ACTIVE',
    principal: { stableId: active.session.stableId, roles: active.session.roles },
  });
}

async function revalidate(request, response) {
  const active = activeSession(request);
  if (!active) {
    send(response, 401, { code: 'APP_SESSION_INVALID' });
    return;
  }
  try {
    const current = await resolveDirectoryStateByGuid(active.session.objectGuid);
    const stableIdPreserved = current?.stableId === active.session.stableId;
    const directoryLocationChanged = current ? current.dn !== active.session.directoryDn : false;
    if (!current || current.disabled) {
      sessions.delete(active.token);
      send(response, 409, {
        code: 'APP_SESSION_REVOKED',
        reason: 'DIRECTORY_ACCOUNT_DISABLED',
        stableIdPreserved,
        directoryLocationChanged,
      });
      return;
    }
    if (!sameStrings(current.roles, active.session.roles)) {
      sessions.delete(active.token);
      send(response, 409, {
        code: 'APP_SESSION_REVOKED',
        reason: 'DIRECTORY_ROLE_CHANGED',
        stableIdPreserved,
        directoryLocationChanged,
      });
      return;
    }
    active.session.directoryDn = current.dn;
    active.session.groups = current.groups;
    send(response, 200, {
      code: 'APP_SESSION_REVALIDATED',
      stableIdPreserved,
      directoryLocationChanged,
    });
  } catch {
    send(response, 503, { code: 'DIRECTORY_REVALIDATION_UNAVAILABLE' });
  }
}

async function probeServiceWrite(request, response) {
  try {
    const state = await resolveDirectoryStateByPrincipal('alice@AD.EXAMPLE.TEST');
    if (!state) throw new Error('user missing');
    const outcome = await withClient(async (client) => {
      await client.bind(SERVICE_DN, servicePassword);
      try {
        await client.modify(state.dn, [new Change({
          operation: 'replace',
          modification: new Attribute({ type: 'description', values: ['must-not-be-written'] }),
        })]);
        return 'WRITE_SUCCEEDED';
      } catch (error) {
        return error instanceof InsufficientAccessError ? 'INSUFFICIENT_ACCESS' : 'OTHER_REJECTION';
      }
    });
    if (outcome !== 'INSUFFICIENT_ACCESS') {
      send(response, 500, { code: 'SERVICE_ACCOUNT_BOUNDARY_FAILED', outcome });
      return;
    }
    send(response, 200, { code: 'SERVICE_ACCOUNT_WRITE_REJECTED', outcome });
  } catch {
    send(response, 500, { code: 'SERVICE_ACCOUNT_PROBE_FAILED' });
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      await health();
      send(response, 200, {
        status: 'ok',
        implementation: 'Samba AD-compatible DC over verified LDAPS',
        notMicrosoftAdDs: true,
        notFreeIpaRuntime: true,
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/login') return await login(request, response);
    if (request.method === 'GET' && request.url === '/session') return readSession(request, response);
    if (request.method === 'POST' && request.url === '/session/revalidate') {
      return await revalidate(request, response);
    }
    if (request.method === 'POST' && request.url === '/service-account/write-probe') {
      return await probeServiceWrite(request, response);
    }
    if (request.method === 'GET' && request.url === '/policy') {
      send(response, 200, {
        mapping: [...ROLE_MAPPING].map(([directoryGroup, appRole]) => ({ directoryGroup, appRole })),
        organizationGroupIgnored: ORGANIZATION_GROUP,
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/__course/reset') {
      if (!controlAuthorized(request)) {
        send(response, 404, { code: 'NOT_FOUND' });
        return;
      }
      sessions.clear();
      send(response, 200, { code: 'COURSE_STATE_RESET' });
      return;
    }
    send(response, 404, { code: 'NOT_FOUND' });
  } catch {
    send(response, 503, { code: 'DIRECTORY_APP_UNAVAILABLE' });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 12_000;
server.listen(PORT, '0.0.0.0');
