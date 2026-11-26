import type { ParamMeta } from './defaults';

/**
 * 결투 상대의 데이터(PLAN 7.7). 몸과 움직임, 공격 목록을 여기에 둔다. 값은 모두 자리값이고,
 * 공격의 내용(어떤 동작인지, 무엇으로 예고하는지, 얼마나 아픈지, 빈틈이 얼마인지)은 11월 29일 회의에서 받는다(PLAN 11.1의 3번).
 * 결투 손맛을 배포된 주소에서 맞출 수 있게, 묶음 하나가 설정(config/defaults.ts)의 한 갈래가 되어 튜닝 패널에 나온다.
 * 상대의 행동은 sim/opponent.ts의 상태 기계가 정한다.
 */

/** 상대의 몸과 움직임 */
export interface FoeConfig {
  maxHealth: number;
  /** 몸의 폭과 키(m) */
  width: number;
  height: number;
  mass: number;
  walkSpeed: number;
  accel: number;
  /** 경직 중에 미끄러지다 멈추는 감속(m/s²) */
  slideDecel: number;
  /** 넉백을 받는 정도. 꼬리에 맞아 밀려나는 속도에 곱한다. */
  knockbackTaken: number;
  /** 맞으면 경직되는 시간 */
  staggerSeconds: number;
  /** 경직이 끝난 뒤 다시 경직되지 않는 시간. 계속 때려 묶어 두지 못하게 한다. */
  staggerCooldownSeconds: number;
  /** 켜면 예고와 공격 중에는 맞아도 경직되지 않는다(피해는 받는다) */
  armor: boolean;
  /** 빈틈(공격 뒤와 경직 중)이 아닐 때 받는 피해 배율. 방어구가 얼마나 막는지의 자리다(PLAN 7.7). 1이면 효과 없음 */
  guardDamage: number;
  /** 거리를 재는 시간의 범위. 이 사이에서 씨앗을 고정한 난수로 고른다. */
  measureMinSeconds: number;
  measureMaxSeconds: number;
  /** 토리가 쓰러지면 이만큼(몸 사이 간격, m) 물러난다 */
  retreatGap: number;
  /** 난수 씨앗. 같은 입력이면 같은 결투가 나온다(PLAN 7.7). */
  seed: number;
}

/**
 * 공격 하나. 거리는 상대의 몸 앞쪽 끝에서 토리 몸통 끝까지의 간격(m)이다.
 * 예고(windup) → 공격(active) → 빈틈(recover) 순서로 지나간다. 예고 시간이 0이면 데이터를 읽을 때 오류다.
 */
export interface AttackConfig {
  /** 간격이 이 범위 안일 때 쓴다 */
  minRange: number;
  maxRange: number;
  windupSeconds: number;
  /** 공격 동작의 시간. 돌진은 토리를 맞히거나 벽에 막히면 일찍 끝난다. */
  activeSeconds: number;
  /** 공격하는 동안 앞으로 나가는 속도(m/s) */
  lungeSpeed: number;
  /** 판정 범위. 몸 앞쪽 끝에서 앞으로 reach만큼, 발밑에서 hitBottom부터 hitTop까지(m) */
  reach: number;
  hitBottom: number;
  hitTop: number;
  damage: number;
  /** 맞은 토리가 밀려나는 속도(m/s). 능력표의 poise로 나눈다. */
  knockback: number;
  /** 맞은 토리가 떠오르는 속도(m/s) */
  lift: number;
  /** 공격 뒤 빈틈. B 방식 휘두르기가 맞는 시간(0.25초 안팎)의 두 배보다 길게 둔다(PLAN 7.7). */
  recoverSeconds: number;
  /** 맞히면 공격 동작을 바로 멈추는지. 돌진은 부딪히면 멈춘다. */
  stopOnHit: boolean;
}

/** 설정에 들어가는 상대 묶음. 상대를 더하면 여기와 OPPONENTS에 함께 적는다. */
export interface OpponentGroups {
  foe1: FoeConfig;
  foe1Dash: AttackConfig;
  foe1Shove: AttackConfig;
}

export type FoeGroup = 'foe1';
export type AttackGroup = Exclude<keyof OpponentGroups, FoeGroup>;

/** 결투 1 상대(PLAN 2.1). 덩치가 크고 방어구를 둘렀다. 정면으로 돌진하고 밀친다. 넉백을 덜 받는다. */
export const OPPONENT_DEFAULTS: OpponentGroups = {
  foe1: {
    maxHealth: 100,
    width: 0.9, // 토리 몸통(길이 1m, 굵기 0.4m)보다 크다
    height: 1.6,
    mass: 12, // kg. 토리(약 4.2kg)가 밀어도 밀리지 않는다
    walkSpeed: 1.4,
    accel: 12,
    slideDecel: 4,
    knockbackTaken: 0.5,
    staggerSeconds: 0.35,
    staggerCooldownSeconds: 0.8,
    armor: true,
    guardDamage: 1,
    measureMinSeconds: 0.5,
    measureMaxSeconds: 1.2,
    retreatGap: 3.5,
    seed: 1,
  },
  // 멀리서 정면으로 달려와 부딪힌다. 뛰면 넘을 수 있다(점프로 몸통 아래가 바닥에서 약 1.7m까지 오른다).
  foe1Dash: {
    minRange: 2.5,
    maxRange: 9,
    windupSeconds: 0.6,
    activeSeconds: 0.8,
    lungeSpeed: 7,
    reach: 0.15,
    hitBottom: 0,
    hitTop: 1.6,
    damage: 25,
    knockback: 7,
    lift: 3,
    recoverSeconds: 1,
    stopOnHit: true,
  },
  // 가까이에서 밀어낸다
  foe1Shove: {
    minRange: 0,
    maxRange: 1,
    windupSeconds: 0.45,
    activeSeconds: 0.18,
    lungeSpeed: 2,
    reach: 0.6,
    hitBottom: 0.15,
    hitTop: 1.3,
    damage: 12,
    knockback: 5.5,
    lift: 2.5,
    recoverSeconds: 0.6,
    stopOnHit: false,
  },
};

/** 상대 종류마다 설정에서 읽을 묶음. 공격 목록은 적은 순서대로 본다. */
export const OPPONENTS = {
  'opponent-1': { body: 'foe1', attacks: ['foe1Dash', 'foe1Shove'] },
} as const satisfies Record<string, { body: FoeGroup; attacks: readonly AttackGroup[] }>;

export type OpponentKind = keyof typeof OPPONENTS;

/** 읽어 낸 공격 하나. group은 설정의 묶음 이름이다. */
export interface Attack extends AttackConfig {
  group: AttackGroup;
}

export interface OpponentData {
  body: FoeConfig;
  attacks: readonly Attack[];
}

/**
 * 설정에서 상대 하나를 읽는다. 예고 시간이 0 이하인 공격이 있으면 오류다(PLAN 7.7).
 * 튜닝 패널은 예고 시간을 0으로 내리지 못하게 범위를 둔다.
 */
export function readOpponent(config: OpponentGroups, kind: OpponentKind): OpponentData {
  const { body, attacks } = OPPONENTS[kind];
  const read = attacks.map((group) => ({ group, ...config[group] }));
  for (const attack of read) {
    if (!(attack.windupSeconds > 0)) throw new Error(`${kind}의 ${attack.group}: 예고 시간이 0이다. 예고 없는 공격은 만들지 않는다`);
  }
  return { body: config[body], attacks: read };
}

const ATTACK_META: Record<keyof AttackConfig, ParamMeta> = {
  minRange: { label: '쓰는 간격 최소 (m)', min: 0, max: 12, step: 0.05 },
  maxRange: { label: '쓰는 간격 최대 (m)', min: 0, max: 12, step: 0.05 },
  windupSeconds: { label: '예고 (초)', min: 0.1, max: 2, step: 0.01 },
  activeSeconds: { label: '공격 동작 (초)', min: 0.02, max: 2, step: 0.01 },
  lungeSpeed: { label: '나가는 속도 (m/s)', min: 0, max: 15, step: 0.1 },
  reach: { label: '판정 앞쪽 (m)', min: 0, max: 2, step: 0.01 },
  hitBottom: { label: '판정 아래 (m)', min: 0, max: 3, step: 0.01 },
  hitTop: { label: '판정 위 (m)', min: 0, max: 3, step: 0.01 },
  damage: { label: '피해', min: 0, max: 100, step: 1 },
  knockback: { label: '넉백 (m/s)', min: 0, max: 15, step: 0.1 },
  lift: { label: '띄우기 (m/s)', min: 0, max: 10, step: 0.1 },
  recoverSeconds: { label: '빈틈 (초)', min: 0, max: 3, step: 0.01 },
  stopOnHit: { label: '맞히면 멈추기' },
};

const FOE_META: Record<keyof FoeConfig, ParamMeta> = {
  maxHealth: { label: '체력', min: 1, max: 500, step: 1, rebuild: true },
  width: { label: '폭 (m)', min: 0.3, max: 2, step: 0.05, rebuild: true },
  height: { label: '키 (m)', min: 0.5, max: 3, step: 0.05, rebuild: true },
  mass: { label: '질량 (kg)', min: 1, max: 60, step: 0.5, rebuild: true },
  walkSpeed: { label: '걷는 속도 (m/s)', min: 0, max: 6, step: 0.1 },
  accel: { label: '가속 (m/s²)', min: 1, max: 60, step: 0.5 },
  slideDecel: { label: '밀려날 때 감속 (m/s²)', min: 0.5, max: 30, step: 0.5 },
  knockbackTaken: { label: '넉백 받는 배율', min: 0, max: 2, step: 0.05 },
  staggerSeconds: { label: '경직 (초)', min: 0, max: 2, step: 0.01 },
  staggerCooldownSeconds: { label: '다시 경직까지 (초)', min: 0, max: 3, step: 0.05 },
  armor: { label: '예고와 공격 중 경직 안 됨' },
  guardDamage: { label: '빈틈이 아닐 때 피해 배율', min: 0, max: 1, step: 0.05 },
  measureMinSeconds: { label: '거리 재기 최소 (초)', min: 0, max: 3, step: 0.05 },
  measureMaxSeconds: { label: '거리 재기 최대 (초)', min: 0, max: 3, step: 0.05 },
  retreatGap: { label: '토리가 쓰러지면 물러날 간격 (m)', min: 0, max: 10, step: 0.1 },
  seed: { label: '난수 씨앗', min: 1, max: 9999, step: 1, rebuild: true },
};

const prefixed = (group: string, meta: Record<string, ParamMeta>): Record<string, ParamMeta> =>
  Object.fromEntries(Object.entries(meta).map(([key, value]) => [`${group}.${key}`, value]));

/** 튜닝 패널 항목. config/defaults.ts의 PARAM_META에 합친다. */
export const OPPONENT_META: Record<string, ParamMeta> = {
  ...prefixed('foe1', FOE_META),
  ...prefixed('foe1Dash', ATTACK_META),
  ...prefixed('foe1Shove', ATTACK_META),
};

/** 튜닝 패널의 묶음 이름. 상대는 번호로만 부른다(CLAUDE.md의 반드시 지킬 것 1번). */
export const OPPONENT_LABELS: Record<keyof OpponentGroups, string> = {
  foe1: '결투 1 상대',
  foe1Dash: '결투 1 상대: 돌진',
  foe1Shove: '결투 1 상대: 밀치기',
};
