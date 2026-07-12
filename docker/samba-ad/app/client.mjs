import { readFile } from 'node:fs/promises';

const ORIGIN = 'http://127.0.0.1:3008';
const MAX_INPUT_BYTES = 4096;
const MAX_OUTPUT_BYTES = 32 * 1024;

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error('input too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('input is invalid');
  return value;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_OUTPUT_BYTES) throw new Error('response too large');
  const value = JSON.parse(buffer.toString('utf8'));
  process.stdout.write(`${JSON.stringify({ status: response.status, body: value })}\n`);
}

const action = process.argv[2];
const input = await readInput();

if (action === 'health') {
  await request('/health');
} else if (action === 'reset') {
  const control = await readFile('/run/secrets/lesson08_control_token', 'utf8');
  await request('/__course/reset', { method: 'POST', headers: { 'x-course-control': control } });
} else if (action === 'login') {
  await request('/login', { method: 'POST', body: input });
} else if (action === 'session') {
  await request('/session', { headers: { authorization: `Session ${input.sessionToken}` } });
} else if (action === 'revalidate') {
  await request('/session/revalidate', {
    method: 'POST',
    headers: { authorization: `Session ${input.sessionToken}` },
  });
} else if (action === 'write-probe') {
  await request('/service-account/write-probe', { method: 'POST' });
} else if (action === 'policy') {
  await request('/policy');
} else {
  throw new Error('action is invalid');
}
