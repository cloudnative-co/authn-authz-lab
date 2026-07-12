import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { BoundedDigestStore } from '../../packages/saml-strict/bounded-store.mjs';
import {
  buildSignedFixture,
  generateRuntimeCertificate,
} from '../../packages/saml-strict/fixture.mjs';
import { createStrictSamlServiceProvider } from '../../packages/saml-strict/service-provider.mjs';

const ISSUER = 'https://fixture-idp.example.test/';
const AUDIENCE = 'lesson09-fixture-sp';
const ACS = 'http://sp.example.test/saml/acs';
let directory;
let keys;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lesson09-saml-'));
  keys = await generateRuntimeCertificate(directory);
});

after(async () => rm(directory, { recursive: true, force: true }));

function provider() {
  return createStrictSamlServiceProvider({
    callbackUrl: ACS,
    entryPoint: 'https://fixture-idp.example.test/sso',
    issuer: AUDIENCE,
    audience: AUDIENCE,
    idpIssuer: ISSUER,
    idpCert: keys.certificate,
  });
}

function fixture(login, fault = null) {
  return buildSignedFixture({
    requestId: login.requestId,
    issuer: ISSUER,
    audience: AUDIENCE,
    destination: ACS,
    privateKey: keys.privateKey,
    certificate: keys.certificate,
    fault,
  });
}

test('strict provider accepts a response and assertion that are both signed', async () => {
  const sp = provider();
  const login = await sp.beginLogin();
  const response = fixture(login);
  const result = await sp.validateResponse({
    samlResponse: response.samlResponse,
    relayState: login.relayState,
  });
  assert.match(result.subjectDigest, /^[a-f0-9]{64}$/u);
  assert.equal(sp.diagnostics().rawXmlRetained, false);
});

test('exact signed response replay is rejected before another session can be created', async () => {
  const sp = provider();
  const login = await sp.beginLogin();
  const response = fixture(login);
  await sp.validateResponse({ samlResponse: response.samlResponse, relayState: login.relayState });
  await assert.rejects(
    sp.validateResponse({ samlResponse: response.samlResponse, relayState: login.relayState }),
    (error) => error.reasonCode === 'REPLAY_DETECTED',
  );
});

for (const [fault, reasonCode] of [
  ['signature', 'SIGNATURE_INVALID'],
  ['response-issuer', 'RESPONSE_ISSUER_INVALID'],
  ['assertion-issuer', 'ASSERTION_ISSUER_INVALID'],
  ['audience', 'AUDIENCE_INVALID'],
  ['destination', 'DESTINATION_INVALID'],
  ['response-in-response-to', 'IN_RESPONSE_TO_INVALID'],
  ['subject-method', 'SUBJECT_CONFIRMATION_METHOD_INVALID'],
  ['subject-recipient', 'SUBJECT_CONFIRMATION_RECIPIENT_INVALID'],
  ['subject-in-response-to', 'SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID'],
  ['expiry', 'SUBJECT_CONFIRMATION_EXPIRED'],
]) {
  test(`one-fault signed fixture rejects ${fault}`, async () => {
    const sp = provider();
    const login = await sp.beginLogin();
    const response = fixture(login, fault);
    await assert.rejects(
      sp.validateResponse({ samlResponse: response.samlResponse, relayState: login.relayState }),
      (error) => error.reasonCode === reasonCode,
    );
    assert.equal(sp.diagnostics().acceptedResponseCount, 0);
  });
}

test('bounded stores retain only key digests and evict the oldest entry', () => {
  const store = new BoundedDigestStore({ maxEntries: 2, ttlMs: 60_000 });
  store.set('raw-request-id-1', true);
  store.set('raw-request-id-2', true);
  store.set('raw-request-id-3', true);
  assert.equal(store.size, 2);
  assert.equal(store.has('raw-request-id-1'), false);
  assert.equal(JSON.stringify(store.snapshot()).includes('raw-request-id'), false);
});
