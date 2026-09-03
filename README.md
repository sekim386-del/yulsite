# 율사이트(프릿지) 콘텐츠 자동 배포 시스템

율사이트 자체 브랜드 '프릿지'의 온라인 마케팅 콘텐츠 생성 및 SNS 자동 업로드 체계.
1개 소스를 입력하면 인스타그램·스레드(자동) · 네이버 블로그·프릿지 매거진(반자동) 4개
채널용 콘텐츠를 한 번에 생성합니다.

자세한 요구사항 정리는 [PRD.md](./PRD.md), 개발 일정은 [SCHEDULE.md](./SCHEDULE.md)를 참고하세요.

## 구조

```
index.html, app.js, styles.css   프론트엔드 (입력 폼 · 채널별 결과 · 발행/복사)
data.js                          선택 메뉴(콘텐츠 유형 · 대상 브랜드) 목록
netlify/functions/
  generate-content.js            Gemini로 4채널 문구 동시 생성
  upload-image.js                Cloudinary 이미지 업로드(URL 발급)
  post-instagram.js              인스타그램 자동 게시 (Meta Graph API)
  post-threads.js                스레드 자동 게시 (Meta Threads API)
  _shared/response.js            공통 응답/검증 헬퍼
netlify.toml                     Netlify 빌드/함수 설정
.env.example                     필요한 환경변수 목록 (실제 값은 커밋하지 않음)
```

## 로컬 개발

```bash
npm install -g netlify-cli   # 최초 1회
netlify dev
```

`.env.example`을 참고해 Netlify 대시보드(Site configuration → Environment variables)에
실제 값을 등록해야 각 채널 기능이 동작합니다. 값이 없으면 해당 기능은 `501 not_configured`를
반환하며, 나머지 화면 동작에는 영향이 없습니다.

## 배포

이 저장소를 Netlify에 연결하면 `netlify.toml` 설정에 따라 정적 파일과 서버리스 함수가
함께 배포됩니다.
