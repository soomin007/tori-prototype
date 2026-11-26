/**
 * 게임 상태의 항목과, 항목마다 회귀하면 되돌아가는지(timeline) 남는지(meta)를 정한다(PLAN 7.4).
 * 어느 쪽인지는 아래 SCHEMA 한 곳에서만 정한다. 기획이 바뀌면 timeline(...)과 meta(...)만 바꿔 적는다.
 * 다른 코드는 쪽을 가리지 않고 state.room, state.sectionsLeft처럼 읽고 쓰므로 함께 고칠 곳이 없다.
 * 값은 JSON으로 적을 수 있는 것(숫자, 글자, 참거짓, null, 배열, 객체)만 둔다. 체크포인트를 JSON으로 저장하기 때문이다.
 * 이 폴더는 Phaser와 물리를 쓰지 않는다.
 */

/** timeline: 회귀하면 체크포인트 시점 값으로 돌아간다. meta: 회귀해도 남는다. */
export type Side = 'timeline' | 'meta';

interface Field<T, S extends Side> {
  readonly side: S;
  readonly initial: T;
}

const timeline = <T>(initial: T): Field<T, 'timeline'> => ({ side: 'timeline', initial });
const meta = <T>(initial: T): Field<T, 'meta'> => ({ side: 'meta', initial });

/** 항목 이름, 쪽, 처음 값. 3단계 이후에 쓰는 항목은 자리만 있다. */
export const SCHEMA = {
  /** 지금 있는 방 번호 */
  room: timeline<number>(1),
  /** 마지막으로 말을 건 기록관. 회귀하면 이 기록관 앞에 선다. */
  recorder: timeline<string | null>(null),
  /** 말을 건 적이 있는 기록관. 말을 걸어야 지나갈 수 있는 기록관의 문이 이것으로 열린다. */
  talkedTo: timeline<string[]>([]),
  /** 손 칸에 든 것(3단계) */
  hand: timeline<string | null>(null),
  /** 꼬리 칸에 든 것(3단계) */
  tailSlot: timeline<string | null>(null),
  /** NPC마다의 상태(2단계) */
  npcs: timeline<Record<string, string>>({}),
  /** 갈림길에서 고른 길(3단계) */
  routes: timeline<Record<string, string>>({}),
  /** 이긴 결투(묶음 나) */
  duelsWon: timeline<string[]>([]),
  /** 버릇 기록(3단계, PLAN 7.9) */
  habits: timeline<Record<string, number>>({}),
  /** 남은 꼬리 구간. 새 판의 값은 설정의 tail.sections다. */
  sectionsLeft: meta<number>(3),
  /** 회귀한 횟수 */
  rewinds: meta<number>(0),
  /** 회귀를 넘어 기억되는 플래그(토리의 기억) */
  memory: meta<Record<string, boolean>>({}),
};

type Schema = typeof SCHEMA;
export type StateKey = keyof Schema;
export type GameState = { [K in StateKey]: Schema[K]['initial'] };

type KeysOn<S extends Side> = { [K in StateKey]: Schema[K]['side'] extends S ? K : never }[StateKey];
export type TimelineKey = KeysOn<'timeline'>;
export type MetaKey = KeysOn<'meta'>;
/** 체크포인트에 담기는 부분 */
export type Timeline = Pick<GameState, TimelineKey>;
export type Meta = Pick<GameState, MetaKey>;

export const STATE_KEYS = Object.keys(SCHEMA) as StateKey[];
export const TIMELINE_KEYS = STATE_KEYS.filter((key) => SCHEMA[key].side === 'timeline') as TimelineKey[];
export const META_KEYS = STATE_KEYS.filter((key) => SCHEMA[key].side === 'meta') as MetaKey[];
