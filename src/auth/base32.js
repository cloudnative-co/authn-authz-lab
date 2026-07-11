const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CHAR_INDEX = new Map([...ALPHABET].map((char, index) => [char, index]));

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  while (output.length % 8 !== 0) {
    output += '=';
  }
  return output;
}

export function base32Decode(text) {
  const normalized = String(text)
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of normalized) {
    const index = CHAR_INDEX.get(char);
    if (index === undefined) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
