# 원격돌격 v1.9.1 — 유저 매칭 버그 수정

## 수정 내용
- `index.html`에서 Socket.IO 클라이언트 스크립트와 매칭 초기화 코드를 분리했습니다. 외부 `src`가 있는 `<script>` 태그 안의 인라인 코드는 실행되지 않아, `window.wonjeokJoinOnlineQueue`가 만들어지지 않던 문제를 해결합니다.
- `server.js`와 `package.json`은 기존 온라인 서버 구성을 유지합니다.

## GitHub / Render 적용
1. 저장소 루트의 `index.html`, `server.js`, `package.json`을 이 묶음의 파일로 교체합니다.
2. Render 서비스의 Start Command가 `npm start`인지 확인합니다. `package.json`은 `node server.js`를 실행합니다.
3. GitHub에 커밋하고 푸시한 뒤 Render 배포가 완료되면 새로고침합니다. 가능하면 브라우저에서 강력 새로고침(Ctrl+F5)을 합니다.

## 빠른 확인
- Render 주소의 `/api/health`가 응답하는지 확인합니다.
- 두 개의 서로 다른 브라우저/기기에서 각각 로그인해 `유저 매칭`을 누릅니다. 첫 번째는 대기하고, 두 번째는 매칭 성공으로 전환되어야 합니다.
- 한 브라우저의 두 탭은 동일 계정이나 같은 브라우저 상태를 공유할 수 있으므로, 서로 다른 계정/브라우저를 권장합니다.
