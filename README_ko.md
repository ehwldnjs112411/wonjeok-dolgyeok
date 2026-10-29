원격돌격 v2.1.4 UI 표시 버그 수정

수정 파일: index.html 하나만 교체하면 됩니다.

수정 내용
1. 원 트로피 버튼을 누를 때 renderTrophy()를 호출하도록 수정했습니다. 기존 계정의 currentUser.trophies, 승리/패배, 해금/보상 상태를 화면에 반영합니다.
2. 원 도감에서 전사 선택 버튼을 누른 직후 renderCollection()을 다시 호출하도록 수정했습니다. 선택된 카드에 강조 표시가 생기고 버튼이 '✓ 선택 중'으로 변경되도록 합니다.

적용 방법
1. GitHub 저장소 루트의 index.html을 이 패키지의 index.html로 교체합니다.
2. 커밋 후 푸시하여 Render가 재배포되도록 합니다.
3. 배포 완료 후 Ctrl+F5로 새로고침합니다.

server.js와 package.json은 수정할 필요가 없습니다. 계정 저장 데이터는 변경하지 않습니다.
