import { hashPassword } from '../auth/password.js';

export function createSeedData() {
  const users = [
    {
      id: 'user_alice',
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: hashPassword('password-alice', { salt: Buffer.from('alice-demo-salt!') }),
    },
    {
      id: 'user_bob',
      email: 'bob@example.com',
      name: 'Bob',
      passwordHash: hashPassword('password-bob', { salt: Buffer.from('bob-demo-salt!!!') }),
    },
    {
      id: 'user_carol',
      email: 'carol@example.com',
      name: 'Carol',
      passwordHash: hashPassword('password-carol', { salt: Buffer.from('carol-demo-salt!') }),
    },
  ];

  const projects = [
    {
      id: 'project_123',
      name: 'Cloud Migration',
      members: {
        user_alice: 'owner',
        user_bob: 'viewer',
      },
    },
    {
      id: 'project_456',
      name: 'Security Review',
      members: {
        user_bob: 'admin',
        user_carol: 'member',
      },
    },
  ];

  const groups = [
    { id: 'engineering', name: 'Engineering', members: ['user_alice', 'user_carol'] },
    { id: 'security', name: 'Security', members: ['user_alice', 'user_bob'] },
    { id: 'contractors', name: 'Contractors', members: ['user_carol'] },
  ];

  const oauthClients = [
    {
      clientId: 'web-app',
      clientSecret: 'web-app-secret',
      redirectUris: ['http://localhost:4000/callback'],
      allowedScopes: ['openid', 'project:read'],
      grantTypes: ['authorization_code'],
    },
    {
      clientId: 'report-app',
      clientSecret: 'report-app-secret',
      redirectUris: [],
      allowedScopes: ['project:read'],
      grantTypes: ['client_credentials'],
    },
  ];

  return { users, projects, groups, oauthClients };
}
