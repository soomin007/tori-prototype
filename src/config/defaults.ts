/**
 * 모든 수치의 기본값. 기획이 정하지 않은 값은 전부 자리값이다.
 * 새 수치를 넣으면 DEFAULTS와 PARAM_META에 함께 적는다. PARAM_META의 이름과 범위가 튜닝 패널에 그대로 나온다.
 */

// ---- 실행 중에 바꾸지 않는 값 ----

/** 물리 고정 스텝(초) */
export const FIXED_DT = 1 / 60;
/** 1미터당 픽셀(자리값). 물리와 화면을 잇는 상수는 이것 하나다. 물리도 화면처럼 y가 아래로 커진다. */
export const PPM = 100;
/** 화면 크기(픽셀, 자리값) */
export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;
/** 도를 라디안으로 */
export const DEG = Math.PI / 180;

// ---- 튜닝 패널에서 바꾸는 값 ----

export interface GameConfig {
  move: {
    maxSpeed: number;
    accel: number;
    decel: number;
    airControl: number;
    lever: number;
    turnSeconds: number;
  };
  jump: {
    speed: number;
    floatOffSeconds: number;
    coyoteSeconds: number;
    bufferSeconds: number;
  };
  upright: {
    strength: number;
    damping: number;
    airFactor: number;
    slopeFollow: number;
    slopeSmoothSeconds: number;
    maxSlopeDeg: number;
  };
  float: {
    clearance: number;
    reach: number;
    frequency: number;
    dampingRatio: number;
    pullDown: number;
    probeSpread: number;
    edgeLean: number;
  };
  torso: {
    length: number;
    thickness: number;
    mass: number;
    friction: number;
  };
  head: {
    radius: number;
    mass: number;
    neckX: number;
    neckY: number;
    forward: number;
    up: number;
    stiffness: number;
    damping: number;
    limitDeg: number;
  };
  legs: {
    frontX: number;
    hindX: number;
    hipY: number;
    upper: number;
    lower: number;
    thickness: number;
    stride: number;
    stepSeconds: number;
    lift: number;
    dutySlow: number;
    dutyFast: number;
    restSpread: number;
    sprawl: number;
    halfWidth: number;
    pelvisDeg: number;
    airPedal: number;
  };
  tail: {
    baseLinks: number;
    sections: number;
    linksPerSection: number;
    linkLength: number;
    linkMass: number;
    armature: number;
    baseThickness: number;
    tipThickness: number;
    hipX: number;
    hipY: number;
    jointLimitDeg: number;
    rootUpDeg: number;
    rootDownDeg: number;
    stiffness: number;
    dampingSeconds: number;
    maxTorque: number;
    tipRatio: number;
    gravityComp: number;
    support: number;
    brace: number;
    friction: number;
    softCcd: number;
  };
  mouse: {
    relative: boolean;
    sensitivity: number;
    pullTip: boolean;
    pullStiffness: number;
    pullDamping: number;
    pullMaxForce: number;
    pullMotor: number;
  };
  auto: {
    idleRaiseDeg: number;
    idleCurlDeg: number;
    waveDeg: number;
    waveHz: number;
    waveLag: number;
    windSeconds: number;
    strikeSeconds: number;
    recoverSeconds: number;
    windRaiseDeg: number;
    windCurlDeg: number;
    strikeRaiseDeg: number;
    strikeCurlDeg: number;
    sweepCurlDeg: number;
    chopSeconds: number;
    strikePower: number;
    strikeBrace: number;
    strikeBraceFadeDeg: number;
    reachFactor: number;
    behindPenalty: number;
    switchMargin: number;
    carryBack: number;
    carryUp: number;
  };
  grab: {
    radius: number;
    snapSeconds: number;
    hangMotor: number;
    swingAccel: number;
    wriggleDeg: number;
    wriggleHz: number;
  };
  hit: {
    minSpeed: number;
    power: number;
    maxLaunch: number;
    lift: number;
    pushMass: number;
    cooldownSeconds: number;
  };
  cut: {
    holdSeconds: number;
    rewindSeconds: number;
    wriggleDeg: number;
    wriggleHz: number;
    wriggleLag: number;
    wriggleStiffness: number;
    wriggleDampingSeconds: number;
    wriggleTorque: number;
  };
  recorder: {
    talkRange: number;
    talkHeight: number;
  };
  ground: {
    friction: number;
    slipperyAccel: number;
    slipperyDecel: number;
  };
  props: {
    density: number;
    friction: number;
    restitution: number;
  };
  camera: {
    followSeconds: number;
    followSecondsY: number;
    lookAhead: number;
    lookSeconds: number;
    offsetY: number;
  };
  physics: {
    gravity: number;
    solverIterations: number;
    maxStepsPerFrame: number;
  };
  view: {
    interpolate: boolean;
  };
}

/** 근거를 적지 않은 값은 모두 자리값이고, PLAN에서 온 값도 자리값이다. 길이는 m, 시간은 초다. */
export const DEFAULTS: GameConfig = {
  move: {
    maxSpeed: 4, // m/s
    accel: 9, // m/s². 4m/s까지 약 0.45초
    decel: 7, // m/s². 4m/s에서 약 1.1m 미끄러진다
    airControl: 0.6, // 공중에서 가속과 감속에 곱한다
    lever: 0.25, // 몸통 중심보다 이만큼 아래에 이동 힘을 준다. 출발할 때 앞이 들리고 멈출 때 앞으로 쏠린다
    turnSeconds: 0.2, // 머리와 그림이 반대쪽으로 넘어가는 시간. PLAN 7.2의 꼬리 밑동과 같은 값
  },
  jump: {
    speed: 5.2, // m/s. 중력 9.81에서 약 1.4m 뛴다
    floatOffSeconds: 0.15, // PLAN 7.2
    coyoteSeconds: 0.1, // PLAN 7.2
    bufferSeconds: 0.1, // PLAN 7.2
  },
  upright: {
    strength: 75, // N·m/rad. M1의 40에서 꼬리가 붙은 만큼 올렸다
    damping: 6.5, // N·m·s/rad. 위와 같은 이유로 2.5에서 올렸다
    airFactor: 0.4, // 공중에서 세기와 감쇠에 곱한다
    slopeFollow: 0.7, // 0이면 늘 수평, 1이면 경사와 나란히 선다
    slopeSmoothSeconds: 0.08, // 계단에서 경사 값이 튀는 것을 고른다
    maxSlopeDeg: 50, // 이보다 가파르면 경사로 보지 않는다
  },
  float: {
    clearance: 0.25, // 몸통 아랫면과 바닥 사이. PLAN 7.2
    reach: 0.2, // 띄우는 높이보다 이만큼 더 떨어져도 바닥을 잡는다
    frequency: 3.2, // Hz. 스프링의 빠르기
    dampingRatio: 0.6, // 1이면 출렁이지 않는다
    pullDown: 5, // m/s². 바닥에서 떠오를 때 도로 당기는 가속의 상한
    probeSpread: 0.35, // 몸통 중심에서 앞뒤 레이캐스트까지
    edgeLean: 0.4, // 일부만 바닥 위에 있을 때 빈 쪽으로 기우는 정도
  },
  torso: {
    length: 1, // PLAN 7.2
    thickness: 0.4, // PLAN 7.2
    mass: 3, // kg, PLAN 7.2
    friction: 0.1, // 벽과 턱에 들러붙지 않게 작게 둔다
  },
  head: {
    radius: 0.17,
    mass: 0.4, // kg
    neckX: 0.42, // 몸통 중심에서 목까지 앞쪽 거리
    neckY: 0.1, // 몸통 중심에서 목까지 위쪽 거리
    forward: 0.14, // 목에서 머리 중심까지 앞쪽 거리
    up: 0.1, // 목에서 머리 중심까지 위쪽 거리
    stiffness: 220, // 1/s². 목이 제자리로 돌아오는 세기
    damping: 8, // 1/s
    limitDeg: 35, // 목이 꺾이는 한계
  },
  legs: {
    frontX: 0.3, // 몸통 중심에서 앞다리까지
    hindX: 0.3, // 몸통 중심에서 뒷다리까지
    hipY: 0.06, // 몸통 중심보다 이만큼 아래에 붙는다
    upper: 0.24,
    lower: 0.3, // 윗다리보다 길어 무릎이 높이 온다
    thickness: 0.11,
    stride: 0.2, // 다리 붙는 자리에서 이만큼 앞에 딛고 이만큼 뒤에서 뗀다
    stepSeconds: 0.1, // 서 있을 때 발을 옮기는 시간
    lift: 0.1, // 발을 옮길 때 드는 높이
    dutySlow: 0.64, // 천천히 걸을 때 발이 땅에 있는 비율. 실제 도마뱀의 뒷발 값(Reilly와 DeLancey 1997의 요약)
    dutyFast: 0.52, // 가장 빠를 때의 비율. 출처는 위와 같다. 0.5보다 작으면 네 발이 함께 뜬다
    restSpread: 0.07, // 서 있을 때와 공중에서 두 짝이 앞뒤로 갈리는 거리
    sprawl: 0.04, // 다리를 벌린 모습. 가까운 쪽 발은 아래로, 먼 쪽 발은 위로 이만큼 옮긴다
    halfWidth: 0.12, // 골반의 반폭. 아래 각도와 함께 다리 붙는 자리가 흔들리는 폭(약 4cm)을 정한다
    pelvisDeg: 20, // 골반이 좌우로 도는 각도. 실제 도마뱀은 16~25도
    airPedal: 1.2, // 공중에서 발을 젓는 빠르기(1초에 몇 번)
  },
  tail: {
    baseLinks: 3, // PLAN 7.3. 자를 수 없는 밑동
    sections: 3, // PLAN 7.3. 자를 수 있는 구간 수
    linksPerSection: 3, // PLAN 7.3
    linkLength: 0.125, // 12마디면 꼬리 전체가 1.5m(PLAN 7.3)
    linkMass: 0.07, // kg. 몸통 3kg과 43:1. 60:1을 넘기지 않는다(known-issues 1번). 0.1이면 휘두를 때 몸이 50도까지 기운다
    armature: 0.02, // kg·m². 마디마다 더하는 회전 관성. 0이면 가벼운 마디들의 모터가 풀리지 않아 꼬리가 구겨진다(known-issues 12번)
    baseThickness: 0.2,
    tipThickness: 0.08,
    hipX: 0.36, // 몸통 중심에서 밑동까지 뒤쪽 거리. 0이면 밑동이 가운데라 돌아설 때 옮기지 않는다(PLAN 7.2의 나)
    hipY: 0.04, // 몸통 중심보다 이만큼 위에 붙는다
    jointLimitDeg: 35, // PLAN 7.3
    rootUpDeg: 160, // 밑동이 뒤쪽 수평에서 위로(등 너머로) 도는 한계
    rootDownDeg: 60, // 밑동이 뒤쪽 수평에서 아래로 도는 한계
    stiffness: 300, // N·m/rad. 밑동 관절의 모터 강성. 끝으로 갈수록 tipRatio까지 줄어든다. 70이면 목표를 1m 넘게 지나쳤다 돌아온다
    dampingSeconds: 0.2, // 감쇠를 강성으로 나눈 값. 크면 천천히 따라온다
    maxTorque: 50, // N·m. 밑동 관절의 힘 상한. 작으면 끝이 늦게 따라오고 무거운 것을 들면 처진다
    tipRatio: 0.12, // 끝 관절의 강성과 힘 상한이 밑동의 몇 배인지
    gravityComp: 0.8, // 꼬리 무게로 처지는 만큼을 목표 각에 미리 더하는 비율
    support: 0.9, // 꼬리 때문에 옮겨 간 무게중심을 다리가 받쳐 주는 비율. 1이면 가만히 있을 때 기울지 않는다
    brace: 0.65, // 발이 바닥에 있을 때 다리가 꼬리의 반동을 버티는 비율. 0이면 반동이 모두 몸에 실린다
    friction: 0.5,
    softCcd: 0.3, // 빠른 마디가 얇은 물건을 지나치지 않게 미리 살피는 거리
  },
  mouse: {
    relative: false, // 켜면 상대 커서(포인터 잠금), 끄면 절대 커서
    sensitivity: 1, // 상대 커서에서 마우스 움직임에 곱한다
    pullTip: false, // 개발자용. 켜면 IK 자세 대신 꼬리 끝만 목표점으로 당긴다
    pullStiffness: 60, // N/m
    pullDamping: 6, // N·s/m
    pullMaxForce: 25, // N. 반작용은 엉덩이에 되돌린다
    pullMotor: 0.07, // 끝만 당길 때 꼬리를 펴는 모터의 세기 배율. 너무 작으면 꼬리가 말려 엉킨다
  },
  auto: {
    idleRaiseDeg: 18, // 평소 밑동을 뒤쪽 수평에서 드는 각
    idleCurlDeg: 3, // 평소 관절마다 위로 말리는 각
    waveDeg: 6, // 살랑이는 폭(관절마다)
    waveHz: 0.7,
    waveLag: 0.5, // 관절 하나마다 물결이 늦어지는 각(라디안)
    windSeconds: 0, // 휘두르기 전 뒤로 젖히는 시간. 결투에서 누르자마자 나가도록 0.08에서 0으로 줄였다(1단계)
    strikeSeconds: 0.45, // 앞으로 넘기는 시간
    recoverSeconds: 0.3, // 평소 자세로 돌아오는 시간
    windRaiseDeg: 25, // 젖힐 때 밑동 각
    windCurlDeg: -10, // 젖힐 때 관절마다 말리는 각(음수면 뒤로)
    strikeRaiseDeg: 160, // 칠 때 밑동 각. 머리 위를 넘어 앞쪽까지(PLAN 7.3)
    strikeCurlDeg: 10, // 내려칠 때 관절마다 말리는 각(양수면 앞으로). 꼬리 끝이 몸 앞 아래로 감겨 바닥의 물건까지 닿는다
    sweepCurlDeg: 0, // 넘길 때 관절마다 말리는 각. 곧게 넘겨야 머리 위를 빨리 지난다
    chopSeconds: 0.08, // 넘기기 시작하고 이 시간이 지나면 strikeCurlDeg로 감아 내려친다. 처음부터 감으면 끝이 느려져 바닥의 물건을 못 친다
    strikePower: 2.5, // 칠 때 모터 세기 배율. 1.2에서는 누른 뒤 0.4~0.45초에 몸 앞을 쳤고, 지금 값들로 0.25~0.27초에 친다(PLAN 7.3)
    strikeBrace: 1.2, // 칠 때 다리가 꼬리의 반동을 버티는 비율. 평소 값(tail.brace 0.65)이면 2.5배 세기에서 몸이 46도 기운다
    strikeBraceFadeDeg: 25, // 칠 때 버티는 토크가 몸이 기운 쪽으로 밀면, 기울기가 이 각에 닿을 때 버티지 않는다
    reachFactor: 2, // 꼬리 길이의 몇 배 안에 있는 것을 잡으러 가는지
    behindPenalty: 0.8, // 등진 쪽에 있는 것은 이만큼 더 먼 것으로 친다
    switchMargin: 0.3, // 노리던 것보다 이만큼 더 가까워야 바꾼다
    carryBack: 0.1, // 들고 있을 때 꼬리 끝이 몸통 중심보다 뒤로 간 거리
    carryUp: 0.7, // 들고 있을 때 꼬리 끝이 몸통 중심보다 위로 간 거리(등 위 0.5m, PLAN 7.3)
  },
  grab: {
    radius: 0.32, // 꼬리 끝에서 이 안에 있으면 잡힌다
    snapSeconds: 0.12, // 잡은 자리까지 끝이 붙는 시간
    hangMotor: 0.15, // 가지에 걸린 동안 모터 세기 배율
    swingAccel: 5, // m/s². 매달려서 이동 키를 누를 때
    wriggleDeg: 12, // 잡기 능력이 꺼졌을 때 꼬리 끝이 꼼지락거리는 폭
    wriggleHz: 4,
  },
  hit: {
    minSpeed: 4, // m/s. 물건에 대한 마디의 속도가 이보다 빠르면 타격이다
    power: 1, // 타격 때 물건이 마디 속도의 몇 배로 튕기는지
    maxLaunch: 9, // m/s. 튕기는 속도의 상한
    lift: 0.45, // 튕기는 방향에 더하는 위쪽 비율
    pushMass: 1, // kg. 이보다 무거운 물건은 무거운 만큼 덜 튕긴다
    cooldownSeconds: 0.25, // 같은 물건을 다시 칠 때까지
  },
  cut: {
    holdSeconds: 1, // 디버그 키 Q를 이만큼 누르고 있으면 자른다(PLAN 7.10)
    rewindSeconds: 2, // 잘린 꼬리가 꿈틀거린 뒤 회귀할 때까지(PLAN 7.4)
    wriggleDeg: 30, // 잘린 꼬리의 관절마다 흔드는 폭. 관절 제한(35도) 안이어야 한다
    wriggleHz: 4, // 잘린 도마뱀붙이 꼬리는 1초에 4~8번 움직인다(Higham과 Russell 2010의 보도 자료)
    wriggleLag: 1.2, // 관절 하나마다 물결이 늦어지는 각(라디안). 크면 꼬리가 S자로 휜다
    wriggleStiffness: 15, // N·m/rad
    wriggleDampingSeconds: 0.01, // 감쇠를 강성으로 나눈 값. 0.05면 감쇠가 흔들림을 붙잡아 폭이 절반으로 준다
    wriggleTorque: 4, // N·m. 관절 하나의 힘 상한. 이 값에서 2초 동안 바닥을 0.4m쯤 꿈틀거리며 움직인다
  },
  recorder: {
    talkRange: 1.4, // 기록관 발밑에서 토리 몸통 중심까지 가로로 이 안이면 말을 걸 수 있다
    talkHeight: 1.5, // 세로로 이 안이면 말을 걸 수 있다. 발판 위아래에 있으면 걸지 못한다
  },
  ground: {
    friction: 0.8, // 물건과 꼬리가 바닥에 닿을 때의 마찰. 토리의 이동에는 쓰지 않는다
    slipperyAccel: 0.2, // PLAN 7.2. 미끄러운 바닥에서 가속에 곱한다
    slipperyDecel: 0.2, // PLAN 7.2. 미끄러운 바닥에서 감속에 곱한다
  },
  props: {
    density: 4, // kg/m². 0.3m 상자가 0.36kg, 0.8m 상자가 2.6kg
    friction: 0.6,
    restitution: 0.1,
  },
  camera: {
    followSeconds: 0.12, // 0에 가까울수록 바로 따라간다
    followSecondsY: 0.35,
    lookAhead: 0.8, // 가는 쪽을 이만큼 더 보여 준다
    lookSeconds: 0.5, // 돌아섰을 때 보여 주는 쪽이 넘어가는 시간
    offsetY: 1.6, // 토리보다 이만큼 위를 화면 가운데에 둔다
  },
  physics: {
    gravity: 9.81, // m/s², 아래쪽
    solverIterations: 16, // Rapier 기본값 4로는 꼬리가 늘어난다(known-issues 1번)
    maxStepsPerFrame: 5, // 이보다 밀린 시간은 버린다
  },
  view: {
    interpolate: true,
  },
};

export interface ParamMeta {
  label: string;
  /** 숫자 항목의 범위. 링크로 들어온 값도 이 범위로 자른다. */
  min?: number;
  max?: number;
  step?: number;
  /** 바꾸면 방을 처음부터 다시 만드는 항목 */
  rebuild?: boolean;
}

/** 키는 DEFAULTS의 경로다. 빠진 항목이 있으면 테스트가 실패한다. */
export const PARAM_META: Record<string, ParamMeta> = {
  'move.maxSpeed': { label: '최고 속도 (m/s)', min: 0.5, max: 10, step: 0.1 },
  'move.accel': { label: '가속 (m/s²)', min: 0.5, max: 60, step: 0.5 },
  'move.decel': { label: '감속 (m/s²)', min: 0.5, max: 60, step: 0.5 },
  'move.airControl': { label: '공중 조작 배율', min: 0, max: 1.5, step: 0.05 },
  'move.lever': { label: '출발과 정지 쏠림 (m)', min: 0, max: 0.8, step: 0.01 },
  'move.turnSeconds': { label: '방향 전환 (초)', min: 0.05, max: 1, step: 0.01 },
  'jump.speed': { label: '점프 속도 (m/s)', min: 1, max: 12, step: 0.1 },
  'jump.floatOffSeconds': { label: '뛴 뒤 띄우기 끄기 (초)', min: 0, max: 0.5, step: 0.01 },
  'jump.coyoteSeconds': { label: '떨어진 뒤 점프 허용 (초)', min: 0, max: 0.5, step: 0.01 },
  'jump.bufferSeconds': { label: '착지 전 점프 기억 (초)', min: 0, max: 0.5, step: 0.01 },
  'upright.strength': { label: '직립 세기 (N·m/rad)', min: 0, max: 150, step: 1 },
  'upright.damping': { label: '직립 감쇠', min: 0, max: 10, step: 0.1 },
  'upright.airFactor': { label: '공중 직립 배율', min: 0, max: 1, step: 0.05 },
  'upright.slopeFollow': { label: '경사 따라 눕기', min: 0, max: 1, step: 0.05 },
  'upright.slopeSmoothSeconds': { label: '경사 고르기 (초)', min: 0, max: 0.5, step: 0.01 },
  'upright.maxSlopeDeg': { label: '경사로 보는 한계 (도)', min: 10, max: 70, step: 1 },
  'float.clearance': { label: '띄우는 높이 (m)', min: 0.05, max: 0.8, step: 0.01 },
  'float.reach': { label: '바닥 잡는 거리 (m)', min: 0.02, max: 0.6, step: 0.01 },
  'float.frequency': { label: '스프링 빠르기 (Hz)', min: 0.5, max: 6, step: 0.1 },
  'float.dampingRatio': { label: '스프링 감쇠비', min: 0, max: 1.5, step: 0.05 },
  'float.pullDown': { label: '바닥으로 당기기 (m/s²)', min: 0, max: 40, step: 0.5 },
  'float.probeSpread': { label: '앞뒤 감지 간격 (m)', min: 0, max: 0.8, step: 0.01 },
  'float.edgeLean': { label: '발판 끝 기울기', min: 0, max: 1, step: 0.05 },
  'torso.length': { label: '길이 (m)', min: 0.5, max: 2, step: 0.05, rebuild: true },
  'torso.thickness': { label: '굵기 (m)', min: 0.2, max: 0.5, step: 0.01, rebuild: true },
  'torso.mass': { label: '질량 (kg)', min: 0.5, max: 20, step: 0.1, rebuild: true },
  'torso.friction': { label: '마찰', min: 0, max: 2, step: 0.01 },
  'head.radius': { label: '반지름 (m)', min: 0.05, max: 0.4, step: 0.01, rebuild: true },
  'head.mass': { label: '질량 (kg)', min: 0.05, max: 3, step: 0.05, rebuild: true },
  'head.neckX': { label: '목 앞쪽 거리 (m)', min: 0, max: 1, step: 0.01, rebuild: true },
  'head.neckY': { label: '목 위쪽 거리 (m)', min: -0.5, max: 0.5, step: 0.01, rebuild: true },
  'head.forward': { label: '머리 앞쪽 거리 (m)', min: -0.5, max: 0.5, step: 0.01, rebuild: true },
  'head.up': { label: '머리 위쪽 거리 (m)', min: -0.5, max: 0.5, step: 0.01, rebuild: true },
  'head.stiffness': { label: '목 세기', min: 0, max: 1000, step: 10 },
  'head.damping': { label: '목 감쇠', min: 0, max: 60, step: 0.5 },
  'head.limitDeg': { label: '목 꺾임 한계 (도)', min: 0, max: 120, step: 1 },
  'legs.frontX': { label: '앞다리 거리 (m)', min: 0, max: 1, step: 0.01, rebuild: true },
  'legs.hindX': { label: '뒷다리 거리 (m)', min: 0, max: 1, step: 0.01, rebuild: true },
  'legs.hipY': { label: '다리 붙는 높이 (m)', min: -0.3, max: 0.3, step: 0.01, rebuild: true },
  'legs.upper': { label: '윗다리 길이 (m)', min: 0.1, max: 0.6, step: 0.01, rebuild: true },
  'legs.lower': { label: '아랫다리 길이 (m)', min: 0.1, max: 0.6, step: 0.01, rebuild: true },
  'legs.thickness': { label: '다리 굵기 (m)', min: 0.04, max: 0.3, step: 0.01, rebuild: true },
  'legs.stride': { label: '보폭 (m)', min: 0.05, max: 0.5, step: 0.01 },
  'legs.stepSeconds': { label: '서서 딛는 시간 (초)', min: 0.03, max: 0.5, step: 0.01 },
  'legs.lift': { label: '발 드는 높이 (m)', min: 0, max: 0.4, step: 0.01 },
  'legs.dutySlow': { label: '땅에 닿는 비율 (느릴 때)', min: 0.5, max: 0.9, step: 0.01 },
  'legs.dutyFast': { label: '땅에 닿는 비율 (빠를 때)', min: 0.5, max: 0.9, step: 0.01 },
  'legs.restSpread': { label: '두 짝 벌어짐 (m)', min: 0, max: 0.3, step: 0.01 },
  'legs.sprawl': { label: '다리 벌리기 (m)', min: 0, max: 0.15, step: 0.01 },
  'legs.halfWidth': { label: '골반 반폭 (m)', min: 0, max: 0.3, step: 0.01 },
  'legs.pelvisDeg': { label: '골반 회전 (도)', min: 0, max: 60, step: 1 },
  'legs.airPedal': { label: '공중 발 젓기 (회/초)', min: 0, max: 5, step: 0.1 },
  'tail.baseLinks': { label: '밑동 마디 수', min: 1, max: 6, step: 1, rebuild: true },
  'tail.sections': { label: '자를 수 있는 구간 수', min: 0, max: 5, step: 1, rebuild: true },
  'tail.linksPerSection': { label: '구간마다 마디 수', min: 1, max: 4, step: 1, rebuild: true },
  'tail.linkLength': { label: '마디 길이 (m)', min: 0.08, max: 0.25, step: 0.005, rebuild: true },
  'tail.linkMass': { label: '마디 질량 (kg)', min: 0.05, max: 0.4, step: 0.01, rebuild: true },
  'tail.armature': { label: '마디 회전 관성 (kg·m²)', min: 0.003, max: 0.1, step: 0.001, rebuild: true },
  'tail.baseThickness': { label: '밑동 굵기 (m)', min: 0.06, max: 0.3, step: 0.01, rebuild: true },
  'tail.tipThickness': { label: '끝 굵기 (m)', min: 0.04, max: 0.3, step: 0.01, rebuild: true },
  'tail.hipX': { label: '밑동 뒤쪽 거리 (m)', min: 0, max: 0.8, step: 0.01, rebuild: true },
  'tail.hipY': { label: '밑동 높이 (m)', min: -0.2, max: 0.2, step: 0.01, rebuild: true },
  'tail.jointLimitDeg': { label: '마디 꺾임 한계 (도)', min: 5, max: 80, step: 1 },
  'tail.rootUpDeg': { label: '밑동 위로 한계 (도)', min: 30, max: 165, step: 1 },
  'tail.rootDownDeg': { label: '밑동 아래로 한계 (도)', min: 0, max: 80, step: 1 },
  'tail.stiffness': { label: '모터 강성 (N·m/rad)', min: 10, max: 900, step: 1 },
  'tail.dampingSeconds': { label: '모터 감쇠 (초)', min: 0.02, max: 0.5, step: 0.01 },
  'tail.maxTorque': { label: '힘 상한 (N·m)', min: 1, max: 120, step: 0.5 },
  'tail.tipRatio': { label: '끝 관절 세기 비율', min: 0.02, max: 1, step: 0.01 },
  'tail.gravityComp': { label: '처짐 보정', min: 0, max: 1, step: 0.05 },
  'tail.support': { label: '꼬리 무게 받치기', min: 0, max: 1, step: 0.05 },
  'tail.brace': { label: '반동 버티기', min: 0, max: 1, step: 0.05 },
  'tail.friction': { label: '마찰', min: 0, max: 2, step: 0.01 },
  'tail.softCcd': { label: '빠른 충돌 살피기 (m)', min: 0, max: 1, step: 0.05 },
  'mouse.relative': { label: '상대 커서 (포인터 잠금)' },
  'mouse.sensitivity': { label: '상대 커서 감도', min: 0.2, max: 4, step: 0.05 },
  'mouse.pullTip': { label: '끝만 당기기 (개발자용)' },
  'mouse.pullStiffness': { label: '당기기 강성 (N/m)', min: 10, max: 400, step: 5 },
  'mouse.pullDamping': { label: '당기기 감쇠', min: 0, max: 30, step: 0.5 },
  'mouse.pullMaxForce': { label: '당기는 힘 상한 (N)', min: 1, max: 120, step: 1 },
  'mouse.pullMotor': { label: '당길 때 모터 배율', min: 0, max: 1, step: 0.01 },
  'auto.idleRaiseDeg': { label: '평소 드는 각 (도)', min: -40, max: 120, step: 1 },
  'auto.idleCurlDeg': { label: '평소 말림 (도)', min: -20, max: 30, step: 0.5 },
  'auto.waveDeg': { label: '살랑이는 폭 (도)', min: 0, max: 20, step: 0.5 },
  'auto.waveHz': { label: '살랑이는 빠르기 (Hz)', min: 0, max: 4, step: 0.1 },
  'auto.waveLag': { label: '물결 늦어짐 (rad)', min: 0, max: 2, step: 0.05 },
  'auto.windSeconds': { label: '젖히는 시간 (초)', min: 0, max: 0.6, step: 0.01 },
  'auto.strikeSeconds': { label: '치는 시간 (초)', min: 0.05, max: 1, step: 0.01 },
  'auto.recoverSeconds': { label: '돌아오는 시간 (초)', min: 0.05, max: 1, step: 0.01 },
  'auto.windRaiseDeg': { label: '젖힐 때 밑동 (도)', min: -60, max: 120, step: 1 },
  'auto.windCurlDeg': { label: '젖힐 때 말림 (도)', min: -30, max: 30, step: 0.5 },
  'auto.strikeRaiseDeg': { label: '칠 때 밑동 (도)', min: 30, max: 165, step: 1 },
  'auto.strikeCurlDeg': { label: '칠 때 말림 (도)', min: -30, max: 30, step: 0.5 },
  'auto.sweepCurlDeg': { label: '넘길 때 말림 (도)', min: -30, max: 30, step: 0.5 },
  'auto.chopSeconds': { label: '내려치기까지 (초)', min: 0, max: 1, step: 0.01 },
  'auto.strikePower': { label: '칠 때 세기 배율', min: 0.5, max: 5, step: 0.1 },
  'auto.strikeBrace': { label: '칠 때 반동 버티기', min: 0, max: 1.5, step: 0.05 },
  'auto.strikeBraceFadeDeg': { label: '칠 때 버티기 줄이는 기울기 (도)', min: 1, max: 90, step: 1 },
  'auto.reachFactor': { label: '잡으러 가는 거리 배율', min: 0.5, max: 3, step: 0.05 },
  'auto.behindPenalty': { label: '등진 쪽 거리 더하기 (m)', min: 0, max: 3, step: 0.05 },
  'auto.switchMargin': { label: '대상 바꾸기 여유 (m)', min: 0, max: 2, step: 0.05 },
  'auto.carryBack': { label: '들 때 뒤쪽 거리 (m)', min: -1, max: 1.5, step: 0.05 },
  'auto.carryUp': { label: '들 때 높이 (m)', min: 0, max: 1.5, step: 0.05 },
  'grab.radius': { label: '잡히는 거리 (m)', min: 0.05, max: 0.6, step: 0.01 },
  'grab.snapSeconds': { label: '끝이 붙는 시간 (초)', min: 0.02, max: 0.5, step: 0.01 },
  'grab.hangMotor': { label: '매달릴 때 모터 배율', min: 0, max: 1, step: 0.01 },
  'grab.swingAccel': { label: '매달려 흔드는 가속 (m/s²)', min: 0, max: 20, step: 0.5 },
  'grab.wriggleDeg': { label: '꼼지락 폭 (도)', min: 0, max: 30, step: 1 },
  'grab.wriggleHz': { label: '꼼지락 빠르기 (Hz)', min: 0.5, max: 10, step: 0.5 },
  'hit.minSpeed': { label: '타격 기준 속도 (m/s)', min: 0.5, max: 20, step: 0.1 },
  'hit.power': { label: '튕기는 세기', min: 0, max: 3, step: 0.05 },
  'hit.maxLaunch': { label: '튕기는 속도 상한 (m/s)', min: 1, max: 20, step: 0.5 },
  'hit.lift': { label: '위로 튕기기', min: 0, max: 2, step: 0.05 },
  'hit.pushMass': { label: '다 튕기는 무게 (kg)', min: 0.1, max: 5, step: 0.1 },
  'hit.cooldownSeconds': { label: '다시 칠 때까지 (초)', min: 0.05, max: 1, step: 0.05 },
  'cut.holdSeconds': { label: 'Q 누르는 시간 (초)', min: 0.1, max: 3, step: 0.1 },
  'cut.rewindSeconds': { label: '회귀 전 연출 (초)', min: 0.2, max: 5, step: 0.1 },
  'cut.wriggleDeg': { label: '꿈틀 폭 (도)', min: 0, max: 35, step: 1 },
  'cut.wriggleHz': { label: '꿈틀 빠르기 (Hz)', min: 0.5, max: 10, step: 0.1 },
  'cut.wriggleLag': { label: '꿈틀 물결 늦어짐 (rad)', min: 0, max: 3, step: 0.05 },
  'cut.wriggleStiffness': { label: '꿈틀 모터 강성 (N·m/rad)', min: 1, max: 60, step: 1 },
  'cut.wriggleDampingSeconds': { label: '꿈틀 모터 감쇠 (초)', min: 0, max: 0.3, step: 0.01 },
  'cut.wriggleTorque': { label: '꿈틀 힘 상한 (N·m)', min: 0.2, max: 20, step: 0.1 },
  'recorder.talkRange': { label: '말 거는 가로 거리 (m)', min: 0.3, max: 4, step: 0.05 },
  'recorder.talkHeight': { label: '말 거는 세로 거리 (m)', min: 0.3, max: 4, step: 0.05 },
  'ground.friction': { label: '바닥 마찰 (물건, 꼬리)', min: 0, max: 2, step: 0.01 },
  'ground.slipperyAccel': { label: '미끄러운 바닥 가속 배율', min: 0.02, max: 1, step: 0.02 },
  'ground.slipperyDecel': { label: '미끄러운 바닥 감속 배율', min: 0.02, max: 1, step: 0.02 },
  'props.density': { label: '밀도', min: 0.1, max: 10, step: 0.1 },
  'props.friction': { label: '마찰', min: 0, max: 2, step: 0.01 },
  'props.restitution': { label: '탄성', min: 0, max: 1, step: 0.01 },
  'camera.followSeconds': { label: '가로 따라가기 (초)', min: 0, max: 1, step: 0.01 },
  'camera.followSecondsY': { label: '세로 따라가기 (초)', min: 0, max: 1, step: 0.01 },
  'camera.lookAhead': { label: '가는 쪽 더 보기 (m)', min: 0, max: 4, step: 0.1 },
  'camera.lookSeconds': { label: '더 보기 넘어가기 (초)', min: 0, max: 2, step: 0.05 },
  'camera.offsetY': { label: '위쪽 더 보기 (m)', min: -2, max: 3, step: 0.1 },
  'physics.gravity': { label: '중력 (m/s²)', min: 0, max: 30, step: 0.01 },
  'physics.solverIterations': { label: '솔버 반복', min: 1, max: 64, step: 1 },
  'physics.maxStepsPerFrame': { label: '프레임당 최대 스텝', min: 1, max: 10, step: 1 },
  'view.interpolate': { label: '보간 그리기' },
};

/** 튜닝 패널의 묶음 이름. 키는 DEFAULTS의 첫 단계 이름이다. */
export const GROUP_LABELS: Record<keyof GameConfig, string> = {
  move: '이동',
  jump: '점프',
  upright: '직립',
  float: '띄우기',
  torso: '몸통',
  head: '머리',
  legs: '다리 그림',
  tail: '꼬리',
  mouse: 'A 방식 (마우스)',
  auto: 'B 방식 (자동)',
  grab: '잡기와 걸기',
  hit: '휘둘러 치기',
  cut: '꼬리 자르기와 회귀',
  recorder: '기록관',
  ground: '바닥',
  props: '물건',
  camera: '카메라',
  physics: '물리',
  view: '화면',
};

/** 패널을 열었을 때 펼쳐 둘 묶음. 나머지는 접어 둔다. */
export const OPEN_GROUPS: readonly (keyof GameConfig)[] = ['move', 'tail', 'mouse', 'auto'];

// ---- 경로로 값을 읽고 쓰는 도우미 ----

export type ParamValue = number | boolean;

type Section = Record<string, ParamValue>;

/** 'physics.gravity' 같은 경로 전부 */
export function paramPaths(): string[] {
  return Object.entries(DEFAULTS).flatMap(([group, section]) =>
    Object.keys(section as Section).map((key) => `${group}.${key}`),
  );
}

/** 경로가 가리키는 묶음 객체와 키 */
export function resolveParam(config: GameConfig, path: string): { section: Section; key: string } {
  const [group, key] = path.split('.');
  return { section: config[group as keyof GameConfig] as unknown as Section, key };
}

export function getParam(config: GameConfig, path: string): ParamValue {
  const { section, key } = resolveParam(config, path);
  return section[key];
}

export function setParam(config: GameConfig, path: string, value: ParamValue): void {
  const { section, key } = resolveParam(config, path);
  section[key] = value;
}

export function cloneConfig(config: GameConfig): GameConfig {
  return structuredClone(config);
}
