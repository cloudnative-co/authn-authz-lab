const CLASSIFICATIONS = [
  {
    id: 'authentication',
    label: '認証',
    description: '提示された資格情報を検証し、プリンシパルを確定する。',
  },
  {
    id: 'session',
    label: 'セッション',
    description: '認証後の状態を識別子にひもづけ、継続的に検証する。',
  },
  {
    id: 'authorization',
    label: '認可',
    description: '確定済みのプリンシパルに対し、対象操作を許可するか判定する。',
  },
  {
    id: 'federation',
    label: 'フェデレーション',
    description: '別の信頼ドメインが発行したアサーションやIDトークンを検証する。',
  },
  {
    id: 'delegated-authorization',
    label: '委任された認可',
    description: '利用者が委任した権限を表すアクセストークンを検証する。対象データのアプリ内認可は別に残る。',
  },
];

const VERIFIERS = [
  {
    id: 'credential-verifier',
    label: '資格情報検証器',
    description: 'パスワードなどの資格情報を検証する。',
  },
  {
    id: 'session-middleware',
    label: 'セッションミドルウェア',
    description: 'セッション識別子を照合し、有効なセッションだけを受け入れる。',
  },
  {
    id: 'policy-decision-point',
    label: 'ポリシー判定点',
    description: '属性、ロール、対象、操作を使って許可・拒否を決める。',
  },
  {
    id: 'relying-party',
    label: 'リライングパーティ',
    description: '発行者、署名、宛先、有効期限を検証して外部アイデンティティを受け入れる。',
  },
  {
    id: 'resource-server',
    label: 'リソースサーバー',
    description: 'アクセストークンの形式に応じて有効性、発行者、宛先、期限、スコープを検証する。',
  },
];

const TRACE_DEFINITIONS = [
  {
    id: 'trace-01',
    title: 'パスワードが一致したログイン',
    request: {
      method: 'POST',
      path: '/api/lessons/02/authenticate',
      presented: ['Content-Type: application/json', 'identifier', 'password'],
    },
    observations: ['保存済みhashと照合した', 'principalを確定したがsessionは発行していない'],
    response: { status: 200, outcome: 'identity-established' },
    classification: 'authentication',
  },
  {
    id: 'trace-02',
    title: 'パスワードが一致しないログイン',
    request: {
      method: 'POST',
      path: '/api/lessons/02/authenticate',
      presented: ['Content-Type: application/json', 'identifier', 'password'],
    },
    observations: ['利用者の存在有無にかかわらず同じ比較処理を実行した', '資格情報の検証に失敗した'],
    response: { status: 422, outcome: 'credential-rejected' },
    classification: 'authentication',
  },
  {
    id: 'trace-03',
    title: 'クッキーでプロジェクト一覧を再表示',
    request: { method: 'GET', path: '/api/lessons/03/me', presented: ['Cookie: course_session=(redacted)'] },
    observations: ['セッション識別子のハッシュを検索した', '失効と無効化の状態を確認した'],
    response: { status: 200, outcome: 'session-accepted' },
    classification: 'session',
  },
  {
    id: 'trace-04',
    title: 'ログアウト後の同一クッキー利用',
    request: { method: 'GET', path: '/api/lessons/03/me', presented: ['Cookie: course_session=(redacted)'] },
    observations: ['識別子にひもづくセッションは無効化済みだった', '資格情報の再検証は行っていない'],
    response: { status: 403, outcome: 'session-rejected' },
    classification: 'session',
  },
  {
    id: 'trace-05',
    title: '所有者によるプロジェクト削除',
    request: {
      method: 'DELETE',
      path: '/api/lessons/04/projects/p-100',
      presented: ['Cookie: course04_session=(redacted)'],
    },
    observations: ['Cookie sessionからprincipalを復元した', 'project-coreがtenant、対象、操作、roleを照合し削除を許可した'],
    response: { status: 204, outcome: 'operation-allowed' },
    classification: 'authorization',
  },
  {
    id: 'trace-06',
    title: '閲覧者によるプロジェクト削除',
    request: {
      method: 'DELETE',
      path: '/api/lessons/04/projects/p-100',
      presented: ['Cookie: course04_session=(redacted)'],
    },
    observations: ['Cookie sessionからprincipalを復元した', 'project-coreはviewerの削除操作を拒否した'],
    response: { status: 403, outcome: 'operation-denied' },
    classification: 'authorization',
  },
  {
    id: 'trace-07',
    title: 'SAMLレスポンスの受け入れ',
    request: { method: 'POST', path: '/saml/acs', presented: ['SAMLResponse=(redacted)'] },
    observations: ['SPが署名、Issuer、Audience、Destination、InResponseTo、Conditionsを検証した', 'アサーションIDの再利用を拒否し、IdPが表明したユーザーを受け入れた'],
    response: { status: 303, outcome: 'external-identity-accepted' },
    classification: 'federation',
  },
  {
    id: 'trace-08',
    title: 'OpenID Connectコールバック',
    request: { method: 'GET', path: '/oidc/callback', presented: ['code=(redacted)', 'state=(redacted)'] },
    observations: ['RPがstateを照合し、PKCEで認可コードをトークンと交換した', 'RPがIDトークンの署名、Issuer、Audience、期限、nonceと、複数Audience時のazpを検証した'],
    response: { status: 303, outcome: 'external-identity-accepted' },
    classification: 'federation',
  },
  {
    id: 'trace-09',
    title: '委任された読み取り権限をAPI受付段階で検証',
    request: { method: 'GET', path: '/api/projects/p-100', presented: ['Authorization: Bearer (redacted)', 'token format=JWT access token'] },
    observations: ['リソースサーバーが署名、iss、aud、exp、typを検証した', 'projects:readスコープを確認した後、対象projectのtenantとownershipを別のアプリ認可で検証した'],
    response: { status: 200, outcome: 'delegated-operation-allowed' },
    classification: 'delegated-authorization',
  },
  {
    id: 'trace-10',
    title: '書き込み権限のないアクセストークンでAPIを呼び出し',
    request: { method: 'DELETE', path: '/api/projects/p-100', presented: ['Authorization: Bearer (redacted)', 'token format=JWT access token'] },
    observations: ['署名、iss、aud、exp、typの検証は成功した', 'projects:deleteスコープがなく、対象projectのアプリ内認可へ進む前に拒否した'],
    response: { status: 403, outcome: 'delegated-operation-denied' },
    classification: 'delegated-authorization',
  },
];

const EXPECTED_VERIFIERS = {
  authentication: 'credential-verifier',
  session: 'session-middleware',
  authorization: 'policy-decision-point',
  federation: 'relying-party',
  'delegated-authorization': 'resource-server',
};

const PROVIDED_PROTOCOL_CASES = {
  'trace-07': 'saml-2.0',
  'trace-08': 'openid-connect',
  'trace-09': 'oauth-2.0',
  'trace-10': 'oauth-2.0',
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

deepFreeze(CLASSIFICATIONS);
deepFreeze(VERIFIERS);
deepFreeze(TRACE_DEFINITIONS);
deepFreeze(EXPECTED_VERIFIERS);
deepFreeze(PROVIDED_PROTOCOL_CASES);

export function getLesson01Exercise() {
  return structuredClone({
    schemaVersion: 1,
    lessonId: '01',
    evidenceBasis: 'provided-case',
    runtimeEvidence: false,
    evidenceNotice: '有限の分類問題として提供するcaseであり、実行時に取得した証跡ではありません。SAML、OpenID Connect、OAuthのcaseはproject-appでの実装または実行を示しません。',
    classificationQuestion: '各caseで強調されている検証、または拒否の直接原因を担当する境界を選びます。1つのHTTP requestに他の境界も残ることとは区別します。',
    illustratedProtocolStatus: {
      'saml-2.0': 'not-implemented',
      'openid-connect': 'not-implemented',
      'oauth-2.0': 'not-implemented',
    },
    classifications: CLASSIFICATIONS,
    verifierOptions: VERIFIERS,
    traces: TRACE_DEFINITIONS.map(({ classification, ...trace }) => ({
      ...trace,
      evidenceBasis: 'provided-case',
      runtimeEvidence: false,
      illustratedProtocol: PROVIDED_PROTOCOL_CASES[trace.id] ?? null,
      protocolImplementation: PROVIDED_PROTOCOL_CASES[trace.id] ? 'not-implemented' : 'not-applicable',
    })),
    passCriteria: {
      minimumCorrectTraces: 9,
      requiredVerifierBoundaries: CLASSIFICATIONS.map(({ id }) => id),
    },
  });
}

export function getLesson01AssessmentReference() {
  return structuredClone({
    traceClassifications: Object.fromEntries(
      TRACE_DEFINITIONS.map(({ id, classification }) => [id, classification]),
    ),
    expectedVerifiers: EXPECTED_VERIFIERS,
  });
}
