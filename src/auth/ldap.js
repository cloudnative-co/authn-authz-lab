import { AndFilter, Client, EqualityFilter, InvalidCredentialsError } from 'ldapts';

function asString(value) {
  if (Array.isArray(value)) return value[0]?.toString();
  return value?.toString();
}

// Authenticate against a real LDAP directory (RFC 4511 bind + search).
// Connection failures throw; wrong credentials resolve to null.
export async function authenticateWithDirectory({ url, baseDn, bindDn, bindPassword, email, password }) {
  // An empty password would trigger an LDAP unauthenticated bind (RFC 4513
  // §5.1.2), which many servers accept as anonymous. Reject it up front.
  if (!password) return null;

  const peopleBase = `ou=people,${baseDn}`;
  const groupsBase = `ou=groups,${baseDn}`;

  const searchClient = new Client({ url });
  const authClient = new Client({ url });
  try {
    // 1. Bind as a service account and find the user by mail. The value goes
    // into a structured EqualityFilter so ldapts escapes it — a hostile value
    // like "*)(uid=*" becomes the literal "\2a\29\28uid=\2a" (LDAP injection
    // defense) instead of altering the filter.
    await searchClient.bind(bindDn, bindPassword);
    const { searchEntries } = await searchClient.search(peopleBase, {
      scope: 'sub',
      filter: new AndFilter({
        filters: [
          new EqualityFilter({ attribute: 'objectClass', value: 'inetOrgPerson' }),
          new EqualityFilter({ attribute: 'mail', value: email }),
        ],
      }),
    });
    if (searchEntries.length !== 1) return null;
    const entry = searchEntries[0];

    // 2. Re-bind as the located DN with the supplied password. In LDAP this
    // bind is the authentication.
    try {
      await authClient.bind(entry.dn, password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) return null;
      throw error;
    }

    // 3. Collect group memberships (groupOfNames.member = user DN).
    const { searchEntries: groupEntries } = await searchClient.search(groupsBase, {
      scope: 'sub',
      filter: new AndFilter({
        filters: [
          new EqualityFilter({ attribute: 'objectClass', value: 'groupOfNames' }),
          new EqualityFilter({ attribute: 'member', value: entry.dn }),
        ],
      }),
    });

    return {
      dn: entry.dn,
      name: asString(entry.cn) ?? email,
      email: asString(entry.mail) ?? email,
      groups: groupEntries.map((group) => asString(group.cn)).filter(Boolean),
    };
  } finally {
    await searchClient.unbind().catch(() => {});
    await authClient.unbind().catch(() => {});
  }
}
