import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  getLessonImplementation,
  LESSON_01_SETUP_RECOVERY,
} from '../../course/lessons/registry.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readCourseContract() {
  return JSON.parse(readFileSync(resolve(repositoryRoot, 'curriculum/course-contract.json'), 'utf8'));
}

test('lesson registry exposes the immutable Lesson 01 implementation contract', () => {
  const lesson = getLessonImplementation('01');

  assert.equal(Object.isFrozen(lesson), true);
  assert.equal(lesson.id, '01');
  assert.equal(typeof lesson.run, 'function');
  assert.equal(typeof lesson.policy, 'function');
  assert.equal(Object.isFrozen(lesson.implementedCheckIds), true);
  assert.deepEqual(lesson.implementedCheckIds, ['AA01-C1', 'AA01-C2']);
  assert.equal(lesson.interruptedSetupRecovery, LESSON_01_SETUP_RECOVERY);
});

test('Lesson 01 policy remains exact for locks, transactions, and purge', () => {
  assert.deepEqual(getLessonImplementation('01').policy('doctor'), {
    requiresState: true,
    lockMode: 'read',
    transactionCommand: null,
  });
  assert.deepEqual(getLessonImplementation('01').policy('demo'), {
    requiresState: true,
    lockMode: 'write',
    transactionCommand: null,
  });
  assert.deepEqual(getLessonImplementation('01').policy('check'), {
    requiresState: true,
    lockMode: 'write',
    transactionCommand: 'check',
  });
  assert.deepEqual(getLessonImplementation('01').policy('reset'), {
    requiresState: true,
    lockMode: 'write',
    transactionCommand: 'reset',
  });
  assert.deepEqual(getLessonImplementation('01').policy('purge'), {
    requiresState: false,
    lockMode: null,
    transactionCommand: null,
  });
});

test('registry exposes every implemented runtime lesson with its generated assessment bindings', () => {
  const contract = readCourseContract();
  const implemented = contract.lessons.filter(({ id, assessments }) => (
    !['setup', '01'].includes(id)
      && assessments.every(({ artifactStatus }) => artifactStatus === 'implemented')
  ));
  for (const contractLesson of implemented) {
    const lesson = getLessonImplementation(contractLesson.id);
    assert.ok(lesson, `missing runtime implementation for Lesson ${contractLesson.id}`);
    assert.deepEqual(
      lesson.implementedCheckIds,
      contractLesson.requiredChecks.map(({ id }) => id),
    );
    assert.equal(lesson.interruptedSetupRecovery, null);
    assert.equal(Object.isFrozen(lesson), true);
  }
});

test('registry does not make setup or planned lessons executable', () => {
  assert.equal(getLessonImplementation('setup'), null);
  const contract = readCourseContract();
  for (const lesson of contract.lessons.filter(({ assessments }) => (
    assessments.some(({ artifactStatus }) => artifactStatus === 'planned')
  ))) {
    assert.equal(getLessonImplementation(lesson.id), null, lesson.id);
  }
  assert.throws(() => getLessonImplementation(null), /lessonId must be a string/u);
});
