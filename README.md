# 원격돌격 온라인 서버 시작 패키지

## 포함 파일
- `public/index.html`: 기존 게임 화면 + Socket.IO 연결/온라인 매칭 대기열 훅
- `server.js`: Express API, Socket.IO 대기열, PostgreSQL 계정/프로필 스키마
- `render.yaml`: Render 웹 서비스 및 PostgreSQL 배포 설정
- `package.json`: 필요한 의존성

## 중요 안내
이 패키지는 온라인 서비스의 **초기 기반**입니다. 서버 회원가입/로그인 API, PostgreSQL 저장 구조, Socket.IO 연결 및 1:1 매칭 대기열을 포함합니다.
기존 HTML의 전투는 여전히 클라이언트에서 시뮬레이션되며, 두 플레이어의 움직임/탄환/피해를 서버 권한으로 동기화하는 실시간 전투는 아직 완성되지 않았습니다. 결과 저장 API는 치팅 방지를 위해 현재 비활성화(501) 상태입니다. 이를 완료했다고 주장하지 않습니다.

## GitHub에 올리기
1. https://github.com 에 로그인하고 `New repository`를 누릅니다.
2. 이름을 `wonjeok-dolgyuk`로 만들고 `Public` 또는 `Private`를 선택합니다.
3. `Add file` → `Upload files`로 이 압축을 푼 폴더 안의 파일/폴더를 모두 업로드합니다.
4. `Commit changes`를 누릅니다.

## Render 배포
1. https://render.com 에 가입/로그인합니다.
2. Dashboard → `New` → `Blueprint`를 선택합니다.
3. GitHub를 연결하고 `wonjeok-dolgyuk` 저장소를 고릅니다.
4. Render가 `render.yaml`을 읽어 Web Service와 PostgreSQL을 만들도록 진행합니다.
5. 배포가 끝나면 `https://서비스이름.onrender.com/api/health`를 엽니다. `{"ok":true,"service":"wonjeok-dolgyuk","database":"connected"}`가 나오면 서버와 DB가 연결된 것입니다.
6. 서비스 주소 루트(`/`)를 열어 게임 화면이 나오는지 확인합니다.

## 참고
- `render.yaml`은 Render Blueprint용 설정입니다. DB free plan 이용 가능 여부는 계정/지역/시점에 따라 달라질 수 있습니다.
- `JWT_SECRET`은 Render에서 자동 생성되므로 직접 공개하지 마세요.
- 비밀번호는 서버에서 bcrypt로 해시 처리됩니다.
- 로컬 HTML 파일을 더블클릭(`file://`)하면 온라인 API가 아닌 정적 파일로 열립니다. 반드시 Render의 HTTPS 주소로 접속해야 합니다.
- 현재 기존 HTML의 로그인 폼은 로컬 저장 로직도 남아 있습니다. 서버 계정 API와 완전히 연결하려면 로그인 UI를 API 기반으로 전환하는 추가 통합 단계가 필요합니다. 이 패키지는 인증 API를 제공하지만, UI 통합 완료 상태는 아닙니다.
