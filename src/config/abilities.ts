import TABLE from './abilities.json';

/**
 * 능력표 한 줄(PLAN 7.5). 줄 이름은 남은 꼬리 구간 수이고, 값은 기획이 정한다.
 * 그 전까지는 모든 줄이 같아서 꼬리의 물리적 길이만 줄어든다. 표의 배율은 물리로 달라진 값 위에 곱해진다.
 * 지금 쓰는 열은 balance와 canGrab이다. maxHealth, poise, whipPower는 묶음 나에서, 나머지는 2단계에서 잇는다.
 */
export interface Abilities {
  /** 잡기를 할 수 있는지. 꺼져 있으면 꼬리 끝만 꼼지락거린다. */
  canGrab: boolean;
  /** 가지에 매달릴 수 있는지 */
  canHang: boolean;
  /** 직립 세기에 곱한다 */
  balance: number;
  /** 타격으로 튕기는 세기와 피해에 곱한다 */
  whipPower: number;
  /** 사거리에 곱한다 */
  reach: number;
  /** 쓸기 범위에 곱한다 */
  sweep: number;
  /** 걸어당기는 힘에 곱한다 */
  pull: number;
  /** 휘두르기 속도에 곱한다 */
  swingSpeed: number;
  /** 공격 뒤 빈틈의 길이에 곱한다 */
  recovery: number;
  /** 이동 속도에 곱한다 */
  moveSpeed: number;
  /** 점프 높이에 곱한다 */
  jump: number;
  /** 버티는 힘. 넉백을 이 값으로 나눈다. */
  poise: number;
  /** 받아치기를 할 수 있는지 */
  canParry: boolean;
  /** 체력 상한에 곱한다 */
  maxHealth: number;
  /** 꼬리 칸에 걸 수 있는 무게(kg) */
  carryMass: number;
}

/** 남은 구간 수 → 능력 */
export type AbilityTable = Readonly<Record<string, Abilities>>;

export const ABILITIES: AbilityTable = TABLE;

/** 남은 구간 수의 줄. 그 줄이 없으면(설정에서 구간 수를 늘렸을 때) 번호가 가장 가까운 줄을 쓴다. */
export function abilitiesFor(sectionsLeft: number, table: AbilityTable = ABILITIES): Abilities {
  const exact = table[String(sectionsLeft)];
  if (exact) return { ...exact };
  const rows = Object.keys(table).map(Number).filter(Number.isFinite);
  if (rows.length === 0) throw new Error('능력표가 비어 있다');
  const nearest = rows.reduce((best, row) => (Math.abs(row - sectionsLeft) < Math.abs(best - sectionsLeft) ? row : best));
  return { ...table[String(nearest)] };
}
