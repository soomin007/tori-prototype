import { cloneConfig, DEFAULTS, FIXED_DT, setParam } from '../src/config/defaults';
import type { ParamValue } from '../src/config/defaults';
import type { Scheme } from '../src/config/presets';
import type { DuelData, Point, RecorderData, RoomData, ScriptedEventData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/simulation';
import type { GameState } from '../src/state/gameState';
import { ground, room } from './testRooms';

/** 결투 테스트에서 함께 쓰는 방과 진행 도우미. 결투(duel.test.ts)와 대본 사건(scripted.test.ts)이 쓴다. */

const FOE_HALF = DEFAULTS.foe1.width / 2;

/** 결투 시험 방의 기록관. 말을 걸면 회귀 지점이 된다. */
export const RECORDER: RecorderData = {
  id: 'test-recorder',
  x: 3,
  y: 0,
  stand: { x: 1.9, y: -0.5 },
  line: '기록관 대사 1',
  number: '번호 1',
  time: '시각 1',
  door: null,
};

export interface DuelRoomOptions {
  opponentX?: number;
  startX?: number;
  spawnX?: number;
  /** 결투에 딸린 대본 사건 */
  events?: ScriptedEventData[];
}

/** 결투 시험 방. 바닥 윗면이 y = 0이다. 기록관(x 3) 오른쪽의 결투장(x 8~30)에 들어서면(x 11) 결투가 시작된다. */
export function duelRoom({ opponentX = 14, startX = 11, spawnX = RECORDER.stand.x, events = [] }: DuelRoomOptions = {}): RoomData {
  const duel: DuelData = {
    id: 'duel-test',
    left: 8,
    right: 30,
    floorY: 0,
    startX,
    opponent: 'opponent-1',
    opponentX,
    numbers: ['번호 1', '번호 2'],
  };
  return { ...room([ground(0, 40)], [], [], [RECORDER], [duel], events), spawn: { x: spawnX, y: -0.5 } };
}

/** 토리가 결투장 안(x 12)에서 시작하고 상대가 몸 앞 face(m)에 서 있는 방. 결투는 첫 스텝에 시작된다. */
export function faceToFace(face: number): RoomData {
  return duelRoom({ spawnX: 12, opponentX: 12 + face + FOE_HALF });
}

/** 상대가 거리를 재기만 하고 공격하지 않게 하는 설정. 튜닝 패널의 범위(3초)를 넘지만 테스트에서는 그대로 쓴다. */
export const PASSIVE = { 'foe1.measureMinSeconds': 20, 'foe1.measureMaxSeconds': 20 };

export class Duelist {
  readonly sim: Simulation;
  readonly input: InputState = createInputState();
  readonly events: SimEvent[] = [];

  constructor(scheme: Scheme, roomData: RoomData, config: Record<string, ParamValue> = {}, initial: Partial<GameState> = {}) {
    const values = cloneConfig(DEFAULTS);
    for (const [path, value] of Object.entries(config)) setParam(values, path, value);
    this.sim = new Simulation(values, roomData, scheme, initial);
  }

  seconds(seconds: number, each?: (time: number) => void): this {
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) {
      each?.(i * FIXED_DT);
      this.sim.step(this.input);
      this.events.push(...this.sim.drainEvents());
    }
    return this;
  }

  /** 조건이 참이 될 때까지(최대 seconds) 돌린다 */
  until(done: () => boolean, seconds: number): this {
    for (let i = 0; i < Math.round(seconds / FIXED_DT) && !done(); i += 1) this.seconds(FIXED_DT);
    return this;
  }

  pressE(): this {
    this.input.pressed.interact = true;
    return this.seconds(FIXED_DT);
  }

  /** 몸통 중심에서 본 자리에 커서를 둔다 */
  point(dx: number, dy: number): this {
    const { x, y } = this.center;
    this.input.pointerActive = true;
    this.input.pointer = { x: x + dx, y: y + dy };
    return this;
  }

  get duel() {
    return this.sim.duels[0];
  }

  get foe() {
    return this.duel.opponent;
  }

  get center(): Point {
    return this.sim.tori.torso.translation();
  }
}

/** 좌우 이동 키를 0.1초마다 번갈아 누른다 */
export const alternateKeys = (run: Duelist) => (time: number): void => {
  run.input.moveX = Math.floor(time / 0.1) % 2 === 0 ? 1 : -1;
};

/** 마우스를 0.1초마다 좌우로 번갈아 흔든다 */
export const shakeMouse = (run: Duelist) => (time: number): void => {
  const side = Math.floor(time / 0.1) % 2 === 0 ? 1 : -1;
  run.input.mouseMotion = { x: side * 0.05, y: 0 };
};
