import { DOMParser } from '@xmldom/xmldom';

export const SAML_PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const SAML_ASSERTION = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const SAML_BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';

const MAX_XML_BYTES = 512 * 1024;
const MAX_BASE64_BYTES = 700 * 1024;
const MAX_NODES = 2048;
const MAX_DEPTH = 32;
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9._:-]{0,255}$/u;

export class SamlShapeError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'SamlShapeError';
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, message) {
  throw new SamlShapeError(reasonCode, message);
}

export function decodeCanonicalBase64(value) {
  if (typeof value !== 'string'
      || value.length === 0
      || Buffer.byteLength(value, 'ascii') > MAX_BASE64_BYTES
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail('SAML_RESPONSE_ENCODING_INVALID', 'SAMLResponse is not bounded canonical Base64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.length > MAX_XML_BYTES || decoded.toString('base64') !== value) {
    fail('SAML_RESPONSE_ENCODING_INVALID', 'SAMLResponse Base64 is not canonical');
  }
  return decoded.toString('utf8');
}

function directElements(node, namespaceURI, localName) {
  const values = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.namespaceURI === namespaceURI && child.localName === localName) {
      values.push(child);
    }
  }
  return values;
}

function exactlyOne(node, namespaceURI, localName, reasonCode) {
  const values = directElements(node, namespaceURI, localName);
  if (values.length !== 1) fail(reasonCode, `${localName} must appear exactly once`);
  return values[0];
}

function attribute(element, name, reasonCode) {
  const value = element.getAttribute(name);
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    fail(reasonCode, `${name} is missing or invalid`);
  }
  return value;
}

function exactText(element, reasonCode) {
  if (directElements(element, SAML_ASSERTION, 'unexpected').length > 0) {
    fail(reasonCode, 'text element has child elements');
  }
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (![3, 4].includes(child.nodeType) && !(child.nodeType === 8)) {
      fail(reasonCode, 'text element has unexpected content');
    }
  }
  const value = element.textContent?.trim();
  if (!value || value.length > 512) fail(reasonCode, 'text element is empty or too large');
  return value;
}

function assertDocumentBounds(document) {
  let count = 0;
  const walk = (node, depth) => {
    count += 1;
    if (count > MAX_NODES || depth > MAX_DEPTH) fail('SAML_XML_LIMIT', 'SAML XML exceeds limits');
    if (node.nodeType === 1 && node.attributes.length > 64) {
      fail('SAML_XML_LIMIT', 'SAML element has too many attributes');
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child, depth + 1);
  };
  walk(document, 0);
}

export function parseResponseShape(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    fail('SAML_XML_LIMIT', 'SAML XML is missing or too large');
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/iu.test(xml)) {
    fail('SAML_XML_FORBIDDEN', 'SAML XML contains a forbidden declaration');
  }
  const parseErrors = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => parseErrors.push(message),
      error: (message) => parseErrors.push(message),
      fatalError: (message) => parseErrors.push(message),
    },
  }).parseFromString(xml, 'application/xml');
  if (parseErrors.length > 0) fail('SAML_XML_INVALID', 'SAML XML could not be parsed');
  assertDocumentBounds(document);
  const root = document.documentElement;
  if (!root || root.namespaceURI !== SAML_PROTOCOL || root.localName !== 'Response') {
    fail('SAML_STRUCTURE_INVALID', 'root must be one SAML Response');
  }
  const documentElements = [...Array.from(document.childNodes)].filter((node) => node.nodeType === 1);
  if (documentElements.length !== 1 || documentElements[0] !== root) {
    fail('SAML_STRUCTURE_INVALID', 'document must contain one root element');
  }
  const assertions = directElements(root, SAML_ASSERTION, 'Assertion');
  const encrypted = directElements(root, SAML_ASSERTION, 'EncryptedAssertion');
  if (assertions.length !== 1 || encrypted.length !== 0) {
    fail('SAML_STRUCTURE_INVALID', 'Response must contain exactly one unencrypted Assertion');
  }
  const assertion = assertions[0];
  const responseIssuer = exactlyOne(root, SAML_ASSERTION, 'Issuer', 'RESPONSE_ISSUER_INVALID');
  const assertionIssuer = exactlyOne(assertion, SAML_ASSERTION, 'Issuer', 'ASSERTION_ISSUER_INVALID');
  const status = exactlyOne(root, SAML_PROTOCOL, 'Status', 'SAML_STATUS_INVALID');
  const statusCode = exactlyOne(status, SAML_PROTOCOL, 'StatusCode', 'SAML_STATUS_INVALID');
  if (attribute(statusCode, 'Value', 'SAML_STATUS_INVALID')
      !== 'urn:oasis:names:tc:SAML:2.0:status:Success') {
    fail('SAML_STATUS_INVALID', 'SAML status is not Success');
  }
  const subject = exactlyOne(assertion, SAML_ASSERTION, 'Subject', 'SUBJECT_CONFIRMATION_INVALID');
  const nameId = exactlyOne(subject, SAML_ASSERTION, 'NameID', 'SUBJECT_INVALID');
  const confirmation = exactlyOne(
    subject, SAML_ASSERTION, 'SubjectConfirmation', 'SUBJECT_CONFIRMATION_INVALID',
  );
  const confirmationData = exactlyOne(
    confirmation, SAML_ASSERTION, 'SubjectConfirmationData', 'SUBJECT_CONFIRMATION_INVALID',
  );
  const conditions = exactlyOne(assertion, SAML_ASSERTION, 'Conditions', 'CONDITIONS_INVALID');
  const audienceRestriction = exactlyOne(
    conditions, SAML_ASSERTION, 'AudienceRestriction', 'AUDIENCE_INVALID',
  );
  const audience = exactlyOne(audienceRestriction, SAML_ASSERTION, 'Audience', 'AUDIENCE_INVALID');
  const responseId = attribute(root, 'ID', 'RESPONSE_ID_INVALID');
  const assertionId = attribute(assertion, 'ID', 'ASSERTION_ID_INVALID');
  if (!SAFE_ID.test(responseId) || !SAFE_ID.test(assertionId) || responseId === assertionId) {
    fail('SAML_ID_INVALID', 'Response and Assertion IDs must be distinct bounded identifiers');
  }
  return Object.freeze({
    document,
    root,
    assertion,
    responseId,
    assertionId,
    responseIssuer: exactText(responseIssuer, 'RESPONSE_ISSUER_INVALID'),
    assertionIssuer: exactText(assertionIssuer, 'ASSERTION_ISSUER_INVALID'),
    destination: attribute(root, 'Destination', 'DESTINATION_INVALID'),
    responseInResponseTo: attribute(root, 'InResponseTo', 'IN_RESPONSE_TO_INVALID'),
    subject: exactText(nameId, 'SUBJECT_INVALID'),
    confirmationMethod: attribute(confirmation, 'Method', 'SUBJECT_CONFIRMATION_METHOD_INVALID'),
    recipient: attribute(confirmationData, 'Recipient', 'SUBJECT_CONFIRMATION_RECIPIENT_INVALID'),
    subjectInResponseTo: attribute(
      confirmationData, 'InResponseTo', 'SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID',
    ),
    subjectNotOnOrAfter: attribute(
      confirmationData, 'NotOnOrAfter', 'SUBJECT_CONFIRMATION_EXPIRY_INVALID',
    ),
    subjectNotBeforePresent: confirmationData.hasAttribute('NotBefore'),
    conditionsNotBefore: attribute(conditions, 'NotBefore', 'CONDITIONS_INVALID'),
    conditionsNotOnOrAfter: attribute(conditions, 'NotOnOrAfter', 'CONDITIONS_INVALID'),
    audience: exactText(audience, 'AUDIENCE_INVALID'),
  });
}
