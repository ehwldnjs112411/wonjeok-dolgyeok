# 원격돌격 프로젝트 파일

## 파일 구성
- `index.html`: 게임 화면과 클라이언트 로직
- `server.js`: Express / Socket.IO 온라인 서버 및 API
- `package.json`: Node.js 의존성 및 실행 명령

## 실행
Node.js 18 이상에서 프로젝트 루트 폴더에 위 세 파일을 둔 뒤 실행합니다.

```bash
npm install
npm start
```

서버는 `PORT` 환경변수를 사용하며, 기본 포트는 10000입니다.

## Render 환경변수
- `DATABASE_URL`: PostgreSQL 연결 문자열
- `JWT_SECRET`: 계정 인증 토큰 서명용 비밀값

두 환경변수가 설정되지 않으면 서버 로그에 경고가 표시되며, 데이터베이스/인증 기능은 정상 동작하지 않습니다.

## 배포
GitHub 저장소 루트에 `index.html`, `server.js`, `package.json`을 업로드하고 커밋/푸시합니다. Render의 Build Command는 `npm install`, Start Command는 `npm start`를 사용하면 됩니다.

## 참고
이 프로젝트는 `index.html`을 서버 루트에서 직접 제공합니다. `public` 폴더는 필수 파일이 아닙니다. 배포 후 브라우저에서 강력 새로고침(Ctrl+F5)을 하세요.
