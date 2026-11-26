import { beforeAll, describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesFor } from '../src/config/abilities';
import { cloneConfig, DEFAULTS, FIXED_DT } from '../src/config/defaults';
import type { Scheme } from '../src/config/presets';
import { angleDiff, initPhysics } from '../src/physics/world';
import { roomByNumber } from '../src/rooms/rooms';
import type { Point, RoomData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import type { GameState } from '../src/state/gameState';
import { box, ground, room } from './testRooms';

beforeAll(() => initPhysics());

const FLAT: RoomData = { ...room([ground(0, 60)]), spawn: { x: 30, y: -0.5 } };
const { baseLinks, linksPerSection, sections } = DEFAULTS.tail;
const FULL_LINKS = baseLinks + sections * linksPerSection;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

class Run {
  readonly sim: Simulation;
  readonly input: InputState = createInputState();

  constructor(scheme: Scheme, roomData: RoomData = FLAT, initial: Partial<GameState> = {}) {
    this.sim = new Simulation(cloneConfig(DEFAULTS), roomData, scheme, initial);
  }

  seconds(seconds: number, each?: (time: number) => void): this {
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) {
      each?.(i * FIXED_DT);
      this.sim.step(this.input);
    }
    return this;
  }

  /** E를 한 번 누른다 */
  pressE(): this {
    this.input.pressed.interact = true;
    return this.seconds(FIXED_DT);
  }

  /** Q를 seconds 동안 누르고 뗀다 */
  holdQ(seconds: number): this {
    this.input.held.cutTail = true;
    this.seconds(seconds);
    this.input.held.cutTail = false;
    return this.seconds(FIXED_DT);
  }

  get x(): number {
    return this.sim.tori.torso.translation().x;
  }

  get links(): number {
    return this.sim.tori.tail.links.length;
  }
}

describe('꼬리 자르기', () => {
  it('자르면 마디 수가 구간만큼 줄고, 꼬리 끝에 들고 있던 물건이 함께 떨어진다', () => {
    const item = { ...box(28.4, -0.09, 0.18, 0), grabbable: true };
    const run = new Run('A', { ...FLAT, boxes: [item] });
    run.input.pointerActive = true;
    run.input.pointer = { x: 28.4, y: -0.1 };
    run.input.held.pointerGrab = true;
    run.seconds(2);
    expect(run.sim.tori.grab.holding).not.toBeNull();
    run.input.pointer = { x: 29.8, y: -1.8 };
    run.seconds(1.5);
    const { body } = run.sim.objects[0];
    expect(body.translation().y).toBeLessThan(-1.2);

    expect(run.sim.cutTail()).toBe(true);
    expect(run.links).toBe(FULL_LINKS - linksPerSection);
    expect(run.sim.tori.grab.holding).toBeNull();
    const [piece] = run.sim.severed;
    expect(piece.links.length).toBe(linksPerSection);
    expect(piece.carried?.body.handle).toBe(body.handle);

    // 잡기 입력을 그대로 누르고 있어도 물건은 잘린 꼬리에 붙은 채 바닥까지 떨어진다
    let maxGap = 0;
    run.seconds(1.2, () => {
      const tip = piece.links[piece.links.length - 1].body.translation();
      maxGap = Math.max(maxGap, distance(tip, body.translation()));
    });
    expect(body.translation().y).toBeGreaterThan(-0.3);
    expect(maxGap).toBeLessThan(0.4);
    expect(run.sim.tori.grab.holding).toBeNull();
  });

  it('가지에 걸린 채 자르면 가지를 놓고 떨어진다', () => {
    const branch = { x: 30, y: -2.2, length: 0.7, thickness: 0.1 };
    const run = new Run('B', { ...room([ground(0, 60)], [], [branch]), spawn: { x: 30.4, y: -0.5 } });
    run.input.held.grab = true;
    run.seconds(0.5);
    run.input.pressed.jump = true;
    run.seconds(1.5);
    expect(run.sim.tori.grab.hooked).toBe(true);
    run.sim.cutTail();
    expect(run.sim.tori.grab.hooked).toBe(false);
    run.seconds(1);
    expect(run.sim.tori.grounded).toBe(true);
  });

  it('잘린 꼬리는 꿈틀거리고, 토리의 몸과 부딪히지 않고, 멀리 날아가지 않는다', () => {
    const run = new Run('B').seconds(1);
    run.sim.cutTail();
    const [piece] = run.sim.severed;
    const start = piece.links[0].body.translation();
    const angles: number[] = [];
    let farthest = 0;
    run.seconds(1.8, () => {
      angles.push(angleDiff(piece.links[1].body.rotation(), piece.links[0].body.rotation()));
      farthest = Math.max(farthest, distance(piece.links[0].body.translation(), start));
    });
    // 관절마다 ±30도를 목표로 흔든다
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.9);
    expect(farthest).toBeLessThan(2);
    const torso = run.sim.tori.torso.collider(0);
    for (const { collider } of piece.links) {
      expect(run.sim.world.intersectionPair(collider, torso) || collider.contactCollider(torso, 0) !== null).toBe(false);
    }
  });

  it('Q를 1초 누르면 자르고, 그보다 짧게 누르면 자르지 않는다', () => {
    const run = new Run('A').seconds(0.5);
    run.holdQ(0.8);
    expect(run.links).toBe(FULL_LINKS);
    run.holdQ(1.05);
    expect(run.links).toBe(FULL_LINKS - linksPerSection);
  });

  it('Q를 계속 누르고 있어도 한 번만 자른다', () => {
    const run = new Run('A').seconds(0.5);
    run.input.held.cutTail = true;
    run.seconds(5);
    expect(run.sim.state.rewinds).toBe(1);
    expect(run.links).toBe(FULL_LINKS - linksPerSection);
  });

  it('남은 구간이 0이면 자르기 계기가 와도 잘리지 않는다', () => {
    const run = new Run('B', FLAT, { sectionsLeft: 0 }).seconds(0.5);
    expect(run.links).toBe(baseLinks);
    expect(run.sim.cutTail()).toBe(false);
    run.holdQ(1.5).seconds(2.5);
    expect(run.links).toBe(baseLinks);
    expect(run.sim.severed).toEqual([]);
    expect(run.sim.state.rewinds).toBe(0);
  });
});

describe('회귀', () => {
  it('기록관에게 말을 건 적이 없으면 처음 자리로 돌아오고, 꼬리가 짧아진 채로 선다', () => {
    const run = new Run('B').seconds(0.5);
    run.input.moveX = 1;
    run.seconds(2);
    run.input.moveX = 0;
    expect(run.x).toBeGreaterThan(33);
    run.sim.cutTail();
    run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
    expect(run.sim.state.sectionsLeft).toBe(sections - 1);
    expect(run.sim.state.rewinds).toBe(1);
    expect(Math.abs(run.x - FLAT.spawn.x)).toBeLessThan(0.3);
    expect(run.links).toBe(FULL_LINKS - linksPerSection);
    expect(run.sim.dialogue).toBeNull();
  });

  it('세 번 자른 뒤에는 더 잘리지 않는다', () => {
    const run = new Run('A').seconds(0.5);
    for (let i = 0; i < sections; i += 1) {
      expect(run.sim.cutTail()).toBe(true);
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
    }
    expect(run.links).toBe(baseLinks);
    expect(run.sim.cutTail()).toBe(false);
    expect(run.sim.state).toMatchObject({ sectionsLeft: 0, rewinds: sections });
  });

  it('회귀 횟수 범위를 벗어난 것은 방을 다시 만들 때 생기지 않는다', () => {
    const always = box(25, -0.25, 0.5, 0);
    const firstOnly = { ...box(27, -0.25, 0.5, 0), maxRewinds: 0 };
    const afterOne = { ...box(33, -0.25, 0.5, 0), minRewinds: 1 };
    const betweenTwo = { ...box(35, -0.25, 0.5, 0), minRewinds: 2, maxRewinds: 2 };
    const run = new Run('A', { ...FLAT, boxes: [always, firstOnly, afterOne, betweenTwo] }).seconds(0.2);
    const present = (): number[] => run.sim.objects.map(({ data }) => data.x);
    expect(present()).toEqual([25, 27]);
    for (const expected of [
      [25, 33],
      [25, 33, 35],
      [25, 33],
    ]) {
      run.sim.cutTail();
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
      expect(present()).toEqual(expected);
    }
  });

  it('처음부터 하면 꼬리와 상태와 체크포인트가 모두 새 판으로 돌아간다', () => {
    const run = new Run('A', roomByNumber(3)).seconds(0.5);
    run.input.moveX = 1;
    run.seconds(2.5).pressE();
    run.sim.cutTail();
    run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
    expect(run.sim.state.talkedTo).toEqual(['duel-1']);
    run.sim.reset();
    expect(run.links).toBe(FULL_LINKS);
    expect(run.sim.state).toMatchObject({ sectionsLeft: sections, rewinds: 0, recorder: null, talkedTo: [] });
    expect(run.sim.checkpoint.timeline.recorder).toBeNull();
    expect(run.sim.recorders[0].doorClosed).toBe(true);
  });
});

describe('방 3과 기록관', () => {
  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식: 말을 걸어 문을 열고, Q로 자르면 기록관 앞으로 돌아와 같은 대사를 다시 듣는다`, () => {
      const data = roomByNumber(3);
      const [recorder] = data.recorders;
      const run = new Run(scheme, data).seconds(0.5);

      // 말을 걸기 전에는 문에 막힌다
      run.input.moveX = 1;
      run.seconds(4);
      expect(run.x).toBeLessThan(recorder.door!.x - 0.6);
      expect(run.sim.nearRecorder?.id).toBe('duel-1');

      run.input.moveX = 0;
      run.pressE();
      const line = run.sim.dialogue;
      expect(line).toMatchObject({ recorder: 'duel-1', speaker: '기록관', text: '기록관 대사 1' });
      expect(run.sim.recorders[0].doorClosed).toBe(false);
      expect(run.sim.checkpoint.timeline).toMatchObject({ room: 3, recorder: 'duel-1', talkedTo: ['duel-1'] });

      // 대화 중에는 움직이지 않는다
      const before = run.x;
      run.input.moveX = 1;
      run.seconds(1);
      expect(Math.abs(run.x - before)).toBeLessThan(0.1);
      run.pressE();
      expect(run.sim.dialogue).toBeNull();
      run.seconds(3);
      expect(run.x).toBeGreaterThan(recorder.door!.x + 3);
      run.input.moveX = 0;

      run.holdQ(DEFAULTS.cut.holdSeconds + 0.05);
      expect(run.sim.rewinding).toBe(true);
      expect(run.sim.severed.length).toBe(1);
      run.seconds(DEFAULTS.cut.rewindSeconds);
      expect(run.sim.rewinding).toBe(false);
      expect(run.sim.dialogue).toEqual(line);
      expect(distance(run.sim.tori.torso.translation(), recorder.stand)).toBeLessThan(0.3);
      expect(run.sim.state).toMatchObject({ room: 3, sectionsLeft: sections - 1, rewinds: 1, recorder: 'duel-1' });
      expect(run.links).toBe(FULL_LINKS - linksPerSection);
      expect(run.sim.recorders[0].doorClosed).toBe(false);

      // 대사를 닫으면 짧아진 꼬리로 다시 걷는다
      run.pressE();
      run.input.moveX = 1;
      run.seconds(2);
      expect(run.x).toBeGreaterThan(recorder.door!.x + 1);
    }, 60_000);
  }

  it('다른 방에서 잘라도 마지막으로 말을 건 기록관의 방으로 돌아간다', () => {
    const run = new Run('A', roomByNumber(3)).seconds(0.5);
    run.input.moveX = 1;
    run.seconds(2.5);
    run.input.moveX = 0;
    run.pressE().pressE();
    run.sim.enterRoom(roomByNumber(2));
    expect(run.sim.state.room).toBe(2);
    run.seconds(0.5);
    run.sim.cutTail();
    run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
    expect(run.sim.roomData.number).toBe(3);
    expect(run.sim.state.room).toBe(3);
    expect(run.sim.dialogue?.recorder).toBe('duel-1');
  });
});

describe('능력표', () => {
  it('남은 구간 수의 줄을 읽고, 없는 줄은 가장 가까운 줄을 쓴다', () => {
    expect(Object.keys(ABILITIES).sort()).toEqual(['0', '1', '2', '3']);
    expect(abilitiesFor(2)).toEqual(ABILITIES['2']);
    expect(abilitiesFor(5)).toEqual(ABILITIES['3']);
    expect(abilitiesFor(-1)).toEqual(ABILITIES['0']);
  });

  it('남은 구간이 바뀌면 그 줄의 잡기와 직립 세기를 반영한다', () => {
    const row = ABILITIES['2'];
    const saved = { ...row };
    try {
      Object.assign(row, { canGrab: false, balance: 0.5 });
      const run = new Run('A').seconds(0.2);
      expect(run.sim.tori).toMatchObject({ canGrab: true, balance: 1 });
      run.sim.cutTail();
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
      expect(run.sim.tori).toMatchObject({ canGrab: false, balance: 0.5 });
    } finally {
      Object.assign(row, saved);
    }
  });
});
