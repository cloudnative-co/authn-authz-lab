function lessonId(value) {
  if (!['13', '14'].includes(value)) throw new TypeError('lessonId must be 13 or 14');
  return value;
}

export function webauthnLessonHtml(value) {
  const id = lessonId(value);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>認証認可入門 ${id} WebAuthn 実習</title>
</head>
<body>
  <main>
    <h1>認証認可入門 ${id} WebAuthn 実習</h1>
    <p>教材 runner がこのページで Web Authentication API を実行します。</p>
    <p id="status" role="status">準備完了</p>
  </main>
  <script src="/lessons/${id}/browser.js" defer></script>
</body>
</html>`;
}

export function webauthnBrowserScript(value) {
  const id = lessonId(value);
  return `(() => {
  'use strict';
  const lessonId = '${id}';
  let scenarioId = null;
  let csrfToken = null;

  function base64urlToBytes(value) {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToBase64url(value) {
    const bytes = new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }

  function creationOptionsFromJSON(value) {
    return {
      ...value,
      challenge: base64urlToBytes(value.challenge),
      user: { ...value.user, id: base64urlToBytes(value.user.id) },
      excludeCredentials: value.excludeCredentials?.map((credential) => ({
        ...credential,
        id: base64urlToBytes(credential.id),
      })),
    };
  }

  function requestOptionsFromJSON(value) {
    return {
      ...value,
      challenge: base64urlToBytes(value.challenge),
      allowCredentials: value.allowCredentials?.map((credential) => ({
        ...credential,
        id: base64urlToBytes(credential.id),
      })),
    };
  }

  function registrationToJSON(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: bytesToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bytesToBase64url(response.clientDataJSON),
        attestationObject: bytesToBase64url(response.attestationObject),
        authenticatorData: response.getAuthenticatorData
          ? bytesToBase64url(response.getAuthenticatorData())
          : undefined,
        transports: response.getTransports ? response.getTransports() : undefined,
        publicKeyAlgorithm: response.getPublicKeyAlgorithm
          ? response.getPublicKeyAlgorithm()
          : undefined,
        publicKey: response.getPublicKey?.()
          ? bytesToBase64url(response.getPublicKey())
          : undefined,
      },
    };
  }

  function authenticationToJSON(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: bytesToBase64url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: bytesToBase64url(response.clientDataJSON),
        authenticatorData: bytesToBase64url(response.authenticatorData),
        signature: bytesToBase64url(response.signature),
        userHandle: response.userHandle ? bytesToBase64url(response.userHandle) : undefined,
      },
    };
  }

  async function api(path, { method = 'GET', json, csrf = false } = {}) {
    if (!scenarioId) throw new Error('course scenario is not configured');
    const headers = { 'x-course-scenario-id': scenarioId };
    if (json !== undefined) headers['content-type'] = 'application/json';
    if (csrf) {
      if (!csrfToken) throw new Error('CSRF token is unavailable');
      headers['x-csrf-token'] = csrfToken;
    }
    const response = await fetch(path, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      credentials: 'same-origin',
      redirect: 'error',
    });
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  }

  async function login(identifier, password) {
    const result = await api('/api/lessons/${id}/login/password', {
      method: 'POST', json: { identifier, password },
    });
    if (result.body?.csrfToken) csrfToken = result.body.csrfToken;
    return result;
  }

  async function registrationOptions() {
    return api('/api/lessons/${id}/registration/options', {
      method: 'POST', json: {}, csrf: true,
    });
  }

  async function createCredential(options) {
    const credential = await navigator.credentials.create({
      publicKey: creationOptionsFromJSON(options),
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('WebAuthn registration failed');
    return registrationToJSON(credential);
  }

  async function finishRegistration(transactionId, response) {
    return api('/api/lessons/${id}/registration/verify', {
      method: 'POST', json: { transactionId, response }, csrf: true,
    });
  }

  async function authenticationOptions({ identifier = null, discoverable = false } = {}) {
    return api('/api/lessons/${id}/authentication/options', {
      method: 'POST', json: { identifier, discoverable },
    });
  }

  async function getAssertion(options) {
    const credential = await navigator.credentials.get({
      publicKey: requestOptionsFromJSON(options),
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error('WebAuthn authentication failed');
    return authenticationToJSON(credential);
  }

  async function finishAuthentication(transactionId, response) {
    const result = await api('/api/lessons/${id}/authentication/verify', {
      method: 'POST', json: { transactionId, response },
    });
    if (result.body?.csrfToken) csrfToken = result.body.csrfToken;
    return result;
  }

  window.courseWebAuthn = Object.freeze({
    configure(value) { scenarioId = value; },
    login,
    registrationOptions,
    createCredential,
    finishRegistration,
    authenticationOptions,
    getAssertion,
    finishAuthentication,
    me: () => api('/api/lessons/${id}/me'),
    credentials: () => api('/api/lessons/${id}/credentials'),
    revokeCredential: (credentialReference) => api('/api/lessons/${id}/credentials/revoke', {
      method: 'POST', json: { credentialReference }, csrf: true,
    }),
    metadata: Object.freeze({
      lessonId,
      registrationAPI: 'navigator.credentials.create',
      authenticationAPI: 'navigator.credentials.get',
    }),
  });
})();`;
}

