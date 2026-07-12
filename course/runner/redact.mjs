import { isIP } from 'node:net';
import { digestCanonical } from './canonical.mjs';

const REDACTION_MARKERS = Object.freeze({
  secret: '[REDACTED:secret]',
  token: '[REDACTED:token]',
  assertion: '[REDACTED:assertion]',
  credential: '[REDACTED:credential]',
  hostname: '[REDACTED:hostname]',
  'home-path': '<HOME>',
  'ip-address': '[REDACTED:ip-address]',
});
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype', '$include']);

function createTree() {
  return Object.create(null);
}

function allowlistTree(allowlist) {
  if (Array.isArray(allowlist)) {
    const root = createTree();
    for (const path of allowlist) {
      if (typeof path !== 'string' || path.length === 0) throw new TypeError('allowlist paths must be non-empty strings');
      let node = root;
      for (const segment of path.split('.')) {
        if (!segment || segment === '*' || DANGEROUS_KEYS.has(segment)) throw new TypeError(`unsafe allowlist path: ${path}`);
        node[segment] ??= createTree();
        node = node[segment];
      }
      node.$include = true;
    }
    return root;
  }
  throw new TypeError('allowlist must be an explicit array of field paths');
}

function copyAllowed(value, tree, path, ancestors) {
  if (tree?.$include === true) return structuredClone(value);
  if (value === null || typeof value !== 'object') return undefined;
  if (ancestors.has(value)) throw new TypeError(`${path}: circular input cannot be allowlisted`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return [];
    }
    const output = createTree();
    for (const [key, childTree] of Object.entries(tree)) {
      if (key === '$include') continue;
      if (Object.hasOwn(value, key)) output[key] = copyAllowed(value[key], childTree, `${path}.${key}`, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function selectAllowlisted(value, allowlist) {
  return copyAllowed(value, allowlistTree(allowlist), '$', new Set());
}

function sensitiveClassForKey(key) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  if (/(?:password|passphrase|secret|privatekey|signingkey|encryptionkey)/.test(normalized)) return 'secret';
  if (/(?:samlassertion|samlresponse|assertion)/.test(normalized)) return 'assertion';
  if (/(?:authorization|accesstoken|refreshtoken|idtoken|bearertoken|controltoken|shutdowntoken|sessionid|cookie)/.test(normalized)) return 'token';
  if (/(?:credential|keytab|recoverycode|totp|otpseed)/.test(normalized)) return 'credential';
  if (/^(?:host|hostname|hostfqdn)$/.test(normalized)) return 'hostname';
  if (/^(?:ip|ipaddress|remoteaddress|clientip)$/.test(normalized)) return 'ip-address';
  return null;
}

function redactString(value, classes) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) {
    classes.add('secret');
    return REDACTION_MARKERS.secret;
  }
  if (/<(?:[A-Za-z0-9_-]+:)?Assertion\b/i.test(value)) {
    classes.add('assertion');
    return REDACTION_MARKERS.assertion;
  }
  let output = value;
  output = output.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g, () => {
    classes.add('token');
    return REDACTION_MARKERS.token;
  });
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, () => {
    classes.add('token');
    return `Bearer ${REDACTION_MARKERS.token}`;
  });
  output = output.replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, () => {
    classes.add('credential');
    return `Basic ${REDACTION_MARKERS.credential}`;
  });
  output = output.replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?=\/|\s|$)/g, () => {
    classes.add('home-path');
    return REDACTION_MARKERS['home-path'];
  });
  output = output.replace(/\b[A-Za-z]:\\Users\\[^\\\s]+(?=\\|\s|$)/g, () => {
    classes.add('home-path');
    return REDACTION_MARKERS['home-path'];
  });
  output = output.replace(/\b(password|passphrase|secret|client_secret|token|assertion|SAMLResponse|credential|session_id)=([^&\s;]+)/gi, (_, key) => {
    const normalized = key.toLowerCase();
    const sensitiveClass = normalized === 'assertion' || normalized === 'samlresponse'
      ? 'assertion'
      : normalized === 'credential'
        ? 'credential'
        : normalized === 'token' || normalized === 'session_id'
          ? 'token'
          : 'secret';
    classes.add(sensitiveClass);
    return `${key}=${REDACTION_MARKERS[sensitiveClass]}`;
  });
  output = output.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (address) => {
    if (address === '127.0.0.1') return address;
    classes.add('ip-address');
    return REDACTION_MARKERS['ip-address'];
  });
  output = output.replace(/\[?[A-Fa-f0-9:]{2,}\]?/g, (candidate) => {
    const address = candidate.replace(/^\[|\]$/g, '');
    if (isIP(address) !== 6 || address === '::1') return candidate;
    classes.add('ip-address');
    return REDACTION_MARKERS['ip-address'];
  });
  output = output.replace(/\bhttps?:\/\/([^/:\s]+)(?::\d+)?/gi, (url, hostname) => {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (LOOPBACK_HOSTS.has(normalized) || normalized.endsWith('.example') || normalized === 'example.com') return url;
    classes.add('hostname');
    return url.replace(hostname, REDACTION_MARKERS.hostname);
  });
  output = output.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi, (hostname) => {
    const normalized = hostname.toLowerCase();
    if (normalized.endsWith('.example') || normalized === 'example.com') return hostname;
    classes.add('hostname');
    return REDACTION_MARKERS.hostname;
  });
  return output;
}

function redactNode(value, classes, ancestors) {
  if (typeof value === 'string') return redactString(value, classes);
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new TypeError('circular input cannot be redacted');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => redactNode(entry, classes, ancestors));
    const output = createTree();
    for (const [key, child] of Object.entries(value)) {
      const sensitiveClass = sensitiveClassForKey(key);
      if (sensitiveClass) {
        if (
          typeof child === 'string'
          && (sensitiveClass === 'hostname' || sensitiveClass === 'ip-address')
          && LOOPBACK_HOSTS.has(child.toLowerCase().replace(/^\[|\]$/g, ''))
        ) {
          output[key] = child;
          continue;
        }
        classes.add(sensitiveClass);
        output[key] = REDACTION_MARKERS[sensitiveClass];
      } else {
        output[key] = redactNode(child, classes, ancestors);
      }
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function redactRecursively(value) {
  const classes = new Set();
  const redacted = redactNode(value, classes, new Set());
  return { redacted, redactedFieldClasses: [...classes].sort() };
}

export function allowlistRedactAndDigest(value, { allowlist }) {
  const allowed = selectAllowlisted(value, allowlist);
  const { redacted, redactedFieldClasses } = redactRecursively(allowed);
  return { redacted, redactedFieldClasses, digest: digestCanonical(redacted) };
}
