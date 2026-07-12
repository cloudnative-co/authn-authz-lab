import assert from 'node:assert/strict';
import test from 'node:test';

import { createLesson07ProtocolAdapter } from '../../course/lessons/07/protocol-adapter.mjs';
import { runLesson07Scenario } from '../../course/lessons/07/scenario.mjs';

const PASSWORD = 'lesson07-fake-password';
const SUCCESS = { code: 'KERBEROS_AUTHENTICATED', principal: 'alice@EXAMPLE.TEST' };
const FAILURE = { code: 'NEGOTIATE_REQUIRED', message: 'Kerberos authentication is required.' };

function fakeExecutor() {
  let keytab = 'current';
  let hasTgt = false;
  let hasService = false;
  let lastReason = 'NEGOTIATE_REQUIRED';
  let successes = 0;
  let challenges = 0;
  let finalTokens = 0;

  return async ({ serviceName, argv, stdin }) => {
    if (serviceName === 'kdc' && argv[0] === '/usr/local/bin/keytab-select') {
      keytab = argv[1];
      return { code: 0, signal: null, stdout: '', stderr: '' };
    }
    if (serviceName === 'kdc' && argv[0] === 'klist') {
      const kvno = argv[2].includes('current') ? 2 : 1;
      return {
        code: 0, signal: null, stderr: '',
        stdout: `KVNO Principal\n   ${kvno} HTTP/app.example.test@EXAMPLE.TEST\n`,
      };
    }
    if (argv[0] === 'kdestroy') {
      hasTgt = false;
      hasService = false;
      return { code: 0, signal: null, stdout: '', stderr: '' };
    }
    if (argv[0] === 'kinit') {
      assert.equal(stdin, `${PASSWORD}\n`);
      hasTgt = true;
      return { code: 0, signal: null, stdout: '', stderr: '' };
    }
    if (argv[0] === 'klist') {
      const tickets = [
        'Default principal: alice@EXAMPLE.TEST',
        ...(hasTgt ? ['time krbtgt/EXAMPLE.TEST@EXAMPLE.TEST'] : []),
        ...(hasService ? ['time HTTP/app.example.test@EXAMPLE.TEST'] : []),
      ];
      return { code: 0, signal: null, stdout: tickets.join('\n'), stderr: '' };
    }
    if (argv[0] === 'kvno') {
      return {
        code: 1, signal: null, stdout: '',
        stderr: 'Server not found in Kerberos database',
      };
    }
    if (argv[0] === 'curl' && argv[1] === '--version') {
      return {
        code: 0, signal: null, stderr: '',
        stdout: 'curl 8.0\nFeatures: GSS-API SPNEGO SSL\n',
      };
    }
    if (argv[0] === 'curl' && argv.includes('--include')) {
      challenges += 1;
      lastReason = 'NEGOTIATE_REQUIRED';
      return {
        code: 0, signal: null, stderr: '',
        stdout: `HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Negotiate\r\n\r\n${JSON.stringify(FAILURE)}`,
      };
    }
    if (argv[0] === 'curl' && argv.some((value) => value.includes('/__course/diagnostics'))) {
      return {
        code: 0, signal: null, stderr: '',
        stdout: JSON.stringify({
          schemaVersion: 1,
          implementation: {
            mechanismScope: 'Kerberos-v5-in-SPNEGO',
            transportContext: 'compose-private-http-training-deviation',
            productionRequirement: 'tls-required',
          },
          counters: { lastReason, successes, challenges, finalTokens, incompleteContexts: 0 },
          redaction: {
            authorizationToken: 'omitted', responseToken: 'omitted', keytab: 'omitted', nativeError: 'omitted',
          },
        }),
      };
    }

    const skewed = argv[0] === 'faketime';
    hasService = true;
    if (skewed) lastReason = 'CLOCK_SKEW_REJECTED';
    else if (keytab === 'stale') lastReason = 'ACCEPTOR_KEY_MISMATCH';
    else lastReason = 'GSS_ACCEPTED';
    const rejected = skewed || keytab === 'stale';
    if (rejected) challenges += 1;
    else {
      successes += 1;
      finalTokens += 1;
    }
    const body = rejected ? FAILURE : SUCCESS;
    return {
      code: 0, signal: null, stderr: '',
      stdout: `${JSON.stringify(body)}\n__COURSE_HTTP_STATUS__:${rejected ? 401 : 200}\n`,
    };
  };
}

test('scenario distinguishes AS/TGS/AP evidence and restores the current keytab', async () => {
  const adapter = createLesson07ProtocolAdapter({ executeOwnedService: fakeExecutor() });
  const runtime = await runLesson07Scenario({ adapter, password: PASSWORD });

  assert.equal(runtime.normal.afterKinit.tgtPresent, true);
  assert.equal(runtime.normal.afterKinit.httpServiceTicketPresent, false);
  assert.deepEqual(runtime.normal.afterKinit.ticketServicePrincipals, [
    'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST',
  ]);
  assert.deepEqual(runtime.normal.challenge, { status: 401, scheme: 'Negotiate' });
  assert.equal(runtime.normal.authenticated.status, 200);
  assert.equal(runtime.normal.authenticated.principal, 'alice@EXAMPLE.TEST');
  assert.equal(runtime.normal.afterServiceRequest.httpServiceTicketPresent, true);
  assert.deepEqual(runtime.normal.afterServiceRequest.ticketServicePrincipals, [
    'krbtgt/EXAMPLE.TEST@EXAMPLE.TEST',
    'HTTP/app.example.test@EXAMPLE.TEST',
  ]);
  assert.equal(runtime.rejection.wrongSpn.reason, 'SERVICE_PRINCIPAL_UNKNOWN');
  assert.equal(runtime.rejection.clockSkew.reason, 'CLOCK_SKEW_REJECTED');
  assert.equal(runtime.rejection.staleKeytab.reason, 'ACCEPTOR_KEY_MISMATCH');
  assert.equal(runtime.rejection.staleKeytab.currentRestored, true);
  assert.equal(runtime.rejection.genericHttpSurface, true);
  assert.equal(runtime.protocol.generalSpnegoContinuationSupported, false);
  assert.equal(runtime.protocol.incompleteContextCount, 0);
  assert.equal(runtime.protocol.finalAcceptorTokenObserved, true);
  assert.equal(JSON.stringify(runtime).includes(PASSWORD), false);
});
