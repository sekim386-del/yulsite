/*
 * 입력 폼의 선택 메뉴(팝업) 항목.
 *
 * TODO: 아래 목록은 임시 예시입니다. 고객사가 "업무상 반복적으로 발생하는 콘텐츠
 * 유형·조건"을 정리해 전달하면 그 내용으로 교체합니다. (PRD.md 7번 항목 참고)
 */

var CONTENT_TYPES = [
  '입점사 소개',
  '상품 추천',
  '이벤트/프로모션',
  '브랜드 스토리',
  '시즌 큐레이션'
];

var TARGET_BRANDS = [
  // 예시 — 실제 입점 브랜드 목록으로 교체 예정
  '○○공방'
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONTENT_TYPES: CONTENT_TYPES, TARGET_BRANDS: TARGET_BRANDS };
}
