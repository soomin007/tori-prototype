import { SCHEMA, STATE_KEYS } from './schema';
import type { GameState, StateKey } from './schema';

export type { GameState, Meta, Timeline } from './schema';

/** 새 판의 상태. overrides로 처음 값을 바꾼다(예: 남은 꼬리 구간). */
export function createGameState(overrides: Partial<GameState> = {}): GameState {
  const state = {} as Record<StateKey, unknown>;
  for (const key of STATE_KEYS) {
    state[key] = copyJson(Object.hasOwn(overrides, key) ? overrides[key] : SCHEMA[key].initial);
  }
  return state as GameState;
}

/** JSON으로 적었다가 읽은 사본. JSON에 담기지 않는 값(undefined, 함수, Map)이 섞여 있으면 여기서 빠진다. */
export function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
