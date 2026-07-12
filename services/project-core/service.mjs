import {
  assertProjectId,
  assertSubjectId,
  evaluateProjectDeletePolicy,
  LESSON_04_ACTION,
} from './domain.mjs';
import { createProjectCoreStore } from './store.mjs';

const DELETED = Object.freeze({
  ok: true,
  status: 204,
  code: 'PROJECT_DELETED',
});
const FORBIDDEN = Object.freeze({
  ok: false,
  status: 403,
  code: 'PROJECT_DELETE_FORBIDDEN',
  message: 'Forbidden.',
});
const NOT_FOUND = Object.freeze({
  ok: false,
  status: 404,
  code: 'PROJECT_NOT_FOUND',
  message: 'Project not found.',
});
const RESET = Object.freeze({
  ok: true,
  status: 204,
  code: 'PROJECT_CORE_RESET',
});

function requireInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('delete input must be an object');
  }
  if (!input.principal || typeof input.principal !== 'object' || Array.isArray(input.principal)) {
    throw new TypeError('principal must be established by the PEP before project-core is called');
  }
  return Object.freeze({
    subjectId: assertSubjectId(input.principal.id, 'principal.id'),
    resourceId: assertProjectId(input.resourceId, 'resourceId'),
  });
}

function publicResult(policy) {
  if (policy.status === 204) return DELETED;
  if (policy.status === 403) return FORBIDDEN;
  return NOT_FOUND;
}

export function createLesson04ProjectCore(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const store = createProjectCoreStore(options);

  function deleteProject(input) {
    const { subjectId, resourceId } = requireInput(input);
    return store.transact((transaction) => {
      const subject = transaction.findSubject(subjectId);
      const project = transaction.findProject(resourceId);
      const policy = evaluateProjectDeletePolicy({ subject, project });
      if (policy.decision === 'allow' && !transaction.deleteProject(resourceId)) {
        throw new Error('authorized project disappeared inside a synchronous transaction');
      }
      transaction.appendAudit({
        subject: subjectId,
        resource: resourceId,
        action: LESSON_04_ACTION,
        decision: policy.decision,
        status: policy.status,
        reason: policy.reason,
      });
      return publicResult(policy);
    });
  }

  function observe() {
    return structuredClone({
      schemaVersion: 1,
      lessonId: '04',
      implementation: {
        policyDecisionPoint: 'project-core',
        resourceSourceOfRecord: 'project-core',
        mutationOwner: 'project-core',
        policyEnforcementPoint: 'project-app',
        authenticationBoundary: 'project-app',
        transactionMode: 'synchronous-copy-and-commit',
      },
      state: store.snapshot(),
    });
  }

  function readAudit() {
    return store.auditSnapshot();
  }

  function reset() {
    store.reset();
    return RESET;
  }

  return Object.freeze({ deleteProject, observe, readAudit, reset });
}
