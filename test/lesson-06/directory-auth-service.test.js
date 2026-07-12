import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLesson06DirectoryAuthService,
  LESSON_06_GENERIC_FAILURE,
} from '../../apps/project-app/lessons/06/directory-auth-service.mjs';

const config = Object.freeze({
  url: 'ldap://127.0.0.1:1389',
  baseDn: 'dc=example,dc=test',
  peopleBaseDn: 'ou=people,dc=example,dc=test',
  groupsBaseDn: 'ou=groups,dc=example,dc=test',
  bindDn: 'uid=course-search,ou=service,dc=example,dc=test',
  bindPassword: 'service-password-value',
});

function escaped(value) {
  return value.replaceAll('\\', '\\5c').replaceAll('*', '\\2a').replaceAll('(', '\\28').replaceAll(')', '\\29');
}

function protocolFixture({ people = [], groups = [], invalidPassword = false } = {}) {
  const calls = [];
  const clients = [
    {
      async bind(dn, password) { calls.push({ operation: 'service-bind', dn, password }); },
      async search(base, options) {
        calls.push({ operation: 'search', base, options });
        return { searchEntries: base.startsWith('ou=people') ? people : groups };
      },
      async unbind() { calls.push({ operation: 'service-unbind' }); },
    },
    {
      async bind(dn, password) {
        calls.push({ operation: 'user-bind', dn, password });
        if (invalidPassword) {
          const error = new Error('invalid');
          error.name = 'InvalidCredentialsError';
          throw error;
        }
      },
      async unbind() { calls.push({ operation: 'user-unbind' }); },
    },
  ];
  const protocol = {
    createClient() { return clients.shift(); },
    userFilter(identifier) {
      return { kind: 'user-filter', identifier, toString: () => `(&(objectClass=inetOrgPerson)(mail=${escaped(identifier)}))` };
    },
    groupFilter(dn) {
      return { kind: 'group-filter', dn, toString: () => `(&(objectClass=groupOfNames)(member=${escaped(dn)}))` };
    },
    invalidCredentials(error) { return error.name === 'InvalidCredentialsError'; },
  };
  return { calls, protocolLoader: async () => protocol };
}

test('real protocol shape is service bind, user search, user DN bind, and group search', async () => {
  const fixture = protocolFixture({
    people: [{
      dn: 'uid=alice,ou=people,dc=example,dc=test',
      uid: 'alice',
      cn: 'Alice',
      mail: 'alice@example.com',
    }],
    groups: [{ cn: 'security' }, { cn: 'engineering' }],
  });
  const service = createLesson06DirectoryAuthService({ config, protocolLoader: fixture.protocolLoader });
  const result = await service.authenticate('ALICE@example.com', 'exact-password');
  assert.equal(result.status, 200);
  assert.deepEqual(result.principal.groups, ['engineering', 'security']);
  assert.deepEqual(
    fixture.calls.filter(({ operation }) => !operation.endsWith('unbind')).map(({ operation }) => operation),
    ['service-bind', 'search', 'user-bind', 'search'],
  );
  const searches = fixture.calls.filter(({ operation }) => operation === 'search');
  assert.equal(searches[0].options.sizeLimit, 2);
  assert.equal(searches[0].options.timeLimit, 2);
  assert.equal(searches[1].options.sizeLimit, 32);
  assert.equal(fixture.calls.find(({ operation }) => operation === 'user-bind').password, 'exact-password');
});

test('empty password is rejected before protocol loading or network client creation', async () => {
  let loaded = 0;
  const service = createLesson06DirectoryAuthService({
    config,
    protocolLoader: async () => { loaded += 1; throw new Error('must not load'); },
  });
  assert.deepEqual(await service.authenticate('alice@example.com', ''), LESSON_06_GENERIC_FAILURE);
  assert.equal(loaded, 0);
  assert.equal(service.observe().traces[0].networkReached, false);
});

test('wrong, unknown, and injection are generic while EqualityFilter escapes metacharacters', async () => {
  const wrongFixture = protocolFixture({
    people: [{ dn: 'uid=alice,ou=people,dc=example,dc=test', uid: 'alice', cn: 'Alice' }],
    invalidPassword: true,
  });
  const wrong = await createLesson06DirectoryAuthService({
    config, protocolLoader: wrongFixture.protocolLoader,
  }).authenticate('alice@example.com', 'wrong');

  const unknownFixture = protocolFixture();
  const unknown = await createLesson06DirectoryAuthService({
    config, protocolLoader: unknownFixture.protocolLoader,
  }).authenticate('unknown@example.com', 'wrong');

  const injectionFixture = protocolFixture();
  const injectionService = createLesson06DirectoryAuthService({
    config, protocolLoader: injectionFixture.protocolLoader,
  });
  const injection = await injectionService.authenticate('*)(uid=*', 'wrong');
  assert.deepEqual(wrong, LESSON_06_GENERIC_FAILURE);
  assert.deepEqual(unknown, LESSON_06_GENERIC_FAILURE);
  assert.deepEqual(injection, LESSON_06_GENERIC_FAILURE);
  const filter = injectionFixture.calls.find(({ operation }) => operation === 'search').options.filter.toString();
  assert.match(filter, /\\2a\\29\\28uid=\\2a/u);
  assert.doesNotMatch(filter, /\*\)\(uid=\*/u);
  assert.equal(injectionService.observe().traces[0].filterEscaped, true);
});

test('LDAP bind password bytes are not NFC-normalized by the application', async () => {
  const decomposed = 'Cafe\u0301-password';
  const fixture = protocolFixture({
    people: [{ dn: 'uid=alice,ou=people,dc=example,dc=test', uid: 'alice', cn: 'Alice' }],
  });
  const service = createLesson06DirectoryAuthService({ config, protocolLoader: fixture.protocolLoader });
  await service.authenticate('alice@example.com', decomposed);
  assert.equal(fixture.calls.find(({ operation }) => operation === 'user-bind').password, decomposed);
  assert.notEqual(decomposed, decomposed.normalize('NFC'));
});

test('observations omit raw identifier, passwords, and bind credentials', async () => {
  const fixture = protocolFixture();
  const service = createLesson06DirectoryAuthService({ config, protocolLoader: fixture.protocolLoader });
  await service.authenticate('*)(uid=*', 'sensitive-password');
  const observed = JSON.stringify(service.observe());
  for (const forbidden of ['*)(uid=*', 'sensitive-password', config.bindPassword, config.bindDn]) {
    assert.equal(observed.includes(forbidden), false);
  }
});
