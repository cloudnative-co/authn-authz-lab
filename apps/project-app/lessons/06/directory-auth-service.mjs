const INVALID_DIRECTORY_CREDENTIALS = Object.freeze({
  ok: false,
  status: 422,
  code: 'DIRECTORY_AUTH_FAILED',
  message: 'Directory authentication failed.',
});
const DIRECTORY_UNAVAILABLE = Object.freeze({
  ok: false,
  status: 503,
  code: 'DIRECTORY_UNAVAILABLE',
  message: 'Directory authentication is temporarily unavailable.',
  retryAfterSeconds: 1,
  headers: Object.freeze({ 'retry-after': '1' }),
});
const MAX_IDENTIFIER_BYTES = 254;
const MAX_PASSWORD_BYTES = 1024;
const MAX_TRACES = 8;

function asString(value) {
  if (Array.isArray(value)) return value[0]?.toString();
  return value?.toString();
}

function canonicalIdentifier(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC').toLowerCase();
  if (normalized.length === 0
      || Buffer.byteLength(normalized, 'utf8') > MAX_IDENTIFIER_BYTES
      || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

function canonicalPassword(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES || /\u0000/u.test(value)) return null;
  return value;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config is required');
  let url;
  try {
    url = new URL(config.url);
  } catch (error) {
    throw new TypeError('config.url is invalid', { cause: error });
  }
  if (url.protocol !== 'ldap:'
      || url.hostname !== '127.0.0.1'
      || !url.port
      || url.username
      || url.password
      || !['', '/'].includes(url.pathname)
      || url.search
      || url.hash) {
    throw new TypeError('config.url must be an exact loopback ldap URL');
  }
  for (const name of ['baseDn', 'peopleBaseDn', 'groupsBaseDn', 'bindDn', 'bindPassword']) {
    if (typeof config[name] !== 'string'
        || config[name].length < 3
        || config[name].length > 1024
        || /[\u0000\r\n]/u.test(config[name])) {
      throw new TypeError(`config.${name} is invalid`);
    }
  }
  return Object.freeze({
    url: url.href,
    baseDn: config.baseDn,
    peopleBaseDn: config.peopleBaseDn,
    groupsBaseDn: config.groupsBaseDn,
    bindDn: config.bindDn,
    bindPassword: config.bindPassword,
  });
}

async function defaultProtocolLoader() {
  const {
    AndFilter,
    Client,
    EqualityFilter,
    InvalidCredentialsError,
  } = await import('ldapts');
  return Object.freeze({
    createClient: (url) => new Client({
      url,
      connectTimeout: 2_000,
      timeout: 3_000,
      strictDN: true,
    }),
    userFilter: (identifier) => new AndFilter({
      filters: [
        new EqualityFilter({ attribute: 'objectClass', value: 'inetOrgPerson' }),
        new EqualityFilter({ attribute: 'mail', value: identifier }),
      ],
    }),
    groupFilter: (dn) => new AndFilter({
      filters: [
        new EqualityFilter({ attribute: 'objectClass', value: 'groupOfNames' }),
        new EqualityFilter({ attribute: 'member', value: dn }),
      ],
    }),
    invalidCredentials: (error) => error instanceof InvalidCredentialsError,
  });
}

function validateProtocol(protocol) {
  if (!protocol || typeof protocol !== 'object') throw new TypeError('LDAP protocol adapter is invalid');
  for (const method of ['createClient', 'userFilter', 'groupFilter', 'invalidCredentials']) {
    if (typeof protocol[method] !== 'function') throw new TypeError(`LDAP protocol.${method} is required`);
  }
  return protocol;
}

function operation(kind, fields) {
  return Object.freeze({ kind, ...fields });
}

function traceRecord({ outcome, networkReached, operations, filterEscaped = null }) {
  return Object.freeze({
    outcome,
    networkReached,
    filterConstruction: filterEscaped === null ? null : 'structured-equality-filter',
    filterEscaped,
    operations: Object.freeze([...operations]),
  });
}

export function createLesson06DirectoryAuthService({
  config,
  protocolLoader = defaultProtocolLoader,
} = {}) {
  const directory = validateConfig(config);
  if (typeof protocolLoader !== 'function') throw new TypeError('protocolLoader must be a function');
  const traces = [];
  const counters = {
    attempts: 0,
    networkAttempts: 0,
    successes: 0,
    genericFailures: 0,
    unavailable: 0,
  };

  function remember(trace) {
    traces.push(trace);
    if (traces.length > MAX_TRACES) traces.shift();
  }

  async function authenticate(identifierInput, passwordInput) {
    counters.attempts += 1;
    const identifier = canonicalIdentifier(identifierInput);
    const password = canonicalPassword(passwordInput);
    if (identifier === null || password === null) {
      counters.genericFailures += 1;
      remember(traceRecord({ outcome: 'input-rejected', networkReached: false, operations: [] }));
      return INVALID_DIRECTORY_CREDENTIALS;
    }

    let searchClient;
    let authClient;
    const operations = [];
    try {
      const protocol = validateProtocol(await protocolLoader());
      const userFilter = protocol.userFilter(identifier);
      const filterText = String(userFilter);
      const containsMetacharacters = /[()*\\]/u.test(identifier);
      const filterEscaped = !containsMetacharacters || !filterText.includes(identifier);
      searchClient = protocol.createClient(directory.url);
      authClient = protocol.createClient(directory.url);
      counters.networkAttempts += 1;

      await searchClient.bind(directory.bindDn, directory.bindPassword);
      operations.push(operation('bind', {
        actor: 'read-only-service-account',
        dnRole: 'service-account-dn',
        result: 'success',
      }));
      const { searchEntries } = await searchClient.search(directory.peopleBaseDn, {
        scope: 'sub',
        filter: userFilter,
        attributes: ['uid', 'cn', 'mail'],
        sizeLimit: 2,
        timeLimit: 2,
      });
      operations.push(operation('search', {
        baseDnRole: 'people-base-dn',
        equalityAttribute: 'mail',
        returnedAttributeRoles: Object.freeze(['uid', 'cn', 'mail']),
        sizeLimit: 2,
        timeLimitSeconds: 2,
        result: searchEntries.length === 1 ? 'one-entry' : 'no-unique-entry',
      }));
      if (searchEntries.length !== 1) {
        counters.genericFailures += 1;
        remember(traceRecord({
          outcome: 'generic-failure',
          networkReached: true,
          filterEscaped,
          operations,
        }));
        return INVALID_DIRECTORY_CREDENTIALS;
      }

      const entry = searchEntries[0];
      try {
        await authClient.bind(entry.dn, password);
      } catch (error) {
        if (!protocol.invalidCredentials(error)) throw error;
        operations.push(operation('bind', {
          actor: 'resolved-user',
          dnRole: 'user-entry-dn',
          result: 'invalid-credentials',
        }));
        counters.genericFailures += 1;
        remember(traceRecord({
          outcome: 'generic-failure',
          networkReached: true,
          filterEscaped,
          operations,
        }));
        return INVALID_DIRECTORY_CREDENTIALS;
      }
      operations.push(operation('bind', {
        actor: 'resolved-user',
        dnRole: 'user-entry-dn',
        result: 'success',
      }));

      const groupFilter = protocol.groupFilter(entry.dn);
      const { searchEntries: groupEntries } = await searchClient.search(directory.groupsBaseDn, {
        scope: 'sub',
        filter: groupFilter,
        attributes: ['cn'],
        sizeLimit: 32,
        timeLimit: 2,
      });
      operations.push(operation('search', {
        baseDnRole: 'groups-base-dn',
        equalityAttribute: 'member',
        equalityValueRole: 'user-entry-dn',
        returnedAttributeRoles: Object.freeze(['cn']),
        sizeLimit: 32,
        timeLimitSeconds: 2,
        result: 'entries-returned',
      }));
      const groups = groupEntries
        .map((group) => asString(group.cn))
        .filter((value) => typeof value === 'string')
        .sort();
      const uid = asString(entry.uid);
      const displayName = asString(entry.cn);
      if (!uid || !displayName || typeof entry.dn !== 'string') {
        throw new TypeError('LDAP entry is missing required attributes');
      }
      counters.successes += 1;
      remember(traceRecord({
        outcome: 'success',
        networkReached: true,
        filterEscaped,
        operations,
      }));
      return Object.freeze({
        ok: true,
        status: 200,
        code: 'DIRECTORY_AUTHENTICATED',
        principal: Object.freeze({
          id: uid,
          displayName,
          directoryDn: entry.dn,
          groups: Object.freeze(groups),
        }),
      });
    } catch {
      counters.unavailable += 1;
      remember(traceRecord({
        outcome: 'directory-unavailable',
        networkReached: searchClient !== undefined,
        operations,
      }));
      return DIRECTORY_UNAVAILABLE;
    } finally {
      await searchClient?.unbind().catch(() => {});
      await authClient?.unbind().catch(() => {});
    }
  }

  function observe() {
    return structuredClone({
      schemaVersion: 1,
      lessonId: '06',
      implementation: {
        protocol: 'LDAPv3-simple-bind-and-search',
        userLookup: 'read-only-service-account-search',
        userAuthentication: 'resolved-user-dn-simple-bind',
        groupLookup: 'groupOfNames-member-equality-search',
        filterConstruction: 'ldapts-structured-equality-filter',
        userSearchLimits: { sizeLimit: 2, timeLimitSeconds: 2 },
        groupSearchLimits: { sizeLimit: 32, timeLimitSeconds: 2 },
        adminBindUsed: false,
        transportContext: 'loopback-ldap-training-deviation',
        productionRequirement: 'StartTLS-or-LDAPS-with-certificate-validation',
      },
      counters,
      traces,
      redaction: {
        rawIdentifier: 'omitted',
        password: 'omitted',
        bindPassword: 'omitted',
        connectionControl: 'omitted',
      },
    });
  }

  return Object.freeze({ authenticate, observe });
}

export const LESSON_06_GENERIC_FAILURE = INVALID_DIRECTORY_CREDENTIALS;
