import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { SignedXml } from 'xml-crypto';

const execFileAsync = promisify(execFile);
const EXCLUSIVE_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA256_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function signElement(xml, localName, privateKey, certificate) {
  const signer = new SignedXml({ privateKey, publicCert: certificate });
  signer.canonicalizationAlgorithm = EXCLUSIVE_C14N;
  signer.signatureAlgorithm = RSA_SHA256;
  signer.addReference({
    xpath: `//*[local-name(.)='${localName}']`,
    transforms: [ENVELOPED, EXCLUSIVE_C14N],
    digestAlgorithm: SHA256_DIGEST,
  });
  signer.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${localName}']/*[local-name(.)='Issuer']`,
      action: 'after',
    },
  });
  return signer.getSignedXml();
}

export async function generateRuntimeCertificate(directory) {
  if (typeof directory !== 'string' || directory.length === 0) throw new TypeError('directory is required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const privateKeyPath = resolve(directory, 'fixture-private-key.pem');
  const certificatePath = resolve(directory, 'fixture-certificate.pem');
  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
    '-subj', '/CN=lesson09-runtime-fixture.invalid',
    '-days', '1',
    '-keyout', privateKeyPath,
    '-out', certificatePath,
  ], { timeout: 15_000, maxBuffer: 64 * 1024 });
  return Object.freeze({
    privateKey: await readFile(privateKeyPath, 'utf8'),
    certificate: await readFile(certificatePath, 'utf8'),
  });
}

export function buildSignedFixture({
  requestId,
  issuer,
  audience,
  destination,
  subject = 'fixture-subject@example.test',
  privateKey,
  certificate,
  fault = null,
  now = new Date(),
} = {}) {
  for (const [label, value] of Object.entries({ requestId, issuer, audience, destination, privateKey, certificate })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  }
  const allowedFaults = [
    null,
    'signature',
    'response-issuer',
    'assertion-issuer',
    'audience',
    'destination',
    'response-in-response-to',
    'subject-method',
    'subject-recipient',
    'subject-in-response-to',
    'expiry',
  ];
  if (!allowedFaults.includes(fault)) throw new TypeError('fault is not supported');
  const responseId = `_response_${randomUUID()}`;
  const assertionId = `_assertion_${randomUUID()}`;
  const issueInstant = now.toISOString();
  const conditionsNotBefore = new Date(now.getTime() - 30_000).toISOString();
  const conditionsNotOnOrAfter = new Date(now.getTime() + 3 * 60_000).toISOString();
  const subjectNotOnOrAfter = new Date(
    fault === 'expiry' ? now.getTime() - 60_000 : now.getTime() + 3 * 60_000,
  ).toISOString();
  const responseIssuer = fault === 'response-issuer' ? 'https://wrong-idp.invalid/' : issuer;
  const assertionIssuer = fault === 'assertion-issuer' ? 'https://wrong-idp.invalid/' : issuer;
  const resolvedAudience = fault === 'audience' ? 'wrong-audience' : audience;
  const resolvedDestination = fault === 'destination' ? 'http://wrong-sp.invalid/acs' : destination;
  const responseRequestId = fault === 'response-in-response-to' ? '_wrong_response_request' : requestId;
  const subjectRequestId = fault === 'subject-in-response-to' ? '_wrong_subject_request' : responseRequestId;
  const method = fault === 'subject-method'
    ? 'urn:oasis:names:tc:SAML:2.0:cm:holder-of-key'
    : 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
  const recipient = fault === 'subject-recipient' ? 'http://wrong-sp.invalid/acs' : destination;
  const unsigned = [
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXml(resolvedDestination)}" InResponseTo="${escapeXml(responseRequestId)}">`,
    `<saml:Issuer>${escapeXml(responseIssuer)}</saml:Issuer>`,
    '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">`,
    `<saml:Issuer>${escapeXml(assertionIssuer)}</saml:Issuer>`,
    '<saml:Subject>',
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(subject)}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="${escapeXml(method)}">`,
    `<saml:SubjectConfirmationData InResponseTo="${escapeXml(subjectRequestId)}" NotOnOrAfter="${subjectNotOnOrAfter}" Recipient="${escapeXml(recipient)}"/>`,
    '</saml:SubjectConfirmation>',
    '</saml:Subject>',
    `<saml:Conditions NotBefore="${conditionsNotBefore}" NotOnOrAfter="${conditionsNotOnOrAfter}">`,
    `<saml:AudienceRestriction><saml:Audience>${escapeXml(resolvedAudience)}</saml:Audience></saml:AudienceRestriction>`,
    '</saml:Conditions>',
    `<saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="_session_${randomUUID()}">`,
    '<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>',
    '</saml:AuthnStatement>',
    '</saml:Assertion>',
    '</samlp:Response>',
  ].join('');
  const assertionSigned = signElement(unsigned, 'Assertion', privateKey, certificate);
  let signed = signElement(assertionSigned, 'Response', privateKey, certificate);
  if (fault === 'signature') {
    const corrupted = signed.replace(
      /(<SignatureValue[^>]*>)([A-Za-z0-9+/])/u,
      (_match, prefix, first) => `${prefix}${first === 'A' ? 'B' : 'A'}`,
    );
    if (corrupted === signed) throw new Error('signature corruption failed');
    signed = corrupted;
  }
  return Object.freeze({
    responseId,
    assertionId,
    samlResponse: Buffer.from(signed, 'utf8').toString('base64'),
  });
}
