import {
  appendAuditEntry,
  createEmptyAuditState,
  snapshotAuditState,
} from './audit-log.mjs';
import {
  assertProjectId,
  assertProjectRole,
  assertSubjectId,
  assertTenantId,
  LESSON_04_SEED,
} from './domain.mjs';

function assertRecordName(value, name) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be printable text between 1 and 128 characters`);
  }
  return value;
}

function normalizeSeed(seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) {
    throw new TypeError('seed must be an object');
  }
  if (!Array.isArray(seed.subjects) || !Array.isArray(seed.projects)) {
    throw new TypeError('seed subjects and projects must be arrays');
  }

  const subjects = new Map();
  for (const candidate of seed.subjects) {
    const subject = Object.freeze({
      id: assertSubjectId(candidate?.id, 'seed subject id'),
      tenantId: assertTenantId(candidate?.tenantId, 'seed subject tenantId'),
      displayName: assertRecordName(candidate?.displayName, 'seed subject displayName'),
    });
    if (subjects.has(subject.id)) throw new TypeError(`duplicate subject ${subject.id}`);
    subjects.set(subject.id, subject);
  }

  const projects = new Map();
  for (const candidate of seed.projects) {
    const id = assertProjectId(candidate?.id, 'seed project id');
    const tenantId = assertTenantId(candidate?.tenantId, 'seed project tenantId');
    if (!Array.isArray(candidate?.members) || candidate.members.length < 1) {
      throw new TypeError(`project ${id} must have members`);
    }
    const members = {};
    let ownerCount = 0;
    for (const membership of candidate.members) {
      const subjectId = assertSubjectId(membership?.subjectId, 'seed membership subjectId');
      const role = assertProjectRole(membership?.role, 'seed membership role');
      const subject = subjects.get(subjectId);
      if (!subject || subject.tenantId !== tenantId) {
        throw new TypeError(`project ${id} membership must reference its tenant`);
      }
      if (members[subjectId] !== undefined) {
        throw new TypeError(`duplicate membership ${subjectId} in ${id}`);
      }
      members[subjectId] = role;
      if (role === 'owner') ownerCount += 1;
    }
    if (ownerCount !== 1) throw new TypeError(`project ${id} must have exactly one owner`);
    const project = Object.freeze({
      id,
      tenantId,
      name: assertRecordName(candidate?.name, 'seed project name'),
      members: Object.freeze(members),
    });
    if (projects.has(id)) throw new TypeError(`duplicate project ${id}`);
    projects.set(id, project);
  }
  return { subjects, projects };
}

function publicProject(project) {
  return Object.freeze({
    id: project.id,
    tenantId: project.tenantId,
    name: project.name,
    members: Object.freeze(Object.entries(project.members)
      .map(([subjectId, role]) => Object.freeze({ subjectId, role }))
      .sort((left, right) => left.subjectId.localeCompare(right.subjectId))),
  });
}

export function createProjectCoreStore(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const initial = normalizeSeed(options.seed ?? LESSON_04_SEED);
  const maxAuditEntries = options.maxAuditEntries ?? 128;
  let state = {
    subjects: new Map(initial.subjects),
    projects: new Map(initial.projects),
    audit: createEmptyAuditState(maxAuditEntries),
  };
  let transactionActive = false;

  function transact(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    if (transactionActive) throw new Error('nested project-core transactions are not allowed');
    transactionActive = true;
    const projects = new Map(state.projects);
    let audit = state.audit;
    let appendedAudit = null;
    let auditAppendCount = 0;
    const deletedResourceIds = [];
    let draftOpen = true;
    function assertDraftOpen() {
      if (!draftOpen) throw new Error('project-core transaction draft is closed');
    }
    const draft = Object.freeze({
      findSubject(subjectId) {
        assertDraftOpen();
        return state.subjects.get(subjectId) ?? null;
      },
      findProject(resourceId) {
        assertDraftOpen();
        return projects.get(resourceId) ?? null;
      },
      deleteProject(resourceId) {
        assertDraftOpen();
        const canonicalResourceId = assertProjectId(resourceId, 'transaction resourceId');
        const deleted = projects.delete(canonicalResourceId);
        if (deleted) deletedResourceIds.push(canonicalResourceId);
        return deleted;
      },
      appendAudit(candidate) {
        assertDraftOpen();
        if (auditAppendCount !== 0) {
          throw new Error('a project-core transaction must append exactly one audit entry');
        }
        audit = appendAuditEntry(audit, candidate);
        appendedAudit = audit.entries.at(-1);
        auditAppendCount += 1;
      },
    });

    try {
      const result = operation(draft);
      if (result && typeof result.then === 'function') {
        throw new TypeError('project-core transactions must be synchronous');
      }
      if (auditAppendCount !== 1) {
        throw new Error('a project-core transaction must append exactly one audit entry');
      }
      if (deletedResourceIds.length > 1) {
        throw new Error('a project-core transaction may mutate at most one project');
      }
      if (appendedAudit.decision === 'allow') {
        if (deletedResourceIds.length !== 1) {
          throw new Error('an allowed project delete must mutate exactly one project');
        }
        if (deletedResourceIds[0] !== appendedAudit.resource) {
          throw new Error('an allowed project delete must mutate its audited resource');
        }
      } else if (deletedResourceIds.length !== 0) {
        throw new Error('a denied project delete must not mutate a project');
      }
      draftOpen = false;
      state = { subjects: state.subjects, projects, audit };
      return result;
    } finally {
      draftOpen = false;
      transactionActive = false;
    }
  }

  function reset() {
    if (transactionActive) throw new Error('cannot reset during a project-core transaction');
    state = {
      subjects: new Map(initial.subjects),
      projects: new Map(initial.projects),
      audit: createEmptyAuditState(maxAuditEntries),
    };
  }

  function snapshot() {
    return structuredClone({
      projects: [...state.projects.values()]
        .map(publicProject)
        .sort((left, right) => left.id.localeCompare(right.id)),
      audit: snapshotAuditState(state.audit),
    });
  }

  function auditSnapshot() {
    return snapshotAuditState(state.audit);
  }

  return Object.freeze({ auditSnapshot, reset, snapshot, transact });
}
