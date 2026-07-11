import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { WebAuthnService } from '../src/auth/webauthn.js';
import { decodeClientDataJSON, parseAuthenticatorData } from '../src/auth/webauthnInspect.js';

// Browser-free unit coverage: the wire-format inspectors and the shape of the
// generated options. The full register -> authenticate flow needs a real
// authenticator and is covered by the Playwright e2e suite.

test('13 parseAuthenticatorData reads the fixed 37-byte header', () => {
  const rpIdHash = createHash('sha256').update('localhost').digest();
  // flags 0x05 = UP (0x01) + UV (0x04); signCount = 42.
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.from([0x00, 0x00, 0x00, 0x2a])]);

  const parsed = parseAuthenticatorData(authData);
  assert.equal(parsed.rpIdHash, rpIdHash.toString('hex'));
  assert.equal(parsed.flags.userPresent, true);
  assert.equal(parsed.flags.userVerified, true);
  assert.equal(parsed.flags.backupEligible, false);
  assert.equal(parsed.signCount, 42);
});

test('13 decodeClientDataJSON parses the plain JSON client data', () => {
  const clientData = { type: 'webauthn.get', challenge: 'Y2hhbGxlbmdl', origin: 'http://localhost:3100' };
  const encoded = Buffer.from(JSON.stringify(clientData)).toString('base64url');
  assert.deepEqual(decodeClientDataJSON(encoded), clientData);
});

test('13 registration options carry a base64url challenge and rpID', async () => {
  const service = new WebAuthnService({ rpID: 'localhost' });
  const options = await service.startRegistration({ id: 'user_alice', email: 'alice@example.com' });
  assert.equal(options.rp.id, 'localhost');
  assert.equal(options.user.name, 'alice@example.com');
  assert.match(options.challenge, /^[A-Za-z0-9_-]+$/);
});

test('14 authentication options omit allowCredentials for discoverable login', async () => {
  const service = new WebAuthnService({ rpID: 'localhost' });
  const { options, challengeId } = await service.startAuthentication();
  assert.equal(options.rpId, 'localhost');
  assert.match(options.challenge, /^[A-Za-z0-9_-]+$/);
  assert.ok(!options.allowCredentials || options.allowCredentials.length === 0);
  assert.ok(challengeId);
});

test('13 an expired registration challenge is rejected', async () => {
  const service = new WebAuthnService({ rpID: 'localhost' });
  const user = { id: 'user_alice', email: 'alice@example.com' };
  await service.startRegistration(user, { now: 0 });
  // The registration challenge TTL is 60s.
  const result = await service.finishRegistration(user, {}, { expectedOrigin: 'http://localhost:3100', now: 60_001 });
  assert.equal(result.verified, false);
});

test('14 an assertion without a userHandle is rejected (discoverable login needs it)', async () => {
  const service = new WebAuthnService({ rpID: 'localhost' });
  service.credentials.set('cred-1', { userId: 'user_alice', credential: { id: 'cred-1', publicKey: new Uint8Array(), counter: 0 } });
  const { challengeId } = await service.startAuthentication({ now: 0 });
  const result = await service.finishAuthentication(
    challengeId,
    { id: 'cred-1', response: {} },
    { expectedOrigin: 'http://localhost:3100', now: 1000 },
  );
  assert.equal(result.verified, false);
});

test('14 an assertion whose userHandle does not match the credential account is rejected', async () => {
  const service = new WebAuthnService({ rpID: 'localhost' });
  service.credentials.set('cred-1', { userId: 'user_alice', credential: { id: 'cred-1', publicKey: new Uint8Array(), counter: 0 } });
  const { challengeId } = await service.startAuthentication({ now: 0 });
  const foreignHandle = Buffer.from('someone-else').toString('base64url');
  const result = await service.finishAuthentication(
    challengeId,
    { id: 'cred-1', response: { userHandle: foreignHandle } },
    { expectedOrigin: 'http://localhost:3100', now: 1000 },
  );
  assert.equal(result.verified, false);
});
