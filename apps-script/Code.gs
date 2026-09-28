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

var GEMINI_MODEL = 'gemini-3.6-flash';

function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

/**
 * ===== 임시 도구: 화면 입력이 안 될 때 스크립트 속성을 코드로 직접 설정 =====
 * 아래 값을 채우고, 이 함수를 편집기 상단 함수 선택 드롭다운에서 골라 ▶ 실행 버튼으로 한 번 실행하세요.
 * 실행 후에는 이 함수를 지우거나 값을 비워두는 게 안전합니다 (토큰이 코드에 남지 않도록).
 */
function setIgTokenManually() {
  var newToken = '여기에_새_IG_ACCESS_TOKEN_값을_붙여넣으세요';
  if (newToken.indexOf('여기에_') === 0) {
    throw new Error('newToken 값을 먼저 채워주세요.');
  }
  PropertiesService.getScriptProperties().setProperty('IG_ACCESS_TOKEN', newToken);
  Logger.log('IG_ACCESS_TOKEN 갱신 완료. 새 값 앞 10자: ' + newToken.slice(0, 10));
}

function requireProp_(name, label) {
  var v = getProp_(name);
  if (!v) throw new Error((label || name) + ' 설정이 없습니다. 프로젝트 설정 > 스크립트 속성에서 ' + name + '를 등록해주세요.');
  return v;
}

/**
 * 채널별 작성지침의 기본값입니다 (공통/인스타그램/스레드/네이버블로그/프릿지매거진 5개 섹션).
 * Brand_Rules 시트의 해당 칸이 비어있을 때만 이 기본값을 씁니다 —
 * 업체가 시트(또는 화면의 "문구 작성지침")에서 직접 지침을 수정하면(코드 수정·재배포 없이) 그 내용이 바로 다음 생성부터 적용됩니다.
 */
var DEFAULT_COMMON_GUIDE_ = [
  '모든 채널(인스타그램/스레드/네이버블로그/프릿지매거진) 공통으로 지킬 사항입니다. 아래 채널별 지침보다 먼저 적용됩니다.',
  '1. 실제로 존재하지 않는 정보나 과장된 효능·효과를 지어내지 말고, 사실에 기반해 진솔하게 작성할 것.',
  '2. 프릿지(f-ridge.com)가 ESG 가치소비를 지향하는 플랫폼이라는 브랜드 정체성을 자연스럽게 녹여낼 것.',
  '3. 과도하게 딱딱한 광고 문구보다는, 실제 사람이 쓴 것처럼 자연스러운 어투를 우선할 것.',
  '4. 어느 채널이든 확정적인 효능·효과 표현이나 과대광고성 표현은 쓰지 말 것.'
].join('\n');

var DEFAULT_INSTAGRAM_GUIDE_ = [
  '1. 첫 문장은 스크롤을 멈추게 하는 "후킹 문장"으로 시작할 것 (질문형, 공감형, 의외성 중 하나).',
  '2. 문장은 짧게 끊어 쓰고, 문단 사이에 줄바꿈을 넣어 모바일에서 읽기 편하게 할 것.',
  '3. 이모지를 문장 포인트마다 자연스럽게 사용할 것 (과하지 않게, 2~5개 내외).',
  '4. 캡션은 전체 300자 이내로 작성하고(인스타그램 실제 게시 글자수 제한), 마지막 줄에는 저장/공유/링크클릭 등을 유도하는 짧은 CTA(행동 유도 문구)를 넣을 것.',
  '5. hashtags는 5~10개: 브랜드 태그(#프릿지 #가치소비) + 카테고리 태그(친환경/제로웨이스트/업사이클/비건/동물복지 중 관련된 것) + 주제 특화 태그를 섞어서 구성할 것.'
].join('\n');

var DEFAULT_THREADS_GUIDE_ = [
  '1. 첫 문장은 스크롤을 멈추게 하는 "후킹 문장"으로 시작할 것 (질문형, 공감형, 의외성 중 하나).',
  '2. 문장은 짧게 끊어 쓰고, 문단 사이에 줄바꿈을 넣어 모바일에서 읽기 편하게 할 것.',
  '3. 이모지를 문장 포인트마다 자연스럽게 사용할 것 (과하지 않게, 2~5개 내외).',
  '4. 캡션은 전체 500자 이내로 작성하고(스레드 실제 게시 글자수 제한), 마지막 줄에는 저장/공유/링크클릭 등을 유도하는 짧은 CTA(행동 유도 문구)를 넣을 것.',
  '5. hashtags는 5~10개: 브랜드 태그(#프릿지 #가치소비) + 카테고리 태그(친환경/제로웨이스트/업사이클/비건/동물복지 중 관련된 것) + 주제 특화 태그를 섞어서 구성할 것.',
  '6. instagram보다 조금 더 담백하고 대화체로, 스레드 특유의 가벼운 톤으로 쓸 것.'
].join('\n');

var DEFAULT_NAVERBLOG_GUIDE_ = [
  '이 상품(프로그램)의 판매·참여 증대를 목표로 구매욕을 자극하는 블로그 글을 쓴다. SEO, AEO, GEO를 고려해 네이버·구글·AI 검색에서 상위노출/추천될 수 있게 작성한다.',
  '1. 네이버 검색 상위노출을 고려한 키워드로 naverBlog.title(제목)을 작성할 것.',
  '2. naverBlog.body는 공백 제외 2000자 이상으로 작성할 것.',
  '3. 말투: 친근하고 친절한 반말로 쓰되, 무례하게 느껴지는 "야", "너"라는 표현은 쓰지 말 것.',
  '4. naverBlog.body의 첫 문장은 반드시 정확히 "찌-하! 오늘도 가치소비 하고 이찌?" 로 시작할 것.',
  '5. 이 상품을 쓰지 않을 때의 문제의식을 제기하고, 계속 해결되지 않을 거란 암시를 준 뒤, 이 상품을 해결책으로 자연스럽게 제시할 것.',
  '6. 이 상품이 고객에게 왜 도움이 되는지, 구매/사용 시 이점을 설명할 것.',
  '7. 이 상품/브랜드가 많이 팔릴수록 사회적으로 어떤 선한 영향력을 미치는지 어필할 것.',
  '8. 어떤 사람이 쓰면 좋을지, 누구에게 선물하면 좋을지 추천할 것.',
  '9. 개인이 직접 쓰거나 소중한 사람에게 선물하기에도 좋고, 기업·기관이 대량구매하기에도 좋은 상품임을 함께 어필할 것.',
  '10. 프릿지 소개와 함께, 왜 이 상품을 프릿지에서 사야 하는지, 일반 쇼핑몰과의 차별점, ESG 브랜드만 입점시키는 까다로운 심사를 통과한 프릿지의 공식 파트너사라는 점을 어필할 것.',
  '11. 세일즈 퍼널 흐름으로 자연스럽게 전개하고, selectedItems의 url을 본문 맥락에 자연스럽게 바로가기 링크로 삽입할 것.',
  '12. 모바일 가독성을 위해 문장 자체를 줄이지 말고, 약 15자 내외 단위로 줄바꿈(엔터) 처리할 것.',
  '13. 글 마지막에 해시태그를 작성할 것.',
  '14. 제목을 누락하지 말고 SEO/AEO/GEO를 고려해 작성할 것.',
  '너무 딱딱하지 않게, 대화하듯 자연스러운 서술형 문장을 정리된 요약투보다 더 많이 써서 작성할 것.'
].join('\n');

var DEFAULT_FRIDGEMAGAZINE_GUIDE_ = [
  '프릿지 매거진은 f-ridge.com 안에 노출되는 자체 에디토리얼 콘텐츠입니다. 광고 느낌보다는 잡지 기사처럼 정보성 있게 작성합니다.',
  '1. fridgeMagazine.title은 클릭을 유도하는 매거진 스타일 제목으로 작성할 것 (예: "OO를 위한 3가지 이유"처럼 리스트형/궁금증 유발형 제목 환영).',
  '2. fridgeMagazine.body는 800~900자 내외로, 도입-본론-마무리 구조를 갖출 것.',
  '3. 도입부에서 관련 문제의식이나 공감 가는 상황을 제시하고, 본론에서 상품/프로그램을 자연스럽게 소개할 것.',
  '4. 마무리는 프릿지에서 확인/구매할 수 있다는 안내와 함께 자연스러운 CTA로 끝낼 것.',
  '5. fridgeMagazine.keywords는 SEO를 고려한 검색 키워드 3~10개로 작성할 것.'
].join('\n');

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
    rules.appendRow(['Common_Guide', DEFAULT_COMMON_GUIDE_]);
    rules.appendRow(['Instagram_Guide', DEFAULT_INSTAGRAM_GUIDE_]);
    rules.appendRow(['Threads_Guide', DEFAULT_THREADS_GUIDE_]);
    rules.appendRow(['NaverBlog_Guide', DEFAULT_NAVERBLOG_GUIDE_]);
    rules.appendRow(['FridgeMagazine_Guide', DEFAULT_FRIDGEMAGAZINE_GUIDE_]);
    rules.setFrozenRows(1);
  }

  var history = ss.getSheetByName('Content_History');
  if (!history) {
    history = ss.insertSheet('Content_History');
    history.appendRow(['ID', '생성일시', '콘텐츠유형', '대상브랜드', '핵심메시지', '인스타그램', '스레드', '네이버블로그', '프릿지매거진', '발행상태', '게시물ID', '인스타상태', '스레드상태', '네이버상태', '매거진상태', '인스타URL', '스레드URL']);
    history.setFrozenRows(1);
  } else {
    // 이미 만들어져 있던 시트라면, 나중에 추가된 열(인스타URL/스레드URL 등)의 머리글이
    // 비어있을 때만 채워 넣습니다 — 기존 데이터는 건드리지 않습니다.
    var headerRow = ['ID', '생성일시', '콘텐츠유형', '대상브랜드', '핵심메시지', '인스타그램', '스레드', '네이버블로그', '프릿지매거진', '발행상태', '게시물ID', '인스타상태', '스레드상태', '네이버상태', '매거진상태', '인스타URL', '스레드URL'];
    var lastCol = Math.max(history.getLastColumn(), 1);
    var currentHeader = history.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < headerRow.length; c++) {
      if (!currentHeader[c]) {
        history.getRange(1, c + 1).setValue(headerRow[c]);
      }
    }
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

/**
 * 지침 5개 섹션의 (시트 키, 예전 키, 기본값) 매핑입니다.
 * 예전 키(레거시)는 세분화 이전 버전(SNS_Guide 하나로 인스타/스레드 공용)에서 쓰던 값을 그대로 이어받기 위한 것으로,
 * 새 키(Instagram_Guide/Threads_Guide)가 아직 시트에 없을 때만 참고합니다.
 */
var GUIDE_SECTIONS_ = {
  common: { key: 'Common_Guide', legacyKey: null, def: function () { return DEFAULT_COMMON_GUIDE_; } },
  instagram: { key: 'Instagram_Guide', legacyKey: 'SNS_Guide', def: function () { return DEFAULT_INSTAGRAM_GUIDE_; } },
  threads: { key: 'Threads_Guide', legacyKey: 'SNS_Guide', def: function () { return DEFAULT_THREADS_GUIDE_; } },
  naverBlog: { key: 'NaverBlog_Guide', legacyKey: null, def: function () { return DEFAULT_NAVERBLOG_GUIDE_; } },
  fridgeMagazine: { key: 'FridgeMagazine_Guide', legacyKey: null, def: function () { return DEFAULT_FRIDGEMAGAZINE_GUIDE_; } }
};

/** rules(시트 값 객체)에서 한 섹션의 현재 값을 구합니다: 새 키 → 레거시 키 → 기본값 순. */
function resolveGuideValue_(rules, section) {
  var cfg = GUIDE_SECTIONS_[section];
  if (rules[cfg.key] && String(rules[cfg.key]).trim()) return String(rules[cfg.key]).trim();
  if (cfg.legacyKey && rules[cfg.legacyKey] && String(rules[cfg.legacyKey]).trim()) return String(rules[cfg.legacyKey]).trim();
  return cfg.def();
}

/**
 * 화면(설정 탭)에서 호출 — 현재 작성지침 5개 섹션(공통/인스타그램/스레드/네이버블로그/프릿지매거진)을 반환합니다.
 * 시트에 값이 없으면 기본 지침을 그대로 보여줘서, 화면에서 "이게 지금 적용 중인 지침"임을 알 수 있게 합니다.
 * 각 섹션에 modified(기본값에서 직접 수정했는지) 플래그를 함께 내려줘서 화면에 "직접 수정함" 표시를 할 수 있게 합니다.
 */
function getGuidelines() {
  var rules = loadBrandRules_();
  var result = {};
  Object.keys(GUIDE_SECTIONS_).forEach(function (section) {
    var value = resolveGuideValue_(rules, section);
    result[section] = { value: value, modified: value !== GUIDE_SECTIONS_[section].def() };
  });
  return result;
}

/**
 * 화면(설정 탭)에서 호출 — 작성지침 5개 섹션을 Brand_Rules 시트에 저장합니다. 재배포 없이 다음 생성부터 바로 반영됩니다.
 * guides: { common, instagram, threads, naverBlog, fridgeMagazine } (문자열, 비어있으면 해당 섹션은 기본값으로 저장됨)
 */
function saveGuidelines(guides) {
  guides = guides || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Brand_Rules');
  if (!sheet) { setupSheets(); sheet = ss.getSheetByName('Brand_Rules'); }

  Object.keys(GUIDE_SECTIONS_).forEach(function (section) {
    var cfg = GUIDE_SECTIONS_[section];
    var value = (guides[section] && String(guides[section]).trim()) || cfg.def();
    setBrandRuleValue_(sheet, cfg.key, value);
  });
  return { ok: true };
}

/** 화면(설정 탭)에서 호출 — 지침 섹션 하나만 기본값으로 되돌립니다. section: 'common'|'instagram'|'threads'|'naverBlog'|'fridgeMagazine' */
function resetGuidelineSection(section) {
  var cfg = GUIDE_SECTIONS_[section];
  if (!cfg) throw new Error('알 수 없는 지침 항목: ' + section);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Brand_Rules');
  if (!sheet) { setupSheets(); sheet = ss.getSheetByName('Brand_Rules'); }
  var def = cfg.def();
  setBrandRuleValue_(sheet, cfg.key, def);
  return { ok: true, value: def };
}

/** Brand_Rules 시트에서 항목명으로 행을 찾아 값을 갱신하고, 없으면 새 행을 추가합니다. */
function setBrandRuleValue_(sheet, key, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.optout) {
    return handleVendorOptOut_(e.parameter.optout);
  }
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

    // user_id는 숫자가 매우 커서 JSON.parse가 정밀도를 잃을 수 있으므로,
    // /me 엔드포인트에서 문자열(quoted)로 다시 조회해 정확한 값을 확보합니다.
    var meRes = UrlFetchApp.fetch(
      'https://graph.threads.net/v1.0/me?fields=id&access_token=' + encodeURIComponent(finalToken),
      { muteHttpExceptions: true }
    );
    var meData = JSON.parse(meRes.getContentText());
    var userId = meData.id || String(tokenData.user_id);

    PropertiesService.getScriptProperties().setProperty('THREADS_ACCESS_TOKEN', finalToken);
    PropertiesService.getScriptProperties().setProperty('THREADS_USER_ID', userId);

    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h2>✅ 스레드 연동 완료!</h2>' +
      '<p>THREADS_USER_ID: ' + userId + '</p>' +
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
/** html에서 <meta property="og:xxx" content="..."> 형태의 값을 속성 순서 무관하게 추출합니다. */
function extractMetaContent_(html, property) {
  var re1 = new RegExp('<meta[^>]+property=["\']' + property + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
  var re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']' + property + '["\']', 'i');
  var m = html.match(re1) || html.match(re2);
  return m ? m[1] : '';
}

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

    // 상품 대표 이미지: og:image → twitter:image → 본문 첫 <img> 순으로 시도
    var imageUrl = extractMetaContent_(html, 'og:image') || extractMetaContent_(html, 'twitter:image');
    if (!imageUrl) {
      var imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) imageUrl = imgMatch[1];
    }
    if (imageUrl && imageUrl.indexOf('http') !== 0) {
      // 상대경로 보정 (Apps Script V8 런타임에는 URL API가 없어 직접 조합)
      var originMatch = pageUrl.match(/^(https?:\/\/[^/]+)/i);
      var origin = originMatch ? originMatch[1] : '';
      if (imageUrl.indexOf('//') === 0) {
        imageUrl = 'https:' + imageUrl;
      } else if (imageUrl.indexOf('/') === 0) {
        imageUrl = origin + imageUrl;
      } else {
        imageUrl = origin ? (origin + '/' + imageUrl) : '';
      }
    }

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
    return { fetched: true, text: text, title: title, url: pageUrl, imageUrl: imageUrl || '' };
  } catch (e) {
    return { fetched: false, reason: 'fetch_failed' };
  }
}

/** 이미지 URL을 서버에서 내려받아 <img>에 바로 쓸 수 있는 data URL로 변환합니다. (브라우저 CORS 우회) */
// Cloudinary는 보안 정책상 SVG/PDF 등은 기본적으로 업로드를 거부합니다("Invalid image file" 오류).
// 실제 사진 형식만 자동 채움 대상으로 허용하고, 로고/일러스트(SVG 등)는 조용히 건너뜁니다.
var ALLOWED_REFERENCE_IMAGE_TYPES_ = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

function fetchImageAsDataUrl_(imageUrl) {
  try {
    var res = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    var blob = res.getBlob();
    var contentType = (blob.getContentType() || '').toLowerCase();
    if (ALLOWED_REFERENCE_IMAGE_TYPES_.indexOf(contentType) === -1) return null;
    var bytes = blob.getBytes();
    if (!bytes || bytes.length < 100) return null; // 너무 작은 응답은 에러 페이지 등으로 의심되어 제외
    var base64 = Utilities.base64Encode(bytes);
    return 'data:' + contentType + ';base64,' + base64;
  } catch (e) {
    return null;
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
  lines.push('');
  lines.push('=== 공통 작성지침 (모든 채널에 우선 적용) ===');
  lines.push(resolveGuideValue_(rules, 'common'));
  lines.push('');
  lines.push('=== instagram 캡션 작성지침 (반드시 지킬 것) ===');
  lines.push(resolveGuideValue_(rules, 'instagram'));
  lines.push('');
  lines.push('=== threads 캡션 작성지침 (반드시 지킬 것) ===');
  lines.push(resolveGuideValue_(rules, 'threads'));
  lines.push('');
  lines.push('=== naverBlog.body 작성지침 (매우 중요, 반드시 모두 지킬 것) ===');
  lines.push(resolveGuideValue_(rules, 'naverBlog'));
  lines.push('');
  lines.push('=== fridgeMagazine 작성지침 (반드시 지킬 것) ===');
  lines.push(resolveGuideValue_(rules, 'fridgeMagazine'));
  return lines.join('\n');
}

var CHAR_LIMITS_ = { instagram: 300, threads: 500, naverBlog: 4000, fridgeMagazine: 900 };

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

  // 참고 URL에서 상품 대표 이미지를 찾았다면 함께 내려보냅니다. (사진을 직접 등록하지 않은 경우 화면에 자동으로 채워짐)
  var referenceImage = null;
  if (reference && reference.fetched && reference.imageUrl) {
    referenceImage = fetchImageAsDataUrl_(reference.imageUrl);
  }

  return {
    channels: channels,
    listing: { fetched: sourceFetched, reason: sourceReason || null },
    historyId: historyId,
    referenceImage: referenceImage
  };
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

/**
 * ===== 화면(설정 탭) "연결 테스트" 버튼에서 호출 =====
 * 자격증명 하나를 실제로 그 서비스에 접속해 테스트하고, 실패 시 원인을 "값 잘못됨 / 만료됨 / 권한없음"으로 구분해 알려줍니다.
 * type: 'gemini' | 'cloudinary' | 'instagram' | 'threads'
 * 반환: { ok: boolean, reason: string, message: string }
 */
function testConnection(type) {
  switch (type) {
    case 'gemini': return testGeminiConnection_();
    case 'cloudinary': return testCloudinaryConnection_();
    case 'instagram': return testInstagramConnection_();
    case 'threads': return testThreadsConnection_();
    default: return { ok: false, reason: 'unknown', message: '알 수 없는 연동 항목입니다: ' + type };
  }
}

function testGeminiConnection_() {
  var apiKey = getProp_('GEMINI_API_KEY');
  if (!apiKey) return { ok: false, reason: 'missing', message: '값이 등록되어 있지 않습니다. 스크립트 속성에 GEMINI_API_KEY를 등록해주세요.' };
  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: '연결 테스트' }] }] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());
    if (code === 200 && data.candidates) {
      return { ok: true, reason: 'ok', message: '정상 연결됨 (모델: ' + GEMINI_MODEL + ')' };
    }
    var msg = (data.error && data.error.message) || res.getContentText();
    if (code === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) {
      return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다 (API 키가 유효하지 않음).' };
    }
    if (code === 403) {
      return { ok: false, reason: 'forbidden', message: '권한이 없습니다 (이 키로 해당 모델 사용이 거부됨). ' + msg };
    }
    if (code === 429) {
      return { ok: false, reason: 'quota', message: '요청량 한도 초과 또는 서버 혼잡입니다. 값 자체는 정상일 가능성이 높습니다. 잠시 후 다시 시도해주세요.' };
    }
    return { ok: false, reason: 'unknown', message: '오류(' + code + '): ' + msg };
  } catch (e) {
    return { ok: false, reason: 'network', message: '네트워크 오류로 확인하지 못했습니다: ' + e.message };
  }
}

function testCloudinaryConnection_() {
  var cloudName = getProp_('CLOUDINARY_CLOUD_NAME');
  var apiKey = getProp_('CLOUDINARY_API_KEY');
  var apiSecret = getProp_('CLOUDINARY_API_SECRET');
  if (!cloudName || !apiKey || !apiSecret) {
    var missing = [];
    if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!apiKey) missing.push('CLOUDINARY_API_KEY');
    if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
    return { ok: false, reason: 'missing', message: '값이 등록되어 있지 않습니다: ' + missing.join(', ') };
  }
  try {
    var url = 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(cloudName) + '/ping';
    var auth = Utilities.base64Encode(apiKey + ':' + apiSecret);
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Basic ' + auth }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) return { ok: true, reason: 'ok', message: '정상 연결됨 (cloud: ' + cloudName + ')' };
    if (code === 401) return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다 (API 키/시크릿이 클라우드 이름과 맞지 않음).' };
    if (code === 404) return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다 (CLOUDINARY_CLOUD_NAME(' + cloudName + ')이 존재하지 않음).' };
    return { ok: false, reason: 'unknown', message: '오류(' + code + '): ' + res.getContentText().slice(0, 200) };
  } catch (e) {
    return { ok: false, reason: 'network', message: '네트워크 오류로 확인하지 못했습니다: ' + e.message };
  }
}

function testInstagramConnection_() {
  var userId = getProp_('IG_USER_ID');
  var token = getProp_('IG_ACCESS_TOKEN');
  if (!token || !userId) {
    var missing = [];
    if (!userId) missing.push('IG_USER_ID');
    if (!token) missing.push('IG_ACCESS_TOKEN');
    return { ok: false, reason: 'missing', message: '값이 등록되어 있지 않습니다: ' + missing.join(', ') };
  }
  try {
    var debugRes = UrlFetchApp.fetch(
      'https://graph.facebook.com/debug_token?input_token=' + encodeURIComponent(token) + '&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var debugData = JSON.parse(debugRes.getContentText());
    if (debugData.error) {
      return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다 (토큰 형식 오류). ' + debugData.error.message };
    }
    if (debugData.data && debugData.data.is_valid === false) {
      return { ok: false, reason: 'expired', message: '토큰이 만료되었거나 무효화되었습니다. 설정 탭에서 재발급이 필요합니다.' };
    }

    var acctRes = UrlFetchApp.fetch(
      'https://graph.facebook.com/v19.0/' + userId + '?fields=id,username&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var acctData = JSON.parse(acctRes.getContentText());
    if (acctData.error) {
      var code = acctData.error.code, sub = acctData.error.error_subcode;
      if (code === 190) return { ok: false, reason: 'expired', message: '토큰이 만료되었습니다. 재발급이 필요합니다.' };
      if (code === 100 || code === 200 || sub === 33) {
        return { ok: false, reason: 'forbidden', message: '권한이 없습니다 (IG_USER_ID와 토큰이 서로 다른 계정/앱이거나 필요한 권한이 없음). ' + acctData.error.message };
      }
      return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다. ' + acctData.error.message };
    }

    var expiresAt = debugData.data && debugData.data.expires_at;
    var expireNote = (expiresAt === 0) ? ' (만료 없음)' : (expiresAt ? (' (만료: ' + new Date(expiresAt * 1000).toLocaleString('ko-KR') + ')') : '');
    return { ok: true, reason: 'ok', message: '정상 연결됨: @' + (acctData.username || acctData.id) + expireNote };
  } catch (e) {
    return { ok: false, reason: 'network', message: '네트워크 오류로 확인하지 못했습니다: ' + e.message };
  }
}

function testThreadsConnection_() {
  var userId = getProp_('THREADS_USER_ID');
  var token = getProp_('THREADS_ACCESS_TOKEN');
  if (!token || !userId) {
    var missing = [];
    if (!userId) missing.push('THREADS_USER_ID');
    if (!token) missing.push('THREADS_ACCESS_TOKEN');
    return { ok: false, reason: 'missing', message: '값이 등록되어 있지 않습니다: ' + missing.join(', ') };
  }
  try {
    var meRes = UrlFetchApp.fetch(
      'https://graph.threads.net/v1.0/me?fields=id,username&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var meData = JSON.parse(meRes.getContentText());
    if (meData.error) {
      var code = meData.error.code;
      if (code === 190) return { ok: false, reason: 'expired', message: '토큰이 만료되었습니다. 설정 탭에서 재연동이 필요합니다.' };
      if (code === 10 || code === 200 || code === 803) {
        return { ok: false, reason: 'forbidden', message: '권한이 없습니다. ' + meData.error.message };
      }
      return { ok: false, reason: 'invalid', message: '값 자체가 잘못되었습니다. ' + meData.error.message };
    }
    if (String(meData.id) !== String(userId)) {
      return {
        ok: false, reason: 'mismatch',
        message: '값 자체가 잘못되었습니다 (저장된 THREADS_USER_ID(' + userId + ')가 실제 토큰 계정 ID(' + meData.id + ')와 다릅니다). 설정 탭에서 재연동해주세요.'
      };
    }
    return { ok: true, reason: 'ok', message: '정상 연결됨: @' + (meData.username || meData.id) };
  } catch (e) {
    return { ok: false, reason: 'network', message: '네트워크 오류로 확인하지 못했습니다: ' + e.message };
  }
}

/**
 * ===== 진단 도구: 로그인 없이, 지금 등록된 IG_ACCESS_TOKEN이 정확히 뭐가 문제인지 확인 =====
 * 스크립트 편집기 함수 드롭다운에서 이 함수를 고르고 ▶ 실행 → 실행 로그(보기 > 실행 기록/로그)에서 결과 확인.
 * 로그인/비밀번호 전혀 필요 없이, 현재 저장된 토큰만으로 서버에서 바로 확인합니다.
 */
function debugInstagramToken() {
  var userId = getProp_('IG_USER_ID');
  var token = getProp_('IG_ACCESS_TOKEN');
  if (!token) { Logger.log('IG_ACCESS_TOKEN이 아예 등록되어 있지 않습니다.'); return; }
  if (!userId) { Logger.log('IG_USER_ID가 아예 등록되어 있지 않습니다.'); return; }

  Logger.log('===== 1) 토큰 자체 정보 (scope, 만료일 등) =====');
  var debugRes = UrlFetchApp.fetch(
    'https://graph.facebook.com/debug_token?input_token=' + encodeURIComponent(token) +
    '&access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log(debugRes.getContentText());

  Logger.log('===== 2) 이 토큰으로 실제 부여된 권한 목록 =====');
  var permRes = UrlFetchApp.fetch(
    'https://graph.facebook.com/v19.0/me/permissions?access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log(permRes.getContentText());

  Logger.log('===== 3) IG_USER_ID(' + userId + ')로 실제 계정 정보 조회 =====');
  var acctRes = UrlFetchApp.fetch(
    'https://graph.facebook.com/v19.0/' + userId + '?fields=id,username,account_type&access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log(acctRes.getContentText());

  Logger.log('===== 확인 포인트 =====');
  Logger.log('- 2)번 결과에 "instagram_content_publish"(또는 instagram_basic)가 없으면 → 권한 자체가 없는 토큰. 권한 추가 발급 필요.');
  Logger.log('- 3)번 결과에 에러가 뜨면 → IG_USER_ID와 토큰이 서로 다른 계정/앱 것이라 안 맞는 상태.');
  Logger.log('- 1)번 결과의 expires_at이 이미 지난 시각이면 → 토큰 만료. 재발급 필요.');
}

/** 인스타그램 자동 게시 (Meta Graph API, 2단계: 컨테이너 생성 → 준비 대기 → 게시) */
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

  // 인스타그램 서버가 이미지를 다운로드·처리할 시간이 필요합니다.
  // status_code가 FINISHED가 될 때까지 최대 10번(약 30초) 대기했다가 발행합니다.
  var containerId = createData.id;
  var statusUrl = base + containerId + '?fields=status_code&access_token=' + encodeURIComponent(token);
  for (var i = 0; i < 10; i++) {
    Utilities.sleep(3000);
    var statusRes = UrlFetchApp.fetch(statusUrl, { muteHttpExceptions: true });
    var statusData = JSON.parse(statusRes.getContentText());
    if (statusData.status_code === 'FINISHED') break;
    if (statusData.status_code === 'ERROR') {
      throw new Error('인스타그램 미디어 처리 실패: ' + statusRes.getContentText());
    }
    // IN_PROGRESS면 계속 대기
  }

  var pubRes = UrlFetchApp.fetch(base + userId + '/media_publish', {
    method: 'post', muteHttpExceptions: true,
    payload: { creation_id: containerId, access_token: token }
  });
  var pubData = JSON.parse(pubRes.getContentText());
  if (!pubData.id) throw new Error('인스타그램 게시 실패: ' + pubRes.getContentText());

  // 실제 게시물 URL(permalink)을 추가로 조회합니다. 실패해도 발행 자체는 이미 끝난 상태라
  // 에러를 던지지 않고 url을 빈 값으로 둡니다(발행 결과 자체는 정상 반환).
  var permalink = '';
  try {
    var linkRes = UrlFetchApp.fetch(
      base + pubData.id + '?fields=permalink&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var linkData = JSON.parse(linkRes.getContentText());
    permalink = linkData.permalink || '';
  } catch (e) { /* permalink 조회 실패는 무시 */ }

  return { id: pubData.id, url: permalink };
}

/** 채널별 상태를 캘린더용으로 별도 열에 기록하기 위한 채널→열번호 매핑 (L~O열). */
var CHANNEL_STATUS_COL_ = { instagram: 12, threads: 13, naverBlog: 14, fridgeMagazine: 15 };

/** 실제 발행된 게시물 URL을 기록하기 위한 채널→열번호 매핑 (P~Q열). 자동 발행 채널(인스타/스레드)만 해당. */
var CHANNEL_URL_COL_ = { instagram: 16, threads: 17 };

/** Content_History에서 id로 행을 찾아 발행상태·게시물ID·채널별 상태·게시물URL을 갱신합니다. */
function updateHistoryStatus_(id, status, postId, channel, postUrl) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content_History');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.getRange(i + 1, 10).setValue(status); // J열: 발행상태(최근 동작 요약)
      if (postId) sheet.getRange(i + 1, 11).setValue(postId); // K열: 게시물ID
      var col = CHANNEL_STATUS_COL_[channel];
      if (col) sheet.getRange(i + 1, col).setValue(status); // L~O열: 채널별 상태(캘린더 표시용)
      var urlCol = CHANNEL_URL_COL_[channel];
      if (urlCol && postUrl) sheet.getRange(i + 1, urlCol).setValue(postUrl); // P~Q열: 실제 게시물 URL
      break;
    }
  }
}

/** 화면의 "복사" 버튼 클릭 시 호출 — 캘린더에 표시하기 위해 복사 동작을 기록합니다. */
function recordCopy(historyId, channel) {
  updateHistoryStatus_(historyId, '복사완료', null, channel);
  return { status: 'ok' };
}

/** 캘린더 상세에서 "취소" 클릭 시 호출 — 실수로 기록된 채널 상태를 지웁니다. */
function clearChannelStatus(id, channel) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content_History');
  if (!sheet) return { status: 'ok' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      var col = CHANNEL_STATUS_COL_[channel];
      if (col) sheet.getRange(i + 1, col).setValue('');
      break;
    }
  }
  return { status: 'ok' };
}

/** 대시보드 캘린더용: 채널별 발행·복사 현황을 날짜별로 반환합니다. */
function getPublishCalendar() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Content_History');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var channels = {
      instagram: !!(r[11] && String(r[11]).trim()),
      threads: !!(r[12] && String(r[12]).trim()),
      naverBlog: !!(r[13] && String(r[13]).trim()),
      fridgeMagazine: !!(r[14] && String(r[14]).trim())
    };
    if (!channels.instagram && !channels.threads && !channels.naverBlog && !channels.fridgeMagazine) continue;
    rows.push({
      id: r[0],
      date: r[1] ? new Date(r[1]).toISOString() : '',
      contentType: r[2] || '',
      targetBrand: r[3] || '',
      channels: channels,
      urls: { instagram: r[15] || '', threads: r[16] || '' }
    });
  }
  return rows;
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
  var result;
  if (channel === 'instagram') {
    result = postInstagram(imageUrl, caption);
  } else if (channel === 'threads') {
    result = postThreads(imageUrl, caption);
  } else {
    throw new Error('지원하지 않는 채널입니다: ' + channel);
  }
  updateHistoryStatus_(historyId, '발행완료', result.id, channel, result.url);
  return { status: 'success', postId: result.id, postUrl: result.url };
}

/** 진단 도구: 스레드 토큰/ID가 실제로 서로 맞는지 확인 (로그인 없이 바로 실행) */
function debugThreadsToken() {
  var userId = getProp_('THREADS_USER_ID');
  var token = getProp_('THREADS_ACCESS_TOKEN');
  Logger.log('저장된 THREADS_USER_ID: ' + userId);

  Logger.log('===== 1) 이 토큰으로 /me 조회 (실제 연결된 계정 확인) =====');
  var meRes = UrlFetchApp.fetch(
    'https://graph.threads.net/v1.0/me?fields=id,username&access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log(meRes.getContentText());

  Logger.log('===== 2) 저장된 THREADS_USER_ID로 직접 조회 =====');
  var idRes = UrlFetchApp.fetch(
    'https://graph.threads.net/v1.0/' + userId + '?fields=id,username&access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log(idRes.getContentText());
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

  // 실제 게시물 URL(permalink)을 추가로 조회합니다. 실패해도 발행 자체는 이미 끝난 상태라
  // 에러를 던지지 않고 url을 빈 값으로 둡니다(발행 결과 자체는 정상 반환).
  var permalink = '';
  try {
    var linkRes = UrlFetchApp.fetch(
      base + pubData.id + '?fields=permalink&access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var linkData = JSON.parse(linkRes.getContentText());
    permalink = linkData.permalink || '';
  } catch (e) { /* permalink 조회 실패는 무시 */ }

  return { id: pubData.id, url: permalink };
}

/**
 * ===================================================================
 * 입점 제안 이메일 자동화 (신규 입점사 발굴 아웃리치)
 * ===================================================================
 * 재사용 가능한 패턴: "시트 기반 관리(CRM) + 시간 기반 트리거로 자동 실행 + Gmail 발송".
 * 나중에 비슷한 요청(정기적으로 뭔가 자동 발송/자동 확인)이 오면 이 구조를 거의 그대로 복사해 쓰면 됩니다.
 *
 * 설계 원칙(중요):
 * - 후보 업체는 절대 자동으로 수집하지 않습니다. 정보통신망법상 웹사이트에서 자동 수집한
 *   주소로 광고성 메일을 보내는 것은 규제 대상이라, 담당자가 직접 확보한 연락처만
 *   "입점제안_업체리스트" 시트에 직접 입력해서 씁니다.
 * - 메일 제목/본문은 "입점제안_설정" 시트에서 코드 수정·재배포 없이 바로 고칠 수 있습니다.
 * - GmailApp으로 발송하므로, 스크립트를 실행하는 구글 계정의 이름으로 메일이 나갑니다.
 *   "@yulsight.com" 주소로 보내려면 그 계정 자체가 Google Workspace(유료) 계정이어야 합니다.
 * - 하루 발송 상한(MaxDailySend)으로 한 번에 너무 많이 보내 스팸 처리되는 걸 방지합니다.
 * - 메일 본문에 수신거부 링크가 자동 삽입되고, 클릭하면 자동으로 발송 대상에서 제외됩니다.
 * - 회신 자동 확인은 "답장이 왔는지 여부"만 확인합니다(Gmail 검색). 내용 판단(관심 있음/없음 등)은
 *   자동화되지 않으므로, 실제 입점 진행 여부는 담당자가 답장을 읽고 시트에서 직접 상태를 바꿔야 합니다.
 *
 * ===== 사용법 =====
 * 1. setupVendorOutreachSheets()를 한 번 실행해 시트 2개를 만듭니다.
 * 2. "입점제안_업체리스트" 시트에 업체명/담당자/이메일을 입력합니다(상태·최근발송일 등은 비워두면 됩니다).
 * 3. "입점제안_설정" 시트에서 메일 제목/본문을 필요하면 수정합니다(플레이스홀더: {{업체명}}, {{담당자}}, {{이메일}}, {{수신거부링크}}).
 * 4. installVendorOutreachTriggers()를 한 번 실행하면, 이후 2주마다 자동 발송 + 매일 회신 자동 확인이 시작됩니다.
 *    (실행 시 Gmail 권한 승인 화면이 뜨면 승인해주세요 — 최초 1회만 필요합니다.)
 * 5. 궁금하면 previewVendorProposals()를 실행해서 "다음 실행 때 누구에게 보내질지" 미리 확인할 수 있습니다.
 */

var VENDOR_SHEET_ = '입점제안_업체리스트';
var VENDOR_SETTINGS_SHEET_ = '입점제안_설정';

/** 시트 열 번호(1-indexed) — 업체리스트 시트 기준 */
var VENDOR_COLS_ = {
  id: 1, name: 2, contact: 3, email: 4, status: 5,
  lastSentAt: 6, sentCount: 7, createdAt: 8, memo: 9, optOutToken: 10
};

var VENDOR_SKIP_STATUSES_ = ['회신됨', '입점완료', '보류', '수신거부'];

var DEFAULT_VENDOR_PROPOSAL_SUBJECT_ = '[프릿지] {{업체명}}님, ESG 가치소비 플랫폼 프릿지 입점 제안드립니다';
var DEFAULT_VENDOR_PROPOSAL_BODY_ = [
  '안녕하세요, {{업체명}} {{담당자}}님.',
  '',
  '친환경·제로웨이스트·업사이클·비건·동물복지 등 ESG 가치소비를 지향하는 플랫폼 "프릿지(f-ridge.com)"입니다.',
  '',
  '{{업체명}}의 상품/서비스가 프릿지가 소개하는 가치와 잘 맞는다고 판단되어 입점을 제안드리고자 합니다.',
  '관심 있으시면 이 메일에 회신 주시면 상세 안내드리겠습니다.',
  '',
  '감사합니다.',
  '프릿지 드림',
  '',
  '---',
  '이 메일은 입점 제안을 위해 개별적으로 발송되었습니다. 더 이상 수신을 원치 않으시면 아래 링크를 클릭해주세요.',
  '{{수신거부링크}}'
].join('\n');

var DEFAULT_VENDOR_SEND_INTERVAL_DAYS_ = 14;
var DEFAULT_VENDOR_MAX_DAILY_SEND_ = 20; // 한 번 실행당 최대 발송 개수 — 평판 보호용 안전장치
var DEFAULT_VENDOR_AI_PERSONALIZE_ = false; // 기본 꺼짐 — 옵트인 기능

/** 최초 1회 실행: 입점 제안 관련 시트 2개("입점제안_업체리스트", "입점제안_설정")를 만들고 기본값을 채웁니다. */
function setupVendorOutreachSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var settings = ss.getSheetByName(VENDOR_SETTINGS_SHEET_);
  if (!settings) {
    settings = ss.insertSheet(VENDOR_SETTINGS_SHEET_);
    settings.appendRow(['항목', '값']);
    settings.appendRow(['Subject', DEFAULT_VENDOR_PROPOSAL_SUBJECT_]);
    settings.appendRow(['Body', DEFAULT_VENDOR_PROPOSAL_BODY_]);
    settings.appendRow(['SendIntervalDays', DEFAULT_VENDOR_SEND_INTERVAL_DAYS_]);
    settings.appendRow(['MaxDailySend', DEFAULT_VENDOR_MAX_DAILY_SEND_]);
    settings.appendRow(['AiPersonalize', DEFAULT_VENDOR_AI_PERSONALIZE_]);
    settings.setFrozenRows(1);
  }

  var vendors = ss.getSheetByName(VENDOR_SHEET_);
  if (!vendors) {
    vendors = ss.insertSheet(VENDOR_SHEET_);
    vendors.appendRow(['ID', '업체명', '담당자', '이메일', '상태', '최근발송일', '발송횟수', '등록일', '메모', '수신거부토큰']);
    vendors.setFrozenRows(1);
  }

  return { ok: true, message: '입점 제안 시트 준비 완료' };
}

/** 입점제안_설정 시트에서 현재 템플릿/발송주기/일일상한/AI개인화 여부를 읽어옵니다. 비어있으면 기본값을 씁니다. */
function loadVendorSettings_() {
  var result = {
    subject: DEFAULT_VENDOR_PROPOSAL_SUBJECT_,
    body: DEFAULT_VENDOR_PROPOSAL_BODY_,
    intervalDays: DEFAULT_VENDOR_SEND_INTERVAL_DAYS_,
    maxDailySend: DEFAULT_VENDOR_MAX_DAILY_SEND_,
    aiPersonalize: DEFAULT_VENDOR_AI_PERSONALIZE_
  };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SETTINGS_SHEET_);
  if (!sheet) return result;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0], val = data[i][1];
    if (key === 'Subject' && val) result.subject = String(val);
    if (key === 'Body' && val) result.body = String(val);
    if (key === 'SendIntervalDays' && val) result.intervalDays = Number(val) || DEFAULT_VENDOR_SEND_INTERVAL_DAYS_;
    if (key === 'MaxDailySend' && val) result.maxDailySend = Number(val) || DEFAULT_VENDOR_MAX_DAILY_SEND_;
    if (key === 'AiPersonalize') result.aiPersonalize = (String(val).toLowerCase() === 'true');
  }
  return result;
}

/** 화면(입점 제안 탭)에서 호출 — 현재 메일 템플릿/발송 설정을 반환합니다. */
function getVendorSettings() {
  return loadVendorSettings_();
}

/** 화면(입점 제안 탭)에서 호출 — 메일 템플릿/발송 설정을 저장합니다. 코드 재배포 없이 다음 발송부터 반영됩니다. */
function saveVendorSettings(settings) {
  settings = settings || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(VENDOR_SETTINGS_SHEET_);
  if (!sheet) { setupVendorOutreachSheets(); sheet = ss.getSheetByName(VENDOR_SETTINGS_SHEET_); }

  var map = {
    Subject: (settings.subject && String(settings.subject).trim()) || DEFAULT_VENDOR_PROPOSAL_SUBJECT_,
    Body: (settings.body && String(settings.body).trim()) || DEFAULT_VENDOR_PROPOSAL_BODY_,
    SendIntervalDays: Number(settings.intervalDays) > 0 ? Number(settings.intervalDays) : DEFAULT_VENDOR_SEND_INTERVAL_DAYS_,
    MaxDailySend: Number(settings.maxDailySend) > 0 ? Number(settings.maxDailySend) : DEFAULT_VENDOR_MAX_DAILY_SEND_,
    AiPersonalize: settings.aiPersonalize ? 'true' : 'false'
  };

  var data = sheet.getDataRange().getValues();
  Object.keys(map).forEach(function (key) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(map[key]);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([key, map[key]]);
  });
  return { ok: true };
}

/** 업체 하나를 등록합니다(자동 수집 없음 — 담당자가 직접 입력). 화면 또는 스크립트 편집기에서 직접 호출 가능. */
function addVendor(name, contact, email, memo) {
  if (!name || !email) throw new Error('업체명과 이메일은 필수입니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(VENDOR_SHEET_);
  if (!sheet) { setupVendorOutreachSheets(); sheet = ss.getSheetByName(VENDOR_SHEET_); }

  var id = 'VEND_' + new Date().getTime();
  var token = Utilities.getUuid();
  sheet.appendRow([id, name, contact || '', email, '대기중', '', 0, new Date(), memo || '', token]);
  return { ok: true, id: id };
}

/**
 * 여러 업체를 한 번에 등록합니다. text는 한 줄에 하나씩, "업체명,담당자,이메일,메모" 형식
 * (담당자/메모는 생략 가능: "업체명,,이메일" 처럼 빈 칸으로 두면 됩니다).
 * 업체명이나 이메일이 없는 줄, 이메일 형식이 아닌 줄은 건너뛰고 skipped에 이유와 함께 담아 반환합니다.
 */
function addVendorsBulk(text) {
  var lines = String(text || '').split('\n');
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var rowsToAdd = [];
  var skipped = [];
  var now = new Date();

  lines.forEach(function (line, idx) {
    var raw = line.trim();
    if (!raw) return;
    var parts = raw.split(',').map(function (p) { return p.trim(); });
    var name = parts[0] || '';
    var contact = parts[1] || '';
    var email = parts[2] || '';
    var memo = parts.slice(3).join(',').trim();

    if (!name || !email) { skipped.push({ line: idx + 1, text: raw, reason: '업체명 또는 이메일 누락' }); return; }
    if (!emailPattern.test(email)) { skipped.push({ line: idx + 1, text: raw, reason: '이메일 형식 오류' }); return; }

    rowsToAdd.push([
      'VEND_' + now.getTime() + '_' + rowsToAdd.length,
      name, contact, email, '대기중', '', 0, now, memo, Utilities.getUuid()
    ]);
  });

  if (rowsToAdd.length) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(VENDOR_SHEET_);
    if (!sheet) { setupVendorOutreachSheets(); sheet = ss.getSheetByName(VENDOR_SHEET_); }
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
  }

  return { ok: true, added: rowsToAdd.length, skipped: skipped };
}

/**
 * 화면에서 호출 — 지금 저장된(또는 화면에서 아직 저장 전인) 템플릿을 샘플 업체 데이터로 채워
 * 실제 발송 시 어떻게 보일지 미리 보여줍니다. settings를 안 넘기면 시트에 저장된 값을 씁니다.
 */
function previewVendorEmail(settings) {
  var s = (settings && (settings.subject || settings.body)) ? settings : loadVendorSettings_();
  var sample = { name: '(주)샘플컴퍼니', contact: '김담당', email: 'sample@example.com', memo: '친환경 리필스테이션을 운영하는 제로웨이스트 편집숍' };
  var optOutUrl = ScriptApp.getService().getUrl() + '?optout=샘플토큰';
  var result = buildVendorEmailBody_(s, sample, optOutUrl);
  return {
    subject: fillVendorTemplate_(s.subject, sample, optOutUrl),
    body: result.body,
    aiApplied: result.aiApplied,
    aiReason: result.aiReason
  };
}

/**
 * 화면에서 호출 — 실제 업체에게 나가기 전에, 저장된(또는 화면에서 입력 중인) 템플릿을
 * 내가 지정한 이메일로 먼저 보내서 실제 수신함에서 어떻게 보이는지 확인합니다.
 * 업체리스트에는 전혀 기록되지 않고, 발송횟수에도 영향 없는 순수 테스트 발송입니다.
 */
function sendTestVendorEmail(toEmail, settings) {
  if (!toEmail) throw new Error('테스트로 받을 이메일 주소를 입력해주세요.');
  var s = (settings && (settings.subject || settings.body)) ? settings : loadVendorSettings_();
  var sample = { name: '(주)샘플컴퍼니', contact: '김담당', email: toEmail, memo: '친환경 리필스테이션을 운영하는 제로웨이스트 편집숍' };
  var optOutUrl = ScriptApp.getService().getUrl() + '?optout=샘플토큰(테스트)';
  var subject = '[테스트] ' + fillVendorTemplate_(s.subject, sample, optOutUrl);
  var result = buildVendorEmailBody_(s, sample, optOutUrl);
  GmailApp.sendEmail(toEmail, subject, result.body);
  return { ok: true, aiApplied: result.aiApplied, aiReason: result.aiReason };
}

/** 화면에서 호출 — 등록된 업체 목록을 반환합니다. */
function getVendorList() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SHEET_);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    rows.push({
      id: r[0], name: r[1], contact: r[2], email: r[3], status: r[4] || '대기중',
      lastSentAt: r[5] ? new Date(r[5]).toISOString() : '',
      sentCount: r[6] || 0,
      createdAt: r[7] ? new Date(r[7]).toISOString() : '',
      memo: r[8] || ''
    });
  }
  return rows;
}

/** 화면에서 호출 — 업체 상태를 담당자가 직접 변경합니다 (예: 회신 내용 확인 후 "입점완료"로 표시). */
function updateVendorStatus(id, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SHEET_);
  if (!sheet) return { ok: false };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.getRange(i + 1, VENDOR_COLS_.status).setValue(status);
      return { ok: true };
    }
  }
  return { ok: false };
}

/** 템플릿의 {{업체명}} 등 플레이스홀더를 실제 값으로 치환합니다. */
function fillVendorTemplate_(template, vendor, optOutUrl) {
  return String(template || '')
    .replace(/\{\{업체명\}\}/g, vendor.name || '')
    .replace(/\{\{담당자\}\}/g, vendor.contact || '담당자')
    .replace(/\{\{이메일\}\}/g, vendor.email || '')
    .replace(/\{\{수신거부링크\}\}/g, optOutUrl || '');
}

/**
 * ===== AI 개인화 (옵트인, 기본 꺼짐) =====
 * 업체 메모를 참고해서, 본문 첫 줄(인사말) 바로 다음에 넣을 한두 문장짜리 도입부를 제미나이로 다듬습니다.
 * - 메모가 없거나 너무 짧으면(4자 미만) AI를 호출하지 않고 그냥 빈 문자열(추가 문장 없음)을 반환합니다.
 * - "훌륭한 철학에 감명받아" 류의 상투적인 AI 문구를 쓰지 않도록 프롬프트에서 명시적으로 금지합니다.
 * - 호출이 실패해도(키 없음/오류/과부하) 조용히 빈 문자열을 반환해서, 발송 자체가 막히지 않게 합니다.
 */
function personalizeVendorOpening_(vendor) {
  if (!vendor.memo || String(vendor.memo).trim().length < 4) {
    return { text: '', reason: '메모가 비어있거나 너무 짧습니다(4자 미만). 메모를 적어두면 개인화가 적용됩니다.' };
  }
  var apiKey = getProp_('GEMINI_API_KEY');
  if (!apiKey) {
    return { text: '', reason: 'GEMINI_API_KEY가 스크립트 속성에 등록되어 있지 않습니다.' };
  }

  var prompt = [
    '당신은 프릿지(f-ridge.com)의 마케터입니다. 아래 업체에게 보낼 입점 제안 메일의 인사말 바로 다음에',
    '들어갈 짧은 도입 문장을 하나 써주세요.',
    '',
    '[업체명] ' + (vendor.name || ''),
    '[이 업체에 대한 메모(담당자가 직접 남긴 내용)] ' + vendor.memo,
    '',
    '규칙(반드시 지킬 것):',
    '1. 한국어로, 담백하고 자연스러운 비즈니스 문체로 쓸 것. 이모지 쓰지 말 것.',
    '2. "훌륭한 철학에 깊은 감명을 받아", "귀사의 뛰어난" 같은 상투적인 AI스러운 칭찬·아부 문구는 절대 쓰지 말 것.',
    '3. 메모에 실제로 적힌 내용만 반영하고, 메모에 없는 사실을 지어내지 말 것.',
    '4. 딱 1문장, 50자 이내로 짧게 쓸 것.',
    '5. 결과는 그 문장 하나만 출력하고, 따옴표·마크다운·설명을 붙이지 말 것.'
  ].join('\n');

  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) {
      return { text: '', reason: 'Gemini 오류: ' + ((data.error && data.error.message) || res.getContentText()) };
    }
    var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    var text = parts ? parts.map(function (p) { return p.text || ''; }).join('').trim() : '';
    if (!text) return { text: '', reason: 'Gemini가 빈 응답을 반환했습니다.' };
    return { text: text, reason: null };
  } catch (e) {
    return { text: '', reason: '호출 실패: ' + e.message }; // 실패해도 발송이 막히면 안 되므로 text는 빈 문자열
  }
}

/**
 * 템플릿을 채운 뒤, AI 개인화가 켜져 있으면 본문 첫 줄(인사말) 다음에 개인화 문장을 삽입합니다.
 * (본문 첫 줄이 인사말이라는 가정 — 기본 템플릿 구조 기준. 템플릿을 완전히 다른 구조로 바꾸면
 * 삽입 위치가 어색할 수 있으니, 그런 경우 AI 개인화는 끄고 쓰는 걸 권장합니다.)
 * 반환값: { body, aiApplied, aiReason } — aiReason은 적용 안 됐을 때 그 이유(화면에 표시용)
 */
function buildVendorEmailBody_(settings, vendor, optOutUrl) {
  var body = fillVendorTemplate_(settings.body, vendor, optOutUrl);
  if (!settings.aiPersonalize) return { body: body, aiApplied: false, aiReason: null };

  var result = personalizeVendorOpening_(vendor);
  if (!result.text) return { body: body, aiApplied: false, aiReason: result.reason };

  var lines = body.split('\n');
  lines.splice(1, 0, '', result.text);
  return { body: lines.join('\n'), aiApplied: true, aiReason: null };
}

/** 지금 당장 sendVendorProposals()를 실행하면 누구에게 발송되는지 미리 확인합니다(실제 발송 안 함). */
function previewVendorProposals() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SHEET_);
  if (!sheet) return [];
  var settings = loadVendorSettings_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var preview = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0] || !r[3]) continue;
    var status = r[4] || '대기중';
    if (VENDOR_SKIP_STATUSES_.indexOf(status) !== -1) continue;
    var lastSentAt = r[5] ? new Date(r[5]) : null;
    if (lastSentAt) {
      var daysSince = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < settings.intervalDays) continue;
    }
    preview.push({ name: r[1], email: r[3], status: status });
    if (preview.length >= settings.maxDailySend) break;
  }
  return preview;
}

/**
 * ===== 시간 기반 트리거로 2주마다 자동 실행 =====
 * 발송 대상(대기중이거나, 이전 발송 후 설정된 주기가 지난 업체)에게 입점 제안 메일을 보냅니다.
 * 하루 발송 상한(MaxDailySend)을 넘지 않도록 제한해서 스팸 처리를 방지합니다.
 * 회신됨/입점완료/보류/수신거부 상태인 업체는 건너뜁니다.
 */
function sendVendorProposals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(VENDOR_SHEET_);
  if (!sheet) { Logger.log('입점제안_업체리스트 시트가 없습니다. setupVendorOutreachSheets()를 먼저 실행하세요.'); return { ok: false, sentCount: 0 }; }

  var settings = loadVendorSettings_();
  var webAppUrl = ScriptApp.getService().getUrl();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var sentThisRun = 0;

  for (var i = 1; i < data.length; i++) {
    if (sentThisRun >= settings.maxDailySend) break;
    var r = data[i];
    if (!r[0] || !r[3]) continue; // ID/이메일 없으면 건너뜀
    var status = r[4] || '대기중';
    if (VENDOR_SKIP_STATUSES_.indexOf(status) !== -1) continue;

    var lastSentAt = r[5] ? new Date(r[5]) : null;
    if (lastSentAt) {
      var daysSince = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < settings.intervalDays) continue; // 아직 발송 주기가 안 됨
    }

    var vendor = { name: r[1], contact: r[2], email: r[3], memo: r[8] };
    var token = r[9] || Utilities.getUuid();
    if (!r[9]) sheet.getRange(i + 1, VENDOR_COLS_.optOutToken).setValue(token);
    var optOutUrl = webAppUrl + '?optout=' + encodeURIComponent(token);

    var subject = fillVendorTemplate_(settings.subject, vendor, optOutUrl);
    var bodyResult = buildVendorEmailBody_(settings, vendor, optOutUrl);
    if (settings.aiPersonalize && !bodyResult.aiApplied) {
      Logger.log('AI 개인화 적용 안 됨 (' + vendor.email + '): ' + bodyResult.aiReason);
    }

    try {
      GmailApp.sendEmail(vendor.email, subject, bodyResult.body);
      sheet.getRange(i + 1, VENDOR_COLS_.status).setValue('발송완료');
      sheet.getRange(i + 1, VENDOR_COLS_.lastSentAt).setValue(now);
      sheet.getRange(i + 1, VENDOR_COLS_.sentCount).setValue((Number(r[6]) || 0) + 1);
      sentThisRun++;
    } catch (e) {
      Logger.log('발송 실패 (' + vendor.email + '): ' + e.message);
    }
  }

  Logger.log('이번 실행에서 ' + sentThisRun + '건 발송했습니다.');
  return { ok: true, sentCount: sentThisRun };
}

/**
 * ===== 매일 트리거로 자동 실행 =====
 * 이미 발송했던("발송완료" 상태) 업체의 이메일 주소로부터 최근 30일 내 답장이 왔는지 Gmail에서
 * 확인해, 있으면 자동으로 "회신됨" 상태로 바꿔줍니다. 답장 "내용"까지는 판단하지 않으므로,
 * 실제 입점 진행 여부는 담당자가 답장을 읽고 updateVendorStatus()나 시트에서 직접 갱신해야 합니다.
 */
function checkVendorReplies() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SHEET_);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0] || !r[3]) continue;
    if ((r[4] || '') !== '발송완료') continue; // 발송한 적 있는 업체만 확인

    try {
      var threads = GmailApp.search('from:' + r[3] + ' newer_than:30d', 0, 1);
      if (threads.length > 0) {
        sheet.getRange(i + 1, VENDOR_COLS_.status).setValue('회신됨');
      }
    } catch (e) {
      Logger.log('회신 확인 실패 (' + r[3] + '): ' + e.message);
    }
  }
}

/** 수신거부 링크 클릭 시 doGet()에서 호출 — 해당 업체를 자동으로 발송 대상에서 제외합니다. */
function handleVendorOptOut_(token) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VENDOR_SHEET_);
  var found = false;
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][9] === token) {
        sheet.getRange(i + 1, VENDOR_COLS_.status).setValue('수신거부');
        found = true;
        break;
      }
    }
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;text-align:center;">' +
    (found
      ? '<h2>✅ 수신거부 처리되었습니다</h2><p>더 이상 입점 제안 메일이 발송되지 않습니다.</p>'
      : '<h2>처리할 수 없습니다</h2><p>유효하지 않거나 만료된 링크입니다.</p>') +
    '</div>'
  );
}

/**
 * ===== 최초 1회 실행 =====
 * 입점 제안 자동 발송(2주마다 월요일 오전 10시)과 회신 자동 확인(매일 오전 9시) 트리거를 설치합니다.
 * 이미 같은 이름으로 등록된 트리거가 있으면 먼저 지우고 다시 설치합니다(중복 설치 방지).
 * 실행 시 Gmail 권한 승인 화면이 뜨면 승인해주세요.
 */
function installVendorOutreachTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendVendorProposals' || fn === 'checkVendorReplies') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sendVendorProposals').timeBased().everyWeeks(2).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10).create();
  ScriptApp.newTrigger('checkVendorReplies').timeBased().everyDays(1).atHour(9).create();

  return { ok: true, message: '트리거 설치 완료: 2주마다 월요일 오전 10시 자동 발송, 매일 오전 9시 회신 확인' };
}
