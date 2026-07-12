export class Lesson09ProtocolError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'Lesson09ProtocolError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new Lesson09ProtocolError(reasonCode, message);
}

export function createLesson09ProtocolAdapter({ executeOwnedService } = {}) {
  if (typeof executeOwnedService !== 'function') throw new TypeError('executeOwnedService is required');

  async function runScenario(signal) {
    let result;
    try {
      result = await executeOwnedService({
        resourceId: 'saml-lab',
        serviceName: 'user-agent',
        argv: Object.freeze(['node', 'client.mjs', 'scenario']),
        signal,
        timeoutMs: 90_000,
        maxOutputBytes: 1024 * 1024,
        acceptedExitCodes: [0],
      });
    } catch (error) {
      fail(error?.reasonCode ?? 'SAML_SCENARIO_FAILED', 'Lesson 09 scenario command failed');
    }
    if (result?.code !== 0 || result.signal !== null || typeof result.stdout !== 'string') {
      fail('SAML_SCENARIO_RESULT_INVALID', 'Lesson 09 scenario returned an invalid result');
    }
    let runtime;
    try {
      runtime = JSON.parse(result.stdout);
    } catch {
      fail('SAML_SCENARIO_RESULT_INVALID', 'Lesson 09 scenario output was not JSON');
    }
    return runtime;
  }

  return Object.freeze({ runScenario });
}
