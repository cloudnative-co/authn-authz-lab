import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), 'utf8'));
}

test('the host install excludes the native Kerberos addon', async () => {
  const manifest = await readJson('package.json');
  const lockfile = await readJson('package-lock.json');

  assert.equal(manifest.engines.node, '>=24 <25 || >=26 <27');
  assert.equal(manifest.dependencies?.kerberos, undefined);
  assert.equal(lockfile.packages[''].dependencies?.kerberos, undefined);
  assert.equal(lockfile.packages['node_modules/kerberos'], undefined);
});

test('the lesson 07 container owns the Kerberos dependency and lockfile', async () => {
  const manifest = await readJson('docker/kerberos/app/package.json');
  const lockfile = await readJson('docker/kerberos/app/package-lock.json');

  assert.equal(manifest.private, true);
  assert.equal(manifest.engines.node, '>=24 <25');
  assert.deepEqual(Object.keys(manifest.dependencies), ['kerberos']);
  assert.equal(manifest.dependencies.kerberos, '7.0.0');
  assert.equal(manifest.allowScripts, undefined);
  assert.equal(lockfile.packages[''].dependencies.kerberos, '7.0.0');
  assert.ok(lockfile.packages['node_modules/kerberos']);
});

test('the Kerberos app image installs only its dedicated locked dependencies', async () => {
  const dockerfile = await readFile(new URL('docker/kerberos/app/Dockerfile', repositoryRoot), 'utf8');
  const copyMatch = dockerfile.match(/^COPY (docker\/kerberos\/app\/package\.json) (docker\/kerberos\/app\/package-lock\.json) \.\/$/m);

  assert.ok(copyMatch, 'Dockerfile must copy the lesson 07 package files');
  assert.doesNotMatch(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev --ignore-scripts=false$/m);

  for (const source of copyMatch.slice(1)) {
    await access(new URL(source, repositoryRoot));
  }

  const dockerignore = (await readFile(new URL('.dockerignore', repositoryRoot), 'utf8')).split(/\r?\n/);
  for (const pattern of [
    'docker',
    '!docker/',
    'docker/*',
    '!docker/kerberos/',
    'docker/kerberos/*',
    '!docker/kerberos/app/',
    'docker/kerberos/app/*',
    '!docker/kerberos/app/server.mjs',
    '!docker/kerberos/app/package.json',
    '!docker/kerberos/app/package-lock.json',
  ]) {
    assert.ok(dockerignore.includes(pattern), `.dockerignore is missing ${pattern}`);
  }
});
