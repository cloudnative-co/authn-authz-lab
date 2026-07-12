#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep as pathSeparator } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidSchema } from '../course/runner/schema.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputRoot = resolve(scriptDirectory, '..');
const defaultSource = resolve(
  defaultOutputRoot,
  '../ghost-writer-okash1n/articles/series/auth-authz/curriculum.json',
);
const localSourceSnapshot = resolve(defaultOutputRoot, 'curriculum/course-source.snapshot.json');
const defaultSourceLabel = 'articles/series/auth-authz/curriculum.json';

function fail(message) {
  throw new Error(message);
}

function expectNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
}

function expectUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    expectNonEmptyString(item, label);
    if (seen.has(item)) fail(`duplicate ${label}: ${item}`);
    seen.add(item);
  }
  return seen;
}

function expectObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function expectPortableRepositoryPath(value, label) {
  expectNonEmptyString(value, label);
  const segments = value.split('/');
  if (
    value !== value.trim()
    || isAbsolute(value)
    || value.includes('\\')
    || value.includes('#')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a safe portable repository-relative path`);
  }
}

function assertExistingRepositoryFile(repositoryRoot, reference, label) {
  expectPortableRepositoryPath(reference, label);
  if (!existsSync(repositoryRoot)) fail(`repository root does not exist: ${repositoryRoot}`);
  const candidate = resolve(repositoryRoot, reference);
  if (!existsSync(candidate)) fail(`${label} references a missing file: ${reference}`);
  const rootRealPath = realpathSync(repositoryRoot);
  const candidateRealPath = realpathSync(candidate);
  const relativePath = relative(rootRealPath, candidateRealPath);
  if (
    relativePath === ''
    || relativePath === '..'
    || relativePath.startsWith(`..${pathSeparator}`)
    || isAbsolute(relativePath)
  ) {
    fail(`${label} escapes the repository root: ${reference}`);
  }
  if (!statSync(candidateRealPath).isFile()) fail(`${label} must reference a file: ${reference}`);
}

function validateProcedure(procedure, assessment, {
  label = `${assessment.id}.procedure`,
  requireTerminal = true,
  requireCheckCoverage = true,
} = {}) {
  if (!Array.isArray(procedure) || procedure.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
  const requiredCheckIds = new Set(assessment.requiredCheckIds);
  const coveredCheckIds = new Set();
  let terminalSeen = false;
  for (const [index, procedureStep] of procedure.entries()) {
    expectObject(procedureStep, `${label}[${index}]`);
    if (procedureStep.step !== index + 1) {
      fail(`${label} steps must be sequential from 1`);
    }
    if (procedureStep.kind === 'learner-action') {
      expectPortableRepositoryPath(procedureStep.path, `${label}[${index}].path`);
      expectNonEmptyString(procedureStep.task, `${label}[${index}].task`);
      expectNonEmptyString(
        procedureStep.completionCriterion,
        `${label}[${index}].completionCriterion`,
      );
      continue;
    }
    if (procedureStep.kind !== 'command') {
      fail(`${label}[${index}].kind must be command or learner-action`);
    }
    expectNonEmptyString(procedureStep.command, `${label}[${index}].command`);
    if (!['pass', 'fail', 'blocked', 'safe-noop'].includes(procedureStep.expectedStatus)) {
      fail(`${label}[${index}].expectedStatus is invalid`);
    }
    if (!Array.isArray(procedureStep.checkIds)) {
      fail(`${label}[${index}].checkIds must be an array`);
    }
    const procedureCheckIds = expectUnique(
      procedureStep.checkIds,
      `${label}[${index}] check ID`,
    );
    for (const checkId of procedureCheckIds) {
      if (!requiredCheckIds.has(checkId)) {
        fail(`${label}[${index}] references unknown required check: ${checkId}`);
      }
      coveredCheckIds.add(checkId);
    }
    if (typeof procedureStep.terminal !== 'boolean') {
      fail(`${label}[${index}].terminal must be a boolean`);
    }
    if (procedureStep.terminal) {
      if (terminalSeen || index !== procedure.length - 1) {
        fail(`${label} may only mark its final step as terminal`);
      }
      terminalSeen = true;
    }
  }
  if (requireTerminal && !terminalSeen) fail(`${label} must mark its final step as terminal`);
  if (requireCheckCoverage) {
    for (const checkId of requiredCheckIds) {
      if (!coveredCheckIds.has(checkId)) {
        fail(`${label} does not cover required check: ${checkId}`);
      }
    }
  }
}

function validateOptionalRecoveryScenarios(scenarios, assessment) {
  if (scenarios === undefined) return;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    fail(`${assessment.id}.optionalRecoveryScenarios must be a non-empty array when present`);
  }
  expectUnique(scenarios.map((scenario) => scenario?.id), `${assessment.id} recovery scenario ID`);
  for (const [index, scenario] of scenarios.entries()) {
    expectObject(scenario, `${assessment.id}.optionalRecoveryScenarios[${index}]`);
    expectNonEmptyString(scenario.trigger, `${assessment.id}.optionalRecoveryScenarios[${index}].trigger`);
    validateProcedure(scenario.procedure, assessment, {
      label: `${assessment.id}.optionalRecoveryScenarios[${index}].procedure`,
      requireTerminal: false,
      requireCheckCoverage: false,
    });
  }
}

function readAssessmentArtifactContract(source) {
  const contract = expectObject(
    source.assessmentArtifactContract,
    'assessmentArtifactContract',
  );
  if (contract.labRequiredEntriesWhen !== 'artifactStatus=implemented') {
    fail('assessmentArtifactContract.labRequiredEntriesWhen must be artifactStatus=implemented');
  }
  const arrays = [
    'labRequiredEntries',
    'plannedRequiredEntries',
    'labTaskRequiredEntries',
    'requiredCheckSchema',
  ];
  for (const field of arrays) {
    if (!Array.isArray(contract[field]) || contract[field].length === 0) {
      fail(`assessmentArtifactContract.${field} must be a non-empty array`);
    }
    expectUnique(contract[field], `assessmentArtifactContract.${field} entry`);
  }
  return contract;
}

function readExtensionArtifactContract(source) {
  const contract = expectObject(
    source.extensionArtifactContract,
    'extensionArtifactContract',
  );
  if (contract.referenceField !== 'lessons[].extensionTaskRef') {
    fail('extensionArtifactContract.referenceField must be lessons[].extensionTaskRef');
  }
  for (const field of ['requiredEntries', 'taskRequiredEntries']) {
    if (!Array.isArray(contract[field]) || contract[field].length === 0) {
      fail(`extensionArtifactContract.${field} must be a non-empty array`);
    }
    expectUnique(contract[field], `extensionArtifactContract.${field} entry`);
  }
  expectNonEmptyString(contract.releaseGate, 'extensionArtifactContract.releaseGate');
  return contract;
}

function assertRequiredEntries(value, entries, label) {
  for (const entry of entries) {
    if (!Object.hasOwn(value, entry) || value[entry] === undefined) {
      fail(`${label} does not satisfy assessmentArtifactContract entry: ${entry}`);
    }
  }
}

function assertExactEntrySchema(value, entries, label) {
  const actual = Object.keys(value);
  if (actual.length !== entries.length || actual.some((entry, index) => entry !== entries[index])) {
    fail(`${label} entries must exactly match assessmentArtifactContract: ${entries.join(', ')}`);
  }
}

function parseArguments(argv) {
  const options = {
    check: false,
    outputRoot: defaultOutputRoot,
    source: process.env.COURSE_CURRICULUM_SOURCE
      ? resolve(process.env.COURSE_CURRICULUM_SOURCE)
      : (existsSync(defaultSource) ? defaultSource : localSourceSnapshot),
    sourceLabel: defaultSourceLabel,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--source' || argument === '--source-label' || argument === '--output-root') {
      const value = argv[index + 1];
      if (!value) fail(`${argument} requires a value`);
      index += 1;
      if (argument === '--source') options.source = resolve(value);
      if (argument === '--source-label') options.sourceLabel = value;
      if (argument === '--output-root') options.outputRoot = resolve(value);
      continue;
    }
    if (argument === '--help') {
      return { help: true };
    }
    fail(`unknown argument: ${argument}`);
  }

  expectNonEmptyString(options.sourceLabel, 'source label');
  if (
    options.sourceLabel.startsWith('/')
    || options.sourceLabel.includes('\\')
    || options.sourceLabel.split('/').includes('..')
  ) {
    fail('source label must be a portable relative path');
  }
  return options;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readGeneratorSchema(relativePath) {
  return JSON.parse(readFileSync(resolve(defaultOutputRoot, relativePath), 'utf8'));
}

export function buildCourseContract(source, { sourceLabel, sourceSha256 }) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('curriculum source must be an object');
  if (!Number.isInteger(source.schemaVersion)) fail('schemaVersion must be an integer');
  expectNonEmptyString(source.courseId, 'courseId');
  expectNonEmptyString(source.title, 'title');
  if (!Array.isArray(source.courseOutcomes) || source.courseOutcomes.length === 0) {
    fail('courseOutcomes must be a non-empty array');
  }
  if (!Array.isArray(source.lessons) || source.lessons.length === 0) fail('lessons must be a non-empty array');

  const outcomeIds = expectUnique(source.courseOutcomes.map((outcome) => outcome.id), 'course outcome ID');
  for (const outcome of source.courseOutcomes) {
    expectNonEmptyString(outcome.statement, `${outcome.id}.statement`);
  }
  const lessonIds = expectUnique(source.lessons.map((lesson) => lesson.id), 'lesson ID');
  const lessonOrder = new Map(source.lessons.map((lesson, index) => [lesson.id, index]));
  const objectiveIds = new Set();
  const assessmentIds = new Set();
  const requiredCheckIds = new Set();
  const usedOutcomeIds = new Set();
  const lessons = [];

  for (const lesson of source.lessons) {
    expectNonEmptyString(lesson.kind, `${lesson.id}.kind`);
    expectNonEmptyString(lesson.module, `${lesson.id}.module`);
    if (lesson.articleSlug !== null && (typeof lesson.articleSlug !== 'string' || lesson.articleSlug.length === 0)) {
      fail(`${lesson.id}.articleSlug must be null or a non-empty string`);
    }
    const expectedEnvironmentRef = `curriculum/support-matrix.json#lessons.${lesson.id}`;
    if (lesson.environmentRef !== expectedEnvironmentRef) {
      fail(`${lesson.id}.environmentRef must be ${expectedEnvironmentRef}`);
    }
    if (!Number.isInteger(lesson.estimatedMinutes) || lesson.estimatedMinutes < 0) {
      fail(`${lesson.id}.estimatedMinutes must be a non-negative integer`);
    }
    if (!Number.isInteger(lesson.extensionMinutes) || lesson.extensionMinutes < 0) {
      fail(`${lesson.id}.extensionMinutes must be a non-negative integer`);
    }
    const expectedExtensionTaskRef = `course/lessons/${lesson.id}/extension.yaml`;
    let extensionTaskRef = null;
    if (lesson.extensionMinutes > 0) {
      if (lesson.extensionTaskRef !== expectedExtensionTaskRef) {
        fail(`${lesson.id}.extensionTaskRef must be ${expectedExtensionTaskRef}`);
      }
      extensionTaskRef = lesson.extensionTaskRef;
    } else if (lesson.extensionTaskRef !== undefined && lesson.extensionTaskRef !== null) {
      fail(`${lesson.id}.extensionTaskRef must be omitted when extensionMinutes is 0`);
    }
    if (!Array.isArray(lesson.learningPrerequisites)) fail(`${lesson.id}.learningPrerequisites must be an array`);
    expectUnique(lesson.learningPrerequisites, `${lesson.id} prerequisite lesson ID`);
    for (const prerequisiteId of lesson.learningPrerequisites) {
      if (!lessonIds.has(prerequisiteId)) fail(`${lesson.id} references unknown prerequisite lesson: ${prerequisiteId}`);
      if (prerequisiteId === lesson.id) fail(`${lesson.id} cannot require itself`);
      if (lessonOrder.get(prerequisiteId) >= lessonOrder.get(lesson.id)) {
        fail(`${lesson.id} prerequisite ${prerequisiteId} must appear earlier in course order`);
      }
    }
    if (!Array.isArray(lesson.objectives) || lesson.objectives.length === 0) {
      fail(`${lesson.id}.objectives must be a non-empty array`);
    }
    if (!Array.isArray(lesson.assessments) || lesson.assessments.length === 0) {
      fail(`${lesson.id}.assessments must be a non-empty array`);
    }

    const lessonObjectiveIds = new Set();
    const objectives = lesson.objectives.map((objective) => {
      expectNonEmptyString(objective.id, `${lesson.id} objective ID`);
      if (objectiveIds.has(objective.id)) fail(`duplicate objective ID: ${objective.id}`);
      objectiveIds.add(objective.id);
      lessonObjectiveIds.add(objective.id);
      if (!Array.isArray(objective.courseOutcomeIds)) {
        fail(`${objective.id}.courseOutcomeIds must be an array`);
      }
      expectUnique(objective.courseOutcomeIds, `${objective.id} course outcome ID`);
      for (const outcomeId of objective.courseOutcomeIds) {
        if (!outcomeIds.has(outcomeId)) fail(`${objective.id} references unknown course outcome: ${outcomeId}`);
        usedOutcomeIds.add(outcomeId);
      }
      expectNonEmptyString(objective.statement, `${objective.id}.statement`);
      return {
        id: objective.id,
        courseOutcomeIds: [...objective.courseOutcomeIds],
        statement: objective.statement,
      };
    });
    const objectiveById = new Map(objectives.map((objective) => [objective.id, objective]));
    const assessedObjectiveIds = new Set();
    const checks = [];

    const assessments = lesson.assessments.map((assessment) => {
      expectNonEmptyString(assessment.id, `${lesson.id} assessment ID`);
      if (assessmentIds.has(assessment.id)) fail(`duplicate assessment ID: ${assessment.id}`);
      assessmentIds.add(assessment.id);
      if (!['implemented', 'planned'].includes(assessment.artifactStatus)) {
        fail(`${assessment.id}.artifactStatus must be implemented or planned`);
      }
      if (!Array.isArray(assessment.objectiveIds) || assessment.objectiveIds.length === 0) {
        fail(`${assessment.id}.objectiveIds must be a non-empty array`);
      }
      expectUnique(assessment.objectiveIds, `${assessment.id} objective ID`);
      for (const objectiveId of assessment.objectiveIds) {
        if (!lessonObjectiveIds.has(objectiveId)) {
          fail(`${assessment.id} references an objective outside lesson ${lesson.id}: ${objectiveId}`);
        }
        assessedObjectiveIds.add(objectiveId);
      }
      if (!Array.isArray(assessment.requiredCheckIds) || assessment.requiredCheckIds.length === 0) {
        fail(`${assessment.id}.requiredCheckIds must be a non-empty array`);
      }
      expectNonEmptyString(assessment.type, `${assessment.id}.type`);
      expectNonEmptyString(assessment.artifactSetRef, `${assessment.id}.artifactSetRef`);
      expectNonEmptyString(assessment.evidence, `${assessment.id}.evidence`);
      expectNonEmptyString(assessment.passCriteria, `${assessment.id}.passCriteria`);

      const checkOutcomeIds = source.courseOutcomes
        .map((outcome) => outcome.id)
        .filter((outcomeId) => assessment.objectiveIds.some(
          (objectiveId) => objectiveById.get(objectiveId).courseOutcomeIds.includes(outcomeId),
        ));
      for (const checkId of assessment.requiredCheckIds) {
        expectNonEmptyString(checkId, `${assessment.id} required check ID`);
        if (requiredCheckIds.has(checkId)) fail(`duplicate required check ID: ${checkId}`);
        requiredCheckIds.add(checkId);
        checks.push({
          id: checkId,
          mode: 'lab',
          assessmentId: assessment.id,
          objectiveIds: [...assessment.objectiveIds],
          courseOutcomeIds: checkOutcomeIds,
          evidenceType: assessment.type,
          required: true,
          mappingBasis: 'assessment-objective-closure',
        });
      }

      return {
        id: assessment.id,
        artifactStatus: assessment.artifactStatus,
        objectiveIds: [...assessment.objectiveIds],
        type: assessment.type,
        artifactSetRef: assessment.artifactSetRef,
        requiredCheckIds: [...assessment.requiredCheckIds],
        evidence: assessment.evidence,
        passCriteria: assessment.passCriteria,
      };
    });

    for (const objectiveId of lessonObjectiveIds) {
      if (!assessedObjectiveIds.has(objectiveId)) fail(`${objectiveId} is not covered by an assessment`);
    }
    const expectedReadingAssessmentRef = lesson.articleSlug === null
      ? null
      : `episodes/${lesson.id}-${lesson.articleSlug}/assessment.yaml#${assessments[0].id}`;
    if ((lesson.readingAssessmentRef ?? null) !== expectedReadingAssessmentRef) {
      fail(`${lesson.id}.readingAssessmentRef must be ${expectedReadingAssessmentRef}`);
    }
    lessons.push({
      id: lesson.id,
      kind: lesson.kind,
      module: lesson.module,
      articleSlug: lesson.articleSlug,
      environmentRef: lesson.environmentRef,
      learningPrerequisites: [...lesson.learningPrerequisites],
      estimatedMinutes: lesson.estimatedMinutes,
      extensionMinutes: lesson.extensionMinutes,
      extensionTaskRef,
      readingAssessmentRef: expectedReadingAssessmentRef,
      objectives,
      assessments,
      requiredChecks: checks,
    });
  }

  for (const outcomeId of outcomeIds) {
    if (!usedOutcomeIds.has(outcomeId)) fail(`course outcome is not covered by an objective: ${outcomeId}`);
  }

  return {
    $schema: './schemas/course-contract.schema.json',
    schemaVersion: 1,
    courseId: source.courseId,
    title: source.title,
    source: {
      path: sourceLabel,
      schemaVersion: source.schemaVersion,
      sha256: sourceSha256,
      revision: null,
    },
    courseOutcomes: source.courseOutcomes.map((outcome) => ({
      id: outcome.id,
      statement: outcome.statement,
    })),
    lessons,
    traceability: {
      courseOutcomeCount: outcomeIds.size,
      lessonCount: lessonIds.size,
      objectiveCount: objectiveIds.size,
      assessmentCount: assessmentIds.size,
      requiredCheckCount: requiredCheckIds.size,
      requiredCheckMappingBasis: 'assessment-objective-closure',
    },
  };
}

export function generateArtifacts(sourceBytes, options) {
  let source;
  try {
    source = JSON.parse(sourceBytes);
  } catch (error) {
    fail(`cannot parse curriculum source: ${error.message}`);
  }
  const assessmentArtifactContract = readAssessmentArtifactContract(source);
  const extensionArtifactContract = readExtensionArtifactContract(source);
  const sourceSha256 = sha256(sourceBytes);
  const contract = buildCourseContract(source, {
    sourceLabel: options.sourceLabel,
    sourceSha256,
  });
  assertValidSchema(
    contract,
    readGeneratorSchema('curriculum/schemas/course-contract.schema.json'),
    'generated course contract',
  );
  const contractContent = json(contract);
  const generatedArtifacts = new Map([
    ['curriculum/course-contract.json', contractContent],
    ['curriculum/course-source.snapshot.json', sourceBytes.toString('utf8')],
  ]);
  const outputRoot = options.outputRoot ?? defaultOutputRoot;
  const sourceLessons = new Map(source.lessons.map((lesson) => [lesson.id, lesson]));
  for (const lesson of contract.lessons) {
    if (lesson.extensionMinutes > 0) {
      assertExistingRepositoryFile(
        outputRoot,
        lesson.extensionTaskRef,
        `lesson ${lesson.id} extensionTaskRef`,
      );
      let extension;
      try {
        extension = JSON.parse(readFileSync(resolve(outputRoot, lesson.extensionTaskRef), 'utf8'));
      } catch (error) {
        fail(`lesson ${lesson.id} extension artifact cannot be parsed: ${error.message}`);
      }
      assertValidSchema(
        extension,
        readGeneratorSchema('curriculum/schemas/extension.schema.json'),
        `lesson ${lesson.id} extension artifact`,
      );
      assertExactEntrySchema(
        extension,
        extensionArtifactContract.requiredEntries,
        `lesson ${lesson.id} extension artifact`,
      );
      for (const task of extension.tasks) {
        assertExactEntrySchema(
          task,
          extensionArtifactContract.taskRequiredEntries,
          `lesson ${lesson.id} extension task ${task.id}`,
        );
      }
      if (extension.courseId !== contract.courseId || extension.lessonId !== lesson.id) {
        fail(`lesson ${lesson.id} extension artifact identity does not match the course contract`);
      }
      if (extension.estimatedMinutes !== lesson.extensionMinutes) {
        fail(`lesson ${lesson.id} extension estimatedMinutes must equal extensionMinutes`);
      }
      if (JSON.stringify(extension.prerequisiteCheckIds) !== JSON.stringify(lesson.requiredChecks.map(({ id }) => id))) {
        fail(`lesson ${lesson.id} extension prerequisiteCheckIds must equal all requiredCheckIds`);
      }
    }
    if (lesson.assessments.length !== 1) fail(`lesson ${lesson.id} must have exactly one assessment artifact`);
    const assessment = lesson.assessments[0];
    const sourceAssessment = sourceLessons.get(lesson.id)?.assessments?.find(
      (candidate) => candidate.id === assessment.id,
    );
    expectObject(sourceAssessment, `${assessment.id} source assessment`);
    if (Object.hasOwn(sourceAssessment, 'requiredChecks')) {
      fail(`${assessment.id}.requiredChecks must be derived from the course contract, not supplied manually`);
    }
    const assessmentPath = `course/lessons/${lesson.id}/assessment.yaml`;
    if (assessment.artifactSetRef !== `${assessmentPath}#${assessment.id}`) {
      fail(`lesson ${lesson.id} assessment artifactSetRef must be ${assessmentPath}#${assessment.id}`);
    }
    const derivedRequiredChecks = lesson.requiredChecks.filter(
      (check) => check.assessmentId === assessment.id,
    );
    let artifactSpecificFields;
    if (assessment.artifactStatus === 'implemented') {
      validateProcedure(sourceAssessment.procedure, assessment);
      validateOptionalRecoveryScenarios(sourceAssessment.optionalRecoveryScenarios, assessment);
      const labTask = expectObject(sourceAssessment.labTask, `${assessment.id}.labTask`);
      for (const field of ['predict', 'execute', 'rejectOrFail', 'evidence', 'practicalTransfer']) {
        expectNonEmptyString(labTask[field], `${assessment.id}.labTask.${field}`);
      }
      const rubric = expectObject(sourceAssessment.rubric, `${assessment.id}.rubric`);
      if (rubric.scoringMethod !== 'all-required-checks') {
        fail(`${assessment.id}.rubric.scoringMethod must be all-required-checks`);
      }
      expectNonEmptyString(rubric.passRule, `${assessment.id}.rubric.passRule`);
      expectNonEmptyString(rubric.failureRule, `${assessment.id}.rubric.failureRule`);
      if (!Array.isArray(sourceAssessment.automatedCheckRefs)
          || sourceAssessment.automatedCheckRefs.length === 0) {
        fail(`${assessment.id}.automatedCheckRefs must be a non-empty array`);
      }
      expectUnique(sourceAssessment.automatedCheckRefs, `${assessment.id} automated check reference`);
      const references = [
        ['labTask.instructionsRef', labTask.instructionsRef],
        ['answerKeyRef', sourceAssessment.answerKeyRef],
        ['instructorGuideRef', sourceAssessment.instructorGuideRef],
        ...sourceAssessment.automatedCheckRefs.map((reference, index) => [
          `automatedCheckRefs[${index}]`,
          reference,
        ]),
      ];
      for (const [field, reference] of references) {
        assertExistingRepositoryFile(outputRoot, reference, `${assessment.id}.${field}`);
      }
      artifactSpecificFields = {
        labTask,
        rubric,
        answerKeyRef: sourceAssessment.answerKeyRef,
        instructorGuideRef: sourceAssessment.instructorGuideRef,
        automatedCheckRefs: sourceAssessment.automatedCheckRefs,
        requiredChecks: derivedRequiredChecks,
        procedure: sourceAssessment.procedure,
        ...(sourceAssessment.optionalRecoveryScenarios === undefined
          ? {}
          : { optionalRecoveryScenarios: sourceAssessment.optionalRecoveryScenarios }),
      };
    } else {
      const forbiddenFields = [
        'labTask',
        'rubric',
        'answerKeyRef',
        'instructorGuideRef',
        'automatedCheckRefs',
        'procedure',
        'optionalRecoveryScenarios',
      ];
      for (const field of forbiddenFields) {
        if (Object.hasOwn(sourceAssessment, field)) {
          fail(`${assessment.id}.${field} is not allowed while artifactStatus is planned`);
        }
      }
      expectNonEmptyString(sourceAssessment.implementationNote, `${assessment.id}.implementationNote`);
      if (!sourceAssessment.implementationNote.includes('未実装')) {
        fail(`${assessment.id}.implementationNote must explicitly say 未実装`);
      }
      artifactSpecificFields = { implementationNote: sourceAssessment.implementationNote };
    }
    const assessmentArtifact = {
      $schema: 'curriculum/schemas/assessment.schema.json',
      schemaVersion: 1,
      courseId: contract.courseId,
      lessonId: lesson.id,
      assessment: {
        id: assessment.id,
        artifactStatus: assessment.artifactStatus,
        objectiveIds: assessment.objectiveIds,
        type: assessment.type,
        evidence: assessment.evidence,
        passCriteria: assessment.passCriteria,
        ...artifactSpecificFields,
      },
    };
    assertValidSchema(
      assessmentArtifact,
      readGeneratorSchema('curriculum/schemas/assessment.schema.json'),
      `generated assessment ${lesson.id}`,
    );
    if (assessment.artifactStatus === 'implemented') {
      assertRequiredEntries(
        assessmentArtifact.assessment,
        assessmentArtifactContract.labRequiredEntries,
        `${assessment.id} generated artifact`,
      );
      assertExactEntrySchema(
        assessmentArtifact.assessment.labTask,
        assessmentArtifactContract.labTaskRequiredEntries,
        `${assessment.id}.labTask`,
      );
      for (const check of assessmentArtifact.assessment.requiredChecks) {
        assertExactEntrySchema(
          check,
          assessmentArtifactContract.requiredCheckSchema,
          `${assessment.id}.requiredChecks.${check.id}`,
        );
      }
    } else {
      assertRequiredEntries(
        assessmentArtifact.assessment,
        assessmentArtifactContract.plannedRequiredEntries,
        `${assessment.id} generated artifact`,
      );
    }
    generatedArtifacts.set(assessmentPath, json(assessmentArtifact));
  }
  const lock = {
    $schema: './curriculum/schemas/course-lock.schema.json',
    schemaVersion: 1,
    courseId: source.courseId,
    releaseStatus: 'unreleased',
    sourceRevision: null,
    sourceFile: {
      path: options.sourceLabel,
      sha256: sourceSha256,
    },
    generatedFiles: [...generatedArtifacts].map(([path, content]) => ({ path, sha256: sha256(content) })),
  };
  assertValidSchema(lock, readGeneratorSchema('curriculum/schemas/course-lock.schema.json'), 'generated course lock');

  return new Map([
    ...generatedArtifacts,
    ['curriculum/course-contract.source.sha256', `${sourceSha256}  ${options.sourceLabel}\n`],
    ['course-lock.json', json(lock)],
  ]);
}

function synchronize(options) {
  if (!existsSync(options.source)) fail(`curriculum source not found: ${options.source}`);
  const sourceBytes = readFileSync(options.source);
  const artifacts = generateArtifacts(sourceBytes, options);
  const mismatches = [];

  for (const [relativePath, expected] of artifacts) {
    const destination = resolve(options.outputRoot, relativePath);
    if (options.check) {
      if (!existsSync(destination)) {
        mismatches.push(`${relativePath}: missing`);
      } else if (readFileSync(destination, 'utf8') !== expected) {
        mismatches.push(`${relativePath}: stale`);
      }
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, expected);
  }

  if (mismatches.length > 0) {
    fail(`generated course contract is not synchronized:\n${mismatches.map((item) => `- ${item}`).join('\n')}`);
  }
  return artifacts;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/sync-course-contract.mjs [options]',
    '',
    'Options:',
    '  --check                 compare generated artifacts without writing',
    '  --source <path>         curriculum.json input',
    '  --source-label <path>   portable source path stored in artifacts',
    '  --output-root <path>    repository-shaped output directory',
    '  --help                  show this help',
    '',
  ].join('\n'));
}

if (process.argv[1]
    && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const artifacts = synchronize(options);
      process.stdout.write(`${options.check ? 'checked' : 'generated'} ${artifacts.size} course contract artifacts\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
