import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatNegotiateChallenge,
  negotiateHeaderLimits,
  parseNegotiateAuthorization,
} from '../../apps/project-app/lessons/07/negotiate-header.mjs';

test('missing authorization is a challenge, not a parser error', () => {
  assert.deepEqual(parseNegotiateAuthorization(undefined), {
    kind: 'absent',
    reason: 'NEGOTIATE_REQUIRED',
  });
});

test('scheme is case-insensitive and canonical Base64 token is accepted', () => {
  const parsed = parseNegotiateAuthorization('nEgOtIaTe YWJjZA==');
  assert.equal(parsed.kind, 'token');
  assert.equal(parsed.token, 'YWJjZA==');
});

test('malformed, non-canonical, empty and trailing input is rejected before GSSAPI', () => {
  const values = [
    '',
    'Negotiate',
    'Negotiate ',
    'Bearer YWJjZA==',
    'Negotiate abc',
    'Negotiate YWJjZA',
    'Negotiate YWJjZA===',
    'Negotiate YWJjZA== ',
    'Negotiate YWJj-ZA_',
    ['Negotiate YWJjZA=='],
  ];
  for (const value of values) {
    assert.deepEqual(parseNegotiateAuthorization(value), {
      kind: 'invalid',
      reason: 'NEGOTIATE_HEADER_INVALID',
    });
  }
});

test('header byte bound is enforced before token decoding', () => {
  const oversized = `Negotiate ${'A'.repeat(negotiateHeaderLimits.maxHeaderBytes)}`;
  assert.deepEqual(parseNegotiateAuthorization(oversized), {
    kind: 'invalid',
    reason: 'NEGOTIATE_HEADER_INVALID',
  });
  assert.throws(
    () => parseNegotiateAuthorization('Negotiate YQ==', { maxHeaderBytes: 100 }),
    /at least 256/,
  );
});

test('challenge formatter never forwards a malformed server token', () => {
  assert.equal(formatNegotiateChallenge(), 'Negotiate');
  assert.equal(formatNegotiateChallenge('YQ=='), 'Negotiate YQ==');
  assert.throws(() => formatNegotiateChallenge('not_base64'), /canonical Base64/);
});

