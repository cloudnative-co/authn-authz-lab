// Minimal, build-free WebAuthn front end (plain ES modules). It uses the
// Baseline 2025 helpers (parseCreationOptionsFromJSON / parseRequestOptionsFromJSON
// / credential.toJSON) with a small base64url fallback for older browsers.

function show(value) {
  const el = document.getElementById('log');
  if (el) el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// --- base64url helpers (fallback path + display decoding) ---
function base64urlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function toCreationOptions(json) {
  if (PublicKeyCredential.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON(json);
  return {
    ...json,
    challenge: base64urlToBytes(json.challenge),
    user: { ...json.user, id: base64urlToBytes(json.user.id) },
    excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({ ...c, id: base64urlToBytes(c.id) })),
  };
}

function toRequestOptions(json) {
  if (PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON(json);
  return {
    ...json,
    challenge: base64urlToBytes(json.challenge),
    allowCredentials: (json.allowCredentials ?? []).map((c) => ({ ...c, id: base64urlToBytes(c.id) })),
  };
}

// --- display-only decoders (mirror src/auth/webauthnInspect.js in the browser) ---
function decodeClientData(b64url) {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(b64url)));
}

function parseAuthenticatorData(b64url) {
  const bytes = base64urlToBytes(b64url);
  const flags = bytes[32];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rpIdHash: [...bytes.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    flags: {
      UP: Boolean(flags & 0x01),
      UV: Boolean(flags & 0x04),
      BE: Boolean(flags & 0x08),
      BS: Boolean(flags & 0x10),
    },
    signCount: view.getUint32(33, false),
  };
}

async function login(email, password) {
  const { status } = await postJSON('/login', { email, password });
  return status === 200;
}

async function registerPasskey() {
  const options = await postJSON('/webauthn/register/options');
  if (options.status !== 200) return { ok: false, step: 'options', status: options.status };

  const credential = await navigator.credentials.create({ publicKey: toCreationOptions(options.data) });
  const response = credential.toJSON();
  const inspect = { clientData: decodeClientData(response.response.clientDataJSON) };

  const verify = await postJSON('/webauthn/register', response);
  const result = { ok: verify.status === 200, verified: verify.data.verified === true, credentialId: verify.data.credentialId, inspect };
  show(result);
  return result;
}

async function loginWithPasskey(overrides = {}) {
  // `tamperUserHandle` mutates the response (for negative tests); the rest are
  // request-option overrides (e.g. a tampered challenge or a foreign rpId).
  const { tamperUserHandle, ...requestOverrides } = overrides;
  const options = await postJSON('/webauthn/authenticate/options');
  if (options.status !== 200) return { ok: false, step: 'options', status: options.status };

  const credential = await navigator.credentials.get({ publicKey: toRequestOptions({ ...options.data, ...requestOverrides }) });
  const response = credential.toJSON();
  if (tamperUserHandle) response.response.userHandle = tamperUserHandle;
  const inspect = {
    clientData: decodeClientData(response.response.clientDataJSON),
    authenticatorData: parseAuthenticatorData(response.response.authenticatorData),
  };

  const verify = await postJSON('/webauthn/authenticate', response);
  const me = await fetch('/me').then((r) => r.json().then((b) => ({ status: r.status, body: b })));
  const result = {
    ok: verify.status === 200,
    verified: verify.data.verified === true,
    user: verify.data.user,
    signCount: verify.data.signCount,
    inspect,
    me,
  };
  show(result);
  return result;
}

window.webauthnDemo = { login, registerPasskey, loginWithPasskey };

document.getElementById('register')?.addEventListener('click', async () => {
  await login(document.getElementById('email').value, document.getElementById('password').value);
  await registerPasskey();
});
document.getElementById('login-passkey')?.addEventListener('click', () => loginWithPasskey());
