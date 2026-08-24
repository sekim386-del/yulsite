/*
 * AI 콘텐츠 자동 생성 — Gemini API (Google AI Studio)
 *
 * 필요 준비물 (Netlify 환경변수에 등록):
 *   GEMINI_API_KEY — https://aistudio.google.com/apikey 에서 발급 (무료 사용량으로 시작 가능)
 *
 * 요청 본문 (JSON):
 *   {
 *     "contentType": "입점사 소개",       // 선택 메뉴 입력값
 *     "targetBrand": "○○공방",           // 선택 메뉴 입력값 (대상 브랜드/상품)
 *     "coreMessage": "자유 작성 텍스트",   // 이번 건에만 해당하는 핵심 메시지
 *     "productUrl": "https://f-ridge.com/products/..."  // 선택. 상품 추천형 콘텐츠일 때만
 *   }
 *
 * 1번의 입력으로 4개 채널에 맞는 문구를 한 번에 생성합니다(OSMU: One Source Multi Use).
 * 채널별 규격:
 *   - 인스타그램 · 스레드 : 짧게 끊어 쓴 문구 + 해시태그
 *   - 네이버 블로그       : 검색 유입을 고려해 풀어 쓴 본문(SEO)
 *   - 프릿지 매거진        : 매거진 입력 항목에 맞춘 형태
 *     ※ 프릿지(아임웹) 매거진 글쓰기 화면 구조를 아직 전달받지 못해, 현재는 "제목/본문" 2단
 *       구조로 임시 생성합니다. 화면 캡처 수령 후 실제 입력 항목 순서에 맞춰 조정 예정입니다.
 *
 * 이미지는 생성하지 않습니다 — 이미지는 율사이트가 직접 제작합니다(PRD.md 참고).
 */
var shared = require('./_shared/response');

// 'gemini-flash-latest'는 Google이 관리하는 별칭으로, 항상 현재 권장되는 최신 flash 모델을
// 가리킵니다. 특정 모델명을 직접 고정하면 나중에 그 모델이 지원 종료(404)될 수 있어 별칭 사용.
var GEMINI_MODEL = 'gemini-flash-latest';

var SYSTEM_INSTRUCTION = [
  '당신은 ESG 상품 큐레이션 플랫폼 "프릿지"(율사이트 운영)의 SNS 마케터입니다.',
  '항상 자연스러운 한국어로만 답변하세요. 영어나 다른 언어를 섞지 마세요.',
  '입력된 조건에 맞춰 아래 4개 채널용 문구를 각각 작성하고, 반드시 아래 JSON 형식 하나로만 답변하세요.',
  '설명, 코드블록 표시(```json 등), 그 외 텍스트를 절대 덧붙이지 마세요.',
  '{',
  '  "instagram": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },',
  '  "threads": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },',
  '  "naverBlog": { "title": "SEO를 고려한 제목", "body": "검색 유입을 고려해 풀어 쓴 본문" },',
  '  "fridgeMagazine": { "title": "매거진 제목", "body": "매거진 본문" }',
  '}',
  '인스타그램·스레드는 300자 이내로 짧고 임팩트 있게, 네이버 블로그와 프릿지 매거진은',
  '600~900자 내외로 충분히 풀어 써주세요.'
].join('\n');

function buildUserPrompt(body) {
  var lines = [
    '콘텐츠 유형: ' + body.contentType,
    '대상 브랜드/상품: ' + body.targetBrand,
    '핵심 메시지: ' + body.coreMessage
  ];
  if (body.productUrl) {
    lines.push('참고 상품 URL: ' + body.productUrl);
  }
  return lines.join('\n');
}

// Gemini 응답에서 JSON 부분만 안전하게 추출 (모델이 코드블록으로 감싸 보내는 경우 대비)
function extractJson(text) {
  var trimmed = (text || '').trim();
  var fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) trimmed = fenced[1].trim();
  return JSON.parse(trimmed);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return shared.json(405, { ok: false, error: 'method_not_allowed' });
  }

  var missing = shared.requireEnv(['GEMINI_API_KEY']);
  if (missing.length) return shared.notConfigured(missing);

  var body = shared.parseBody(event);
  if (!body || !body.contentType || !body.targetBrand || !body.coreMessage) {
    return shared.json(400, {
      ok: false,
      error: 'missing_fields',
      required: ['contentType', 'targetBrand', 'coreMessage']
    });
  }

  var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
    ':generateContent?key=' + encodeURIComponent(GEMINI_API_KEY);

  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: buildUserPrompt(body) }] }]
      })
    });
    var data = await res.json();

    if (!res.ok) {
      return shared.json(502, { ok: false, error: 'gemini_api_error', detail: data });
    }

    var parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    var text = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';

    if (!text) {
      return shared.json(502, { ok: false, error: 'empty_response', detail: data });
    }

    var channels;
    try {
      channels = extractJson(text);
    } catch (parseErr) {
      return shared.json(502, { ok: false, error: 'invalid_json_from_model', raw: text });
    }

    return shared.json(200, { ok: true, channels: channels });
  } catch (err) {
    return shared.json(500, { ok: false, error: 'unexpected_error', detail: String(err) });
  }
};
