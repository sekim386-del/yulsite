# 다음에 이어서 할 일 (재개 체크리스트)

> 오늘(8/25) 진행 상황 정리. 다음에 시작할 때 이 문서부터 보면 바로 이어갈 수 있습니다.

## 지금 상태 요약

**완성/작동 확인됨**
- ✅ 구글 앱스 스크립트 웹 앱 배포 완료 (URL은 브라우저 즐겨찾기에 저장해두신 상태)
- ✅ AI 문구 자동 생성 (인스타/스레드/네이버블로그/프릿지매거진 4채널) — 실제 생성 성공 확인
- ✅ Cloudinary 이미지 업로드 키 3종 등록 완료
- ✅ 인스타그램 `IG_ACCESS_TOKEN`(장기 토큰), `IG_USER_ID`(`122110697517419275`) 등록 완료
- ✅ Meta 개발자 앱 "프릿지 콘텐츠 발행" 생성 및 권한 설정 완료

**미완료**
- 🔲 이미지 업로드 + 인스타그램 실제 발행 테스트 (제미나이 서버 혼잡으로 문구 생성부터 막혀서 끝까지 못 감)
- 🔲 스레드(Threads) `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` — 아직 발급 안 함
- 🔲 프릿지 매거진 실제 입력 화면 구조 반영 (아임웹 글쓰기 화면 캡처 필요 — 아직 미수령)
- 🔲 반복 콘텐츠 유형 목록 반영 (data.js/Index.html 선택 메뉴 — 임시 예시로 되어 있음)

## 다음에 시작할 때, 이 순서로

### 1. 제미나이 문구 생성부터 재확인
- 웹 앱 URL 접속 → 문구 생성 클릭
- "high demand" 오류가 계속되면 시간대를 바꿔서 시도 (새벽/늦은 밤이 덜 혼잡한 경향)

### 2. 이미지 업로드 + 인스타그램 발행 테스트
- 문구 생성 성공하면, 이미지 선택 → 인스타그램 "발행" 버튼
- 여기서 나는 오류가:
  - Cloudinary 관련이면 → 키 값 재확인
  - 인스타그램 관련이면 → 토큰/계정 상태 재확인

### 3. 스레드 토큰 발급
- Meta Graph API 탐색기(developers.facebook.com/tools/explorer)에서
  - Meta 앱: "프릿지 콘텐츠 발행" 선택
  - 권한에 `threads_basic`, `threads_content_publish` 등 추가
  - 토큰 생성 → Apps Script 스크립트 속성에 `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` 등록

### 4. 프릿지 매거진 실제 화면 반영
- 율사이트 측에 아임웹 매거진 글쓰기(에디터) 화면 캡처 요청
- 받으면 `Code.gs`의 `buildPrompt_` 함수와 `normalizeChannels_`의 `fridgeMagazine` 부분을 실제 입력 항목 순서에 맞게 조정

### 5. 반복 콘텐츠 유형 목록 확정
- 율사이트 측에 "업무상 반복적으로 발생하는 콘텐츠 유형·조건" 목록 요청
- 받으면 `Index.html`의 `<select id="contentType">` 옵션 목록 교체

## 참고 — 등록된 키 목록 (Apps Script 스크립트 속성)

| 속성 이름 | 상태 |
|---|---|
| `GEMINI_API_KEY` | ✅ 등록됨 |
| `CLOUDINARY_CLOUD_NAME` | ✅ 등록됨 |
| `CLOUDINARY_API_KEY` | ✅ 등록됨 |
| `CLOUDINARY_API_SECRET` | ✅ 등록됨 |
| `IG_USER_ID` | ✅ 등록됨 (`122110697517419275`) |
| `IG_ACCESS_TOKEN` | ✅ 등록됨 (장기 토큰) |
| `THREADS_USER_ID` | 🔲 미등록 |
| `THREADS_ACCESS_TOKEN` | 🔲 미등록 |

## 오늘 겪은 문제들 (참고용 — 재발 시 빠르게 원인 파악용)

- **스크립트 속성 이름 오타**: `GEMINI_API_KEY` 저장할 때 띄어쓰기가 섞여 들어가서("GEMINI_API_ KEY") 인식 안 됐던 적 있음 → 속성 이름 저장 후 꼭 재확인
- **크롬 자동완성**: 인스타그램 로그인 팝업마다 예전 비밀번호가 자동으로 채워져서 계속 실패 → 항상 직접 타이핑 필요
- **계정 보안 제한**: `sekim386` 개인 계정이 반복 로그인 시도로 한때 CAPTCHA/2단계 인증까지 걸렸음 → 결국 Meta Graph API 탐색기로 우회해서 토큰 발급 성공
