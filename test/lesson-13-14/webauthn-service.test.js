import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createWebAuthnCourseService } from '../../apps/project-app/lessons/13-14/webauthn-service.mjs';

function deterministicRandom() {
  let value = 0;
  return (size) => Buffer.alloc(size, value++ % 256);
}

function fakeProtocol() {
  const calls = { registrationOptions: [], registrationVerify: 0, authenticationVerify: 0 };
  return {
    calls,
    async generateRegistrationOptions(options) {
      calls.registrationOptions.push(options);
      return {
        rp: { id: options.rpID, name: options.rpName },
        user: {
          id: Buffer.from(options.userID).toString('base64url'),
          name: options.userName,
          displayName: options.userDisplayName,
        },
        challenge: Buffer.alloc(32, 9).toString('base64url'),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestationType,
        excludeCredentials: options.excludeCredentials,
      };
    },
    async verifyRegistrationResponse() {
      calls.registrationVerify += 1;
      return {
        verified: true,
        registrationInfo: {
          fmt: 'none',
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          credential: {
            id: 'credential-one',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
        },
      };
    },
    async generateAuthenticationOptions(options) {
      return {
        challenge: Buffer.alloc(32, 10).toString('base64url'),
        rpId: options.rpID,
        userVerification: options.userVerification,
        allowCredentials: options.allowCredentials,
      };
    },
    async verifyAuthenticationResponse() {
      calls.authenticationVerify += 1;
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      };
    },
  };
}

async function fixture({ now = 0 } = {}) {
  let timestamp = now;
  const protocol = fakeProtocol();
  const service = await createWebAuthnCourseService({
    lessonId: '13',
    expectedOrigin: 'http://localhost:3000',
    randomBytes: deterministicRandom(),
    clock: () => timestamp,
    protocol,
    passwordAuthenticator: {
      async authenticate(identifier, password) {
        return identifier === 'alice@example.com' && password === 'correct'
          ? { ok: true, principal: { id: 'user-alice' } }
          : { ok: false };
      },
    },
  });
  return { service, protocol, setTime(value) { timestamp = value; } };
}

test('user handle is a per-account 64-byte opaque random value, not a hash of the identifier', async () => {
  const { service, protocol } = await fixture();
  const login = await service.passwordLogin('alice@example.com', 'correct');
  const started = await service.startRegistration(login.sessionToken, login.csrfToken);
  const userID = Buffer.from(protocol.calls.registrationOptions[0].userID);
  assert.equal(userID.length, 64);
  assert.notDeepEqual(userID, createHash('sha256').update('alice@example.com').digest());
  assert.equal(started.options.user.id, userID.toString('base64url'));
  const observation = service.observe();
  assert.equal(observation.account.userHandle.byteLength, 64);
  assert.equal(observation.account.userHandle.containsPII, false);
  assert.equal(observation.account.userHandle.rawValue, 'omitted');
  assert.equal(JSON.stringify(observation).includes('alice@example.com'), false);
});

test('registration transaction is single-use and the RP stores only a verified credential', async () => {
  const { service, protocol } = await fixture();
  const login = await service.passwordLogin('alice@example.com', 'correct');
  const started = await service.startRegistration(login.sessionToken, login.csrfToken);
  const first = await service.finishRegistration(
    login.sessionToken,
    login.csrfToken,
    started.transactionId,
    {},
  );
  assert.equal(first.status, 201);
  assert.equal(service.observe().state.credentialCount, 1);
  const replay = await service.finishRegistration(
    login.sessionToken,
    login.csrfToken,
    started.transactionId,
    {},
  );
  assert.equal(replay.status, 422);
  assert.equal(protocol.calls.registrationVerify, 1);
  assert.equal(service.observe().state.credentialCount, 1);
});

test('expired registration transaction fails before credential verification or storage', async () => {
  const { service, protocol, setTime } = await fixture();
  const login = await service.passwordLogin('alice@example.com', 'correct');
  const started = await service.startRegistration(login.sessionToken, login.csrfToken);

  setTime(120_001);
  const result = await service.finishRegistration(
    login.sessionToken,
    login.csrfToken,
    started.transactionId,
    {},
  );

  assert.equal(result.status, 422);
  assert.equal(protocol.calls.registrationVerify, 0);
  assert.equal(service.observe().state.credentialCount, 0);
  assert.equal(
    service.observe().state.events.some(
      ({ type, reason }) => type === 'registration-rejected'
        && reason === 'TRANSACTION_OR_SESSION_INVALID',
    ),
    true,
  );
});

test('expired authentication transaction and mismatched user handle fail before signature verification', async () => {
  const { service, protocol, setTime } = await fixture();
  const login = await service.passwordLogin('alice@example.com', 'correct');
  const registration = await service.startRegistration(login.sessionToken, login.csrfToken);
  await service.finishRegistration(login.sessionToken, login.csrfToken, registration.transactionId, {});

  const expired = await service.startAuthentication({ identifier: 'alice@example.com' });
  setTime(120_001);
  const expiredResult = await service.finishAuthentication(expired.transactionId, {
    id: 'credential-one',
    response: { userHandle: Buffer.alloc(64).toString('base64url') },
  });
  assert.equal(expiredResult.status, 422);
  assert.equal(protocol.calls.authenticationVerify, 0);

  const mismatch = await service.startAuthentication({ identifier: 'alice@example.com' });
  const mismatchResult = await service.finishAuthentication(mismatch.transactionId, {
    id: 'credential-one',
    response: { userHandle: Buffer.alloc(64, 99).toString('base64url') },
  });
  assert.equal(mismatchResult.status, 422);
  assert.equal(protocol.calls.authenticationVerify, 0);
  assert.equal(
    service.observe().state.events.some(({ reason }) => reason === 'USER_HANDLE_MISMATCH'),
    true,
  );
});

test('missing user handle fails before authentication signature verification', async () => {
  const { service, protocol } = await fixture();
  const login = await service.passwordLogin('alice@example.com', 'correct');
  const registration = await service.startRegistration(login.sessionToken, login.csrfToken);
  await service.finishRegistration(login.sessionToken, login.csrfToken, registration.transactionId, {});

  const authentication = await service.startAuthentication({ identifier: 'alice@example.com' });
  const result = await service.finishAuthentication(authentication.transactionId, {
    id: 'credential-one',
    response: {},
  });

  assert.equal(result.status, 422);
  assert.equal(protocol.calls.authenticationVerify, 0);
  assert.equal(
    service.observe().state.events.some(
      ({ type, reason }) => type === 'authentication-rejected'
        && reason === 'USER_HANDLE_MISMATCH',
    ),
    true,
  );
});
