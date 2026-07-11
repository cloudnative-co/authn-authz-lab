// Display-only decoders for teaching. These read the wire format so the article
// can show "what is inside" a WebAuthn response. They are NOT used for
// verification — @simplewebauthn/server does the real, security-critical work
// (signature, attestation, CBOR parsing).

function toBuffer(input) {
  return typeof input === 'string' ? Buffer.from(input, 'base64url') : Buffer.from(input);
}

// clientDataJSON is plain UTF-8 JSON: { type, challenge, origin, crossOrigin }.
export function decodeClientDataJSON(input) {
  return JSON.parse(toBuffer(input).toString('utf8'));
}

// authenticatorData begins with a fixed 37-byte header:
//   rpIdHash (32B) | flags (1B) | signCount (4B, big-endian)
// followed by variable attested credential data / extensions.
export function parseAuthenticatorData(input) {
  const buffer = toBuffer(input);
  if (buffer.length < 37) throw new Error('authenticatorData is shorter than the 37-byte header');

  const flags = buffer[32];
  return {
    rpIdHash: buffer.subarray(0, 32).toString('hex'),
    flags: {
      userPresent: Boolean(flags & 0x01),
      userVerified: Boolean(flags & 0x04),
      backupEligible: Boolean(flags & 0x08),
      backupState: Boolean(flags & 0x10),
      attestedCredentialData: Boolean(flags & 0x40),
      extensionData: Boolean(flags & 0x80),
    },
    signCount: buffer.readUInt32BE(33),
  };
}
