import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const CHROMIUM_ARGUMENTS = Object.freeze([
  '--host-resolver-rules=MAP localhost 127.0.0.1',
]);

function browserOrigin(runtimeOrigin) {
  const parsed = new URL(runtimeOrigin);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    throw new TypeError('runtimeOrigin must be an IPv4 loopback HTTP origin');
  }
  return `http://localhost:${parsed.port}`;
}

async function closeQuietly(value) {
  await value?.close?.().catch(() => {});
}

export async function inspectPlaywrightChromium() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGUMENTS });
    return Object.freeze({
      ready: true,
      reasonCode: null,
      version: browser.version(),
      recovery: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      ready: false,
      reasonCode: 'PREREQUISITE_PLAYWRIGHT_CHROMIUM',
      message: error instanceof Error ? error.message.split('\n', 1)[0] : 'Chromium could not start',
      recovery: Object.freeze([
        'npm ciを完了してから npx playwright install chromium を実行してください',
        'Linuxで共有library不足が表示された場合は講師または管理者へPlaywrightの公式install-deps手順を確認してください',
      ]),
    });
  } finally {
    await closeQuietly(browser);
  }
}

export async function launchWebAuthnBrowser({ runtimeOrigin, signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('operation aborted');
  const origin = browserOrigin(runtimeOrigin);
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGUMENTS });
  const contexts = new Set();
  const abort = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });

  async function newAuthenticator({
    lessonId,
    scenarioId,
    backupEligibility = false,
    backupState = false,
  } = {}) {
    if (!['13', '14'].includes(lessonId)) throw new TypeError('lessonId must be 13 or 14');
    if (backupState && !backupEligibility) throw new TypeError('backupState requires backupEligibility');
    const context = await browser.newContext();
    contexts.add(context);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        defaultBackupEligibility: backupEligibility,
        defaultBackupState: backupState,
      },
    });
    await page.goto(`${origin}/lessons/${lessonId}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.courseWebAuthn === 'object');
    await page.evaluate((value) => window.courseWebAuthn.configure(value), scenarioId);
    return Object.freeze({ context, page, client, authenticatorId, lessonId, scenarioId });
  }

  async function close() {
    signal?.removeEventListener('abort', abort);
    for (const context of contexts) await closeQuietly(context);
    contexts.clear();
    await closeQuietly(browser);
  }

  return Object.freeze({ origin, browser, newAuthenticator, close });
}

export async function browserMethod(page, method, ...args) {
  return page.evaluate(({ methodName, methodArgs }) => {
    const callable = window.courseWebAuthn?.[methodName];
    if (typeof callable !== 'function') throw new Error(`unknown browser helper: ${methodName}`);
    return callable(...methodArgs);
  }, { methodName: method, methodArgs: args });
}

export async function authenticatorCredentials(authenticator) {
  const result = await authenticator.client.send('WebAuthn.getCredentials', {
    authenticatorId: authenticator.authenticatorId,
  });
  return result.credentials;
}

export async function getAssertionDirect(page, optionsJSON) {
  return page.evaluate(async (source) => {
    function decode(value) {
      const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const binary = atob(padded);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    function encode(value) {
      const bytes = new Uint8Array(value);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    }
    const options = {
      ...source,
      challenge: decode(source.challenge),
      allowCredentials: source.allowCredentials?.map((credential) => ({
        ...credential,
        id: decode(credential.id),
      })),
    };
    const credential = await navigator.credentials.get({ publicKey: options });
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: encode(credential.response.clientDataJSON),
        authenticatorData: encode(credential.response.authenticatorData),
        signature: encode(credential.response.signature),
        userHandle: credential.response.userHandle
          ? encode(credential.response.userHandle)
          : undefined,
      },
    };
  }, optionsJSON);
}

export async function browserRejectsForeignRPID(page, optionsJSON) {
  return page.evaluate(async (source) => {
    const normalized = source.challenge.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    try {
      await navigator.credentials.get({
        publicKey: {
          ...source,
          rpId: 'invalid.example',
          challenge: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
          allowCredentials: [],
        },
      });
      return { rejected: false, errorName: null };
    } catch (error) {
      return { rejected: true, errorName: error?.name ?? 'Error' };
    }
  }, optionsJSON);
}

export async function withAlternateLocalhostPage(page, callback) {
  if (typeof callback !== 'function') throw new TypeError('callback is required');
  const server = createServer((request, response) => {
    const payload = Buffer.from('<!doctype html><html><title>alternate origin</title></html>');
    response.statusCode = request.method === 'GET' ? 200 : 405;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('content-length', payload.length);
    response.end(payload);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
    return await callback();
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export function mutateBase64urlByte(value) {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0) throw new TypeError('base64url value must not be empty');
  bytes[bytes.length - 1] ^= 0x01;
  return bytes.toString('base64url');
}

export function browserPrerequisiteDiagnostic(result, lessonId) {
  return {
    id: `lesson${lessonId}.playwright-chromium`,
    status: result.ready ? 'pass' : 'fail',
    actual: result.ready ? `available/${result.version}` : result.reasonCode,
    expected: 'Playwright 1.61.1 compatible Chromium available',
    message: result.ready
      ? 'CDP virtual WebAuthn実習に使うChromiumを起動できました'
      : 'Chromiumはnpm ciだけでは用意されません',
  };
}

