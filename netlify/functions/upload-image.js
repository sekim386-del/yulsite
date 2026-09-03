/*
 * 이미지 호스팅 — Cloudinary
 *
 * 필요 준비물 (Netlify 환경변수에 등록):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * 왜 필요한가: 인스타그램·스레드 API는 파일 업로드가 아니라 "공개적으로 접근 가능한
 * 이미지 URL"을 요구합니다. 율사이트가 직접 제작한 이미지를 여기로 업로드하면
 * 게시에 쓸 수 있는 URL을 발급받습니다.
 *
 * 요청 본문 (JSON):
 *   { "imageBase64": "data:image/png;base64,..." }
 *
 * 응답: { ok: true, url: "https://res.cloudinary.com/..." }
 */
var crypto = require('crypto');
var shared = require('./_shared/response');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return shared.json(405, { ok: false, error: 'method_not_allowed' });
  }

  var missing = shared.requireEnv(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
  if (missing.length) return shared.notConfigured(missing);

  var body = shared.parseBody(event);
  if (!body || !body.imageBase64) {
    return shared.json(400, { ok: false, error: 'missing_fields', required: ['imageBase64'] });
  }

  var CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  var API_KEY = process.env.CLOUDINARY_API_KEY;
  var API_SECRET = process.env.CLOUDINARY_API_SECRET;

  var timestamp = Math.floor(Date.now() / 1000);
  // Cloudinary 서명 규칙: 파라미터를 알파벳 순으로 정렬해 문자열을 만든 뒤 API_SECRET을 붙여 SHA-1
  var signature = crypto
    .createHash('sha1')
    .update('timestamp=' + timestamp + API_SECRET)
    .digest('hex');

  try {
    var form = new URLSearchParams();
    form.append('file', body.imageBase64);
    form.append('api_key', API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    var res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/image/upload', {
      method: 'POST',
      body: form
    });
    var data = await res.json();

    if (!res.ok || !data.secure_url) {
      return shared.json(502, { ok: false, error: 'cloudinary_upload_failed', detail: data });
    }

    return shared.json(200, { ok: true, url: data.secure_url });
  } catch (err) {
    return shared.json(500, { ok: false, error: 'unexpected_error', detail: String(err) });
  }
};
