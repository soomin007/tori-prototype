import { copyJson } from './gameState';
import { SCHEMA, TIMELINE_KEYS } from './schema';
import type { GameState, Timeline, TimelineKey } from './schema';

/**
 * 체크포인트. 기록관에게 말을 건 순간의 timeline을 통째로 복사해 둔다(PLAN 7.4).
 * 회귀 지점은 늘 마지막 체크포인트라서 가장 최근 것 하나만 들고 있는다.
 * 바디의 위치나 속도 같은 물리 상태는 넣지 않는다. 방을 다시 만들면 물건은 방 데이터의 처음 배치로 돌아간다.
 */
export interface Checkpoint {
  version: number;
  timeline: Timeline;
}

/** 저장 형식이 바뀌면 올린다. 다른 판의 체크포인트는 읽지 않는다. */
export const CHECKPOINT_VERSION = 1;

/** 지금 상태의 timeline을 복사한다. JSON으로 적었다가 읽어 복사하므로 JSON에 담기지 않는 값은 남지 않는다. */
export function takeCheckpoint(state: GameState): Checkpoint {
  const timeline = {} as Record<TimelineKey, unknown>;
  for (const key of TIMELINE_KEYS) timeline[key] = state[key];
  return { version: CHECKPOINT_VERSION, timeline: copyJson(timeline) as Timeline };
}

/** 체크포인트의 timeline을 상태에 되돌린다. meta는 건드리지 않는다. */
export function restoreCheckpoint(state: GameState, { timeline }: Checkpoint): void {
  const target = state as Record<TimelineKey, unknown>;
  for (const key of TIMELINE_KEYS) target[key] = copyJson(timeline[key]);
}

export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify(checkpoint);
}

/**
 * 글자로 적은 체크포인트를 읽는다. 판이 다르거나 깨졌으면 null을 준다.
 * 모르는 항목은 버리고, 빠졌거나 형이 다른 항목은 처음 값을 쓴다. 기획이 항목을 더해도 예전 저장이 열리게 하려는 것이다.
 */
export function parseCheckpoint(text: string): Checkpoint | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== CHECKPOINT_VERSION || !isRecord(value.timeline)) return null;
  const saved = value.timeline;
  const timeline = {} as Record<TimelineKey, unknown>;
  for (const key of TIMELINE_KEYS) {
    const { initial } = SCHEMA[key];
    timeline[key] = Object.hasOwn(saved, key) && sameKind(saved[key], initial) ? saved[key] : copyJson(initial);
  }
  return { version: CHECKPOINT_VERSION, timeline: timeline as Timeline };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 처음 값과 같은 종류의 값인지. 처음 값이 null인 항목(아직 없음)은 null이나 글자를 받는다. */
function sameKind(value: unknown, initial: unknown): boolean {
  if (initial === null) return value === null || typeof value === 'string';
  if (Array.isArray(initial)) return Array.isArray(value);
  if (isRecord(initial)) return isRecord(value);
  return typeof value === typeof initial;
}
