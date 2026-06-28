# H-MATE v17: AI + 위치정보 연결 준비 버전

이 프로젝트는 지금까지 만든 H-MATE HTML에 다음 기능을 붙인 버전입니다.

- 브라우저 위치정보 수집 UI
- 권역 직접 선택
- 위치/권역 기반 추천 로직
- `/api/recommend` 서버리스 함수
- OpenAI API 연결
- API 연결 실패 시 로컬 추천 fallback

## 실행 구조

사용자 입력 → index.html → /api/recommend → OpenAI API → 추천/답변 JSON 반환 → 화면 업데이트

## 배포 방법

1. ZIP 압축 해제
2. GitHub 저장소에 전체 파일 업로드
3. Vercel에서 저장소 연결 후 Deploy
4. Vercel 환경변수에 아래 값 추가

```bash
OPENAI_API_KEY=본인_API_KEY
OPENAI_MODEL=gpt-5.5
```

5. Redeploy

## 위치정보 주의

브라우저 위치정보는 HTTPS 또는 localhost 같은 보안 환경에서 잘 작동합니다.
HTML 파일을 더블클릭해서 열면 위치 권한이 막힐 수 있습니다.
