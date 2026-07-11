import { readFileSync } from 'node:fs';
import { SAML } from '@node-saml/node-saml';

// Build the SAML SP configuration from the environment. Returns null when the
// IdP is not configured so the server can answer 503 instead of crashing.
export function samlConfigFromEnv(env = process.env) {
  const entryPoint = env.SAML_ENTRY_POINT;
  const idpCert = env.SAML_IDP_CERT ?? (env.SAML_IDP_CERT_FILE ? readFileSync(env.SAML_IDP_CERT_FILE, 'utf8') : undefined);
  if (!entryPoint || !idpCert) return null;
  return {
    callbackUrl: env.SAML_CALLBACK_URL ?? 'http://localhost:3000/saml/acs',
    entryPoint,
    issuer: env.SAML_ISSUER ?? 'mini-project-app',
    idpCert,
    audience: env.SAML_AUDIENCE ?? 'mini-project-app',
  };
}

function normalizeCert(cert) {
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

export function createSamlServiceProvider(config) {
  return new SAML({
    callbackUrl: config.callbackUrl,
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    idpCert: normalizeCert(config.idpCert),
    audience: config.audience,
    // The assertion signature is the trust anchor; xml-crypto (inside node-saml)
    // performs the XML-DSig verification we deliberately do NOT hand-roll.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // IdP-initiated responses carry no InResponseTo; accept them but still
    // validate it (replay defense) when present.
    validateInResponseTo: 'ifPresent',
    signatureAlgorithm: 'sha256',
  });
}

export async function getLoginRedirectUrl(sp, relayState = '') {
  // SP-initiated SSO: a deflate+base64 AuthnRequest carried on an HTTP-Redirect.
  return sp.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlResponse(sp, samlResponse) {
  const { profile } = await sp.validatePostResponseAsync({ SAMLResponse: samlResponse });
  return profile;
}

export function decodeSamlResponseXml(samlResponse) {
  return Buffer.from(samlResponse, 'base64').toString('utf8');
}
