import { lesson07ProtocolConstants } from './protocol-adapter.mjs';

function sameGenericFailure(left, right) {
  return left?.status === 401
    && right?.status === 401
    && left.body?.code === 'NEGOTIATE_REQUIRED'
    && right.body?.code === 'NEGOTIATE_REQUIRED'
    && left.body?.message === right.body?.message;
}

export async function runLesson07Scenario({ adapter, password, signal } = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
  const capabilities = await adapter.inspectCapabilities(signal);
  const keytabs = await adapter.inspectKeytabOrdering(signal);

  await adapter.selectKeytab('current', signal);
  await adapter.destroyTickets(signal);
  await adapter.acquireTgt(password, signal);
  const afterKinit = await adapter.listTickets(signal);
  const unauthenticated = await adapter.unauthenticated(signal);
  const success = await adapter.requestWithNegotiate({ signal });
  const afterServiceRequest = await adapter.listTickets(signal);

  const wrongSpn = await adapter.requestWrongSpn(signal);

  const skewed = await adapter.requestWithNegotiate({ clockOffset: '+10 minutes', signal });
  const skewDiagnostics = await adapter.readDiagnostics(signal);

  let stale;
  let staleDiagnostics;
  let restored;
  try {
    await adapter.selectKeytab('stale', signal);
    await adapter.destroyTickets(signal);
    await adapter.acquireTgt(password, signal);
    stale = await adapter.requestWithNegotiate({ signal });
    staleDiagnostics = await adapter.readDiagnostics(signal);
  } finally {
    await adapter.selectKeytab('current', signal);
  }

  await adapter.destroyTickets(signal);
  await adapter.acquireTgt(password, signal);
  restored = await adapter.requestWithNegotiate({ signal });
  const finalDiagnostics = await adapter.readDiagnostics(signal);

  const runtime = {
    schemaVersion: 1,
    lessonId: '07',
    evidenceBasis: 'mit-kerberos-v5-kdc-kinit-klist-tgs-gssapi-http-negotiate',
    runtimeEvidence: true,
    wireEvidence: true,
    normal: {
      afterKinit: {
        canonicalPrincipal: afterKinit.principal,
        tgtPresent: afterKinit.tgt,
        httpServiceTicketPresent: afterKinit.httpService,
        ticketServicePrincipals: afterKinit.servicePrincipals,
      },
      challenge: {
        status: unauthenticated.status,
        scheme: unauthenticated.challenge,
      },
      authenticated: {
        status: success.status,
        code: success.body?.code,
        principal: success.body?.principal,
      },
      afterServiceRequest: {
        tgtPresent: afterServiceRequest.tgt,
        httpServiceTicketPresent: afterServiceRequest.httpService,
        ticketServicePrincipals: afterServiceRequest.servicePrincipals,
      },
    },
    rejection: {
      wrongSpn,
      clockSkew: {
        stage: 'AP-GSSAPI',
        processOffset: '+10-minutes',
        status: skewed.status,
        code: skewed.body?.code,
        reason: skewDiagnostics.counters.lastReason,
      },
      staleKeytab: {
        stage: 'AP-GSSAPI',
        status: stale?.status,
        code: stale?.body?.code,
        reason: staleDiagnostics?.counters?.lastReason,
        currentKvnoGreaterThanStale: keytabs.currentGreaterThanStale,
        currentRestored: restored.status === 200
          && restored.body?.principal === lesson07ProtocolConstants.principal,
      },
      genericHttpSurface: sameGenericFailure(unauthenticated, skewed)
        && sameGenericFailure(unauthenticated, stale),
    },
    protocol: {
      implementation: 'MIT-Kerberos-V5-and-GSSAPI',
      exchange: 'AS-TGS-AP-over-HTTP-Negotiate',
      mechanismScope: finalDiagnostics.implementation?.mechanismScope,
      exchangeScope: 'kerberos-client-token-and-final-acceptor-token',
      generalSpnegoContinuationSupported: false,
      incompleteContextCount: finalDiagnostics.counters?.incompleteContexts,
      finalAcceptorTokenObserved: finalDiagnostics.counters?.finalTokens > 0,
      finalServerTokenMayBePresent: true,
      browserBehaviorGeneralized: false,
      curlGssApi: capabilities.gssApi,
      curlSpnego: capabilities.spnego,
    },
    safety: {
      transportContext: finalDiagnostics.implementation?.transportContext,
      productionRequirement: finalDiagnostics.implementation?.productionRequirement,
      authorizationTokenOmitted: finalDiagnostics.redaction?.authorizationToken === 'omitted',
      responseTokenOmitted: finalDiagnostics.redaction?.responseToken === 'omitted',
      keytabOmitted: finalDiagnostics.redaction?.keytab === 'omitted',
      nativeErrorOmitted: finalDiagnostics.redaction?.nativeError === 'omitted',
      passwordOmitted: true,
      keytabReadOnly: true,
      hostClockChanged: false,
    },
  };
  if (typeof password === 'string' && JSON.stringify(runtime).includes(password)) {
    throw new TypeError('lesson 07 runtime contains a credential');
  }
  return Object.freeze(runtime);
}
