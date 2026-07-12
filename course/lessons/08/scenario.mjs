function requireResponse(response, status, code) {
  if (response?.status !== status || response.body?.code !== code) {
    throw new TypeError(`Lesson 08 expected ${status}/${code}`);
  }
  return response;
}

function sameGenericFailure(left, right) {
  return left?.status === 422
    && right?.status === 422
    && JSON.stringify(left.body) === JSON.stringify(right.body)
    && left.body?.code === 'DIRECTORY_AUTH_FAILED';
}

export async function runLesson08Scenario({ adapter, password, signal } = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
  if (typeof password !== 'string') throw new TypeError('password is required');

  await adapter.admin('reset', signal);
  requireResponse(await adapter.resetApp(signal), 200, 'COURSE_STATE_RESET');
  const health = requireResponse(await adapter.health(signal), 200, undefined);
  const policy = await adapter.policy(signal);
  await adapter.admin('joiner', signal);

  const firstLogin = requireResponse(await adapter.login(password, signal), 200, 'DIRECTORY_AUTHENTICATED');
  const wrongPassword = requireResponse(await adapter.wrongPassword(signal), 422, 'DIRECTORY_AUTH_FAILED');
  const firstToken = firstLogin.body.sessionToken;
  if (typeof firstToken !== 'string' || firstToken.length < 32) throw new TypeError('session token is invalid');
  const firstStableId = firstLogin.body.principal?.stableId;
  const serviceWrite = requireResponse(
    await adapter.serviceWriteProbe(signal),
    200,
    'SERVICE_ACCOUNT_WRITE_REJECTED',
  );
  const kerberos = await adapter.kerberos(password, signal);

  await adapter.admin('mover', signal);
  const moverBefore = requireResponse(await adapter.session(firstToken, signal), 200, 'APP_SESSION_ACTIVE');
  const moverRevalidation = requireResponse(
    await adapter.revalidate(firstToken, signal),
    409,
    'APP_SESSION_REVOKED',
  );
  const revokedFirst = requireResponse(await adapter.session(firstToken, signal), 401, 'APP_SESSION_INVALID');
  const secondLogin = requireResponse(await adapter.login(password, signal), 200, 'DIRECTORY_AUTHENTICATED');
  const secondToken = secondLogin.body.sessionToken;
  if (typeof secondToken !== 'string' || secondToken.length < 32 || secondToken === firstToken) {
    throw new TypeError('second session token is invalid');
  }

  await adapter.admin('leaver', signal);
  const disabledLogin = requireResponse(await adapter.login(password, signal), 422, 'DIRECTORY_AUTH_FAILED');
  const leaverBefore = requireResponse(await adapter.session(secondToken, signal), 200, 'APP_SESSION_ACTIVE');
  const leaverRevalidation = requireResponse(
    await adapter.revalidate(secondToken, signal),
    409,
    'APP_SESSION_REVOKED',
  );
  const revokedSecond = requireResponse(await adapter.session(secondToken, signal), 401, 'APP_SESSION_INVALID');

  const runtime = {
    schemaVersion: 1,
    lessonId: '08',
    evidenceBasis: 'samba-ad-compatible-dc-verified-ldaps-jml-session-revalidation-and-kinit',
    runtimeEvidence: true,
    actualProtocol: true,
    implementation: {
      runtime: health.body.implementation,
      sambaAdCompatibleDomainController: true,
      microsoftAdDsRuntime: health.body.notMicrosoftAdDs === false,
      freeIpaRuntime: health.body.notFreeIpaRuntime === false,
      gpoOrWindowsJoinProven: false,
      sysvolAclProvisioning: 'skipped-for-docker-desktop-ldap-kerberos-lab',
      network: 'compose-internal-no-published-ports',
    },
    directory: {
      transport: firstLogin.body.protocol?.transport,
      caVerified: firstLogin.body.protocol?.caVerified,
      hostnameVerified: firstLogin.body.protocol?.hostnameVerified,
      operations: firstLogin.body.protocol?.operations,
      serviceAccountWriteRejected: serviceWrite.body.outcome === 'INSUFFICIENT_ACCESS',
      serviceAccountWriteOutcome: serviceWrite.body.outcome,
    },
    identity: {
      applicationKey: 'objectGUID-derived-opaque-stable-id',
      opaqueFormatValid: /^usr_[A-Za-z0-9_-]{24}$/u.test(firstStableId ?? ''),
      stableIdPreservedAcrossMove: secondLogin.body.principal?.stableId === firstStableId,
      rawObjectGuidOmitted: true,
      distinguishedNameOmitted: true,
      emailNotUsedAsApplicationKey: true,
    },
    mapping: {
      explicit: policy.body?.mapping,
      organizationGroupIgnored: policy.body?.organizationGroupIgnored,
      directoryGroupIsNotApplicationRole: true,
    },
    joiner: {
      loginStatus: firstLogin.status,
      sessionRole: firstLogin.body.principal?.roles,
      wrongPasswordGenericStatus: wrongPassword.status,
    },
    mover: {
      existingSessionBeforeRevalidationStatus: moverBefore.status,
      existingSessionRoleBeforeRevalidation: moverBefore.body.principal?.roles,
      revalidationStatus: moverRevalidation.status,
      revalidationReason: moverRevalidation.body.reason,
      stableIdPreserved: moverRevalidation.body.stableIdPreserved,
      directoryLocationChanged: moverRevalidation.body.directoryLocationChanged,
      oldSessionRejectedAfterRevalidation: revokedFirst.status === 401,
      newLoginStatus: secondLogin.status,
      newSessionRole: secondLogin.body.principal?.roles,
    },
    leaver: {
      disabledLoginStatus: disabledLogin.status,
      disabledLoginGeneric: sameGenericFailure(wrongPassword, disabledLogin),
      existingSessionBeforeRevalidationStatus: leaverBefore.status,
      existingSessionRoleBeforeRevalidation: leaverBefore.body.principal?.roles,
      revalidationStatus: leaverRevalidation.status,
      revalidationReason: leaverRevalidation.body.reason,
      oldSessionRejectedAfterRevalidation: revokedSecond.status === 401,
    },
    kerberos: {
      sameSambaIdentityPlatform: kerberos.canonicalPrincipal && kerberos.tgtPresent,
      canonicalPrincipalObserved: kerberos.canonicalPrincipal,
      tgtObservedByKlist: kerberos.tgtPresent,
      applicationAuthenticationPath: 'LDAPS-not-Kerberos',
    },
    safety: {
      runtimeSecrets: true,
      passwordOmitted: true,
      serviceBindSecretOmitted: true,
      sessionTokensOmitted: true,
      rawObjectGuidOmitted: true,
      distinguishedNameOmitted: true,
      boundedInputTimeoutSizeAndOutput: true,
    },
  };
  const persisted = JSON.stringify(runtime);
  if (persisted.includes(password) || persisted.includes(firstToken) || persisted.includes(secondToken)) {
    throw new TypeError('Lesson 08 runtime contains a secret');
  }
  return Object.freeze(runtime);
}
