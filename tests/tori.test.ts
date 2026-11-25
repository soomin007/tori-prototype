import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, FIXED_DT, PARAM_META, setParam } from '../src/config/defaults';
import type { GameConfig } from '../src/config/defaults';
import { initPhysics } from '../src/physics/world';
import { roomByNumber } from '../src/rooms/rooms';
import type { RoomData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import { ground, room } from './testRooms';

beforeAll(() => initPhysics());

const FLAT = room([ground(0, 60)]);
const STAND_Y = -(DEFAULTS.float.clearance + DEFAULTS.torso.thickness / 2);
const toDeg = (radians: number): number => Math.abs((radians * 180) / Math.PI);

/** 시뮬레이션과 입력을 묶어, 몇 초 동안 돌리며 가장 크게 기운 각도와 가장 높은 자리를 잰다 */
class Run {
  readonly sim: Simulation;
  readonly input: InputState = createInputState();
  maxTilt = 0;
  minY = Infinity;

  constructor(roomData: RoomData, config: GameConfig = cloneConfig(DEFAULTS)) {
    this.sim = new Simulation(config, roomData);
    this.seconds(1);
    this.clear();
  }

  seconds(seconds: number, moveX = 0): this {
    this.input.moveX = moveX;
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) {
      this.sim.step(this.input);
      this.maxTilt = Math.max(this.maxTilt, toDeg(this.sim.tori.torso.rotation()));
      this.minY = Math.min(this.minY, this.y);
    }
    return this;
  }

  pressJump(): this {
    this.input.pressed.jump = true;
    return this;
  }

  clear(): void {
    this.maxTilt = 0;
    this.minY = Infinity;
  }

  get x(): number {
    return this.sim.tori.torso.translation().x;
  }

  get y(): number {
    return this.sim.tori.torso.translation().y;
  }

  get vx(): number {
    return this.sim.tori.torso.linvel().x;
  }
}

describe('토리 몸', () => {
  it('가만히 있으면 몸통 아랫면이 정해진 높이에 뜨고 수평으로 선다', () => {
    const run = new Run(FLAT).seconds(2);
    // 꼬리 무게로 조금 기울어 있어 2cm까지 봐준다
    expect(Math.abs(run.y - STAND_Y)).toBeLessThan(0.02);
    expect(run.x).toBeCloseTo(2, 1);
    expect(run.maxTilt).toBeLessThan(3);
    // 레이캐스트가 자기 몸을 맞았다면 거리가 0에 가깝다
    for (const { from, to, hit } of run.sim.tori.probeLines) {
      expect(hit).toBe(true);
      expect(to.y - from.y).toBeGreaterThan(DEFAULTS.torso.thickness / 2);
      expect(to.y).toBeCloseTo(0, 2);
    }
  });

  it('평지에서 3초 걸어도 몸통 기울기가 45도 미만이다', () => {
    for (const direction of [1, -1]) {
      const run = new Run({ ...FLAT, spawn: { x: 30, y: -0.5 } }).seconds(3, direction);
      expect((run.x - 30) * direction).toBeGreaterThan(9);
      expect(run.maxTilt).toBeLessThan(45);
    }
  });

  it('높이 0.2m 턱을 넘는다', () => {
    const run = new Run(room([ground(0, 6), ground(6, 60, 0.2)])).seconds(3, 1);
    expect(run.x).toBeGreaterThan(9);
    expect(run.maxTilt).toBeLessThan(45);
    run.seconds(1.5);
    expect(Math.abs(run.y - (STAND_Y - 0.2))).toBeLessThan(0.02);
  });

  it('가속과 감속 값을 따로 따른다', () => {
    const { accel, decel, maxSpeed } = DEFAULTS.move;
    const run = new Run(FLAT).seconds(0.2, 1);
    expect(run.vx).toBeCloseTo(accel * 0.2, 0);
    run.seconds(2, 1);
    expect(run.vx).toBeCloseTo(maxSpeed, 1);
    const stopFrom = run.x;
    run.seconds(2);
    expect(Math.abs(run.vx)).toBeLessThan(0.05);
    expect(run.x - stopFrom).toBeCloseTo(maxSpeed ** 2 / (2 * decel), 0);
  });

  it('미끄러운 바닥에서는 더 오래 미끄러진다', () => {
    const slide = (surface: 'normal' | 'slippery'): number => {
      const run = new Run(room([ground(0, 8), ground(8, 60, 0, 0, surface)])).seconds(2.5, 1);
      const from = run.x;
      run.seconds(4);
      return run.x - from;
    };
    expect(slide('slippery')).toBeGreaterThan(slide('normal') * 3);
  });

  it('돌아서면 머리가 반대쪽으로 넘어간다', () => {
    const run = new Run({ ...FLAT, spawn: { x: 30, y: -0.5 } });
    const headSide = (): number => run.sim.tori.head.translation().x - run.x;
    expect(headSide()).toBeGreaterThan(0.4);
    run.seconds(1, -1).seconds(1);
    expect(headSide()).toBeLessThan(-0.4);
    expect(run.maxTilt).toBeLessThan(45);
  });
});

describe('점프', () => {
  /** 1m 높이 발판에서 오른쪽으로 걸어 나간다 */
  const LEDGE = { ...room([ground(0, 6, 1), ground(6, 60)]), spawn: { x: 4, y: -1.5 } };

  it('뛰면 정해진 높이만큼 올라갔다가 45도 넘게 기울지 않고 선다', () => {
    const { speed } = DEFAULTS.jump;
    const run = new Run(FLAT).seconds(1, 1);
    run.pressJump().seconds(2, 1).seconds(1);
    expect(STAND_Y - run.minY).toBeCloseTo(speed ** 2 / (2 * DEFAULTS.physics.gravity), 0);
    expect(run.maxTilt).toBeLessThan(45);
    expect(run.y).toBeCloseTo(STAND_Y, 1);
  });

  it('공중에서는 다시 뛰지 못한다', () => {
    const once = new Run(FLAT).pressJump().seconds(1.5);
    const twice = new Run(FLAT).pressJump().seconds(0.5).pressJump().seconds(1);
    expect(twice.minY).toBeCloseTo(once.minY, 3);
  });

  it('발판 끝에서 떨어진 직후의 점프는 받고, 늦은 점프는 받지 않는다', () => {
    const riseAfter = (delay: number): number => {
      const run = new Run(LEDGE);
      for (let i = 0; i < 300 && (run.sim.tori.grounded || run.x < 5); i += 1) run.seconds(FIXED_DT, 1);
      run.seconds(delay, 1).clear();
      const from = run.y;
      run.pressJump().seconds(0.3, 1);
      return from - run.minY;
    };
    expect(riseAfter(0.05)).toBeGreaterThan(0.8);
    expect(riseAfter(0.15)).toBeLessThan(0.1);
  });

  it('착지 직전에 누른 점프는 착지하자마자 실행한다', () => {
    // 먼저 한 번 뛰어 착지까지 걸리는 스텝 수를 잰다
    const probe = new Run(FLAT).pressJump().seconds(0.3);
    let air = Math.round(0.3 / FIXED_DT);
    while (!probe.sim.tori.grounded) {
      probe.seconds(FIXED_DT);
      air += 1;
    }
    const riseAfter = (lead: number): number => {
      const run = new Run(FLAT).pressJump().seconds(air * FIXED_DT - lead);
      run.pressJump().seconds(lead + FIXED_DT).clear();
      return STAND_Y - run.seconds(0.6).minY;
    };
    expect(riseAfter(0.07)).toBeGreaterThan(0.8);
    expect(riseAfter(0.2)).toBeLessThan(0.4);
  });
});

describe('방 1', () => {
  it('오른쪽으로만 걸어도 경사, 턱, 계단을 지나 끝 벽까지 갔다가 되돌아온다', () => {
    const run = new Run(roomByNumber(1)).seconds(25, 1);
    expect(run.x).toBeGreaterThan(55);
    expect(run.maxTilt).toBeLessThan(60);
    run.clear();
    run.seconds(25, -1);
    expect(run.x).toBeLessThan(2);
    expect(run.maxTilt).toBeLessThan(60);
  });

  it('설정값을 패널 범위의 양 끝으로 밀어도 몸이 튕겨 나가지 않는다', () => {
    for (const [path, { min, max }] of Object.entries(PARAM_META)) {
      for (const value of [min, max]) {
        if (value === undefined) continue;
        const config = cloneConfig(DEFAULTS);
        setParam(config, path, value);
        const run = new Run(roomByNumber(1), config).seconds(1, 1).pressJump().seconds(1.5, -1);
        // 토리가 선 왼쪽 평지의 벽과 바닥(x는 0~25, y는 6까지) 사이에 남아 있다
        const { x, y } = run;
        expect(x > 0 && x < 25 && y < 6 && y > -10, `${path} = ${value}: (${x}, ${y})`).toBe(true);
      }
    }
  }, 120_000);
});
