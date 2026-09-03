/*
 * 스레드 자동 게시 — Meta Threads API
 *
 * 필요 준비물 (Netlify 환경변수에 등록):
 *   THREADS_USER_ID      — 프릿지 스레드 계정 ID
 *   THREADS_ACCESS_TOKEN — 장기(long-lived) 액세스 토큰
 *
 * 요청 본문 (JSON):
 *   { "imageUrl": "https://res.cloudinary.com/.../image.jpg", "caption": "게시글 문구" }
 *   imageUrl이 없으면 텍스트 전용 게시로 처리합니다.
 *
 * 흐름: ① 미디어 컨테이너 생성 → ② 컨테이너 게시 (Instagram Graph API와 동일한 2단계 방식,
 * 단 엔드포인트는 graph.threads.net 을 사용)
 */
var shared = require('./_shared/response');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return shared.json(405, { ok: false, error: 'method_not_allowed' });
  }

  var missing = shared.requireEnv(['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN']);
  if (missing.length) return shared.notConfigured(missing);

  var body = shared.parseBody(event);
  if (!body || !body.caption) {
    return shared.json(400, { ok: false, error: 'missing_fields', required: ['caption'] });
  }

  var THREADS_USER_ID = process.env.THREADS_USER_ID;
  var THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
  var THREADS_BASE = 'https://graph.threads.net/v1.0';

  try {
    var createPayload = {
      media_type: body.imageUrl ? 'IMAGE' : 'TEXT',
      text: body.caption,
      access_token: THREADS_ACCESS_TOKEN
    };
    if (body.imageUrl) createPayload.image_url = body.imageUrl;

    // ① 미디어 컨테이너 생성
    var createRes = await fetch(THREADS_BASE + '/' + THREADS_USER_ID + '/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload)
    });
    var createData = await createRes.json();
    if (!createRes.ok || !createData.id) {
      return shared.json(502, { ok: false, error: 'container_create_failed', detail: createData });
    }

    // ② 컨테이너 게시
    var publishRes = await fetch(THREADS_BASE + '/' + THREADS_USER_ID + '/threads_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: THREADS_ACCESS_TOKEN
      })
    });
    var publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      return shared.json(502, { ok: false, error: 'publish_failed', detail: publishData });
    }

    return shared.json(200, { ok: true, postId: publishData.id });
  } catch (err) {
    return shared.json(500, { ok: false, error: 'unexpected_error', detail: String(err) });
  }
};
