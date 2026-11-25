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

/** M0 확인용 방(미터, 자리값). M1에서 rooms/rooms.ts의 방 데이터로 바꾼다. */
export const M0_ROOM = {
  width: 12.8,
  height: 7.2,
  floorThickness: 0.6,
  wallThickness: 0.3,
  /** 화면 위에서 떨어지는 상자가 벽을 넘지 않게 벽을 위로 더 올리는 높이 */
  wallExtraHeight: 80,
};

// ---- 튜닝 패널에서 바꾸는 값 ----

export interface GameConfig {
  physics: {
    gravity: number;
    solverIterations: number;
    maxStepsPerFrame: number;
  };
  view: {
    interpolate: boolean;
  };
  ground: {
    friction: number;
  };
  testBoxes: {
    count: number;
    size: number;
    density: number;
    friction: number;
    restitution: number;
  };
}

export const DEFAULTS: GameConfig = {
  physics: {
    gravity: 9.81, // m/s², 아래쪽. 자리값
    solverIterations: 16, // Rapier 기본값 4로는 꼬리가 늘어난다(known-issues 1번)
    maxStepsPerFrame: 5, // 이보다 밀린 시간은 버린다
  },
  view: {
    interpolate: true,
  },
  ground: {
    friction: 0.8, // 자리값
  },
  testBoxes: {
    count: 6, // 자리값
    size: 0.6, // m, 자리값
    density: 1, // kg/m², 자리값
    friction: 0.6, // 자리값
    restitution: 0.1, // 자리값
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
  'physics.gravity': { label: '중력 (m/s²)', min: 0, max: 30, step: 0.01 },
  'physics.solverIterations': { label: '솔버 반복', min: 1, max: 64, step: 1 },
  'physics.maxStepsPerFrame': { label: '프레임당 최대 스텝', min: 1, max: 10, step: 1 },
  'view.interpolate': { label: '보간 그리기' },
  'ground.friction': { label: '바닥 마찰', min: 0, max: 2, step: 0.01 },
  'testBoxes.count': { label: '상자 수', min: 1, max: 30, step: 1, rebuild: true },
  'testBoxes.size': { label: '상자 크기 (m)', min: 0.2, max: 1.5, step: 0.05, rebuild: true },
  'testBoxes.density': { label: '상자 밀도', min: 0.1, max: 10, step: 0.1 },
  'testBoxes.friction': { label: '상자 마찰', min: 0, max: 2, step: 0.01 },
  'testBoxes.restitution': { label: '상자 탄성', min: 0, max: 1, step: 0.01 },
};

/** 튜닝 패널의 묶음 이름. 키는 DEFAULTS의 첫 단계 이름이다. */
export const GROUP_LABELS: Record<keyof GameConfig, string> = {
  physics: '물리',
  view: '화면',
  ground: '바닥',
  testBoxes: '확인용 상자',
};

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
