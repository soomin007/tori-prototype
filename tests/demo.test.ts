import { beforeAll, describe, expect, it } from 'vitest';
import { surveyLink } from '../src/config/demo';
import { cloneConfig, DEFAULTS, FIXED_DT } from '../src/config/defaults';
import type { Scheme } from '../src/config/presets';
import { DEFAULT_ROOM, parseShare } from '../src/config/share';
import { initPhysics } from '../src/physics/world';
import { roomByNumber } from '../src/rooms/rooms';
import type { Point, RoomData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import type { GameState } from '../src/state/gameState';

beforeAll(() => initPhysics());

/** 방 4(등록장 길). 바닥 윗면이 y = 6이다. */
const GI = roomByNumber(4);
const FLOOR_Y = 6;
const LEDGE = { left: 16.5, right: 20.5, top: FLOOR_Y - 1.8 };
const at = (x: number): Point => ({ x, y: FLOOR_Y - 0.5 });

class Walker {
  readonly sim: Simulation;
  readonly input: InputState = createInputState();

  constructor(scheme: Scheme, roomData: RoomData = GI, initial: Partial<GameState> = {}) {
    this.sim = new Simulation(cloneConfig(DEFAULTS), roomData, scheme, initial);
  }

  seconds(seconds: number, each?: (time: number) => void): this {
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) {
      each?.(i * FIXED_DT);
      this.sim.step(this.input);
    }
    return this;
  }

  get center(): Point {
    return this.sim.tori.torso.translation();
  }

  get junk() {
    const junk = this.sim.objects.find(({ data }) => data.look === 'junk');
    if (!junk) throw new Error('폐품이 없다');
    return junk.body.translation();
  }
}

describe('체험판의 첫 방(등록장 길)', () => {
  it('주소에 방이 없으면 등록장 길에서 시작한다', () => {
    expect(DEFAULT_ROOM).toBe(4);
    expect(parseShare('').room).toBe(4);
    expect(GI.recorders[0].door).not.toBeNull();
  });

  it('열매는 토리가 다가가기 전에는 매달려 있고, 지나가면 차례로 떨어진다', () => {
    const run = new Walker('B');
    const fruits = run.sim.objects.filter(({ data }) => data.look === 'fruit');
    expect(fruits.length).toBe(3);
    const start = fruits.map(({ body }) => body.translation().y);
    run.seconds(1);
    expect(fruits.map(({ body }) => body.translation().y)).toEqual(start);
    const untilX = fruits[0].data.hang?.untilX as number;
    run.input.moveX = 1;
    let firstFell: number | null = null;
    run.seconds(3, (time) => {
      if (firstFell === null && run.center.x > untilX) firstFell = time;
    });
    expect(firstFell).not.toBeNull();
    // 떨어진 열매는 바닥이나 토리의 등과 꼬리 위에 얹힌다
    fruits.forEach(({ body }, i) => {
      expect(body.isDynamic(), `열매 ${i + 1}`).toBe(true);
      expect(body.translation().y, `열매 ${i + 1}`).toBeGreaterThan(start[i] + 0.3);
    });
  });

  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식: 턱은 뛰어서 오르지 못하고, 폐품을 밀어 턱 앞에 놓고 디디면 오른다`, () => {
      // 폐품이 없는 방에서는 턱 앞에서 아무리 뛰어도 오르지 못한다
      const bare: RoomData = { ...GI, boxes: [], spawn: at(14.5) };
      const blocked = new Walker(scheme, bare);
      blocked.input.moveX = 1;
      let highest = Infinity;
      blocked.seconds(4, (time) => {
        blocked.input.pressed.jump = time % 0.8 < FIXED_DT;
        highest = Math.min(highest, blocked.center.y);
      });
      expect(blocked.center.x).toBeLessThan(LEDGE.left);

      // 폐품 왼쪽에서 걸어가면 몸으로 밀어 턱 앞에 붙이고, 두 번 뛰어 오른다
      const run = new Walker(scheme, { ...GI, spawn: at(11.8) });
      run.input.moveX = 1;
      run.seconds(2.5);
      expect(run.junk.x).toBeGreaterThan(LEDGE.left - 0.6);
      // 오른 뒤에도 계속 걸어 턱 반대편으로 내려가므로, 턱 위에 선 적이 있는지를 본다
      let climbed = false;
      let junkTop = run.junk.y;
      run.seconds(3, (time) => {
        run.input.pressed.jump = time % 1 < FIXED_DT;
        climbed ||= run.center.x > LEDGE.left + 0.3 && run.center.x < LEDGE.right && run.center.y < LEDGE.top;
        junkTop = Math.min(junkTop, run.junk.y);
      });
      expect(climbed).toBe(true);
      // 폐품 옆에서 뛰어도 폐품은 튕겨 오르지 않고 턱 밑에 남는다(known-issues 24번)
      expect(junkTop).toBeGreaterThan(FLOOR_Y - 1);
      expect(run.junk.x).toBeLessThan(LEDGE.left);
    });
  }

  it('B 방식: K를 누르고 걸으면 꼬리로 폐품을 끌고 간다', () => {
    const run = new Walker('B', { ...GI, spawn: at(14.6) });
    run.seconds(0.5);
    const before = run.junk.x;
    run.input.held.grab = true;
    run.input.pressed.grab = true;
    run.seconds(0.8);
    run.input.moveX = 1;
    run.seconds(1);
    run.input.moveX = 0;
    run.input.held.grab = false;
    run.seconds(1);
    expect(run.junk.x - before).toBeGreaterThan(0.5);
  });

  it('A 방식: 커서로 폐품을 가리키고 누른 채 걸으면 꼬리로 끌고 간다', () => {
    const run = new Walker('A', { ...GI, spawn: at(14.6) });
    run.seconds(0.3);
    const before = run.junk.x;
    run.input.pointerActive = true;
    run.input.pointer = { x: before, y: run.junk.y };
    run.seconds(0.8);
    run.input.held.pointerGrab = true;
    run.input.pressed.pointerGrab = true;
    run.seconds(0.3);
    run.input.moveX = 1;
    run.seconds(1, () => {
      run.input.pointer = { x: run.center.x - 1, y: run.center.y };
    });
    run.input.moveX = 0;
    run.input.held.pointerGrab = false;
    run.seconds(1);
    expect(run.junk.x - before).toBeGreaterThan(0.5);
  });

  it('친구 NPC 자리는 회귀 횟수 범위를 벗어나면 생기지 않는다', () => {
    const [first, second] = GI.npcs;
    const roomData: RoomData = { ...GI, npcs: [{ ...first, maxRewinds: 0 }, second] };
    expect(new Simulation(cloneConfig(DEFAULTS), roomData, 'B').npcs.length).toBe(2);
    expect(new Simulation(cloneConfig(DEFAULTS), roomData, 'B', { rewinds: 1 }).npcs.map(({ id }) => id)).toEqual([second.id]);
  });

  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식: 기록관에게 말을 걸고 결투 1에 들어가면 구조물에 깔리고, 버둥거리면 기록관 앞으로 돌아와 다시 할 수 있다`, () => {
      const [recorder] = GI.recorders;
      const run = new Walker(scheme, { ...GI, spawn: recorder.stand });
      const talk = (): void => {
        run.input.pressed.interact = true;
        run.seconds(FIXED_DT);
      };
      talk();
      talk();
      run.input.moveX = 1;
      run.seconds(3);
      run.input.moveX = 0;
      const [duel] = run.sim.duels;
      expect(duel.phase).not.toBe('waiting');
      for (let i = 0; i < 20 * 60 && !duel.pinned; i += 1) run.seconds(FIXED_DT);
      expect(duel.pinned).toBe(true);
      run.seconds(2.5, (time) => {
        run.input.moveX = Math.floor(time / 0.1) % 2 === 0 ? 1 : -1;
      });
      run.input.moveX = 0;
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.2);
      expect(run.sim.state).toMatchObject({ rewinds: 1, sectionsLeft: 2, recorder: recorder.id });
      expect(Math.abs(run.center.x - recorder.stand.x)).toBeLessThan(0.5);
      expect(run.sim.dialogue?.recorder).toBe(recorder.id);
      // 문은 열린 채로 남아 있어 대사를 닫고 바로 다시 들어갈 수 있다
      talk();
      run.input.moveX = 1;
      run.seconds(3);
      expect(run.sim.duels[0].phase).not.toBe('waiting');
      expect(run.sim.scripted[0].first).toBe(false);
    });
  }

  it('결투 1을 이기면 "체험판 끝"이다', () => {
    const arena = GI.duels[0];
    const run = new Walker('B', { ...GI, spawn: at(arena.startX + 0.5) }, { rewinds: 1, sectionsLeft: 2 });
    run.seconds(DEFAULTS.duel.startSeconds + 0.2);
    const [duel] = run.sim.duels;
    expect(duel.phase).toBe('fighting');
    expect(run.sim.demoOver).toBe(false);
    duel.opponent.hurt(1000, 0, run.center.x);
    run.seconds(FIXED_DT * 2);
    expect(duel.phase).toBe('won');
    expect(run.sim.demoOver).toBe(true);
  });
});

describe('체험판 끝 화면의 설문 링크', () => {
  it('주소가 비었거나 http, https가 아니면 단추를 숨긴다', () => {
    expect(surveyLink('')).toBeNull();
    expect(surveyLink('   ')).toBeNull();
    expect(surveyLink('javascript:alert(1)')).toBeNull();
    expect(surveyLink('설문')).toBeNull();
  });

  it('누르기 전에 보여 줄 짧은 주소는 호스트와 경로다', () => {
    expect(surveyLink('https://forms.example.test/survey/1?from=demo')).toEqual({
      href: 'https://forms.example.test/survey/1?from=demo',
      shown: 'forms.example.test/survey/1',
    });
  });
});
