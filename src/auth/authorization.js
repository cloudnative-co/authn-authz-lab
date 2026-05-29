const rolePermissions = {
  owner: ['project.read', 'project.update', 'project.delete', 'project.member.manage'],
  admin: ['project.read', 'project.update', 'project.member.invite'],
  member: ['project.read', 'task.write'],
  viewer: ['project.read'],
};

export function roleForProject(project, userId) {
  return project.members[userId] ?? null;
}

export function can(role, action) {
  return rolePermissions[role]?.includes(action) ?? false;
}

export function authorizeProjectAction({ projects }, userId, projectId, action) {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return { allowed: false, reason: 'project_not_found' };
  }

  const role = roleForProject(project, userId);
  if (!role) {
    return { allowed: false, reason: 'not_a_member', project, role: null };
  }

  return {
    allowed: can(role, action),
    reason: can(role, action) ? 'allowed' : 'permission_denied',
    project,
    role,
  };
}

export function listReadableProjects({ projects }, userId) {
  return projects.filter((project) => can(roleForProject(project, userId), 'project.read'));
}
