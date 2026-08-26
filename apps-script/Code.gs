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
    rules.appendRow(['Persona', '친환경·제로웨이스트·업사이클·비건·동물복지 브랜드를 소개하는 ESG 가치소비 플랫폼 프릿지의 마케터']);
    rules.appendRow(['Keywords', '친환경, 제로웨이스트, 업사이클, 비건, 동물복지, 가치소비, 지속가능']);
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

function doGet(e) {
  if (e && e.parameter && e.parameter.code) {
    return handleThreadsOAuthCallback_(e.parameter.code);
  }
  if (e && e.parameter && e.parameter.error) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>❌ 스레드 연동이 취소되었습니다</h2>' +
      '<p>' + (e.parameter.error_description || e.parameter.error) + '</p>' +
      '</div>'
    );
  }
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
 * ===== 스레드(Threads) 연동 — 로그인 승인 1번으로 토큰 자동 발급 =====
 * 사전 준비: 스크립트 속성에 THREADS_APP_ID, THREADS_APP_SECRET 등록
 *           (Meta 앱 대시보드 → 이용 사례 → Threads API 액세스 → 설정 탭에서 확인)
 * 그리고 그 "설정" 탭의 리디렉션 URI 등록란에 이 웹앱의 URL을 추가해야 합니다.
 * 웹앱 URL은 getThreadsAuthUrl()이 알려주는 값과 동일합니다.
 */
function getThreadsAuthUrl() {
  var clientId = requireProp_('THREADS_APP_ID', '스레드 앱 ID');
  var redirectUri = ScriptApp.getService().getUrl();
  return 'https://threads.net/oauth/authorize'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope=threads_basic,threads_content_publish'
    + '&response_type=code';
}

/** 지금 이 웹앱의 실제 배포 URL을 반환 — Meta 쪽 "리디렉션 URI" 등록에 그대로 붙여넣을 값 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

function handleThreadsOAuthCallback_(code) {
  try {
    var clientId = requireProp_('THREADS_APP_ID', '스레드 앱 ID');
    var clientSecret = requireProp_('THREADS_APP_SECRET', '스레드 앱 시크릿');
    var redirectUri = ScriptApp.getService().getUrl();

    var tokenRes = UrlFetchApp.fetch('https://graph.threads.net/oauth/access_token', {
      method: 'post',
      muteHttpExceptions: true,
      payload: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: code
      }
    });
    var tokenData = JSON.parse(tokenRes.getContentText());
    if (!tokenData.access_token) {
      return HtmlService.createHtmlOutput(
        '<div style="font-family:sans-serif;padding:40px;">' +
        '<h2>❌ 1단계(코드→토큰 교환) 실패</h2><pre>' + tokenRes.getContentText() + '</pre></div>'
      );
    }

    var longRes = UrlFetchApp.fetch(
      'https://graph.threads.net/access_token?grant_type=th_exchange_token'
      + '&client_secret=' + encodeURIComponent(clientSecret)
      + '&access_token=' + encodeURIComponent(tokenData.access_token)
    );
    var longData = JSON.parse(longRes.getContentText());
    var finalToken = longData.access_token || tokenData.access_token;

    PropertiesService.getScriptProperties().setProperty('THREADS_ACCESS_TOKEN', finalToken);
    PropertiesService.getScriptProperties().setProperty('THREADS_USER_ID', String(tokenData.user_id));

    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>✅ 스레드 연동 완료!</h2>' +
      '<p>THREADS_USER_ID: ' + tokenData.user_id + '</p>' +
      '<p>토큰이 스크립트 속성에 자동 저장되었습니다. 이 창은 닫으셔도 됩니다.</p>' +
      '</div>'
    );
  } catch (err) {
    return HtmlService.createHtmlOutput('<pre>오류: ' + err.message + '</pre>');
  }
}

var PRODUCT_LIST_URLS_ = {
  product: 'https://f-ridge.com/shop-all',
  program: 'https://f-ridge.com/program-all'
};

/**
 * 상품/프로그램 목록 페이지를 크롤링해 "이름 : 링크" 후보 목록을 추출합니다.
 * 사이트가 자바스크립트로 목록을 그리는 구조면 후보를 거의 못 찾을 수 있는데,
 * 그 경우엔 빈 배열을 반환해서 buildPrompt_가 "지어내지 말라"는 안전 문구를 쓰게 합니다.
 */
function fetchListingLinks_(itemType) {
  var url = PRODUCT_LIST_URLS_[itemType] || PRODUCT_LIST_URLS_.product;
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YulsiteContentBot/1.0)' }
    });
    if (res.getResponseCode() !== 200) return { fetched: false, reason: 'http_' + res.getResponseCode(), items: [] };

    var html = res.getContentText();
    var items = [];
    var seen = {};
    var re = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null && items.length < 60) {
      var href = m[1];
      var text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2 || text.length > 60) continue;
      if (/^(javascript:|mailto:|tel:)/i.test(href)) continue;
      if (href.indexOf('http') !== 0) {
        href = url.replace(/\/$/, '') + '/' + href.replace(/^\//, '');
      }
      var key = text + '|' + href;
      if (seen[key]) continue;
      seen[key] = true;
      items.push({ text: text, url: href });
    }
    if (!items.length) return { fetched: false, reason: 'no_links_found', items: [] };
    return { fetched: true, items: items };
  } catch (e) {
    return { fetched: false, reason: 'fetch_failed', items: [] };
  }
}

/**
 * 사용자가 직접 지정한 URL(상품/프로그램 상세페이지 등)을 열람해 본문 텍스트를 추출합니다.
 * 목록 페이지 크롤링(fetchListingLinks_)보다 훨씬 정확 — 정확한 URL을 아는 경우 이걸 우선 사용합니다.
 */
function fetchReferencePage_(pageUrl) {
  try {
    var res = UrlFetchApp.fetch(pageUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YulsiteContentBot/1.0)' }
    });
    if (res.getResponseCode() !== 200) return { fetched: false, reason: 'http_' + res.getResponseCode() };

    var html = res.getContentText();
    var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    var title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

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
    return { fetched: true, text: text, title: title, url: pageUrl };
  } catch (e) {
    return { fetched: false, reason: 'fetch_failed' };
  }
}

function buildPrompt_(input, rules, listing, reference) {
  var itemTypeLabel = input.itemType === 'program' ? '프로그램' : '상품';
  var itemCount = Number(input.itemCount) > 0 ? Number(input.itemCount) : 1;

  var persona = rules.Persona || '친환경·제로웨이스트·업사이클·비건·동물복지 브랜드를 소개하는 ESG 가치소비 플랫폼 프릿지의 마케터';
  var lines = [
    '당신은 "' + persona + '"입니다. 소속 플랫폼은 프릿지(f-ridge.com)입니다.',
    '항상 자연스러운 한국어로만 답변하세요. 영어나 다른 언어를 섞지 마세요.',
    '주요 키워드(가능하면 자연스럽게 반영): ' + (rules.Keywords || '없음'),
    '금지어(절대 사용 금지): ' + (rules.Prohibited_Words || '없음'),
    '',
    '[콘텐츠 주제] ' + input.topic,
    '[소개할 개수] ' + itemCount + '개',
    '[유형] ' + itemTypeLabel
  ];
  if (input.extraNotes) lines.push('[그 외 추가 반영사항] ' + input.extraNotes);
  if (input.tone) lines.push('[분위기/톤] ' + input.tone);
  lines.push('');

  if (reference && reference.fetched) {
    lines.push('사용자가 아래 URL을 직접 지정했습니다 — 목록에서 고를 필요 없이 이 자료를 최우선으로 사용하세요:');
    lines.push('URL: ' + reference.url);
    if (reference.title) lines.push('페이지 제목: ' + reference.title);
    lines.push('페이지 내용(참고용, 과장/오류 없이 반영):');
    lines.push(reference.text);
    lines.push('이 자료를 바탕으로 selectedItems에 {"name": 위 페이지에서 파악한 실제 이름, "url": "' + reference.url + '"} 형태로 넣고, 콘텐츠에도 반영하세요.');
  } else if (input.referenceUrl) {
    lines.push('(사용자가 지정한 참고 URL(' + input.referenceUrl + ')을 열람하지 못했습니다. selectedItems는 빈 배열로 두고, 구체적 정보를 지어내지 말고 주제만으로 일반적으로 작성하세요.)');
  } else if (listing && listing.fetched && listing.items.length) {
    lines.push('아래는 f-ridge.com ' + itemTypeLabel + ' 목록 페이지에서 가져온 후보 목록입니다 (이름 : 링크):');
    listing.items.forEach(function (it) { lines.push('- ' + it.text + ' : ' + it.url); });
    lines.push('위 후보 중에서 주제에 가장 잘 맞는 것을 정확히 ' + itemCount + '개 골라 selectedItems에 넣고, 아래 콘텐츠 본문에도 반영하세요.');
    lines.push('반드시 후보 목록에 실제로 있는 이름과 링크만 사용하고, 없는 상품명을 지어내지 마세요.');
  } else {
    lines.push('(상품/프로그램 목록 페이지를 열람하지 못했습니다. selectedItems는 빈 배열로 두고, 실제로 존재하는지 알 수 없는 구체적 상품명을 지어내지 말고 "이런 ' + itemTypeLabel + '" 처럼 일반적으로 표현하세요.)');
  }
  lines.push('');
  lines.push('반드시 아래 JSON 형식 하나로만 답변하세요. 설명, 코드블록 표시(```json 등), 그 외 텍스트를 절대 덧붙이지 마세요.');
  lines.push('{');
  lines.push('  "selectedItems": [{"name": "...", "url": "..."}],');
  lines.push('  "instagram": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },');
  lines.push('  "threads": { "caption": "짧게 끊어 쓴 문구", "hashtags": ["#해시태그1", "#해시태그2"] },');
  lines.push('  "naverBlog": { "title": "SEO를 고려한 제목", "body": "아래 [naverBlog.body 작성 규칙]을 지켜 작성한 본문" },');
  lines.push('  "fridgeMagazine": { "title": "매거진 제목", "body": "매거진 본문", "keywords": ["SEO 키워드1", "SEO 키워드2"] }');
  lines.push('}');
  lines.push('인스타그램·스레드는 300자 이내 짧은 문구로 작성하세요.');
  lines.push('');
  lines.push('=== naverBlog.body 작성 규칙 (매우 중요, 반드시 모두 지킬 것) ===');
  lines.push('이 상품(프로그램)의 판매·참여 증대를 목표로 구매욕을 자극하는 블로그 글을 쓴다. SEO, AEO, GEO를 고려해 네이버·구글·AI 검색에서 상위노출/추천될 수 있게 작성한다.');
  lines.push('1. 네이버 검색 상위노출을 고려한 키워드로 naverBlog.title(제목)을 작성할 것.');
  lines.push('2. naverBlog.body는 공백 제외 2000자 이상으로 작성할 것.');
  lines.push('3. 말투: 친근하고 친절한 반말로 쓰되, 무례하게 느껴지는 "야", "너"라는 표현은 쓰지 말 것.');
  lines.push('4. naverBlog.body의 첫 문장은 반드시 정확히 "찌-하! 오늘도 가치소비 하고 이찌?" 로 시작할 것.');
  lines.push('5. 이 상품을 쓰지 않을 때의 문제의식을 제기하고, 계속 해결되지 않을 거란 암시를 준 뒤, 이 상품을 해결책으로 자연스럽게 제시할 것.');
  lines.push('6. 이 상품이 고객에게 왜 도움이 되는지, 구매/사용 시 이점을 설명할 것.');
  lines.push('7. 이 상품/브랜드가 많이 팔릴수록 사회적으로 어떤 선한 영향력을 미치는지 어필할 것.');
  lines.push('8. 어떤 사람이 쓰면 좋을지, 누구에게 선물하면 좋을지 추천할 것.');
  lines.push('9. 개인이 직접 쓰거나 소중한 사람에게 선물하기에도 좋고, 기업·기관이 대량구매하기에도 좋은 상품임을 함께 어필할 것.');
  lines.push('10. 프릿지 소개와 함께, 왜 이 상품을 프릿지에서 사야 하는지, 일반 쇼핑몰과의 차별점, ESG 브랜드만 입점시키는 까다로운 심사를 통과한 프릿지의 공식 파트너사라는 점을 어필할 것.');
  lines.push('11. 세일즈 퍼널 흐름으로 자연스럽게 전개하고, selectedItems의 url을 본문 맥락에 자연스럽게 바로가기 링크로 삽입할 것.');
  lines.push('12. 모바일 가독성을 위해 문장 자체를 줄이지 말고, 약 15자 내외 단위로 줄바꿈(엔터) 처리할 것.');
  lines.push('13. 글 마지막에 해시태그를 작성할 것.');
  lines.push('14. 제목을 누락하지 말고 SEO/AEO/GEO를 고려해 작성할 것.');
  lines.push('너무 딱딱하지 않게, 대화하듯 자연스러운 서술형 문장을 정리된 요약투보다 더 많이 써서 작성할 것.');
  return lines.join('\n');
}

var CHAR_LIMITS_ = { instagram: 300, threads: 300, naverBlog: 4000, fridgeMagazine: 900 };

function clip_(text, max) {
  if (typeof text !== 'string') return '';
  return text.length <= max ? text : text.slice(0, max - 1).trim() + '…';
}

function normalizeChannels_(raw) {
  raw = raw || {};
  var ig = raw.instagram || {}, th = raw.threads || {}, nb = raw.naverBlog || {}, fm = raw.fridgeMagazine || {};
  var selectedItems = Array.isArray(raw.selectedItems) ? raw.selectedItems.slice(0, 5).map(function (it) {
    return { name: String((it && it.name) || ''), url: String((it && it.url) || '') };
  }) : [];
  return {
    selectedItems: selectedItems,
    instagram: { caption: clip_(ig.caption || '', CHAR_LIMITS_.instagram), hashtags: Array.isArray(ig.hashtags) ? ig.hashtags.slice(0, 15) : [] },
    threads: { caption: clip_(th.caption || '', CHAR_LIMITS_.threads), hashtags: Array.isArray(th.hashtags) ? th.hashtags.slice(0, 10) : [] },
    naverBlog: { title: clip_(nb.title || '', 80), body: clip_(nb.body || '', CHAR_LIMITS_.naverBlog) },
    fridgeMagazine: {
      title: clip_(fm.title || '', 60),
      body: clip_(fm.body || '', CHAR_LIMITS_.fridgeMagazine),
      keywords: Array.isArray(fm.keywords) ? fm.keywords.slice(0, 10).map(String) : []
    }
  };
}

/**
 * 프런트에서 호출하는 메인 함수 — 1번의 입력으로 4채널 콘텐츠를 생성합니다.
 * input: { topic, itemCount, itemType ('product'|'program'), extraNotes, tone, referenceUrl }
 */
function generateContent(input) {
  var apiKey = requireProp_('GEMINI_API_KEY', 'Gemini API 키');
  var rules = loadBrandRules_();

  var listing = null;
  var reference = null;
  if (input.referenceUrl) {
    reference = fetchReferencePage_(input.referenceUrl);
  } else {
    listing = fetchListingLinks_(input.itemType);
  }

  var prompt = buildPrompt_(input, rules, listing, reference);
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
  var sourceFetched = reference ? reference.fetched : (listing ? listing.fetched : true);
  var sourceReason = reference ? reference.reason : (listing ? listing.reason : null);
  return { channels: channels, listing: { fetched: sourceFetched, reason: sourceReason || null }, historyId: historyId };
}

/** Content_History 탭에 결과를 기록합니다. */
function saveContentHistory(input, channels) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Content_History');
  if (!sheet) { setupSheets(); sheet = ss.getSheetByName('Content_History'); }

  var itemTypeLabel = input.itemType === 'program' ? '프로그램' : '상품';
  var id = 'YUL_' + new Date().getTime();
  sheet.appendRow([
    id, new Date(), itemTypeLabel + ' ' + (input.itemCount || 1) + '개', input.topic, input.extraNotes || '',
    JSON.stringify(channels.instagram), JSON.stringify(channels.threads),
    JSON.stringify(channels.naverBlog), JSON.stringify(channels.fridgeMagazine),
    '대기'
  ]);
  return id;
}

/** 대시보드용: 최근 생성 이력을 최신순으로 N건 반환합니다. */
function getRecentHistory(limit) {
  limit = limit || 6;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content_History');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var r = data[i];
    if (!r[0]) continue;
    rows.push({
      id: r[0],
      date: r[1] ? new Date(r[1]).toISOString() : '',
      contentType: r[2] || '',
      targetBrand: r[3] || '',
      status: r[9] || '대기'
    });
    if (rows.length >= limit) break;
  }
  return rows;
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
