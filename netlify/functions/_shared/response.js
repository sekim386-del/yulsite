/*
 * 모든 채널 함수가 공통으로 쓰는 응답/검증 헬퍼.
 * 실제 API 키는 절대 이 저장소에 커밋하지 않습니다 — Netlify 대시보드의
 * "Environment variables"에만 등록하고, 함수 코드는 process.env.* 로 읽습니다.
 */

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function notConfigured(missingVars) {
  return json(501, {
    ok: false,
    error: 'not_configured',
    message: '이 채널의 자동 게시는 아직 계정 정보가 등록되지 않았습니다.',
    missingEnvVars: missingVars,
    hint: 'Netlify 대시보드 → Site configuration → Environment variables 에서 값을 등록한 뒤 재배포하세요.'
  });
}

function requireEnv(names) {
  var missing = names.filter(function (n) { return !process.env[n]; });
  return missing;
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (e) {
    return null;
  }
}

module.exports = { json: json, notConfigured: notConfigured, requireEnv: requireEnv, parseBody: parseBody };
