import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { canonicalJson, digestCanonical } from '../../course/runner/canonical.mjs';
import { CliUsageError, parseCli } from '../../course/runner/cli.mjs';
import { EXIT_CODES } from '../../course/runner/constants.mjs';
import { buildEvidence, writeEvidence } from '../../course/runner/evidence.mjs';
import { loadAndValidateManifest, ManifestError } from '../../course/runner/manifest.mjs';
import { allowlistRedactAndDigest } from '../../course/runner/redact.mjs';
import {
  createRunnerResult,
  exitCodeForResult,
  exitCodeForSignal,
  formatRunnerResult,
} from '../../course/runner/result.mjs';
import {
  assertValidSchema,
  loadJsonSchema,
  SchemaDefinitionError,
  SchemaValidationError,
  validateSchema,
} from '../../course/runner/schema.mjs';
import { createStateRoot, writeStateAtomically } from '../../course/runner/state.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix) {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function ownedEvidenceState() {
  const stateRoot = await mkdtemp(resolve(repositoryRoot, '.evidence-test-'));
  temporaryRoots.push(stateRoot);
  const manifest = await loadAndValidateManifest({ repoRoot: repositoryRoot });
  const context = await createStateRoot({
    repoRoot: repositoryRoot,
    stateRoot,
    courseId: manifest.manifest.courseId,
    sourceRevision: null,
    sourceDigest: manifest.sourceDigest,
  });
  const written = await writeStateAtomically({
    stateRoot,
    repoRoot: repositoryRoot,
    sourceRevision: null,
    sourceDigest: manifest.sourceDigest,
    state: {
      $schema: 'curriculum/schemas/state.schema.json',
      schemaVersion: 1,
      courseId: context.marker.courseId,
      installId: context.marker.installId,
      markerDigest: context.markerDigest,
      epoch: 1,
      lifecycle: 'stopped',
      lessons: manifest.manifest.lessons.map(({ id }) => ({
        id,
        lifecycle: 'not-started',
        lastRunId: null,
        evidenceIds: [],
      })),
      resources: manifest.manifest.resources.map(({ id }) => ({
        id,
        status: 'absent',
        ownershipDigest: null,
      })),
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
  });
  return { stateRoot, manifest, context: written };
}

function passingResult(overrides = {}) {
  return createRunnerResult({
    runId: 'run-1',
    courseId: 'auth-authz',
    scope: 'lesson',
    lessonId: '01',
    command: 'check',
    status: 'pass',
    checkIds: ['CHK-01'],
    durationMs: 12,
    ...overrides,
  });
}

function evidenceContext(overrides = {}) {
  return {
    generatedAt: '2026-07-11T00:00:00.000Z',
    supportProfileId: 'macos-arm64-node24',
    inputs: {
      articleContentDigest: null,
      manifestDigest: '1'.repeat(64),
      sampleSourceDigest: '2'.repeat(64),
      sampleRevision: null,
      stateEpoch: 3,
      stateMarkerDigest: '3'.repeat(64),
    },
    observations: [
      {
        checkId: 'CHK-01',
        outcome: 'pass',
        data: {
          statusCode: 200,
          password: 'do-not-store',
          ignored: 'also-do-not-store',
          trace: 'from /Users/alice/work to http://private.internal/path at 10.1.2.3',
        },
        allowlist: ['statusCode', 'password', 'trace'],
      },
    ],
    ...overrides,
  };
}

test('parseCli accepts the complete course and lesson grammar with flags in any position', () => {
  assert.deepEqual(parseCli(['--json', 'doctor', '--timeout=5']), {
    scope: 'course',
    lessonId: null,
    action: 'doctor',
    flags: { json: true, nonInteractive: false, timeoutMs: 5000, yes: false },
  });
  assert.deepEqual(parseCli(['lesson', '--non-interactive', '04', 'purge', '--yes', '--timeout', '25']), {
    scope: 'lesson',
    lessonId: '04',
    action: 'purge',
    flags: { json: false, nonInteractive: true, timeoutMs: 25_000, yes: true },
  });
  assert.equal(parseCli(['lesson', 'capstone', 'check']).lessonId, 'capstone');
});

test('parseCli rejects missing, unknown, duplicate, and malformed input as usage errors', () => {
  for (const argv of [
    [],
    ['demo'],
    ['lesson', '../01', 'check'],
    ['lesson', '01'],
    ['lesson', '01', 'unknown'],
    ['doctor', '--unknown'],
    ['doctor', '--json', '--json'],
    ['doctor', '--timeout', '0'],
    ['doctor', '--timeout', '3601'],
    ['doctor', '--yes'],
    ['purge'],
    ['purge', '--non-interactive'],
  ]) {
    assert.throws(() => parseCli(argv), (error) => {
      assert.ok(error instanceof CliUsageError);
      assert.equal(error.exitCode, EXIT_CODES.USAGE);
      assert.match(error.message, /Usage:/);
      return true;
    });
  }
});

test('plain and JSON renderings are projections of the same runner result', () => {
  const result = passingResult({ evidenceId: 'evidence-1' });
  assert.deepEqual(JSON.parse(formatRunnerResult(result, { json: true })), result);
  const plain = formatRunnerResult(result);
  for (const value of ['PASS', 'lesson 01 check', 'run-1', 'CHK-01', 'evidence-1']) assert.match(plain, new RegExp(value));
});

test('runner exit codes match the stable course contract', () => {
  assert.equal(exitCodeForResult(passingResult()), 0);
  assert.equal(exitCodeForResult(passingResult({ status: 'safe-noop' })), 0);
  assert.equal(exitCodeForResult(passingResult({ status: 'blocked', reasonCode: 'PREREQUISITE_NODE' })), 20);
  assert.equal(exitCodeForResult(passingResult({ status: 'fail', reasonCode: 'CHECK_MISMATCH' })), 10);
  assert.equal(exitCodeForResult(passingResult({ status: 'blocked', reasonCode: 'LOCK_HELD' })), 21);
  assert.equal(exitCodeForResult(passingResult({ status: 'blocked', reasonCode: 'INTERNAL_BUG' })), 30);
  assert.equal(exitCodeForResult(passingResult({ status: 'blocked', reasonCode: 'TIMEOUT_COMMAND' })), 31);
  assert.equal(exitCodeForSignal('SIGTERM'), 143);
  assert.throws(() => exitCodeForSignal('SIG_NOT_REAL'), /unknown signal/);
});

test('canonical JSON is stable and rejects values JSON would silently erase', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(digestCanonical({ b: 2, a: 1 }), digestCanonical({ a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ missing: undefined }), /not representable/);
  assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
});

test('schema validator supports the checked-in Draft 2020-12 subset and fails closed', async () => {
  const schema = await loadJsonSchema(resolve(repositoryRoot, 'curriculum/schemas/runner-result.schema.json'));
  assertValidSchema(passingResult(), schema, 'result');
  assert.throws(
    () => assertValidSchema({ ...passingResult(), unexpected: true }, schema, 'result'),
    SchemaValidationError,
  );
  assert.equal(validateSchema('x', { anyOf: [{ const: 'x' }, { const: 'y' }] }).valid, true);
  assert.equal(validateSchema(null, { oneOf: [{ type: 'null' }, { type: 'string' }] }).valid, true);
  assert.throws(() => validateSchema('x', { minLenght: 1 }), SchemaDefinitionError);
  assert.throws(() => validateSchema('x', { format: 'email' }), SchemaDefinitionError);
  assert.throws(
    () => validateSchema('x', { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' }),
    SchemaDefinitionError,
  );
});

test('allowlist precedes recursive redaction and yields a stable canonical digest', () => {
  const first = allowlistRedactAndDigest({
    statusCode: 200,
    password: 'secret-value',
    authorization: 'Bearer abc.def',
    'x-course-control-token': 'course-control-secret',
    trace: '/Users/alice/project 10.2.3.4 https://corp.internal/a',
    ignored: 'must-not-appear',
  }, { allowlist: ['statusCode', 'password', 'authorization', 'x-course-control-token', 'trace'] });
  const second = allowlistRedactAndDigest({
    trace: '/Users/bob/project 10.2.3.4 https://corp.internal/a',
    authorization: 'Bearer another-token',
    'x-course-control-token': 'different-course-control-secret',
    password: 'different-secret',
    statusCode: 200,
  }, { allowlist: ['trace', 'authorization', 'x-course-control-token', 'password', 'statusCode'] });
  const serialized = canonicalJson(first.redacted);
  for (const forbidden of ['secret-value', 'abc.def', 'course-control-secret', 'alice', '10.2.3.4', 'corp.internal', 'must-not-appear']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(first.redactedFieldClasses, ['home-path', 'hostname', 'ip-address', 'secret', 'token']);
  assert.equal(first.digest, second.digest);
  assert.throws(() => allowlistRedactAndDigest({ value: 'x' }, { allowlist: true }), /explicit array/);
  assert.throws(() => allowlistRedactAndDigest({ value: 'x' }, { allowlist: { value: true } }), /explicit array/);
  assert.throws(() => allowlistRedactAndDigest({ values: ['x'] }, { allowlist: ['values.*'] }), /unsafe/);
});

test('neutral trace fields redact Basic credentials, SAML responses, and session identifiers', () => {
  const first = allowlistRedactAndDigest({
    trace: 'Authorization: Basic YWxpY2U6c2VjcmV0 SAMLResponse=AAA session_id=first',
  }, { allowlist: ['trace'] });
  const second = allowlistRedactAndDigest({
    trace: 'Authorization: Basic Ym9iOm90aGVy SAMLResponse=BBB session_id=second',
  }, { allowlist: ['trace'] });
  assert.deepEqual(first.redactedFieldClasses, ['assertion', 'credential', 'token']);
  assert.equal(first.digest, second.digest);
  for (const secret of ['YWxpY2U6c2VjcmV0', 'AAA', 'first']) {
    assert.equal(canonicalJson(first.redacted).includes(secret), false);
  }
});

test('buildEvidence stores only observation digests and binds the final runner result', () => {
  const built = buildEvidence({ result: passingResult(), context: evidenceContext({ evidenceId: 'evidence-fixed' }) });
  assert.equal(built.result.evidenceId, 'evidence-fixed');
  assert.equal(built.evidence.runnerResultDigest, digestCanonical(built.result));
  assert.deepEqual(built.evidence.redaction.redactedFieldClasses, ['home-path', 'hostname', 'ip-address', 'secret']);
  const serialized = canonicalJson(built.evidence);
  for (const forbidden of ['do-not-store', 'also-do-not-store', 'alice', 'private.internal', '10.1.2.3']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.throws(
    () => buildEvidence({
      result: passingResult(),
      context: evidenceContext({ observations: [{ checkId: 'CHK-01', outcome: 'pass', data: { body: 'raw' } }] }),
    }),
    /no allowlist/,
  );
  assert.throws(
    () => buildEvidence({
      result: passingResult(),
      context: evidenceContext({ inputs: { ...evidenceContext().inputs, stateEpoch: undefined } }),
    }),
    /stateEpoch/,
  );
});

test('writeEvidence validates schemas and creates a private canonical evidence file', async () => {
  const unowned = await temporaryRoot('auth-authz-unowned-evidence-');
  await assert.rejects(
    writeEvidence({
      stateRoot: unowned,
      result: passingResult(),
      context: { ...evidenceContext(), repoRoot: repositoryRoot },
    }),
    /stateRoot escapes/,
  );
  const owned = await ownedEvidenceState();
  const inputs = {
    ...evidenceContext().inputs,
    manifestDigest: owned.manifest.manifestDigest,
    sampleSourceDigest: owned.manifest.sourceDigest,
    sampleRevision: null,
    stateEpoch: owned.context.state.epoch,
    stateMarkerDigest: owned.context.markerDigest,
  };
  const written = await writeEvidence({
    stateRoot: owned.stateRoot,
    result: passingResult(),
    context: {
      ...evidenceContext({ evidenceId: 'evidence-written', inputs }),
      repoRoot: repositoryRoot,
      supportEnvironment: {
        os: 'macos', architecture: 'arm64', nodeMajor: 24, nodeVersion: '24.16.0',
      },
    },
  });
  const contents = await readFile(written.path, 'utf8');
  assert.deepEqual(JSON.parse(contents), written.evidence);
  assert.equal(contents, `${canonicalJson(written.evidence)}\n`);
  assert.equal((await stat(written.path)).mode & 0o777, 0o600);
  assert.match(written.path, /evidence\/epoch-000001\/evidence-written\.json$/);
  await assert.rejects(
    writeEvidence({
      stateRoot: owned.stateRoot,
      result: passingResult(),
      context: {
        ...evidenceContext({ evidenceId: 'evidence-written', inputs }),
        repoRoot: repositoryRoot,
        supportEnvironment: {
          os: 'macos', architecture: 'arm64', nodeMajor: 24, nodeVersion: '24.16.0',
        },
      },
    }),
    /evidence already exists/,
  );
});

function fixtureManifest(sourceFiles = ['src/example.js']) {
  const course = {
    executable: 'node',
    arguments: ['course.mjs'],
    grammar: 'node course.mjs doctor|setup|diagnose|stop|reset|purge',
    actions: ['doctor', 'setup', 'diagnose', 'stop', 'reset', 'purge'],
  };
  return {
    $schema: './schemas/manifest.schema.json',
    schemaVersion: 2,
    courseId: 'fixture',
    implementationStatus: 'candidate',
    runtime: {
      node: { baselineMajor: 24, versionRange: '>=24 <25 || >=26 <27' },
      commands: {
        course,
        lesson: {
          ...course,
          arguments: ['course.mjs', 'lesson', '<id>'],
          grammar: 'node course.mjs lesson <id> doctor|setup|demo|observe|check|diagnose|reset|stop|purge',
          actions: ['doctor', 'setup', 'demo', 'observe', 'check', 'diagnose', 'reset', 'stop', 'purge'],
        },
      },
    },
    ports: [],
    resources: [],
    locks: [],
    lessons: [{
      id: '01',
      status: 'candidate',
      supportedNodeMajors: [24, 26],
      portIds: [],
      resourceIds: [],
      lockIds: [],
      sourceFiles,
    }],
  };
}

async function writeManifestFixture(sourceFiles = ['src/example.js']) {
  const root = await temporaryRoot('auth-authz-manifest-');
  await mkdir(resolve(root, 'curriculum/schemas'), { recursive: true });
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'curriculum/schemas/manifest.schema.json'), await readFile(resolve(repositoryRoot, 'curriculum/schemas/manifest.schema.json')));
  await writeFile(resolve(root, 'curriculum/manifest.json'), `${JSON.stringify(fixtureManifest(sourceFiles), null, 2)}\n`);
  await writeFile(resolve(root, 'src/example.js'), 'export const value = 1;\n');
  return root;
}

test('manifest loader validates schema, relationships, source files, and stable digests', async () => {
  const root = await writeManifestFixture();
  const first = await loadAndValidateManifest({ repoRoot: root });
  const second = await loadAndValidateManifest({ repoRoot: root });
  assert.equal(first.manifest.courseId, 'fixture');
  assert.deepEqual(first.sourceFiles.map(({ path }) => path), ['src/example.js']);
  assert.match(first.manifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.sourceDigest, second.sourceDigest);
});

test('manifest loader rejects missing and escaping source files', async () => {
  const missingRoot = await writeManifestFixture(['src/missing.js']);
  await assert.rejects(loadAndValidateManifest({ repoRoot: missingRoot }), ManifestError);

  const escapingRoot = await writeManifestFixture(['../outside.js']);
  await writeFile(resolve(escapingRoot, '..', 'outside.js'), 'outside\n');
  await assert.rejects(loadAndValidateManifest({ repoRoot: escapingRoot }), /invalid sourceFiles path/);
  await rm(resolve(escapingRoot, '..', 'outside.js'), { force: true });
});
