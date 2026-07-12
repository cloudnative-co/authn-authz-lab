import { DOMParser } from '@xmldom/xmldom';

const METADATA = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const MAX_METADATA_BYTES = 512 * 1024;

function descendants(node, namespaceURI, localName) {
  return Array.from(node.getElementsByTagNameNS(namespaceURI, localName));
}

function pem(value) {
  const compact = value.replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact) || compact.length < 256 || compact.length > 32 * 1024) {
    throw new Error('IdP certificate in metadata is invalid');
  }
  return `-----BEGIN CERTIFICATE-----\n${compact.match(/.{1,64}/gu).join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function parseIdpMetadata(xml, { expectedEntityId } = {}) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_METADATA_BYTES
      || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new Error('IdP metadata is invalid or exceeds limits');
  }
  const errors = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (errors.length > 0 || root?.namespaceURI !== METADATA || root.localName !== 'EntityDescriptor') {
    throw new Error('IdP metadata root is invalid');
  }
  const entityId = root.getAttribute('entityID');
  if (!entityId || entityId.length > 1024 || (expectedEntityId && entityId !== expectedEntityId)) {
    throw new Error('IdP metadata entityID mismatch');
  }
  const descriptors = descendants(root, METADATA, 'IDPSSODescriptor');
  if (descriptors.length !== 1) throw new Error('IdP metadata must contain one IDPSSODescriptor');
  const services = descendants(descriptors[0], METADATA, 'SingleSignOnService')
    .filter((service) => service.getAttribute('Binding') === REDIRECT);
  if (services.length !== 1) throw new Error('IdP metadata must contain one Redirect SSO endpoint');
  const entryPoint = services[0].getAttribute('Location');
  const signingDescriptors = descendants(descriptors[0], METADATA, 'KeyDescriptor')
    .filter((descriptor) => ['', 'signing'].includes(descriptor.getAttribute('use')));
  const certs = signingDescriptors.flatMap((descriptor) => descendants(descriptor, DSIG, 'X509Certificate'));
  if (certs.length === 0 || certs.length > 4) throw new Error('IdP signing certificate set is invalid');
  return Object.freeze({
    entityId,
    entryPoint: new URL(entryPoint).href,
    certs: Object.freeze(certs.map((cert) => pem(cert.textContent))),
  });
}

async function boundedText(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) {
    throw new Error('IdP metadata exceeds limits');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_METADATA_BYTES) throw new Error('IdP metadata exceeds limits');
  return body;
}

export async function fetchIdpMetadata(url, { expectedEntityId, retries = 40, signal } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const timeout = AbortSignal.timeout(5000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, { redirect: 'error', signal: combined });
      if (response.status === 200) {
        return parseIdpMetadata(await boundedText(response), { expectedEntityId });
      }
      lastError = new Error(`metadata endpoint returned HTTP ${response.status}`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }
  throw new Error(`IdP metadata did not become available: ${String(lastError?.message ?? 'unknown')}`);
}
