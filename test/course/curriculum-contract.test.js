import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { buildCourseContract, generateArtifacts } from '../../scripts/sync-course-contract.mjs';
import { validateSchema } from '../../course/runner/schema.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstreamSource = resolve(
  repositoryRoot,
  '../ghost-writer-okash1n/articles/series/auth-authz/curriculum.json',
);
const authoritativeSource = existsSync(upstreamSource)
  ? upstreamSource
  : resolve(repositoryRoot, 'curriculum/course-source.snapshot.json');
const generator = resolve(repositoryRoot, 'scripts/sync-course-contract.mjs');
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));
}

function fixtureSource() {
  return {
    schemaVersion: 2,
    courseId: 'fixture-course',
    title: 'Fixture Course',
    assessmentArtifactContract: {
      labRequiredEntries: [
        'artifactStatus',
        'labTask',
        'rubric',
        'answerKeyRef',
        'instructorGuideRef',
        'automatedCheckRefs',
        'requiredChecks',
        'procedure',
      ],
      labRequiredEntriesWhen: 'artifactStatus=implemented',
      plannedRequiredEntries: ['artifactStatus', 'implementationNote'],
      labTaskRequiredEntries: [
        'instructionsRef',
        'predict',
        'execute',
        'rejectOrFail',
        'evidence',
        'practicalTransfer',
      ],
      requiredCheckSchema: [
        'id',
        'mode',
        'assessmentId',
        'objectiveIds',
        'courseOutcomeIds',
        'evidenceType',
        'required',
        'mappingBasis',
      ],
    },
    extensionArtifactContract: {
      referenceField: 'lessons[].extensionTaskRef',
      requiredEntries: [
        '$schema',
        'schemaVersion',
        'courseId',
        'lessonId',
        'status',
        'title',
        'estimatedMinutes',
        'prerequisiteCheckIds',
        'tasks',
        'evidenceBoundary',
      ],
      taskRequiredEntries: ['id', 'prompt', 'acceptance'],
      releaseGate: 'positive extensionMinutes requires a validated artifact',
    },
    courseOutcomes: [{ id: 'CO1', statement: 'result' }],
    lessons: [
      {
        id: 'setup',
        kind: 'course-setup',
        module: 'orientation',
        articleSlug: null,
        environmentRef: 'curriculum/support-matrix.json#lessons.setup',
        learningPrerequisites: [],
        estimatedMinutes: 10,
        extensionMinutes: 0,
        objectives: [{ id: 'O1', courseOutcomeIds: ['CO1'], statement: 'objective' }],
        assessments: [
          {
            id: 'A1',
            artifactStatus: 'implemented',
            objectiveIds: ['O1'],
            type: 'automated',
            artifactSetRef: 'course/lessons/setup/assessment.yaml#A1',
            requiredCheckIds: ['C1'],
            evidence: 'result',
            passCriteria: 'pass',
            labTask: {
              instructionsRef: 'course/lessons/setup/README.md',
              predict: 'predict the state transition',
              execute: 'execute the documented setup workflow',
              rejectOrFail: 'inspect and correct a failed check',
              evidence: 'capture the generated evidence ID',
              practicalTransfer: 'apply the workflow to another training environment',
            },
            rubric: {
              scoringMethod: 'all-required-checks',
              passRule: 'all required checks pass',
              failureRule: 'any required check fails',
            },
            answerKeyRef: 'course/lessons/setup/answer-key.md',
            instructorGuideRef: 'course/lessons/setup/instructor-guide.md',
            automatedCheckRefs: [
              'course/runner/main.mjs',
              'test/course/assessment-contract.test.js',
            ],
            procedure: [
              {
                kind: 'command',
                step: 1,
                command: 'node course.mjs lesson setup check',
                expectedStatus: 'pass',
                checkIds: ['C1'],
                terminal: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

function plannedFixtureSource() {
  const source = fixtureSource();
  const assessment = source.lessons[0].assessments[0];
  assessment.artifactStatus = 'planned';
  assessment.implementationNote = 'このassessmentの実習・採点資料・自動検証は未実装です。';
  for (const field of [
    'labTask',
    'rubric',
    'answerKeyRef',
    'instructorGuideRef',
    'automatedCheckRefs',
    'procedure',
    'optionalRecoveryScenarios',
  ]) delete assessment[field];
  return source;
}

function copyFixtureReferences(outputRoot, source = fixtureSource()) {
  const assessment = source.lessons[0].assessments[0];
  if (assessment.artifactStatus !== 'implemented') return;
  const references = [
    assessment.labTask.instructionsRef,
    assessment.answerKeyRef,
    assessment.instructorGuideRef,
    ...assessment.automatedCheckRefs,
  ];
  for (const reference of references) {
    const destination = resolve(outputRoot, reference);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(repositoryRoot, reference), destination);
  }
}

test('generated course contract preserves complete ID traceability', () => {
  const contract = readJson('curriculum/course-contract.json');
  const assessmentSchema = readJson('curriculum/schemas/assessment.schema.json');
  const extensionSchema = readJson('curriculum/schemas/extension.schema.json');
  const outcomeIds = new Set(contract.courseOutcomes.map(({ id }) => id));
  const lessonIds = new Set(contract.lessons.map(({ id }) => id));
  const objectiveIds = new Set(contract.lessons.flatMap((lesson) => lesson.objectives.map(({ id }) => id)));
  const assessmentIds = new Set(contract.lessons.flatMap((lesson) => lesson.assessments.map(({ id }) => id)));
  const checkIds = new Set(contract.lessons.flatMap((lesson) => lesson.requiredChecks.map(({ id }) => id)));

  assert.deepEqual(contract.traceability, {
    courseOutcomeCount: contract.courseOutcomes.length,
    lessonCount: contract.lessons.length,
    objectiveCount: contract.lessons.flatMap(({ objectives }) => objectives).length,
    assessmentCount: contract.lessons.flatMap(({ assessments }) => assessments).length,
    requiredCheckCount: contract.lessons.flatMap(({ requiredChecks }) => requiredChecks).length,
    requiredCheckMappingBasis: 'assessment-objective-closure',
  });
  for (const lesson of contract.lessons) {
    assert.equal(lesson.environmentRef, `curriculum/support-matrix.json#lessons.${lesson.id}`);
    if (lesson.articleSlug === null) {
      assert.equal(lesson.readingAssessmentRef, null);
    } else {
      assert.equal(
        lesson.readingAssessmentRef,
        `episodes/${lesson.id}-${lesson.articleSlug}/assessment.yaml#${lesson.assessments[0].id}`,
      );
    }
    if (lesson.extensionMinutes === 0) {
      assert.equal(lesson.extensionTaskRef, null);
    } else {
      assert.equal(lesson.extensionTaskRef, `course/lessons/${lesson.id}/extension.yaml`);
      const extension = readJson(lesson.extensionTaskRef);
      assert.equal(validateSchema(extension, extensionSchema).valid, true, lesson.extensionTaskRef);
      assert.equal(extension.lessonId, lesson.id);
      assert.equal(extension.estimatedMinutes, lesson.extensionMinutes);
      assert.deepEqual(
        extension.prerequisiteCheckIds,
        lesson.requiredChecks.map(({ id }) => id),
      );
    }
    for (const prerequisiteId of lesson.learningPrerequisites) assert.ok(lessonIds.has(prerequisiteId));
    const localObjectives = new Set(lesson.objectives.map(({ id }) => id));
    for (const objective of lesson.objectives) {
      for (const outcomeId of objective.courseOutcomeIds) assert.ok(outcomeIds.has(outcomeId));
    }
    const localChecks = new Map(lesson.requiredChecks.map((check) => [check.id, check]));
    for (const assessment of lesson.assessments) {
      assert.ok(assessmentIds.has(assessment.id));
      const [artifactPath, fragment] = assessment.artifactSetRef.split('#');
      assert.equal(fragment, assessment.id);
      assert.equal(existsSync(resolve(repositoryRoot, artifactPath)), true, artifactPath);
      const artifact = JSON.parse(readFileSync(resolve(repositoryRoot, artifactPath), 'utf8'));
      assert.equal(validateSchema(artifact, assessmentSchema).valid, true, artifactPath);
      assert.equal(artifact.courseId, contract.courseId);
      assert.equal(artifact.lessonId, lesson.id);
      assert.equal(artifact.assessment.id, assessment.id);
      assert.equal(artifact.assessment.artifactStatus, assessment.artifactStatus);
      assert.equal(Object.hasOwn(artifact.assessment, 'requiredCheckIds'), false);
      if (assessment.artifactStatus === 'implemented') {
        const expectedChecks = lesson.requiredChecks.filter(
          (check) => check.assessmentId === assessment.id,
        );
        assert.deepEqual(artifact.assessment.requiredChecks, expectedChecks);
        for (const phase of ['predict', 'execute', 'rejectOrFail', 'evidence', 'practicalTransfer']) {
          assert.ok(artifact.assessment.labTask[phase].length > 0, `${artifactPath}:${phase}`);
        }
        const references = [
          artifact.assessment.labTask.instructionsRef,
          artifact.assessment.answerKeyRef,
          artifact.assessment.instructorGuideRef,
          ...artifact.assessment.automatedCheckRefs,
        ];
        for (const reference of references) {
          assert.equal(existsSync(resolve(repositoryRoot, reference)), true, reference);
        }
      } else {
        assert.match(artifact.assessment.implementationNote, /未実装/);
        for (const field of [
          'labTask',
          'rubric',
          'answerKeyRef',
          'instructorGuideRef',
          'automatedCheckRefs',
          'requiredChecks',
          'procedure',
          'optionalRecoveryScenarios',
        ]) assert.equal(Object.hasOwn(artifact.assessment, field), false, `${artifactPath}:${field}`);
      }
      for (const objectiveId of assessment.objectiveIds) assert.ok(localObjectives.has(objectiveId));
      for (const checkId of assessment.requiredCheckIds) {
        assert.ok(checkIds.has(checkId));
        assert.equal(localChecks.get(checkId).assessmentId, assessment.id);
      }
    }
    for (const check of lesson.requiredChecks) {
      assert.equal(check.mappingBasis, 'assessment-objective-closure');
      assert.equal(check.required, true);
      assert.equal(check.mode, 'lab');
      assert.ok(assessmentIds.has(check.assessmentId));
      for (const objectiveId of check.objectiveIds) assert.ok(objectiveIds.has(objectiveId));
      for (const outcomeId of check.courseOutcomeIds) assert.ok(outcomeIds.has(outcomeId));
    }
  }
});

test('generated artifact statuses match the authoritative course source', () => {
  const contract = readJson('curriculum/course-contract.json');
  const source = readJson('curriculum/course-source.snapshot.json');
  assert.equal(
    source.assessmentArtifactContract.labRequiredEntriesWhen,
    'artifactStatus=implemented',
  );
  assert.deepEqual(source.assessmentArtifactContract.labRequiredEntries, [
    'artifactStatus',
    'labTask',
    'rubric',
    'answerKeyRef',
    'instructorGuideRef',
    'automatedCheckRefs',
    'requiredChecks',
    'procedure',
  ]);
  assert.deepEqual(
    source.assessmentArtifactContract.plannedRequiredEntries,
    ['artifactStatus', 'implementationNote'],
  );
  const statuses = contract.lessons.map((lesson) => lesson.assessments[0].artifactStatus);
  const sourceStatuses = source.lessons.map((lesson) => lesson.assessments[0].artifactStatus);
  assert.deepEqual(statuses, sourceStatuses);
  assert.equal(
    statuses.filter((status) => status === 'implemented').length,
    sourceStatuses.filter((status) => status === 'implemented').length,
  );
  assert.equal(
    statuses.filter((status) => status === 'planned').length,
    sourceStatuses.filter((status) => status === 'planned').length,
  );

  const setupArtifact = readJson('course/lessons/setup/assessment.yaml');
  const setup = setupArtifact.assessment;
  assert.equal(setup.answerKeyRef, 'course/lessons/setup/answer-key.md');
  assert.equal(setup.instructorGuideRef, 'course/lessons/setup/instructor-guide.md');
  assert.ok(setup.automatedCheckRefs.some((reference) => reference.startsWith('course/')));
  assert.ok(setup.automatedCheckRefs.some((reference) => reference.startsWith('test/')));
  const unsafeReferenceArtifact = structuredClone(setupArtifact);
  unsafeReferenceArtifact.assessment.answerKeyRef = '../outside.md';
  assert.equal(
    validateSchema(unsafeReferenceArtifact, readJson('curriculum/schemas/assessment.schema.json')).valid,
    false,
  );

  const lesson01 = readJson('course/lessons/01/assessment.yaml').assessment;
  assert.equal(lesson01.answerKeyRef, 'course/lessons/01/answer-key.md');
  assert.equal(lesson01.instructorGuideRef, 'course/lessons/01/instructor-guide.md');
  assert.match(lesson01.labTask.execute, /\.lab\/submissions\/01\/submission\.json/);
  assert.match(lesson01.labTask.execute, /手作業/);
  assert.deepEqual(lesson01.procedure.map(({ kind }) => kind), [
    'command',
    'command',
    'command',
    'command',
    'learner-action',
    'command',
    'command',
  ]);
  assert.deepEqual(lesson01.procedure.filter(({ kind }) => kind === 'command').map(({ command }) => command), [
    'node course.mjs lesson 01 doctor',
    'node course.mjs lesson 01 setup',
    'node course.mjs lesson 01 demo',
    'node course.mjs lesson 01 observe',
    'node course.mjs lesson 01 check',
    'node course.mjs lesson 01 stop',
  ]);
  const learnerAction = lesson01.procedure.find(({ kind }) => kind === 'learner-action');
  assert.equal(learnerAction.path, '.lab/submissions/01/submission.json');
  assert.match(learnerAction.task, /手作業/);
  assert.deepEqual(
    lesson01.optionalRecoveryScenarios[0].procedure.map(({ command }) => command),
    ['node course.mjs lesson 01 reset'],
  );

  const lesson02 = readJson('course/lessons/02/assessment.yaml').assessment;
  assert.equal(lesson02.artifactStatus, 'implemented');
  assert.match(lesson02.labTask.execute, /fresh scenario/);
  assert.match(lesson02.evidence, /実HTTP/);
  assert.deepEqual(lesson02.requiredChecks.map(({ id }) => id), ['AA02-C1', 'AA02-C2', 'AA02-C3']);

  const lesson03 = readJson('course/lessons/03/assessment.yaml').assessment;
  assert.equal(lesson03.artifactStatus, 'implemented');
  assert.match(lesson03.labTask.execute, /Set-Cookie/);
  assert.match(lesson03.labTask.execute, /fresh scenario/);
  assert.match(lesson03.evidence, /browserによるHttpOnlyとSameSiteの強制動作は証拠範囲に含めない/);
  assert.deepEqual(
    lesson03.requiredChecks.map(({ id }) => id),
    ['AA03-C1', 'AA03-C2', 'AA03-C3', 'AA03-C4'],
  );

  const lesson04 = readJson('course/lessons/04/assessment.yaml').assessment;
  assert.equal(lesson04.artifactStatus, 'implemented');
  assert.match(lesson04.labTask.execute, /fresh scenario/);
  assert.match(lesson04.evidence, /実Cookie/);
  assert.match(lesson04.passCriteria, /401はWWW-Authenticate/);
  assert.deepEqual(
    lesson04.requiredChecks.map(({ id }) => id),
    ['AA04-C1', 'AA04-C2', 'AA04-C3', 'AA04-C4'],
  );
});

test('source digest and unreleased lock describe bytes without inventing a revision', {
  skip: !existsSync(authoritativeSource),
}, () => {
  const sourceBytes = readFileSync(authoritativeSource);
  const expectedDigest = sha256(sourceBytes);
  const contract = readJson('curriculum/course-contract.json');
  const lock = readJson('course-lock.json');
  const digestFile = readFileSync(resolve(repositoryRoot, 'curriculum/course-contract.source.sha256'), 'utf8');
  const sourceSnapshot = readFileSync(resolve(repositoryRoot, 'curriculum/course-source.snapshot.json'));

  assert.equal(contract.source.sha256, expectedDigest);
  assert.equal(contract.source.revision, null);
  assert.equal(lock.releaseStatus, 'unreleased');
  assert.equal(lock.sourceRevision, null);
  assert.equal(lock.sourceFile.sha256, expectedDigest);
  assert.equal(digestFile, `${expectedDigest}  articles/series/auth-authz/curriculum.json\n`);
  assert.deepEqual(sourceSnapshot, sourceBytes);
  assert.equal(lock.generatedFiles[0].sha256, sha256(readFileSync(resolve(repositoryRoot, lock.generatedFiles[0].path))));
});

test('generator --check accepts synchronized output and rejects stale output', () => {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'auth-authz-course-contract-'));
  temporaryRoots.push(outputRoot);
  mkdirSync(resolve(outputRoot, 'curriculum'), { recursive: true });
  const sourcePath = resolve(outputRoot, 'source.json');
  const source = fixtureSource();
  copyFixtureReferences(outputRoot, source);
  writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  const arguments_ = [
    generator,
    '--source', sourcePath,
    '--source-label', 'fixture/source.json',
    '--output-root', outputRoot,
  ];

  const generated = spawnSync(process.execPath, arguments_, { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const assessment = JSON.parse(readFileSync(resolve(outputRoot, 'course/lessons/setup/assessment.yaml'), 'utf8'));
  assert.deepEqual(assessment.assessment.procedure, source.lessons[0].assessments[0].procedure);
  const checked = spawnSync(process.execPath, [...arguments_, '--check'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);

  const contractPath = resolve(outputRoot, 'curriculum/course-contract.json');
  writeFileSync(contractPath, `${readFileSync(contractPath, 'utf8')} `);
  const stale = spawnSync(process.execPath, [...arguments_, '--check'], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /course-contract\.json: stale/);
});

test('generator rejects dangling outcome and assessment references', () => {
  const invalidOutcome = fixtureSource();
  invalidOutcome.lessons[0].objectives[0].courseOutcomeIds = ['MISSING'];
  assert.throws(
    () => buildCourseContract(invalidOutcome, { sourceLabel: 'fixture.json', sourceSha256: '0'.repeat(64) }),
    /unknown course outcome/,
  );

  const invalidObjective = fixtureSource();
  invalidObjective.lessons[0].assessments[0].objectiveIds = ['MISSING'];
  assert.throws(
    () => buildCourseContract(invalidObjective, { sourceLabel: 'fixture.json', sourceSha256: '0'.repeat(64) }),
    /objective outside lesson/,
  );

  const missingLessonKind = fixtureSource();
  delete missingLessonKind.lessons[0].kind;
  assert.throws(
    () => buildCourseContract(missingLessonKind, { sourceLabel: 'fixture.json', sourceSha256: '0'.repeat(64) }),
    /setup\.kind/,
  );

  const invalidDuration = fixtureSource();
  invalidDuration.lessons[0].estimatedMinutes = '10';
  assert.throws(
    () => buildCourseContract(invalidDuration, { sourceLabel: 'fixture.json', sourceSha256: '0'.repeat(64) }),
    /estimatedMinutes/,
  );

  const forwardPrerequisite = fixtureSource();
  forwardPrerequisite.lessons.push({
    ...structuredClone(forwardPrerequisite.lessons[0]),
    id: 'next',
    environmentRef: 'curriculum/support-matrix.json#lessons.next',
    objectives: [{ id: 'O2', courseOutcomeIds: ['CO1'], statement: 'next objective' }],
    assessments: [{
      ...structuredClone(forwardPrerequisite.lessons[0].assessments[0]),
      id: 'A2',
      objectiveIds: ['O2'],
      artifactSetRef: 'course/lessons/next/assessment.yaml#A2',
      requiredCheckIds: ['C2'],
    }],
  });
  forwardPrerequisite.lessons[0].learningPrerequisites = ['next'];
  assert.throws(
    () => buildCourseContract(forwardPrerequisite, {
      sourceLabel: 'fixture.json',
      sourceSha256: '0'.repeat(64),
    }),
    /must appear earlier in course order/,
  );

  const mismatchedEnvironment = fixtureSource();
  mismatchedEnvironment.lessons[0].environmentRef = 'curriculum/support-matrix.json#lessons.09';
  assert.throws(
    () => buildCourseContract(mismatchedEnvironment, {
      sourceLabel: 'fixture.json',
      sourceSha256: '0'.repeat(64),
    }),
    /setup\.environmentRef must be curriculum\/support-matrix\.json#lessons\.setup/,
  );

  const missingArtifactStatus = fixtureSource();
  delete missingArtifactStatus.lessons[0].assessments[0].artifactStatus;
  assert.throws(
    () => buildCourseContract(missingArtifactStatus, {
      sourceLabel: 'fixture.json',
      sourceSha256: '0'.repeat(64),
    }),
    /artifactStatus/,
  );
});

test('generator enforces implemented and planned assessment artifact boundaries', () => {
  const options = { sourceLabel: 'fixture/source.json' };

  const driftedContract = fixtureSource();
  driftedContract.assessmentArtifactContract.labRequiredEntries.push('missingArtifactEntry');
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(driftedContract)), options),
    /does not satisfy assessmentArtifactContract entry/,
  );

  const incomplete = fixtureSource();
  delete incomplete.lessons[0].assessments[0].labTask;
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(incomplete)), options),
    /A1\.labTask must be an object/,
  );

  const manuallyDuplicated = fixtureSource();
  manuallyDuplicated.lessons[0].assessments[0].requiredChecks = [{ id: 'C1' }];
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(manuallyDuplicated)), options),
    /must be derived from the course contract/,
  );

  const plannedWithReference = plannedFixtureSource();
  plannedWithReference.lessons[0].assessments[0].answerKeyRef = 'course/lessons/setup/answer-key.md';
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(plannedWithReference)), options),
    /not allowed while artifactStatus is planned/,
  );

  const vaguePlanned = plannedFixtureSource();
  vaguePlanned.lessons[0].assessments[0].implementationNote = 'later';
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(vaguePlanned)), options),
    /must explicitly say 未実装/,
  );

  const plannedArtifacts = generateArtifacts(
    Buffer.from(JSON.stringify(plannedFixtureSource())),
    options,
  );
  const planned = JSON.parse(plannedArtifacts.get('course/lessons/setup/assessment.yaml')).assessment;
  assert.equal(planned.artifactStatus, 'planned');
  assert.match(planned.implementationNote, /未実装/);
  assert.equal(Object.hasOwn(planned, 'answerKeyRef'), false);
  assert.equal(Object.hasOwn(planned, 'requiredChecks'), false);
});

test('generator rejects unsafe or missing implemented assessment references', () => {
  const options = { sourceLabel: 'fixture/source.json' };
  const unsafe = fixtureSource();
  unsafe.lessons[0].assessments[0].labTask.instructionsRef = '../outside.md';
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(unsafe)), options),
    /safe portable repository-relative path/,
  );

  const missing = fixtureSource();
  missing.lessons[0].assessments[0].answerKeyRef = 'course/lessons/setup/missing-answer-key.md';
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(missing)), options),
    /references a missing file/,
  );
});

test('generator rejects ambiguous or dangling assessment procedure steps', () => {
  const options = { sourceLabel: 'fixture/source.json' };
  const nonSequential = fixtureSource();
  nonSequential.lessons[0].assessments[0].procedure[0].step = 2;
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(nonSequential)), options),
    /steps must be sequential/,
  );

  const danglingCheck = fixtureSource();
  danglingCheck.lessons[0].assessments[0].procedure[0].checkIds = ['MISSING'];
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(danglingCheck)), options),
    /unknown required check/,
  );

  const prematureTerminal = fixtureSource();
  prematureTerminal.lessons[0].assessments[0].procedure.push({
    kind: 'command',
    step: 2,
    command: 'node course.mjs purge --yes',
    expectedStatus: 'pass',
    checkIds: ['C1'],
    terminal: true,
  });
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(prematureTerminal)), options),
    /only mark its final step as terminal/,
  );

  const uncoveredCheck = fixtureSource();
  uncoveredCheck.lessons[0].assessments[0].requiredCheckIds.push('C2');
  assert.throws(
    () => generateArtifacts(Buffer.from(JSON.stringify(uncoveredCheck)), options),
    /does not cover required check: C2/,
  );
});

test('generator rejects a source label that escapes the portable contract namespace', () => {
  const result = spawnSync(process.execPath, [
    generator,
    '--source', authoritativeSource,
    '--source-label', '../private/curriculum.json',
    '--check',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /portable relative path/);
});

test('checked-in contract is synchronized with the authoritative curriculum', {
  skip: !existsSync(authoritativeSource),
}, () => {
  const result = spawnSync(process.execPath, [generator, '--check', '--source', authoritativeSource], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checked 21 course contract artifacts/);
});

test('a standalone sample checkout verifies against its bundled source snapshot', () => {
  const standaloneRoot = mkdtempSync(resolve(tmpdir(), 'auth-authz-standalone-contract-'));
  temporaryRoots.push(standaloneRoot);
  for (const path of [
    'apps',
    'scripts',
    'curriculum',
    'course/lessons',
    'course/runner',
    'packages',
    'services',
    'test',
  ]) {
    const destination = resolve(standaloneRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(repositoryRoot, path), destination, { recursive: true });
  }
  const bundledSource = readJson('curriculum/course-source.snapshot.json');
  const implementedReferences = bundledSource.lessons.flatMap(({ assessments }) => (
    assessments
      .filter(({ artifactStatus }) => artifactStatus === 'implemented')
      .flatMap((assessment) => [
        assessment.labTask.instructionsRef,
        assessment.answerKeyRef,
        assessment.instructorGuideRef,
        ...assessment.automatedCheckRefs,
      ])
  ));
  for (const reference of new Set(implementedReferences)) {
    const destination = resolve(standaloneRoot, reference);
    if (existsSync(destination)) continue;
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(repositoryRoot, reference), destination);
  }
  cpSync(resolve(repositoryRoot, 'course-lock.json'), resolve(standaloneRoot, 'course-lock.json'));
  const result = spawnSync(process.execPath, [resolve(standaloneRoot, 'scripts/sync-course-contract.mjs'), '--check'], {
    cwd: standaloneRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /checked 21 course contract artifacts/);
});
