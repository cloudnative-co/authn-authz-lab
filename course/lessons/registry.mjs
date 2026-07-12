import { lesson01ExecutionPolicy, runLesson01 } from './01/runner.mjs';
import {
  LESSON_02_CHECK_IDS,
  lesson02ExecutionPolicy,
  runLesson02,
} from './02/runner.mjs';
import {
  LESSON_03_CHECK_IDS,
  lesson03ExecutionPolicy,
  runLesson03,
} from './03/runner.mjs';
import {
  LESSON_04_CHECK_IDS,
  lesson04ExecutionPolicy,
  runLesson04,
} from './04/runner.mjs';
import {
  LESSON_05_CHECK_IDS,
  lesson05ExecutionPolicy,
  runLesson05,
} from './05/runner.mjs';
import {
  LESSON_06_CHECK_IDS,
  lesson06ExecutionPolicy,
  runLesson06,
} from './06/runner.mjs';
import {
  LESSON_07_CHECK_IDS,
  lesson07ExecutionPolicy,
  runLesson07,
} from './07/runner.mjs';
import {
  LESSON_08_CHECK_IDS,
  lesson08ExecutionPolicy,
  runLesson08,
} from './08/runner.mjs';
import {
  LESSON_09_CHECK_IDS,
  lesson09ExecutionPolicy,
  runLesson09,
} from './09/runner.mjs';
import {
  LESSON_10_CHECK_IDS,
  lesson10ExecutionPolicy,
  runLesson10,
} from './10/runner.mjs';
import {
  LESSON_11_CHECK_IDS,
  lesson11ExecutionPolicy,
  runLesson11,
} from './11/runner.mjs';
import {
  LESSON_12_CHECK_IDS,
  lesson12ExecutionPolicy,
  runLesson12,
} from './12/runner.mjs';
import {
  LESSON_13_CHECK_IDS,
  lesson13ExecutionPolicy,
  runLesson13,
} from './13/runner.mjs';
import {
  LESSON_14_CHECK_IDS,
  lesson14ExecutionPolicy,
  runLesson14,
} from './14/runner.mjs';
import {
  LESSON_15_CHECK_IDS,
  lesson15ExecutionPolicy,
  runLesson15,
} from './15/runner.mjs';
import {
  CAPSTONE_CHECK_IDS,
  capstoneExecutionPolicy,
  runCapstone,
} from './capstone/runner.mjs';

export const LESSON_01_SETUP_RECOVERY = 'lesson-01-setup-only';

const implementations = new Map([
  ['01', Object.freeze({
    id: '01',
    run: runLesson01,
    policy: lesson01ExecutionPolicy,
    implementedCheckIds: Object.freeze(['AA01-C1', 'AA01-C2']),
    interruptedSetupRecovery: LESSON_01_SETUP_RECOVERY,
  })],
  ['02', Object.freeze({
    id: '02',
    run: runLesson02,
    policy: lesson02ExecutionPolicy,
    implementedCheckIds: LESSON_02_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['03', Object.freeze({
    id: '03',
    run: runLesson03,
    policy: lesson03ExecutionPolicy,
    implementedCheckIds: LESSON_03_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['04', Object.freeze({
    id: '04',
    run: runLesson04,
    policy: lesson04ExecutionPolicy,
    implementedCheckIds: LESSON_04_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['05', Object.freeze({
    id: '05',
    run: runLesson05,
    policy: lesson05ExecutionPolicy,
    implementedCheckIds: LESSON_05_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['06', Object.freeze({
    id: '06',
    run: runLesson06,
    policy: lesson06ExecutionPolicy,
    implementedCheckIds: LESSON_06_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['07', Object.freeze({
    id: '07',
    run: runLesson07,
    policy: lesson07ExecutionPolicy,
    implementedCheckIds: LESSON_07_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['08', Object.freeze({
    id: '08',
    run: runLesson08,
    policy: lesson08ExecutionPolicy,
    implementedCheckIds: LESSON_08_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['09', Object.freeze({
    id: '09',
    run: runLesson09,
    policy: lesson09ExecutionPolicy,
    implementedCheckIds: LESSON_09_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['10', Object.freeze({
    id: '10',
    run: runLesson10,
    policy: lesson10ExecutionPolicy,
    implementedCheckIds: LESSON_10_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['11', Object.freeze({
    id: '11',
    run: runLesson11,
    policy: lesson11ExecutionPolicy,
    implementedCheckIds: LESSON_11_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['12', Object.freeze({
    id: '12',
    run: runLesson12,
    policy: lesson12ExecutionPolicy,
    implementedCheckIds: LESSON_12_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['13', Object.freeze({
    id: '13',
    run: runLesson13,
    policy: lesson13ExecutionPolicy,
    implementedCheckIds: LESSON_13_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['14', Object.freeze({
    id: '14',
    run: runLesson14,
    policy: lesson14ExecutionPolicy,
    implementedCheckIds: LESSON_14_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['15', Object.freeze({
    id: '15',
    run: runLesson15,
    policy: lesson15ExecutionPolicy,
    implementedCheckIds: LESSON_15_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
  ['capstone', Object.freeze({
    id: 'capstone',
    run: runCapstone,
    policy: capstoneExecutionPolicy,
    implementedCheckIds: CAPSTONE_CHECK_IDS,
    interruptedSetupRecovery: null,
  })],
]);

export function getLessonImplementation(lessonId) {
  if (typeof lessonId !== 'string') throw new TypeError('lessonId must be a string');
  return implementations.get(lessonId) ?? null;
}
