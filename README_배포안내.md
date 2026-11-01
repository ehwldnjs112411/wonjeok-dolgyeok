# 원격돌격 — Render 404 복구용 배포 파일

이 패키지는 최신 사용자 제공 게임 화면과 기존 Node/Socket.IO 서버를 함께 담았습니다.

## ZIP 안의 파일 위치 (중요)
압축을 풀면 네 파일이 바로 보여야 합니다.
- `index.html`
- `server.js`
- `package.json`
- `README_배포안내.md`

이 네 파일을 GitHub 저장소의 **최상위 폴더(root)** 에 업로드하세요. `index.html` 이름을 바꾸거나 한 단계 안쪽 폴더에 넣지 마세요.

## Render 서비스 설정
기존 Render 서비스가 **Web Service (Node)** 인지 확인하세요. Static Site로 만들면 Socket.IO 서버를 실행하지 못합니다.
- Root Directory: 비워 두기 (저장소 최상위 사용)
- Build Command: `yarn install` (저장소에 yarn.lock이 있을 때) 또는 `npm install`
- Start Command: `node server.js`
- Environment: Node

기존 서비스의 Environment Variables 설정은 그대로 유지하세요. 계정 로그인에 필요한 `DATABASE_URL`, `JWT_SECRET`이 없다면 웹페이지는 열려도 로그인/회원가입은 정상 동작하지 않을 수 있습니다.

## 배포 확인 순서
1. GitHub의 `main` 브랜치 최상위에 위 파일이 있는지 확인하고 커밋합니다.
2. Render의 해당 **Web Service**에서 최신 커밋 배포가 성공했는지 Deploys / Events / Logs를 확인합니다.
3. `https://wonjeok-dolgyeok-1.onrender.com/api/health` 를 엽니다.
   - `ok: true`와 `indexFound: true`가 나오면 서버가 게임 파일을 찾은 것입니다.
   - `indexFound: false`면 Render Root Directory 또는 GitHub 파일 위치가 잘못된 것입니다.
   - `/api/health` 자체도 Not Found라면 이 server.js가 실행되는 Web Service가 아닌 다른 Render 서비스/도메인으로 접속 중일 가능성이 큽니다.
4. 그다음 `https://wonjeok-dolgyeok-1.onrender.com/` 에서 게임을 확인합니다.

이 파일은 Render에 직접 배포된 상태가 아닙니다. GitHub 커밋과 Render 배포는 사용자가 진행해야 합니다.
