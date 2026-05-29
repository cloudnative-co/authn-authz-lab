import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueServiceTicket({ principal, service, groups = [], ttlMs = 300_000 }, secret, now = Date.now()) {
  const payload = {
    principal,
    service,
    groups,
    expiresAt: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(secret, encoded)}`;
}

export function validateServiceTicket(ticket, expectedService, secret, now = Date.now()) {
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(secret, encoded);
  const ok = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) return null;

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (payload.service !== expectedService || payload.expiresAt <= now) return null;
  return payload;
}
