import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createLesson02PasswordService } from '../../apps/project-app/lessons/02/password-auth-service.mjs';

function fakeKdf() {
  let saltSequence = 0;
  const verificationCredentials = [];
  return {
    verificationCredentials,
    async hash(password) {
      const salt = `salt-${++saltSequence}`;
      const digest = createHash('sha256').update(`${salt}\u0000${password.normalize('NFC')}`).digest('hex');
      return `fake:${salt}:${digest}`;
    },
    async verify(password, encoded) {
      verificationCredentials.push(encoded.split(':')[1]);
      const [, salt, digest] = encoded.split(':');
      const candidate = createHash('sha256')
        .update(`${salt}\u0000${password.normalize('NFC')}`)
        .digest('hex');
      return candidate === digest;
    },
    inspect(encoded) {
      const [, salt] = encoded.split(':');
      return {
        format: 'fake-scrypt',
        version: 1,
        workFactor: { N: 32768, r: 8, p: 3 },
        keyLength: 32,
        saltBytes: 16,
        saltFingerprint: salt,
      };
    },
  };
}

async function serviceFixture(overrides = {}) {
  const kdf = overrides.kdf ?? fakeKdf();
  const service = await createLesson02PasswordService({
    clock: overrides.clock ?? (() => 0),
    kdf,
    alice: {
      id: 'user-alice',
      identifier: 'alice@example.com',
      password: 'Alice secret passphrase',
    },
    dummyPassword: 'Dummy secret passphrase',
    ...(overrides.rateLimit ? { rateLimit: overrides.rateLimit } : {}),
  });
  return { kdf, service };
}

test('Alice authenticates without issuing a session and dummy derivations use different salts', async () => {
  const { service } = await serviceFixture();
  const result = await service.authenticate('Alice@Example.com', 'Alice secret passphrase');
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    code: 'AUTHENTICATED',
    principal: { id: 'user-alice', identifier: 'alice@example.com' },
    sessionIssued: false,
  });

  const observation = service.observe();
  assert.equal(observation.seed.dummySaltDemonstration.sameInput, true);
  assert.equal(observation.seed.dummySaltDemonstration.saltsDiffer, true);
  assert.notEqual(
    observation.seed.dummySaltDemonstration.first.saltFingerprint,
    observation.seed.dummySaltDemonstration.second.saltFingerprint,
  );
  assert.equal(observation.implementation.sessionIssuance, 'not-implemented');
});

test('wrong and unknown users receive the same generic failure while unknown users use the dummy hash', async () => {
  const { kdf, service } = await serviceFixture();
  const wrong = await service.authenticate('alice@example.com', 'wrong password');
  const unknown = await service.authenticate('nobody@example.com', 'wrong password');

  assert.deepEqual(unknown, wrong);
  assert.deepEqual(wrong, {
    ok: false,
    status: 422,
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid identifier or password.',
    sessionIssued: false,
  });
  assert.deepEqual(kdf.verificationCredentials, ['salt-1', 'salt-2']);
});

test('structurally invalid password input still performs one bounded comparison', async () => {
  const { kdf, service } = await serviceFixture();
  const empty = await service.authenticate('alice@example.com', '');
  const nonString = await service.authenticate('nobody@example.com', null);
  assert.deepEqual(empty, nonString);
  assert.equal(empty.status, 422);
  assert.deepEqual(kdf.verificationCredentials, ['salt-1', 'salt-2']);
});

test('three failures block for 30 seconds with integer Retry-After semantics', async () => {
  let timestamp = 0;
  const { service } = await serviceFixture({ clock: () => timestamp });

  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  const threshold = await service.authenticate('alice@example.com', 'wrong');
  assert.equal(threshold.status, 429);
  assert.equal(threshold.retryAfterSeconds, 30);
  assert.equal(threshold.headers['retry-after'], '30');

  timestamp = 1_001;
  const blocked = await service.authenticate('alice@example.com', 'Alice secret passphrase');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfterSeconds, 29);

  timestamp = 30_000;
  assert.equal((await service.authenticate('alice@example.com', 'Alice secret passphrase')).status, 200);
});

test('concurrent failures serialize before KDF work and cannot bypass the threshold', async () => {
  const { kdf, service } = await serviceFixture();
  const results = await Promise.all(Array.from(
    { length: 100 },
    () => service.authenticate('alice@example.com', 'wrong'),
  ));
  assert.deepEqual(results.map(({ status }) => status).sort(), [422, 422, ...Array(98).fill(429)]);
  assert.equal(kdf.verificationCredentials.length, 3);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 429);
  assert.equal(kdf.verificationCredentials.length, 3);
});

test('a correct password queued behind threshold failures is rate-limited without extra KDF work', async () => {
  const { kdf, service } = await serviceFixture();
  const results = await Promise.all([
    ...Array.from(
      { length: 99 },
      () => service.authenticate('alice@example.com', 'wrong'),
    ),
    service.authenticate('alice@example.com', 'Alice secret passphrase'),
  ]);
  assert.equal(results.filter(({ status }) => status === 200).length, 0);
  assert.equal(results.at(-1).status, 429);
  assert.equal(kdf.verificationCredentials.length, 3);
});

test('successful authentication resets failures and old failure windows expire', async () => {
  let timestamp = 0;
  const { service } = await serviceFixture({ clock: () => timestamp });

  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'Alice secret passphrase')).status, 200);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 429);

  timestamp = 60_000;
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  timestamp = 90_000;
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 422);
  assert.equal((await service.authenticate('alice@example.com', 'wrong')).status, 429);
});

test('observation and public service surface retain no seed plaintext or encoded credentials', async () => {
  const { service } = await serviceFixture();
  await service.authenticate('nobody@example.com', 'presented secret');
  const publicText = JSON.stringify({ service, observation: service.observe() });

  for (const secret of [
    'alice@example.com',
    'Alice secret passphrase',
    'Dummy secret passphrase',
    'presented secret',
    'fake:salt-',
  ]) {
    assert.equal(publicText.includes(secret), false);
  }
  assert.equal(publicText.includes('"derivedKey":'), false);
  assert.deepEqual(Object.keys(service).sort(), ['authenticate', 'observe']);
});

test('multiple training accounts authenticate independently and duplicate identities fail closed', async () => {
  const accounts = [
    { id: 'user-100', identifier: 'alice@example.com', password: 'Alice password' },
    { id: 'user-200', identifier: 'bob@example.com', password: 'Bob password' },
  ];
  const service = await createLesson02PasswordService({
    clock: () => 0,
    kdf: fakeKdf(),
    accounts,
    dummyPassword: 'Dummy password',
  });
  assert.equal((await service.authenticate('alice@example.com', 'Alice password')).principal.id, 'user-100');
  assert.equal((await service.authenticate('bob@example.com', 'Bob password')).principal.id, 'user-200');
  assert.equal(JSON.stringify(service.observe()).includes('bob@example.com'), false);

  await assert.rejects(() => createLesson02PasswordService({
    kdf: fakeKdf(),
    accounts: [accounts[0], { ...accounts[1], identifier: 'ALICE@example.com' }],
  }), /unique identifiers/u);
  await assert.rejects(() => createLesson02PasswordService({
    kdf: fakeKdf(),
    accounts: [accounts[0], { ...accounts[1], id: 'user-100' }],
  }), /unique identifiers/u);
  await assert.rejects(() => createLesson02PasswordService({
    kdf: fakeKdf(),
    alice: accounts[0],
    accounts,
  }), /cannot be provided together/u);
});

test('failed-identifier tracking is bounded and expired entries free capacity before KDF work', async () => {
  let timestamp = 0;
  const { kdf, service } = await serviceFixture({
    clock: () => timestamp,
    rateLimit: {
      failureThreshold: 3,
      failureWindowMs: 30_000,
      blockDurationMs: 30_000,
      maxTrackedIdentifiers: 3,
    },
  });

  for (const identifier of ['one@example.com', 'two@example.com', 'three@example.com']) {
    assert.equal((await service.authenticate(identifier, 'wrong')).status, 422);
  }
  assert.equal(kdf.verificationCredentials.length, 3);

  const full = await service.authenticate('four@example.com', 'wrong');
  assert.deepEqual(full, {
    ok: false,
    status: 503,
    code: 'AUTHENTICATION_CAPACITY_EXCEEDED',
    message: 'Authentication temporarily unavailable.',
    retryAfterSeconds: 1,
    headers: { 'retry-after': '1' },
    sessionIssued: false,
  });
  assert.equal(kdf.verificationCredentials.length, 3);
  assert.equal(service.observe().rateLimit.trackedIdentifiers, 3);

  timestamp = 30_000;
  assert.equal((await service.authenticate('four@example.com', 'wrong')).status, 422);
  assert.equal(kdf.verificationCredentials.length, 4);
  assert.equal(service.observe().rateLimit.trackedIdentifiers, 1);
});

test('rate-limit capacity must be a positive bounded integer', async () => {
  await assert.rejects(serviceFixture({
    rateLimit: {
      failureThreshold: 3,
      failureWindowMs: 30_000,
      blockDurationMs: 30_000,
      maxTrackedIdentifiers: 0,
    },
  }), /maxTrackedIdentifiers must be a positive integer/);
});

test('parallel unique identifiers cannot overrun the tracking bound before KDF completion', async () => {
  const { kdf, service } = await serviceFixture({
    rateLimit: {
      failureThreshold: 3,
      failureWindowMs: 30_000,
      blockDurationMs: 30_000,
      maxTrackedIdentifiers: 3,
    },
  });
  const results = await Promise.all(Array.from(
    { length: 100 },
    (_, index) => service.authenticate(`unknown-${index}@example.com`, 'wrong'),
  ));

  assert.equal(results.filter(({ status }) => status === 422).length, 3);
  assert.equal(results.filter(({ status }) => status === 503).length, 97);
  assert.equal(kdf.verificationCredentials.length, 3);
  assert.equal(service.observe().rateLimit.trackedIdentifiers, 3);
});
