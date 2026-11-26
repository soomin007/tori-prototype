import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, DEG, FIXED_DT, setParam } from '../src/config/defaults';
import type { ParamValue } from '../src/config/defaults';
import { readOpponent } from '../src/config/opponents';
import type { Scheme } from '../src/config/presets';
import { initPhysics } from '../src/physics/world';
import type { DuelData, Point, RecorderData, RoomData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import type { FoePhase } from '../src/sim/opponent';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/simulation';
import type { GameState } from '../src/state/gameState';
import { ground, room } from './testRooms';

beforeAll(() => initPhysics());

const { baseLinks } = DEFAULTS.tail;
const TORSO_HALF = DEFAULTS.torso.length / 2;
const FOE_HALF = DEFAULTS.foe1.width / 2;
/** 쓰러진 뒤 탈락할 때까지 */
const COUNT_SECONDS = DEFAULTS.duel.countTo * DEFAULTS.duel.countSeconds;

/** 결투 시험 방의 기록관. 말을 걸면 회귀 지점이 된다. */
const RECORDER: RecorderData = {
  id: 'test-recorder',
  x: 3,
  y: 0,
  stand: { x: 1.9, y: -0.5 },
  line: '기록관 대사 1',
  number: '번호 1',
  time: '시각 1',
  door: null,
};

interface DuelRoomOptions {
  opponentX?: number;
  startX?: number;
  spawnX?: number;
}

/** 결투 시험 방. 바닥 윗면이 y = 0이다. 기록관(x 3) 오른쪽의 결투장(x 8~30)에 들어서면(x 11) 결투가 시작된다. */
function duelRoom({ opponentX = 14, startX = 11, spawnX = RECORDER.stand.x }: DuelRoomOptions = {}): RoomData {
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
  return { ...room([ground(0, 40)], [], [], [RECORDER], [duel]), spawn: { x: spawnX, y: -0.5 } };
}

/** 토리가 결투장 안(x 12)에서 시작하고 상대가 몸 앞 face(m)에 서 있는 방. 결투는 첫 스텝에 시작된다. */
function faceToFace(face: number): RoomData {
  return duelRoom({ spawnX: 12, opponentX: 12 + face + FOE_HALF });
}

/** 상대가 거리를 재기만 하고 공격하지 않게 하는 설정. 튜닝 패널의 범위(3초)를 넘지만 테스트에서는 그대로 쓴다. */
const PASSIVE = { 'foe1.measureMinSeconds': 20, 'foe1.measureMaxSeconds': 20 };

class Duelist {
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

describe('꼬리 타격 피해', () => {
  it('B 방식: 기준 속도를 넘은 꼬리 마디가 상대에 닿으면 상대의 체력이 준다', () => {
    const run = new Duelist('B', faceToFace(0.8), PASSIVE).seconds(1.5);
    expect(run.duel.phase).toBe('fighting');
    const before = run.foe.health;
    run.input.pressed.attack = true;
    run.seconds(0.6);
    expect(run.foe.health).toBeLessThan(before);
    const strike = run.sim.strikes.recent.at(-1);
    expect(strike?.damage).toBeGreaterThan(0);
    expect(strike?.speed).toBeGreaterThanOrEqual(DEFAULTS.hit.minSpeed);
  });

  it('A 방식: 커서를 뒤에서 머리 위를 넘어 앞으로 휘두르면 상대의 체력이 준다', () => {
    const run = new Duelist('A', faceToFace(0.8), PASSIVE).point(-1.3, -0.3).seconds(1.5);
    const before = run.foe.health;
    run.point(1, -0.6).seconds(0.8);
    expect(run.foe.health).toBeLessThan(before);
  });

  it('기준 속도보다 느리게 닿으면 체력이 줄지 않는다', () => {
    // 싸움이 시작되기 전(1초)에 꼬리를 머리 위로 올려 두고, 3초에 걸쳐 상대의 몸 쪽으로 천천히 내린다
    const run = new Duelist('A', faceToFace(0.8), PASSIVE).point(0.2, -1.4).seconds(1.5);
    const before = run.foe.health;
    let touched = false;
    run.seconds(3, (time) => {
      const t = Math.min(1, time / 3);
      run.point(0.2 + t, -1.4 + 1.5 * t);
      const { collider } = run.foe;
      touched ||= run.sim.tori.tail.links.some((link) => collider.intersectsShape(link.collider.shape, link.collider.translation(), link.collider.rotation()));
    });
    expect(touched).toBe(true);
    expect(run.foe.health).toBe(before);
  });

  it('피해는 마디 속도에 비례하고 능력표의 whipPower를 곱한다', () => {
    const damage = (whipPower: number): { damage: number; speed: number } => {
      const run = new Duelist('B', faceToFace(0.8), { ...PASSIVE, 'duel.maxDamage': 100 }).seconds(1.5);
      run.sim.abilities.whipPower = whipPower;
      run.input.pressed.attack = true;
      run.seconds(0.6);
      const strike = run.sim.strikes.recent.find(({ damage: dealt }) => dealt > 0);
      return { damage: strike?.damage ?? 0, speed: strike?.speed ?? 0 };
    };
    const once = damage(1);
    expect(once.damage).toBeCloseTo(once.speed * DEFAULTS.duel.damagePerSpeed, 5);
    expect(damage(2).damage).toBeCloseTo(once.damage * 2, 5);
  });
});

describe('쓰러짐, 심판 카운트, 버둥거림', () => {
  /** 기록관에게 말을 건 뒤 결투장으로 걸어가 한 번 맞고 쓰러진다(토리 체력 1) */
  function knockedDown(scheme: Scheme, initial: Partial<GameState> = {}): Duelist {
    const run = new Duelist(scheme, duelRoom(), { 'duel.toriHealth': 1 }, initial);
    run.pressE().pressE();
    run.input.moveX = 1;
    run.until(() => run.duel.phase !== 'waiting', 6);
    run.input.moveX = 0;
    run.until(() => run.duel.phase === 'downed', 15);
    expect(run.duel.phase).toBe('downed');
    expect(run.sim.tori.downed).toBe(true);
    return run;
  }

  /** 좌우 이동 키를 0.1초마다 번갈아 누른다 */
  const alternateKeys = (run: Duelist) => (time: number) => {
    run.input.moveX = Math.floor(time / 0.1) % 2 === 0 ? 1 : -1;
  };

  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식: 버둥거림 게이지가 차면 꼬리가 끊기고 마지막 기록관 앞으로 회귀한다`, () => {
      const run = knockedDown(scheme);
      run.seconds(1, alternateKeys(run));
      expect(run.duel.gauge.value).toBeGreaterThan(0.5);
      run.seconds(1, alternateKeys(run));
      expect(run.sim.rewinding).toBe(true);
      expect(run.events).toContain('cut');
      expect(run.sim.tori.tail.links.length).toBe(baseLinks + 2 * DEFAULTS.tail.linksPerSection);
      run.input.moveX = 0;
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
      expect(run.events).toContain('rewind');
      expect(run.sim.state).toMatchObject({ rewinds: 1, sectionsLeft: 2 });
      expect(Math.abs(run.center.x - RECORDER.stand.x)).toBeLessThan(0.5);
      expect(run.sim.dialogue?.text).toBe(RECORDER.line);
      expect(run.sim.tori.downed).toBe(false);
      expect(run.duel.phase).toBe('waiting');
      expect(run.foe.health).toBe(run.foe.maxHealth);
    });
  }

  it('마우스를 흔들어도 게이지가 차서 회귀한다', () => {
    const run = knockedDown('A');
    run.seconds(4, (time) => {
      const side = Math.floor(time / 0.1) % 2 === 0 ? 1 : -1;
      run.input.mouseMotion = { x: side * 0.05, y: 0 };
    });
    expect(run.sim.state.rewinds).toBe(1);
  });

  it('가만히 있으면 1부터 10까지 센 뒤 탈락하고, 상대는 공격을 멈추고 물러난다', () => {
    const run = knockedDown('B');
    const counts: number[] = [];
    const phases = new Set<FoePhase>();
    // 쓰러뜨린 스텝 바로 뒤부터 센다. 그 스텝에서 상대는 아직 공격 단계다.
    run.seconds(FIXED_DT);
    run.seconds(COUNT_SECONDS + 0.5, () => {
      const { count } = run.duel;
      if (count !== null && count !== counts.at(-1)) counts.push(count);
      phases.add(run.foe.phase);
    });
    expect(counts).toEqual(Array.from({ length: DEFAULTS.duel.countTo }, (_, i) => i + 1));
    expect(run.duel.phase).toBe('lost');
    expect(run.sim.eliminated).toBe(true);
    expect(run.events).toContain('lost');
    expect(run.sim.state).toMatchObject({ rewinds: 0, sectionsLeft: 3 });
    expect([...phases].filter((phase) => phase === 'windup' || phase === 'attack')).toEqual([]);
    expect(run.foe.gapTo(run.center.x, TORSO_HALF)).toBeGreaterThan(2);
  });

  it('남은 구간이 0이면 버둥거려도 게이지가 차지 않아 자르지 못하고 탈락한다', () => {
    const run = knockedDown('B', { sectionsLeft: 0 });
    let fullest = 0;
    run.seconds(COUNT_SECONDS + 0.5, (time) => {
      alternateKeys(run)(time);
      fullest = Math.max(fullest, run.duel.gauge.value);
    });
    expect(fullest).toBe(0);
    expect(run.duel.gauge.count).toBeGreaterThan(50);
    expect(run.sim.eliminated).toBe(true);
    expect(run.sim.state).toMatchObject({ rewinds: 0, sectionsLeft: 0 });
    expect(run.sim.tori.tail.links.length).toBe(baseLinks);
    expect(run.events).not.toContain('cut');
  });
});

describe('결투 1 상대', () => {
  it('예고 시간이 0인 공격은 데이터를 읽을 때 오류다', () => {
    const config = cloneConfig(DEFAULTS);
    config.foe1Shove.windupSeconds = 0;
    expect(() => readOpponent(config, 'opponent-1')).toThrow();
    expect(() => new Simulation(config, duelRoom(), 'B')).toThrow();
  });

  /** 2초마다 다가가며 치기, 제자리에서 치기, 물러나기, 뛰기를 돌린다 */
  function spar(run: Duelist, scheme: Scheme, time: number): void {
    const beat = Math.floor(time / 2) % 4;
    const toward = Math.sign(run.foe.x - run.center.x) || 1;
    run.input.moveX = beat === 0 ? toward : beat === 2 ? -toward : 0;
    run.input.pressed.jump = beat === 3 && time % 2 < FIXED_DT;
    if (scheme === 'B') run.input.pressed.attack = time % 0.5 < FIXED_DT;
    else run.point(Math.sin(time * 6) * 1.3 * toward, -0.4);
  }

  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식으로 다가가 치고 물러나고 뛰어도, 상대는 예고 동작 없이 공격하지 않는다`, () => {
      // 둘 다 쓰러지지 않게 체력을 크게 두고, 결투장 안에서 시작한다
      const run = new Duelist(scheme, duelRoom({ spawnX: 12 }), { 'duel.toriHealth': 10000, 'foe1.maxHealth': 10000 });
      const steps: { phase: FoePhase; attack: string | null; elapsed: number }[] = [];
      let hurt = 0;
      run.seconds(40, (time) => {
        spar(run, scheme, time);
        steps.push({ phase: run.foe.phase, attack: run.foe.attack?.group ?? null, elapsed: run.foe.elapsed });
        // 앞 스텝에서 토리가 맞았으면 그때 상대는 공격 단계였다
        if (run.events.includes('tori-hurt')) {
          hurt += 1;
          expect(run.foe.phase).toBe('attack');
        }
        run.events.length = 0;
      });
      // 기록은 스텝을 돌리기 전, 곧 앞 스텝이 끝난 상태다. 공격 단계에 들어온 스텝 바로 앞은 같은 공격의 예고여야 한다.
      let attacks = 0;
      for (let i = 1; i < steps.length; i += 1) {
        const [before, now] = [steps[i - 1], steps[i]];
        if (now.phase !== 'attack' || before.phase === 'attack') continue;
        attacks += 1;
        expect(before.phase).toBe('windup');
        expect(before.attack).toBe(now.attack);
        const windup = DEFAULTS[now.attack as 'foe1Dash' | 'foe1Shove'].windupSeconds;
        expect(before.elapsed + FIXED_DT + 1e-9).toBeGreaterThanOrEqual(windup);
      }
      expect(attacks).toBeGreaterThan(10);
      expect(hurt).toBeGreaterThan(5);
    });
  }

  it('맞은 토리는 상대 반대쪽으로 밀려나고 잠깐 이동과 꼬리 입력이 먹지 않는다', () => {
    const run = new Duelist('B', duelRoom({ spawnX: 12 }), { 'duel.toriHealth': 10000 });
    run.until(() => run.events.includes('tori-hurt'), 20);
    expect(run.events).toContain('tori-hurt');
    expect(run.duel.toriHealth).toBeLessThan(run.duel.toriMaxHealth);
    const away = Math.sign(run.center.x - run.foe.x);
    expect(run.sim.tori.torso.linvel().x * away).toBeGreaterThan(2);
    expect(run.duel.stagger).toBeGreaterThan(0);
    expect(run.duel.invulnerable).toBeGreaterThan(run.duel.stagger);
    // 경직 동안 반대로 가는 키를 눌러도 계속 밀려난다
    run.input.moveX = -away;
    run.seconds(DEFAULTS.duel.hurtStaggerSeconds - FIXED_DT);
    expect(run.sim.tori.torso.linvel().x * away).toBeGreaterThan(0);
  });
});

describe('B 방식 휘두르기', () => {
  /** 넓은 평지에서 휘두른다. 몸 앞(몸통 앞 끝부터, 바닥에서 상대의 키까지)에 기준 속도를 넘은 마디가 처음 들어온 시각과 그동안의 최대 기울기 */
  function swing(sectionsLeft: number, facing: 1 | -1): { front: number | null; tilt: number } {
    const run = new Duelist('B', { ...room([ground(0, 60)]), spawn: { x: 30, y: -0.5 } }, {}, { sectionsLeft });
    if (facing === -1) {
      run.input.moveX = -1;
      run.seconds(FIXED_DT);
      run.input.moveX = 0;
    }
    run.seconds(2);
    run.input.pressed.attack = true;
    let front: number | null = null;
    let tilt = 0;
    run.seconds(0.9, (time) => {
      const center = run.center;
      tilt = Math.max(tilt, Math.abs(run.sim.tori.torso.rotation()) / DEG);
      for (const { body } of run.sim.tori.tail.links) {
        const { x, y } = body.translation();
        const { x: vx, y: vy } = body.linvel();
        const ahead = (x - center.x) * facing;
        const fast = Math.hypot(vx, vy) >= DEFAULTS.hit.minSpeed;
        if (front === null && fast && ahead >= TORSO_HALF && y <= 0 && y >= -DEFAULTS.foe1.height) front = time;
      }
    });
    return { front, tilt };
  }

  for (const sectionsLeft of [3, 2]) {
    it(`남은 구간 ${sectionsLeft}: 키를 누른 뒤 0.3초 안에 몸 앞을 친다`, () => {
      for (const facing of [1, -1] as const) {
        const { front } = swing(sectionsLeft, facing);
        expect(front, `${facing}`).not.toBeNull();
        expect(front as number, `${facing}`).toBeLessThanOrEqual(0.3 + 1e-9);
      }
    });
  }

  for (const sectionsLeft of [3, 2, 1, 0]) {
    it(`남은 구간 ${sectionsLeft}: 휘두르는 동안 몸통 기울기가 M2에서 잰 값(최대 34도)보다 커지지 않는다`, () => {
      for (const facing of [1, -1] as const) expect(swing(sectionsLeft, facing).tilt, `${facing}`).toBeLessThan(34);
    });
  }

  it('남은 구간 3: 몸 앞 0.8m의 상대를 0.3초 안에 맞히고, 상대가 바짝 붙어 있어도 몸이 고꾸라지지 않는다', () => {
    const hitTime = (face: number): { at: number | null; tilt: number } => {
      const run = new Duelist('B', faceToFace(face), PASSIVE).seconds(1.5);
      const before = run.foe.health;
      let at: number | null = null;
      let tilt = 0;
      run.input.pressed.attack = true;
      run.seconds(0.8, (time) => {
        tilt = Math.max(tilt, Math.abs(run.sim.tori.torso.rotation()) / DEG);
        if (at === null && run.foe.health < before) at = time;
      });
      return { at, tilt };
    };
    const far = hitTime(0.8);
    expect(far.at).not.toBeNull();
    expect(far.at as number).toBeLessThanOrEqual(0.3 + 1e-9);
    for (const face of [0.6, 0.7]) expect(hitTime(face).tilt, `${face}`).toBeLessThan(45);
  });
});
