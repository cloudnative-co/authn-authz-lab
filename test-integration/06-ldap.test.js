import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { authenticateWithDirectory } from '../src/auth/ldap.js';

// Requires the slapd container (`npm run compose:up`).
const LDAP = {
  url: process.env.LDAP_URL ?? 'ldap://localhost:1389',
  baseDn: process.env.LDAP_BASE_DN ?? 'dc=example,dc=test',
  bindDn: process.env.LDAP_BIND_DN ?? 'cn=admin,dc=example,dc=test',
  bindPassword: process.env.LDAP_BIND_PASSWORD ?? 'admin-password',
};

before(async () => {
  try {
    await authenticateWithDirectory({ ...LDAP, email: 'alice@example.com', password: 'password-alice' });
  } catch (error) {
    throw new Error(`LDAP not reachable at ${LDAP.url}. Run \`npm run compose:up\` first. (${error.message})`);
  }
});

test('06 ldap bind authenticates a valid user and returns group membership', async () => {
  const profile = await authenticateWithDirectory({ ...LDAP, email: 'alice@example.com', password: 'password-alice' });
  assert.ok(profile, 'expected a profile for alice');
  assert.equal(profile.dn, 'uid=alice,ou=people,dc=example,dc=test');
  assert.equal(profile.email, 'alice@example.com');
  assert.deepEqual([...profile.groups].sort(), ['engineering', 'security']);
});

test('06 ldap bind rejects a wrong password', async () => {
  const profile = await authenticateWithDirectory({ ...LDAP, email: 'alice@example.com', password: 'wrong-password' });
  assert.equal(profile, null);
});

test('06 ldap search escapes injection metacharacters in the filter', async () => {
  // Without escaping, "*)(uid=*" would turn the equality filter into a wildcard
  // match. ldapts escapes it to a literal, so no entry matches.
  const profile = await authenticateWithDirectory({ ...LDAP, email: '*)(uid=*', password: 'whatever' });
  assert.equal(profile, null);
});
