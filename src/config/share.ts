import { getParam, PARAM_META, paramPaths, setParam } from './defaults';
import type { GameConfig, ParamValue } from './defaults';
import { DEFAULT_SCHEME, presetConfig, SCHEMES } from './presets';
import type { Scheme } from './presets';

/** 링크 하나로 전할 수 있는 실행 설정 */
export interface Session {
  scheme: Scheme;
  /** 방 번호 1~4. 아직 없는 방 번호도 링크에는 남는다. */
  room: number;
  config: GameConfig;
  /**
   * 디버그 키(Q 자르기, R 처음부터, 숫자 키 방 이동)를 받는지(PLAN 7.10). 수업에 내는 빌드에서는 끈다.
   * 끄면 이 키들은 아무 일도 하지 않고, 도움말과 일시정지 창에서도 빠진다.
   */
  debug: boolean;
}

export const ROOM_COUNT = 4;
/** 주소에 방이 없으면 여는 방. 12월 2일 체험판의 첫 방(방 4, 등록장 길)이다. */
export const DEFAULT_ROOM = 4;

/** 조작 방식의 기본값과 다른 항목만 모은다 */
export function diffConfig(config: GameConfig, scheme: Scheme): Record<string, ParamValue> {
  const base = presetConfig(scheme);
  const diff: Record<string, ParamValue> = {};
  for (const path of paramPaths()) {
    const value = getParam(config, path);
    if (value !== getParam(base, path)) diff[path] = value;
  }
  return diff;
}

/** 지금 설정으로 여는 주소를 만든다. pageUrl에 있던 파라미터는 버린다. */
export function buildShareUrl(pageUrl: string, session: Session): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('scheme', session.scheme);
  url.searchParams.set('room', String(session.room));
  const diff = diffConfig(session.config, session.scheme);
  if (Object.keys(diff).length > 0) url.searchParams.set('cfg', encode(diff));
  if (session.debug) url.searchParams.set('debug', '1');
  return url.toString();
}

/**
 * 주소의 ? 뒤를 읽는다. 모르는 항목과 깨진 값은 무시하고 기본값을 쓴다.
 * debugDefault는 주소에 debug가 없을 때의 값이다. 팀용 주소(main)는 끄고, 확인용 주소는 켠다(main.ts).
 */
export function parseShare(search: string, debugDefault = true): Session {
  const params = new URLSearchParams(search);
  const flag = params.get('debug');
  const scheme = SCHEMES.find((s) => s === params.get('scheme')?.toUpperCase()) ?? DEFAULT_SCHEME;
  const room = Number(params.get('room'));
  const config = presetConfig(scheme);
  applyDiff(config, decode(params.get('cfg')));
  return {
    scheme,
    room: Number.isInteger(room) && room >= 1 && room <= ROOM_COUNT ? room : DEFAULT_ROOM,
    config,
    debug: flag === '1' ? true : flag === '0' ? false : debugDefault,
  };
}

/** 아는 항목만, 형이 맞을 때만, 범위 안으로 잘라 넣는다 */
function applyDiff(config: GameConfig, diff: Record<string, unknown>): void {
  for (const path of paramPaths()) {
    if (!Object.hasOwn(diff, path)) continue;
    const value = diff[path];
    const current = getParam(config, path);
    if (typeof current === 'boolean' && typeof value === 'boolean') {
      setParam(config, path, value);
    } else if (typeof current === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      setParam(config, path, clampToMeta(path, value));
    }
  }
}

function clampToMeta(path: string, value: number): number {
  const { min = -Infinity, max = Infinity, step } = PARAM_META[path] ?? {};
  const clamped = Math.min(max, Math.max(min, value));
  return step === 1 ? Math.round(clamped) : clamped;
}

/** 메신저에 붙여도 깨지지 않게 base64url로 적는다 */
function encode(diff: Record<string, ParamValue>): string {
  return btoa(JSON.stringify(diff)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(atob(text.replaceAll('-', '+').replaceAll('_', '/')));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
