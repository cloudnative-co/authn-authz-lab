import { expect, test } from '@playwright/test';

// Attach a CDP virtual authenticator (an internal, resident-key, user-verified
// CTAP2 device) to the page's browser context.
async function addVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

async function registerPasskey(page) {
  return page.evaluate(async () => {
    await window.webauthnDemo.login('alice@example.com', 'password-alice');
    return window.webauthnDemo.registerPasskey();
  });
}

test('13 registers a passkey and 14 signs in passwordlessly', async ({ page }) => {
  const { client, authenticatorId } = await addVirtualAuthenticator(page);
  await page.goto('/');

  const registration = await registerPasskey(page);
  expect(registration.verified).toBe(true);
  expect(registration.inspect.clientData.type).toBe('webauthn.create');
  expect(registration.inspect.clientData.origin).toBe('http://localhost:3100');

  const beforeAuth = await client.send('WebAuthn.getCredentials', { authenticatorId });
  expect(beforeAuth.credentials.length).toBe(1);
  const signCountBefore = beforeAuth.credentials[0].signCount;

  // 14: passwordless login on a fresh session (no cookies).
  await page.context().clearCookies();
  const auth = await page.evaluate(() => window.webauthnDemo.loginWithPasskey());
  expect(auth.verified).toBe(true);
  expect(auth.user.email).toBe('alice@example.com');
  expect(auth.me.status).toBe(200);
  expect(auth.inspect.authenticatorData.flags.UV).toBe(true);

  const afterAuth = await client.send('WebAuthn.getCredentials', { authenticatorId });
  expect(afterAuth.credentials[0].signCount).toBeGreaterThan(signCountBefore);
});

test('14 rejects an assertion whose challenge was tampered with', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await registerPasskey(page);

  await page.context().clearCookies();
  const result = await page.evaluate(() =>
    window.webauthnDemo.loginWithPasskey({ challenge: 'dGFtcGVyZWQtY2hhbGxlbmdl' }),
  );
  // The signed clientData.challenge no longer matches the server's expected value.
  expect(result.ok).toBe(false);
});

test('14 the browser refuses an assertion scoped to a foreign RP ID', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await registerPasskey(page);

  await page.context().clearCookies();
  // evil.example is not a registrable suffix of the localhost origin.
  await expect(page.evaluate(() => window.webauthnDemo.loginWithPasskey({ rpId: 'evil.example' }))).rejects.toThrow();
});

test('14 rejects an assertion whose userHandle does not match the credential account', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await registerPasskey(page);

  await page.context().clearCookies();
  // 'c29tZW9uZS1lbHNl' is base64url("someone-else") — a user handle that does
  // not belong to the account that owns this credential.
  const result = await page.evaluate(() =>
    window.webauthnDemo.loginWithPasskey({ tamperUserHandle: 'c29tZW9uZS1lbHNl' }),
  );
  expect(result.ok).toBe(false);
});
