/**
 * 프릿지 OSMU 콘텐츠 엔진 — Google Apps Script 버전
 *
 * Netlify/GitHub/로컬 PC 서버 없이, 구글 시트만으로 배포·운영합니다.
 *
 * ===== 사용 전 설정 (필수) =====
 * 1. 이 스크립트가 연결된 구글 시트에 "Brand_Rules"와 "Content_History" 탭이 없으면
 *    아래 setupSheets() 함수를 스크립트 편집기에서 한 번 실행해 자동 생성하세요.
 * 2. 프로젝트 설정(⚙️) → 스크립트 속성(Script properties)에 아래 키를 등록하세요.
 *    - GEMINI_API_KEY        (필수 — 이게 없으면 문구 생성 자체가 안 됩니다)
 *    - CLOUDINARY_CLOUD_NAME (선택 — 이미지 업로드용)
 *    - CLOUDINARY_API_KEY
 *    - CLOUDINARY_API_SECRET
 *    - IG_USER_ID            (선택 — 인스타그램 자동 게시용)
 *    - IG_ACCESS_TOKEN
 *    - THREADS_USER_ID       (선택 — 스레드 자동 게시용)
 *    - THREADS_ACCESS_TOKEN
 * 3. 배포 → 새 배포 → 유형: 웹 앱 → 실행: 나 / 액세스 권한: 아무나 → 배포
 *    생성된 URL을 열면 바로 사용 가능합니다.
 */

var GEMINI_MODEL = 'gemini-flash-latest';

function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function requireProp_(name, label) {
  var v = getProp_(name);
  if (!v) throw new Error((label || name) + ' 설정이 없습니다. 프로젝트 설정 > 스크립트 속성에서 ' + name + '를 등록해주세요.');
  return v;
}

/** 최초 1회 실행: Brand_Rules / Content_History 시트가 없으면 만들고 기본값을 채웁니다. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var rules = ss.getSheetByName('Brand_Rules');
  if (!rules) {
    rules = ss.insertSheet('Brand_Rules');
    rules.appendRow(['항목', '값']);
    rules.appendRow(['Persona', 'ESG 상품 큐레이션 플랫폼 프릿지의 SNS 마케터']);
    rules.appendRow(['Keywords', 'ESG, 지속가능, 업사이클링, 친환경']);
    rules.appendRow(['Prohibited_Words', '없음']);
    rules.setFrozenRows(1);
  }

  var history = ss.getSheetByName('Content_History');
  if (!history) {
    history = ss.insertSheet('Content_History');
    history.appendRow(['ID', '생성일시', '콘텐츠유형', '대상브랜드', '핵심메시지', '인스타그램', '스레드', '네이버블로그', '프릿지매거진', '발행상태']);
    history.setFrozenRows(1);
  }

  return { ok: true, message: '시트 준비 완료' };
}

/** Brand_Rules 탭을 { 항목: 값 } 객체로 읽어옵니다. 탭이 없으면 빈 규칙으로 진행. */
function loadBrandRules_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Brand_Rules');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var rules = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) rules[data[i][0]] = data[i][1];
  }
  return rules;
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('프릿지 OSMU 콘텐츠 엔진')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 상품 URL을 직접 열람(크롤링)해 본문 텍스트를 추출합니다.
 * 실패해도 예외를 던지지 않고 { fetched:false, reason } 으로 알려주기만 합니다.
 */
function fetchProductContext_(productUrl) {
  try {
    var res = UrlFetchApp.fetch(productUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YulsiteContentBot/1.0)' }
    });
    if (res.getResponseCode() !== 200) {
      return { fetched: false, reason: 'http_' + res.getResponseCode() };
    }
    var html = res.getContentText();
    var text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    if (!text) return { fetched: false, reason: 'empty_page' };
    return { fetched: true, text: text };
  } catch (e) {
    return { fetched: false, reason: 'fetch_failed' };
  }
}

function buildPrompt_(input, rules, productContext) {
  var lines = [
    '당신은 "' + (rules.Persona || 'ESG 상품 큐레이션 플랫폼 프릿지의 SNS 마케터') + '"입니다.',
    '항상 자연스러운 한국어로만 답변하세요. 영어나 다른 언어를 섞지 마세요.',
    '주요 키워드(가능하면 자연스럽게 반영): ' + (rules.Keywords || '없음'),
    '금지어(절대 사용 금지): ' + (rules.Prohibited_Words || '없음'),
    '',
    '아래 4개 채널용 문구를 각각 작성하고, 반드시 아래 JSON 형식 하나로만 답변하세요.',
    '설명, 코드블록 표시(```json 등), 그 외 텍스트를 절대 덧붙이지 마세요.',
    '{',
    '  "instagram": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },',
    '  "threads": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },',
    '  "naverBlog": { "title": "SEO를 고려한 제목", "body": "검색 유입을 고려해 풀어 쓴 본문" },',
    '  "fridgeMagazine": { "title": "매거진 제목", "body": "매거진 본문" }',
    '}',
    '인스타그램·스레드는 300자 이내, 네이버 블로그와 프릿지 매거진은 600~900자 내외로 써주세요.',
    '',
    '콘텐츠 유형: ' + input.contentType,
    '대상 브랜드/상품: ' + input.targetBrand,
    '핵심 메시지: ' + input.coreMessage
  ];
  if (input.tone) {
    lines.push('분위기/톤: ' + input.tone);
  }
  if (input.memo) {
    lines.push('추가로 반영할 메모: ' + input.memo);
  }
  if (input.productUrl) {
    lines.push('참고 상품 URL: ' + input.productUrl);
    if (productContext && productContext.fetched) {
      lines.push('상품 페이지에서 확인한 내용(참고용, 과장/오류 없이 반영):');
      lines.push(productContext.text);
    } else {
      lines.push('(상품 페이지를 직접 열람하지 못했습니다 — 위 핵심 메시지만으로 작성해주세요.)');
    }
  }
  return lines.join('\n');
}

var CHAR_LIMITS_ = { instagram: 300, threads: 300, naverBlog: 2000, fridgeMagazine: 900 };

function clip_(text, max) {
  if (typeof text !== 'string') return '';
  return text.length <= max ? text : text.slice(0, max - 1).trim() + '…';
}

function normalizeChannels_(raw) {
  raw = raw || {};
  var ig = raw.instagram || {}, th = raw.threads || {}, nb = raw.naverBlog || {}, fm = raw.fridgeMagazine || {};
  return {
    instagram: { caption: clip_(ig.caption || '', CHAR_LIMITS_.instagram), hashtags: Array.isArray(ig.hashtags) ? ig.hashtags.slice(0, 15) : [] },
    threads: { caption: clip_(th.caption || '', CHAR_LIMITS_.threads), hashtags: Array.isArray(th.hashtags) ? th.hashtags.slice(0, 10) : [] },
    naverBlog: { title: clip_(nb.title || '', 60), body: clip_(nb.body || '', CHAR_LIMITS_.naverBlog) },
    fridgeMagazine: { title: clip_(fm.title || '', 60), body: clip_(fm.body || '', CHAR_LIMITS_.fridgeMagazine) }
  };
}

/**
 * 프런트에서 호출하는 메인 함수 — 1번의 입력으로 4채널 콘텐츠를 생성합니다.
 * input: { contentType, targetBrand, coreMessage, productUrl }
 */
function generateContent(input) {
  var apiKey = requireProp_('GEMINI_API_KEY', 'Gemini API 키');
  var rules = loadBrandRules_();

  var productContext = null;
  if (input.productUrl) productContext = fetchProductContext_(input.productUrl);

  var prompt = buildPrompt_(input, rules, productContext);
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true
  });

  var data = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini 오류: ' + (data.error ? data.error.message : res.getContentText()));
  }

  var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  var text = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
  if (!text) throw new Error('Gemini가 빈 응답을 반환했습니다.');

  var cleaned = text.replace(/```json|```/g, '').trim();
  var channels;
  try {
    channels = normalizeChannels_(JSON.parse(cleaned));
  } catch (e) {
    throw new Error('Gemini 응답을 해석할 수 없습니다: ' + text.slice(0, 200));
  }

  var historyId = saveContentHistory(input, channels);
  return { channels: channels, productContext: productContext, historyId: historyId };
}

/** Content_History 탭에 결과를 기록합니다. */
function saveContentHistory(input, channels) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Content_History');
  if (!sheet) { setupSheets(); sheet = ss.getSheetByName('Content_History'); }

  var id = 'YUL_' + new Date().getTime();
  sheet.appendRow([
    id, new Date(), input.contentType, input.targetBrand, input.coreMessage,
    JSON.stringify(channels.instagram), JSON.stringify(channels.threads),
    JSON.stringify(channels.naverBlog), JSON.stringify(channels.fridgeMagazine),
    '대기'
  ]);
  return id;
}

/**
 * 이미지를 Cloudinary에 업로드해 공개 URL을 발급받습니다.
 * base64DataUrl: "data:image/png;base64,...." 형태의 문자열
 */
function uploadImage(base64DataUrl) {
  var cloudName = requireProp_('CLOUDINARY_CLOUD_NAME', 'Cloudinary Cloud Name');
  var apiKey = requireProp_('CLOUDINARY_API_KEY', 'Cloudinary API Key');
  var apiSecret = requireProp_('CLOUDINARY_API_SECRET', 'Cloudinary API Secret');

  var timestamp = Math.floor(Date.now() / 1000);
  var toSign = 'timestamp=' + timestamp + apiSecret;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, toSign, Utilities.Charset.UTF_8);
  var signature = digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');

  var res = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/' + cloudName + '/image/upload', {
    method: 'post',
    muteHttpExceptions: true,
    payload: { file: base64DataUrl, api_key: apiKey, timestamp: String(timestamp), signature: signature }
  });
  var data = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200 || !data.secure_url) {
    throw new Error('Cloudinary 업로드 실패: ' + res.getContentText());
  }
  return data.secure_url;
}

/** 인스타그램 자동 게시 (Meta Graph API, 2단계: 컨테이너 생성 → 게시) */
function postInstagram(imageUrl, caption) {
  var userId = requireProp_('IG_USER_ID', '인스타그램 User ID');
  var token = requireProp_('IG_ACCESS_TOKEN', '인스타그램 액세스 토큰');
  var base = 'https://graph.facebook.com/v19.0/';

  var createRes = UrlFetchApp.fetch(base + userId + '/media', {
    method: 'post', muteHttpExceptions: true,
    payload: { image_url: imageUrl, caption: caption, access_token: token }
  });
  var createData = JSON.parse(createRes.getContentText());
  if (!createData.id) throw new Error('인스타그램 컨테이너 생성 실패: ' + createRes.getContentText());

  var pubRes = UrlFetchApp.fetch(base + userId + '/media_publish', {
    method: 'post', muteHttpExceptions: true,
    payload: { creation_id: createData.id, access_token: token }
  });
  var pubData = JSON.parse(pubRes.getContentText());
  if (!pubData.id) throw new Error('인스타그램 게시 실패: ' + pubRes.getContentText());
  return pubData.id;
}

/** Content_History에서 id로 행을 찾아 발행상태·게시물ID를 갱신합니다. */
function updateHistoryStatus_(id, status, postId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content_History');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.getRange(i + 1, 10).setValue(status); // J열: 발행상태
      if (postId) sheet.getRange(i + 1, 11).setValue(postId); // K열: 게시물ID
      break;
    }
  }
}

/**
 * 화면의 "발행" 버튼에서 호출하는 함수 — 이미지 업로드 → 채널별 발행 → 이력 갱신을 한 번에 처리합니다.
 * historyId: generateContent()가 반환한 ID (Content_History 행 식별용)
 * channel: 'instagram' | 'threads'
 * imageDataUrl: "data:image/png;base64,..." 형태의 업로드 이미지
 * caption: 발행할 문구 (해시태그 포함해서 화면에서 합쳐 보냄)
 */
function publishChannel(historyId, channel, imageDataUrl, caption) {
  var imageUrl = uploadImage(imageDataUrl);
  var postId;
  if (channel === 'instagram') {
    postId = postInstagram(imageUrl, caption);
  } else if (channel === 'threads') {
    postId = postThreads(imageUrl, caption);
  } else {
    throw new Error('지원하지 않는 채널입니다: ' + channel);
  }
  updateHistoryStatus_(historyId, '발행완료(' + channel + ')', postId);
  return { status: 'success', postId: postId };
}

/** 스레드 자동 게시 (Meta Threads API, 2단계: 컨테이너 생성 → 게시) */
function postThreads(imageUrl, caption) {
  var userId = requireProp_('THREADS_USER_ID', '스레드 User ID');
  var token = requireProp_('THREADS_ACCESS_TOKEN', '스레드 액세스 토큰');
  var base = 'https://graph.threads.net/v1.0/';

  var payload = { media_type: imageUrl ? 'IMAGE' : 'TEXT', text: caption, access_token: token };
  if (imageUrl) payload.image_url = imageUrl;

  var createRes = UrlFetchApp.fetch(base + userId + '/threads', { method: 'post', muteHttpExceptions: true, payload: payload });
  var createData = JSON.parse(createRes.getContentText());
  if (!createData.id) throw new Error('스레드 컨테이너 생성 실패: ' + createRes.getContentText());

  var pubRes = UrlFetchApp.fetch(base + userId + '/threads_publish', {
    method: 'post', muteHttpExceptions: true,
    payload: { creation_id: createData.id, access_token: token }
  });
  var pubData = JSON.parse(pubRes.getContentText());
  if (!pubData.id) throw new Error('스레드 게시 실패: ' + pubRes.getContentText());
  return pubData.id;
}
