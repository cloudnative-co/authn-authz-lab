import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { before, test } from 'node:test';
import { createSamlServiceProvider, getLoginRedirectUrl } from '../src/auth/saml.js';

// Requires the Keycloak IdP container (`npm run compose:up`). Full SSO (entering
// the password and posting the SAMLResponse to the ACS) is a manual exercise in
// the README; this suite covers discovery + SP-initiated request generation.
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8085';
const DESCRIPTOR_URL = `${KEYCLOAK}/realms/example/protocol/saml/descriptor`;

let descriptor;

async function fetchDescriptor(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(DESCRIPTOR_URL);
      if (res.status === 200) return await res.text();
    } catch {
      // Keycloak is still starting; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Keycloak SAML descriptor not reachable at ${DESCRIPTOR_URL}. Run \`npm run compose:up\` first.`);
}

function parseDescriptor(xml) {
  return {
    entityId: xml.match(/entityID="([^"]+)"/)?.[1],
    ssoRedirect: xml.match(/SingleSignOnService[^>]*HTTP-Redirect"[^>]*Location="([^"]+)"/)?.[1],
    cert: xml.match(/<[^>]*X509Certificate>([^<]+)</)?.[1],
  };
}

before(async () => {
  descriptor = await fetchDescriptor();
});

test('09 the IdP descriptor exposes the SSO endpoint and signing certificate', () => {
  const { entityId, ssoRedirect, cert } = parseDescriptor(descriptor);
  assert.match(entityId, /\/realms\/example$/);
  assert.match(ssoRedirect, /\/protocol\/saml$/);
  assert.ok(cert && cert.length > 100, 'expected an IdP signing certificate');
});

test('09 node-saml builds an SP-initiated AuthnRequest addressed to Keycloak', async () => {
  const { ssoRedirect, cert } = parseDescriptor(descriptor);
  const sp = createSamlServiceProvider({
    callbackUrl: 'http://localhost:3000/saml/acs',
    entryPoint: ssoRedirect,
    issuer: 'mini-project-app',
    idpCert: cert,
    audience: 'mini-project-app',
  });

  const redirectUrl = await getLoginRedirectUrl(sp, 'relay-123');
  assert.ok(redirectUrl.startsWith(ssoRedirect), 'redirect should target the IdP SSO endpoint');

  const params = new URL(redirectUrl).searchParams;
  assert.equal(params.get('RelayState'), 'relay-123');

  // The AuthnRequest is deflate(raw)+base64 encoded on the redirect binding.
  const xml = inflateRawSync(Buffer.from(params.get('SAMLRequest'), 'base64')).toString('utf8');
  assert.match(xml, /AuthnRequest/);
  assert.match(xml, /mini-project-app/);
  assert.match(xml, /saml\/acs/);
});
