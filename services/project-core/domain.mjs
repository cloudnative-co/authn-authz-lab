export const LESSON_04_ACTION = 'project:delete';

export const LESSON_04_REASONS = Object.freeze({
  OWNER: 'project-owner',
  INSUFFICIENT_ROLE: 'insufficient-project-role',
  CONCEALED: 'resource-concealed',
});

export const LESSON_04_SEED = deepFreeze({
  subjects: [
    { id: 'user-100', tenantId: 't-100', displayName: 'Alice' },
    { id: 'user-200', tenantId: 't-100', displayName: 'Bob' },
    { id: 'user-300', tenantId: 't-100', displayName: 'Carol' },
    { id: 'user-400', tenantId: 't-200', displayName: 'Dave' },
  ],
  projects: [
    {
      id: 'p-100',
      tenantId: 't-100',
      name: 'Mini Project',
      members: [
        { subjectId: 'user-100', role: 'owner' },
        { subjectId: 'user-200', role: 'viewer' },
      ],
    },
  ],
});

const SUBJECT_ID = /^user-[1-9][0-9]*$/u;
const TENANT_ID = /^t-[1-9][0-9]*$/u;
const PROJECT_ID = /^p-[1-9][0-9]*$/u;
const ROLES = new Set(['owner', 'viewer']);

const ALLOW = Object.freeze({
  decision: 'allow',
  status: 204,
  reason: LESSON_04_REASONS.OWNER,
});
const FORBID = Object.freeze({
  decision: 'deny',
  status: 403,
  reason: LESSON_04_REASONS.INSUFFICIENT_ROLE,
});
const CONCEAL = Object.freeze({
  decision: 'deny',
  status: 404,
  reason: LESSON_04_REASONS.CONCEALED,
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function assertCanonical(value, pattern, name) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${name} must be a canonical identifier`);
  }
  return value;
}

export function assertSubjectId(value, name = 'subjectId') {
  return assertCanonical(value, SUBJECT_ID, name);
}

export function assertTenantId(value, name = 'tenantId') {
  return assertCanonical(value, TENANT_ID, name);
}

export function assertProjectId(value, name = 'resourceId') {
  return assertCanonical(value, PROJECT_ID, name);
}

export function assertProjectRole(value, name = 'role') {
  if (typeof value !== 'string' || !ROLES.has(value)) {
    throw new TypeError(`${name} must be owner or viewer`);
  }
  return value;
}

export function evaluateProjectDeletePolicy({ subject, project }) {
  if (!subject || !project) return CONCEAL;
  if (subject.tenantId !== project.tenantId) return CONCEAL;

  const role = project.members[subject.id];
  if (role === 'owner') return ALLOW;
  if (role === 'viewer') return FORBID;
  return CONCEAL;
}
