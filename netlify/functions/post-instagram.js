/*
 * 인스타그램 자동 게시 — Meta Graph API (Instagram Content Publishing API)
 *
 * 필요 준비물 (Netlify 환경변수에 등록):
 *   IG_USER_ID      — 프릿지 인스타그램 비즈니스 계정의 Instagram User ID
 *   IG_ACCESS_TOKEN — 장기(long-lived) 액세스 토큰
 *
 * 요청 본문 (JSON):
 *   { "imageUrl": "https://res.cloudinary.com/.../image.jpg", "caption": "게시글 문구" }
 *
 * 제약: Graph API는 로컬 파일 업로드가 아니라 "공개적으로 접근 가능한 이미지 URL"이
 * 필요합니다 → upload-image.js(Cloudinary)로 먼저 URL을 발급받아 전달하세요.
 *
 * 흐름: ① 미디어 컨테이너 생성 → ② 컨테이너 게시 (Graph API 표준 2단계 방식)
 */
var shared = require('./_shared/response');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return shared.json(405, { ok: false, error: 'method_not_allowed' });
  }

  var missing = shared.requireEnv(['IG_USER_ID', 'IG_ACCESS_TOKEN']);
  if (missing.length) return shared.notConfigured(missing);

  var body = shared.parseBody(event);
  if (!body || !body.imageUrl || !body.caption) {
    return shared.json(400, { ok: false, error: 'missing_fields', required: ['imageUrl', 'caption'] });
  }

  var IG_USER_ID = process.env.IG_USER_ID;
  var IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
  var GRAPH_BASE = 'https://graph.facebook.com/v19.0';

  try {
    // ① 미디어 컨테이너 생성
    var createRes = await fetch(GRAPH_BASE + '/' + IG_USER_ID + '/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: body.imageUrl,
        caption: body.caption,
        access_token: IG_ACCESS_TOKEN
      })
    });
    var createData = await createRes.json();
    if (!createRes.ok || !createData.id) {
      return shared.json(502, { ok: false, error: 'container_create_failed', detail: createData });
    }

    // ② 컨테이너 게시
    var publishRes = await fetch(GRAPH_BASE + '/' + IG_USER_ID + '/media_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: IG_ACCESS_TOKEN
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
