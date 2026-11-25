# 알려진 함정

반복 위험이 있는 함정을 모은다. 코드를 쓰거나 고치기 전에 제목 줄을 훑고(`grep "^## " known-issues.md`), 관련된 항목만 본문까지 읽는다.

1~5번은 코드를 쓰기 전인 2026-11-25에 스택을 직접 돌려 보고 미리 적은 것이다. 1~3번의 수치는 `docs/spikes/tail-chain.mjs`로 다시 낼 수 있다.

## 1. 꼬리로 매달리면 관절이 벌어져 꼬리가 최대 32% 늘어난다 (솔버 반복 횟수 기본값 4)

- 증상: 꼬리 끝을 가지에 걸고 몸이 매달리면 마디 사이가 벌어진다. 12마디 1.5m 꼬리, 몸 3kg, 마디 0.05kg에서 가만히 매달릴 때 최대 17%, 흔들릴 때 최대 32%였다.
- 원인: Rapier의 `numSolverIterations` 기본값 4로는 가벼운 마디 여러 개가 무거운 몸을 버티는 체인을 다 풀지 못한다. 몸과 마디의 질량 차이가 클수록 심하다.
- 규칙: `numSolverIterations`를 16으로 둔다(같은 조건에서 1.1%, 3.6%). 몸과 마디 하나의 질량 비는 60:1을 넘기지 않는다. 꼬리나 몸의 질량, 마디 수를 바꾸면 매달리기 헤드리스 테스트를 다시 돌린다.

## 2. multibody 관절로 만든 꼬리는 끝을 가지에 걸고 흔들리면 폭주하고, 모터도 쓸 수 없다

- 증상: 꼬리 관절을 `createMultibodyJoint`로 만들고 꼬리 끝을 impulse 관절로 고정 바디에 건 뒤 수평에서 놓으면 속도가 발산한다. 반복 횟수(4, 8, 16)와 질량 비를 바꿔도 같았다. 가만히 매달려 있을 때는 멀쩡하다.
- 원인: Rapier 0.21.0이 multibody 체인의 끝을 impulse 관절로 닫은 구성을 안정적으로 풀지 못한다(엔진 안쪽 문제라 더 파지 않았다). 또 JS 바인딩의 multibody 관절에는 `configureMotorPosition`, `setLimits`가 없다.
- 규칙: 꼬리 관절은 impulse 관절로만 만든다. 늘어남은 1번 규칙으로 잡고, 모자라면 매달린 동안 엉덩이와 꼬리 끝 사이에 `JointData.rope`를 건다.

## 3. 모터 목표 각이 180도를 넘으면 반대쪽으로 감긴다 (200도를 넣으면 -160도로 간다)

- 증상: 회전 관절 위치 모터에 200도를 넣으면 마디가 반대 방향으로 돌아 -160도에서 멈춘다.
- 원인: 목표 각이 ±180도 범위로 접힌다. 179도까지는 정상으로 쫓는다(예전 버전에서 보고된 ±90도 문제는 0.21.0에서 재현되지 않았다).
- 규칙: 목표 각은 관절 제한 범위(관절 하나에 90도 미만)로 자른 뒤 `configureMotorPosition`에 넣는다.

## 4. Phaser 3 방식으로 쓴 코드가 Phaser 4에서 동작하지 않는다 (예: setTintFill은 색을 바꾸지 않고 콘솔 오류만 낸다)

- 증상: `setTintFill(color)`을 불러도 색이 바뀌지 않고 콘솔에 오류가 한 줄 찍힌다.
- 원인: Phaser 4에서 색과 색 입히는 방식이 나뉘었다. 이름은 남아 있지만 하는 일이 없어진 API가 있다. 이 경우는 타입 선언이 인자 없는 `setTintFill(): void`라서 `tsc`가 잡아 주지만, 모든 변경이 타입으로 드러나지는 않는다.
- 규칙: `setTint(color).setTintMode(Phaser.TintModes.FILL)`을 쓴다. Phaser API를 처음 쓰는 자리에서는 `node_modules/phaser/skills/`의 해당 폴더와 `v3-to-v4-migration/SKILL.md`를 먼저 본다. 화면을 확인할 때 브라우저 콘솔 오류도 함께 본다.

## 5. tsconfig에 skipLibCheck가 없으면 Phaser와 Rapier의 타입 파일에서 오류가 난다

- 증상: `tsc --noEmit`이 우리 코드가 아니라 `node_modules/phaser/types/phaser.d.ts`와 `node_modules/@dimforge/rapier2d-compat/dist/rapier_wasm2d.d.ts`에서 실패한다(합쳐서 40건).
- 원인: Phaser의 타입 파일에 TypeScript 7.0.2가 받아들이지 않는 선언이 2건 있고, Rapier의 타입 파일은 `lib`이 ES2022면 `Symbol.dispose`를 찾지 못한다.
- 규칙: `tsconfig.json`에 `"skipLibCheck": true`를 넣는다. 이 설정에서 `import * as Phaser from 'phaser'`와 `import Phaser from 'phaser'`는 둘 다 통과한다.

## 6. 튜닝 패널에서 중력을 바꿔도 멈춰 있던 물체가 반응하지 않는다 (잠든 바디는 스스로 깨지 않는다)

- 증상: 떨어져 멈춘 상자가 중력을 바꿔도 그대로 있다. 움직이던 물체만 새 값을 따른다.
- 원인: Rapier는 오래 멈춘 바디를 재운다. 월드의 중력이나 솔버 반복 횟수를 바꾸는 것은 바디를 깨우는 일이 아니다.
- 규칙: 실행 중에 설정을 반영하는 자리(`PhysicsWorld.applyConfig`)에서 모든 바디에 `wakeUp()`을 부른다. `tests/physics.test.ts`가 지킨다.

## 7. 브라우저 도구로 확인할 때 화면이 멈춰 있다 (뒤에 있는 탭은 requestAnimationFrame이 돌지 않는다)

- 증상: 페이지는 열렸는데 씬이 시작되지 않거나(`window.tori`가 없음) 스텝 수가 거의 늘지 않는다. 콘솔 오류는 없다.
- 원인: 앞에 있지 않은 탭은 `requestAnimationFrame`이 0번 불린다. Phaser는 이것으로 돌기 때문에 시작도 하지 않는다.
  `document.visibilityState`는 이때도 `visible`이라 구분에 쓸 수 없다. 켜 둔 개발 서버 밑에서 `node_modules`를 지워도 비슷하게 멈춘다.
- 규칙: 코드를 의심하기 전에 탭을 앞으로 옮기고(`tabs_select`) `requestAnimationFrame` 횟수를 센다. `npm ci`는 개발 서버를 끄고 돌린다.

## 8. 돌아설 때 몸통이 크게 돈다 (관절 앵커만 옮기면 솔버가 매달린 바디를 낚아챈다)

- 증상: 머리를 반대쪽으로 넘기려고 `setAnchor1`을 0.2초에 걸쳐 옮겼더니, 돌아설 때마다 몸통이 최대 49도까지 기울었다.
- 원인: 앵커가 옮겨 간 만큼을 솔버가 관절 오차로 보고 머리를 5m/s 넘게 끌어당긴다. 그 반동이 몸통에 실린다.
- 규칙: 앵커를 옮기는 스텝마다 매달린 바디도 같은 만큼 `setTranslation`으로 옮긴다(`tori/body.ts`의 `updateFacing`).
  고친 뒤 돌아설 때의 기울기는 16도다. 꼬리 밑동을 옮길 때(M2)도 같은 확인을 한다.

## 9. 브라우저 도구로 보낸 키가 먹지 않는다 (씬이 시작되기 전에 보낸 키는 사라진다)

- 증상: 페이지를 열고 3초 뒤에 보낸 키가 먹지 않고, 뒤에 찍은 화면에는 게임이 멀쩡히 나와 있다.
- 원인: 물리 엔진과 Phaser를 내려받아 씬이 시작되기까지 4초 넘게 걸릴 때가 있다. 키를 듣는 쪽은 씬이 시작될 때 생긴다.
- 규칙: 시간을 정해 기다리지 말고 `window.tori`가 생길 때까지 기다린 뒤 키를 보낸다(팀용 주소의 빌드에는 `window.tori`가 없다).

## 10. 배포가 성공했는데 확인용 주소에 이전 빌드가 열린다 (GitHub Pages의 캐시)

- 증상: 워크플로가 success로 끝난 직후에 열었더니 화면 구석의 커밋 해시가 이전 것이었다.
- 원인: 새 파일이 퍼지는 데 1분쯤 걸리고, 브라우저도 `index.html`을 10분 동안 캐시한다(`Cache-Control: max-age=600`).
- 규칙: 확인하기 전에 화면 구석의 커밋 해시부터 본다. 다르면 1분쯤 뒤에 새로고침한다(Ctrl+Shift+R).
