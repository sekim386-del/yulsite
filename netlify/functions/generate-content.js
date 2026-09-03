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
 * productUrl이 오면 해당 페이지를 직접 열람(크롤링)해 본문 텍스트를 추출한 뒤 AI에게 참고
 * 자료로 함께 전달합니다. (1차 미팅 회의록 8번 — "AI가 상품 상세페이지 URL을 직접 열람해
 * 특징을 파악할 수 있는지" 테스트 항목) 페이지를 못 가져오는 경우에도 생성 자체는 계속 진행하며,
 * 응답의 productContext.fetched 값으로 성공 여부를 알려줍니다.
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

var PRODUCT_CONTEXT_MAX_CHARS = 4000;
var PRODUCT_FETCH_TIMEOUT_MS = 8000;

// 상품 상세페이지 HTML에서 본문으로 추정되는 텍스트만 뽑아냅니다 (외부 라이브러리 없이 정규식 기반).
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// productUrl을 직접 열람(크롤링)해 본문 텍스트를 가져옵니다. 실패해도 예외를 던지지 않고
// { fetched: false, reason } 형태로 알려주기만 합니다 — 상품 URL이 있어도 문구 생성 자체는
// 항상 진행되어야 하기 때문입니다.
async function fetchProductContext(productUrl) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, PRODUCT_FETCH_TIMEOUT_MS);

  try {
    var res = await fetch(productUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YulsiteContentBot/1.0)' }
    });
    if (!res.ok) {
      return { fetched: false, reason: 'http_' + res.status };
    }
    var html = await res.text();
    var text = htmlToText(html).slice(0, PRODUCT_CONTEXT_MAX_CHARS);
    if (!text) {
      return { fetched: false, reason: 'empty_page' };
    }
    return { fetched: true, text: text };
  } catch (err) {
    var reason = err && err.name === 'AbortError' ? 'timeout' : 'fetch_failed';
    return { fetched: false, reason: reason };
  } finally {
    clearTimeout(timer);
  }
}

function buildUserPrompt(body, productContext) {
  var lines = [
    '콘텐츠 유형: ' + body.contentType,
    '대상 브랜드/상품: ' + body.targetBrand,
    '핵심 메시지: ' + body.coreMessage
  ];
  if (body.productUrl) {
    lines.push('참고 상품 URL: ' + body.productUrl);
    if (productContext && productContext.fetched) {
      lines.push('상품 페이지에서 확인한 내용(참고용, 과장/오류 없이 반영):');
      lines.push(productContext.text);
    } else {
      lines.push('(상품 페이지를 직접 열람하지 못했습니다 — 위 핵심 메시지만으로 작성해주세요.)');
    }
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

// 채널별 글자수 상한 (질의서 검토결과 4번 — "채널별 글자수와 해시태그 규격에 맞게 변환").
// 모델이 지시를 어기고 더 길게 쓰는 경우를 대비한 서버 쪽 안전장치.
var CHAR_LIMITS = {
  instagram: 300,
  threads: 300,
  naverBlog: 2000,
  fridgeMagazine: 900
};

function clip(text, max) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trim() + '…';
}

// 모델 응답이 요청한 4개 채널 구조를 항상 지킨다는 보장이 없으므로, 누락된 필드는 빈 값으로
// 채우고 길이를 강제한 뒤 프런트로 넘깁니다 — 화면이 undefined로 깨지는 걸 방지.
function normalizeChannels(raw) {
  raw = raw || {};
  var ig = raw.instagram || {};
  var th = raw.threads || {};
  var nb = raw.naverBlog || {};
  var fm = raw.fridgeMagazine || {};

  return {
    instagram: {
      caption: clip(ig.caption || '', CHAR_LIMITS.instagram),
      hashtags: Array.isArray(ig.hashtags) ? ig.hashtags.slice(0, 15) : []
    },
    threads: {
      caption: clip(th.caption || '', CHAR_LIMITS.threads),
      hashtags: Array.isArray(th.hashtags) ? th.hashtags.slice(0, 10) : []
    },
    naverBlog: {
      title: clip(nb.title || '', 60),
      body: clip(nb.body || '', CHAR_LIMITS.naverBlog)
    },
    fridgeMagazine: {
      title: clip(fm.title || '', 60),
      body: clip(fm.body || '', CHAR_LIMITS.fridgeMagazine)
    }
  };
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

  var productContext = null;
  if (body.productUrl) {
    productContext = await fetchProductContext(body.productUrl);
  }

  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: buildUserPrompt(body, productContext) }] }]
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

    var responseBody = { ok: true, channels: normalizeChannels(channels) };
    if (productContext) {
      responseBody.productContext = { fetched: productContext.fetched, reason: productContext.reason };
    }
    return shared.json(200, responseBody);
  } catch (err) {
    return shared.json(500, { ok: false, error: 'unexpected_error', detail: String(err) });
  }
};
