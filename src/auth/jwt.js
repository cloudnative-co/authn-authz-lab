import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

export function base64UrlDecode(input) {
  return Buffer.from(input, 'base64url');
}

export function signJwt(payload, privateKey, { kid, typ = 'JWT' } = {}) {
  const header = { alg: 'RS256', typ };
  if (kid !== undefined) header.kid = kid;
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyJwt(token, getPublicKey, { expectedTyp, clockToleranceSeconds = 30, now = Date.now() } = {}) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unsupported alg: ${header.alg}`);
  if (expectedTyp !== undefined && header.typ !== expectedTyp) throw new Error(`unexpected typ: ${header.typ}`);

  const publicKey = getPublicKey(header);
  if (!publicKey) throw new Error('signing key not found');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const valid = cryptoVerify('RSA-SHA256', Buffer.from(signingInput), publicKey, base64UrlDecode(encodedSignature));
  if (!valid) throw new Error('invalid signature');

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  const nowSeconds = Math.floor(now / 1000);
  if (typeof payload.exp === 'number' && nowSeconds > payload.exp + clockToleranceSeconds) {
    throw new Error('token expired');
  }
  if (typeof payload.nbf === 'number' && nowSeconds + clockToleranceSeconds < payload.nbf) {
    throw new Error('token not yet valid');
  }
  if (typeof payload.iat === 'number' && nowSeconds + clockToleranceSeconds < payload.iat) {
    throw new Error('token issued in the future');
  }
  return { header, payload };
}

export function publicKeyToJwk(publicKeyObject, kid) {
  return { ...publicKeyObject.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
}

export function createSigningKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const thumbprint = createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest('base64url');
  return { publicKey, privateKey, kid: thumbprint.slice(0, 16) };
}
