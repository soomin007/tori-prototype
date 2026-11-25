/** 충돌 그룹. 어느 것끼리 부딪히는지는 COLLIDES_WITH 표 하나로 정한다. */
export const Group = {
  Terrain: 1 << 0,
  Body: 1 << 1,
  Tail: 1 << 2,
  Prop: 1 << 3,
  Enemy: 1 << 4,
  /** 감지 영역(NPC, 아이템, 체크포인트) */
  Sensor: 1 << 5,
  /** 꼬리로 들고 있는 물건 */
  Held: 1 << 6,
  /** 꼬리로 거는 가지. 아무것과도 부딪히지 않는다. */
  Branch: 1 << 7,
} as const;

export type GroupName = keyof typeof Group;

/** 꼬리는 자기 몸과 부딪히지 않는다(PLAN 7.1). 나머지는 자리값이다. 표에서 양쪽이 서로를 적어야 부딪힌다. */
const COLLIDES_WITH: Record<GroupName, number> = {
  Terrain: Group.Body | Group.Tail | Group.Prop | Group.Enemy | Group.Held,
  Body: Group.Terrain | Group.Prop | Group.Enemy | Group.Sensor,
  Tail: Group.Terrain | Group.Prop | Group.Enemy,
  Prop: Group.Terrain | Group.Body | Group.Tail | Group.Prop | Group.Enemy | Group.Held,
  Enemy: Group.Terrain | Group.Body | Group.Tail | Group.Prop | Group.Enemy | Group.Held,
  Sensor: Group.Body,
  Held: Group.Terrain | Group.Prop | Group.Enemy | Group.Held,
  Branch: 0,
};

/** Rapier의 InteractionGroups 값(위 16비트: 속한 그룹, 아래 16비트: 부딪힐 그룹) */
export function collisionGroups(name: GroupName): number {
  return ((Group[name] << 16) | COLLIDES_WITH[name]) >>> 0;
}

/** 토리가 디딜 바닥을 찾는 레이캐스트용. 몸, 꼬리, 감지 영역은 맞지 않는다. */
export function groundProbeGroups(): number {
  return ((Group.Body << 16) | Group.Terrain | Group.Prop) >>> 0;
}
