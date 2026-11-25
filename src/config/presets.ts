import { cloneConfig, DEFAULTS, getParam, paramPaths, setParam } from './defaults';
import type { GameConfig, ParamValue } from './defaults';

/** 꼬리 조작 방식. A: 마우스로 직접, B: 평소 자동 + 키 */
export type Scheme = 'A' | 'B';

export const SCHEMES: readonly Scheme[] = ['A', 'B'];

/** 처음 열었을 때의 방식(자리값). 팀이 M2 뒤 회의에서 하나를 고른다. */
export const DEFAULT_SCHEME: Scheme = 'A';

/** 방식마다 기본값과 다르게 둘 항목(경로 → 값). 꼬리가 들어오는 M2에서 채운다. */
const OVERRIDES: Record<Scheme, Record<string, ParamValue>> = {
  A: {},
  B: {},
};

/** 그 방식의 기본 설정 */
export function presetConfig(scheme: Scheme): GameConfig {
  const config = cloneConfig(DEFAULTS);
  for (const [path, value] of Object.entries(OVERRIDES[scheme])) setParam(config, path, value);
  return config;
}

/** 방식을 바꾼다. 손대지 않은 항목만 새 방식의 기본값으로 옮기고, 사람이 바꾼 값은 남긴다. */
export function switchScheme(config: GameConfig, from: Scheme, to: Scheme): void {
  const before = presetConfig(from);
  const after = presetConfig(to);
  for (const path of paramPaths()) {
    if (getParam(config, path) === getParam(before, path)) {
      setParam(config, path, getParam(after, path));
    }
  }
}
