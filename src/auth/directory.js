import { authenticateWithPassword } from './password.js';

export class Directory {
  constructor({ users, groups }) {
    this.users = users;
    this.groups = groups;
  }

  authenticate(email, password) {
    return authenticateWithPassword({ users: this.users }, email, password);
  }

  findUserByEmail(email) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  groupsForUser(userId) {
    return this.groups.filter((group) => group.members.includes(userId));
  }

  searchUsers({ groupId } = {}) {
    if (!groupId) return this.users;
    const group = this.groups.find((candidate) => candidate.id === groupId);
    if (!group) return [];
    return this.users.filter((user) => group.members.includes(user.id));
  }
}

export function toIdentityProfile(user, groups = []) {
  return {
    subject: user.id,
    email: user.email,
    displayName: user.name,
    groups: groups.map((group) => group.id),
  };
}
