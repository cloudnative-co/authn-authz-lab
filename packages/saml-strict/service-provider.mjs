import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SAML } from '@node-saml/node-saml';
import {
  BoundedDigestStore,
  DigestCacheProvider,
  LoginTransactionStore,
  sha256,
} from './bounded-store.mjs';
import {
  decodeCanonicalBase64,
  parseResponseShape,
  SAML_BEARER,
} from './xml-shape.mjs';

const REQUEST_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 10_000;

export class StrictSamlError extends Error {
  constructor(reasonCode, message, options = {}) {
    super(message, options);
    this.name = 'StrictSamlError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message, options) {
  throw new StrictSamlError(reasonCode, message, options);
}

function boundedUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${label} protocol is invalid`);
  }
  if (url.username || url.password || url.hash || value.length > 1024) {
    throw new TypeError(`${label} is invalid`);
  }
  return url.href;
}

function normalizeCerts(value) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > 4 || values.some(
    (cert) => typeof cert !== 'string'
      || cert.length < 256
      || cert.length > 32 * 1024
      || !cert.includes('BEGIN CERTIFICATE'),
  )) {
    throw new TypeError('idpCert must contain one to four PEM certificates');
  }
  return Object.freeze([...values]);
}

function parseInstant(value, reasonCode) {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) fail(reasonCode, 'SAML timestamp is invalid');
  return instant;
}

function mapNodeSamlError(error, shape, nowMs) {
  const message = String(error?.message ?? '');
  const subjectExpiry = Date.parse(shape?.subjectNotOnOrAfter ?? '');
  if (Number.isFinite(subjectExpiry) && nowMs >= subjectExpiry + CLOCK_SKEW_MS) {
    return 'SUBJECT_CONFIRMATION_EXPIRED';
  }
  if (/signature/iu.test(message)) return 'SIGNATURE_INVALID';
  if (/audience/iu.test(message)) return 'AUDIENCE_INVALID';
  if (/InResponseTo|in response to/iu.test(message)) {
    return shape?.subjectInResponseTo !== shape?.responseInResponseTo
      ? 'SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID'
      : 'IN_RESPONSE_TO_INVALID';
  }
  if (/expired|not yet valid|timestamp/iu.test(message)) {
    return 'CONDITIONS_INVALID';
  }
  if (/subject confirmation/iu.test(message)) return 'SUBJECT_CONFIRMATION_INVALID';
  return 'SAML_CORE_VALIDATION_FAILED';
}

function parseRequestId(location) {
  const request = new URL(location).searchParams.get('SAMLRequest');
  if (!request || request.length > 256 * 1024) fail('AUTHN_REQUEST_INVALID', 'AuthnRequest is missing');
  let xml;
  try {
    xml = inflateRawSync(Buffer.from(request, 'base64'), { maxOutputLength: 256 * 1024 }).toString('utf8');
  } catch (error) {
    fail('AUTHN_REQUEST_INVALID', 'AuthnRequest cannot be decoded', { cause: error });
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  const id = root?.namespaceURI === 'urn:oasis:names:tc:SAML:2.0:protocol'
    && root.localName === 'AuthnRequest'
    ? root.getAttribute('ID')
    : null;
  if (!id || id.length > 256) fail('AUTHN_REQUEST_INVALID', 'AuthnRequest ID is invalid');
  return id;
}

function semanticValidation(shape, profile, config, expectedRequestIdDigest, nowMs) {
  if (shape.responseIssuer !== config.idpIssuer) fail('RESPONSE_ISSUER_INVALID', 'Response issuer mismatch');
  if (shape.assertionIssuer !== config.idpIssuer) fail('ASSERTION_ISSUER_INVALID', 'Assertion issuer mismatch');
  if (shape.destination !== config.callbackUrl) fail('DESTINATION_INVALID', 'Response Destination mismatch');
  if (sha256(shape.responseInResponseTo) !== expectedRequestIdDigest) {
    fail('IN_RESPONSE_TO_INVALID', 'Response InResponseTo mismatch');
  }
  if (shape.confirmationMethod !== SAML_BEARER) {
    fail('SUBJECT_CONFIRMATION_METHOD_INVALID', 'SubjectConfirmation Method mismatch');
  }
  if (shape.recipient !== config.callbackUrl) {
    fail('SUBJECT_CONFIRMATION_RECIPIENT_INVALID', 'SubjectConfirmation Recipient mismatch');
  }
  if (shape.subjectInResponseTo !== shape.responseInResponseTo) {
    fail('SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID', 'SubjectConfirmation InResponseTo mismatch');
  }
  if (shape.subjectNotBeforePresent) {
    fail('SUBJECT_CONFIRMATION_NOT_BEFORE_FORBIDDEN', 'SubjectConfirmationData NotBefore is not accepted');
  }
  if (nowMs >= parseInstant(shape.subjectNotOnOrAfter, 'SUBJECT_CONFIRMATION_EXPIRY_INVALID') + CLOCK_SKEW_MS) {
    fail('SUBJECT_CONFIRMATION_EXPIRED', 'SubjectConfirmationData expired');
  }
  const notBefore = parseInstant(shape.conditionsNotBefore, 'CONDITIONS_INVALID');
  const notOnOrAfter = parseInstant(shape.conditionsNotOnOrAfter, 'CONDITIONS_INVALID');
  if (nowMs + CLOCK_SKEW_MS < notBefore || nowMs >= notOnOrAfter + CLOCK_SKEW_MS) {
    fail('CONDITIONS_INVALID', 'Assertion Conditions are outside the accepted time window');
  }
  if (shape.audience !== config.audience) fail('AUDIENCE_INVALID', 'Audience mismatch');
  if (profile?.issuer !== shape.assertionIssuer || profile?.nameID !== shape.subject) {
    fail('VERIFIED_PRINCIPAL_MISMATCH', 'verified profile does not match the signed Assertion');
  }
}

export function createStrictSamlServiceProvider(input = {}) {
  const config = Object.freeze({
    callbackUrl: boundedUrl(input.callbackUrl, 'callbackUrl'),
    entryPoint: boundedUrl(input.entryPoint, 'entryPoint'),
    issuer: input.issuer,
    audience: input.audience,
    idpIssuer: input.idpIssuer,
    idpCerts: normalizeCerts(input.idpCert),
  });
  for (const field of ['issuer', 'audience', 'idpIssuer']) {
    if (typeof config[field] !== 'string' || config[field].length < 1 || config[field].length > 1024) {
      throw new TypeError(`${field} is invalid`);
    }
  }
  const now = input.now ?? Date.now;
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const cacheProvider = new DigestCacheProvider({ maxEntries: 256, ttlMs: REQUEST_TTL_MS, now });
  const transactions = new LoginTransactionStore({ maxEntries: 256, ttlMs: REQUEST_TTL_MS, now });
  const responseReplay = new BoundedDigestStore({ maxEntries: 512, ttlMs: 10 * 60_000, now });
  const assertionReplay = new BoundedDigestStore({ maxEntries: 512, ttlMs: 10 * 60_000, now });
  const saml = new SAML({
    callbackUrl: config.callbackUrl,
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    audience: config.audience,
    idpIssuer: config.idpIssuer,
    idpCert: config.idpCerts,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: 'always',
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: REQUEST_TTL_MS,
    cacheProvider,
    signatureAlgorithm: 'sha256',
    disableRequestedAuthnContext: true,
  });
  let validationTail = Promise.resolve();

  async function beginLogin() {
    const placeholder = randomBytes(32).toString('base64url');
    const location = await saml.getAuthorizeUrlAsync(placeholder, undefined, {});
    const requestId = parseRequestId(location);
    const relayState = transactions.create(requestId);
    const url = new URL(location);
    url.searchParams.set('RelayState', relayState);
    return Object.freeze({ location: url.href, requestId, relayState });
  }

  async function validateSerial({ samlResponse, relayState }) {
    let shape;
    let expectedRequestIdDigest;
    try {
      shape = parseResponseShape(decodeCanonicalBase64(samlResponse));
      if (responseReplay.has(shape.responseId) || assertionReplay.has(shape.assertionId)) {
        fail('REPLAY_DETECTED', 'SAML message ID was already accepted');
      }
      expectedRequestIdDigest = transactions.store.get(relayState);
      if (expectedRequestIdDigest === null) {
        fail('RELAY_STATE_INVALID', 'RelayState is missing, expired, or not bound to this request');
      }
      if (!transactions.matches(relayState, shape.responseInResponseTo)) {
        fail('IN_RESPONSE_TO_INVALID', 'Response InResponseTo is not bound to this request');
      }
      let profile;
      try {
        ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse }));
      } catch (error) {
        fail(mapNodeSamlError(error, shape, now()), 'node-saml rejected the signed response', { cause: error });
      }
      semanticValidation(shape, profile, config, expectedRequestIdDigest, now());
      responseReplay.set(shape.responseId, true);
      assertionReplay.set(shape.assertionId, true);
      return Object.freeze({
        subject: profile.nameID,
        subjectDigest: sha256(profile.nameID),
        responseIdDigest: sha256(shape.responseId),
        assertionIdDigest: sha256(shape.assertionId),
        requestIdDigest: expectedRequestIdDigest,
      });
    } finally {
      if (typeof relayState === 'string' && relayState.length > 0) transactions.consume(relayState);
    }
  }

  function validateResponse(inputValue) {
    if (!inputValue || typeof inputValue !== 'object'
        || typeof inputValue.samlResponse !== 'string'
        || typeof inputValue.relayState !== 'string'
        || inputValue.relayState.length < 16
        || inputValue.relayState.length > 256) {
      return Promise.reject(new StrictSamlError('ACS_INPUT_INVALID', 'ACS input is invalid'));
    }
    const operation = validationTail.then(() => validateSerial(inputValue));
    validationTail = operation.catch(() => undefined);
    return operation;
  }

  return Object.freeze({
    beginLogin,
    validateResponse,
    diagnostics: () => Object.freeze({
      requestCount: cacheProvider.store.size,
      transactionCount: transactions.store.size,
      acceptedResponseCount: responseReplay.size,
      acceptedAssertionCount: assertionReplay.size,
      rawXmlRetained: false,
    }),
  });
}
