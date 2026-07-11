const DEFAULT_SERVICE_PRINCIPAL = process.env.KERBEROS_SERVICE_PRINCIPAL ?? 'HTTP@app.example.test';

// SPNEGO / Kerberos acceptor (RFC 4559). Returns a handler that drives the
// "401 Negotiate -> Authorization: Negotiate <token>" HTTP exchange. The native
// kerberos module and libkrb5 are imported lazily so a plain `npm start`
// (without Kerberos configured) keeps working and answers 503 instead.
export function createNegotiateHandler({ servicePrincipal = DEFAULT_SERVICE_PRINCIPAL } = {}) {
  return async function negotiate(authorizationHeader) {
    const match = /^Negotiate\s+(.+)$/i.exec(authorizationHeader ?? '');
    if (!match) {
      return { ok: false, status: 401, headers: { 'www-authenticate': 'Negotiate' } };
    }

    let kerberos;
    try {
      kerberos = await import('kerberos');
    } catch {
      return { ok: false, status: 503, body: { error: 'kerberos_unavailable' } };
    }

    try {
      // The service keytab is resolved by libkrb5 via the KRB5_KTNAME env var.
      const server = await kerberos.initializeServer(servicePrincipal);
      const responseToken = await server.step(match[1]);
      if (!server.contextComplete) {
        return { ok: false, status: 401, headers: { 'www-authenticate': `Negotiate ${responseToken}` } };
      }
      // Mutual authentication: return the acceptor token to the client.
      return {
        ok: true,
        status: 200,
        principal: server.username,
        headers: responseToken ? { 'www-authenticate': `Negotiate ${responseToken}` } : {},
      };
    } catch (error) {
      // The GSSAPI failure reason stays in the server log, not the response.
      console.error('SPNEGO acceptor error:', error.message);
      return { ok: false, status: 401, headers: { 'www-authenticate': 'Negotiate' }, body: { error: 'spnego_failed' } };
    }
  };
}
