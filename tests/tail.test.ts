import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, DEG, FIXED_DT, PARAM_META, setParam } from '../src/config/defaults';
import type { ParamValue } from '../src/config/defaults';
import type { Scheme } from '../src/config/presets';
import { initPhysics, toWorld } from '../src/physics/world';
import { roomByNumber } from '../src/rooms/rooms';
import type { BranchData, Point, RoomData } from '../src/rooms/rooms';
import { createInputState } from '../src/sim/inputState';
import type { InputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import type { TailCommand } from '../src/tori/tail';
import { arcEnd, solveArc } from '../src/tori/tailIk';
import type { ArcProblem } from '../src/tori/tailIk';
import { box, ground, room } from './testRooms';

beforeAll(() => initPhysics());

const FLOOR = [ground(0, 60)];
const FLAT: RoomData = { ...room(FLOOR), spawn: { x: 30, y: -0.5 } };
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

interface Options {
  roomData?: RoomData;
  config?: Record<string, ParamValue>;
  settle?: number;
  /** 남은 꼬리 구간. 없으면 설정의 구간 수 전부다. */
  sectionsLeft?: number;
}

/** 자르고 남은 구간 수마다 다시 돌리는 테스트에 쓴다(PLAN 10절 묶음 가) */
const SECTIONS_LEFT = [3, 2, 1, 0] as const;

/** 남은 구간이 sectionsLeft일 때 꼬리 길이 */
function tailLength(sectionsLeft: number): number {
  const { baseLinks, linksPerSection, linkLength } = DEFAULTS.tail;
  return (baseLinks + sectionsLeft * linksPerSection) * linkLength;
}

class Run {
  readonly sim: Simulation;
  readonly input: InputState = createInputState();
  maxTilt = 0;
  maxGap = 0;
  maxLinkSpeed = 0;

  constructor(scheme: Scheme, { roomData = FLAT, config = {}, settle = 1.5, sectionsLeft }: Options = {}) {
    const values = cloneConfig(DEFAULTS);
    for (const [path, value] of Object.entries(config)) setParam(values, path, value);
    this.sim = new Simulation(values, roomData, scheme, sectionsLeft === undefined ? {} : { sectionsLeft });
    this.seconds(settle);
    this.clear();
  }

  seconds(seconds: number, each?: (time: number) => void): this {
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) {
      each?.(i * FIXED_DT);
      this.sim.step(this.input);
      const { torso, tail, turn } = this.sim.tori;
      this.maxTilt = Math.max(this.maxTilt, Math.abs(torso.rotation()) / DEG);
      this.maxGap = Math.max(this.maxGap, tail.jointGap(turn) / tail.length);
      for (const { body } of tail.links) this.maxLinkSpeed = Math.max(this.maxLinkSpeed, length(body.linvel()));
    }
    return this;
  }

  /** 몸통 중심에서 본 자리에 커서를 둔다 */
  point(dx: number, dy: number): this {
    const { x, y } = this.center;
    this.input.pointerActive = true;
    this.input.pointer = { x: x + dx, y: y + dy };
    return this;
  }

  clear(): void {
    this.maxTilt = 0;
    this.maxGap = 0;
    this.maxLinkSpeed = 0;
  }

  get center(): Point {
    return this.sim.tori.torso.translation();
  }

  get tip(): Point {
    return this.sim.tori.tail.tip;
  }

  object(index = 0): Point {
    return this.sim.objects[index].body.translation();
  }
}

function length({ x, y }: Point): number {
  return Math.hypot(x, y);
}

/** 가장 크게 벌어진 관절 하나의 거리(m) */
function widestJointGap({ sim }: Run): number {
  const { tail, turn } = sim.tori;
  const half = DEFAULTS.tail.linkLength / 2;
  return tail.links.reduce((widest, { body }, i) => {
    const from = i === 0 ? tail.hip(turn) : toWorld(tail.links[i - 1].body, { x: 0, y: -half });
    return Math.max(widest, length(subtract(toWorld(body, { x: 0, y: half }), from)));
  }, 0);
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function branchAt(x: number, y: number): BranchData {
  return { x, y, length: 0.7, thickness: 0.1 };
}

describe('꼬리로 매달리기', () => {
  /** 꼬리 끝이 가지에 닿은 채로 시작한다 */
  function hang(start: '가만히' | '수평', scheme: Scheme, sectionsLeft = DEFAULTS.tail.sections): Run {
    const branches = [branchAt(30, -6)];
    const length = tailLength(sectionsLeft);
    const { hipX } = DEFAULTS.tail;
    const spawn = start === '가만히' ? { x: 30 + hipX, y: -6 + length + 0.1 } : { x: 30 + length + hipX, y: -6 };
    const run = new Run(scheme, { roomData: { ...room(FLOOR, [], branches), spawn }, settle: 0, sectionsLeft });
    run.input.held.grab = true;
    run.input.held.pointerGrab = true;
    const { tail } = run.sim.tori;
    if (start === '가만히') {
      const hip = tail.hip(1);
      tail.links.forEach(({ body }, i) => {
        body.setTranslation({ x: hip.x, y: hip.y - (i + 0.5) * DEFAULTS.tail.linkLength }, true);
        body.setRotation(0, true);
      });
    }
    return run;
  }

  for (const sectionsLeft of SECTIONS_LEFT) {
    for (const scheme of ['A', 'B'] as const) {
      for (const start of ['가만히', '수평'] as const) {
        it(`남은 구간 ${sectionsLeft}, ${scheme} 방식: ${start} 매달린 5초 동안 관절 벌어짐이 꼬리 길이의 5%를 넘지 않는다`, () => {
          const run = hang(start, scheme, sectionsLeft).seconds(5);
          expect(run.sim.tori.tail.links.length * DEFAULTS.tail.linkLength).toBeCloseTo(tailLength(sectionsLeft));
          expect(run.sim.tori.hanging).toBe(true);
          expect(run.maxGap).toBeLessThan(0.05);
        });
      }
    }
  }

  it('매달려서 이동 키를 누르면 흔들리고, 놓으면 떨어진다', () => {
    const run = hang('가만히', 'A').seconds(2);
    const rest = run.center.x;
    let reach = 0;
    run.seconds(6, (time) => {
      run.input.moveX = Math.sin(time * 2.4) > 0 ? 1 : -1;
      reach = Math.max(reach, Math.abs(run.center.x - rest));
    });
    expect(reach).toBeGreaterThan(0.6);
    expect(run.sim.tori.hanging).toBe(true);
    expect(run.maxGap).toBeLessThan(0.05);
    run.input.moveX = 0;
    run.input.held.pointerGrab = false;
    run.seconds(3);
    expect(run.sim.tori.grounded).toBe(true);
    expect(Math.abs(run.sim.tori.torso.rotation()) / DEG).toBeLessThan(10);
  });
});

describe('관절 모터', () => {
  it('관절 제한을 넘는 목표 각을 넣어도 폭주하지 않는다', () => {
    for (const degrees of [120, -120, 200, -200]) {
      const run = new Run('A');
      const command: TailCommand = { pose: [], strength: 3, pull: null, grab: false };
      run.sim.controller = {
        target: null,
        update: () => ({ ...command, pose: run.sim.tori.tail.links.map(() => degrees * DEG) }),
      };
      run.seconds(3);
      expect(run.maxLinkSpeed, `${degrees}도`).toBeLessThan(50);
      expect(run.maxGap, `${degrees}도`).toBeLessThan(0.05);
    }
  });
});

describe('고른 곡률 IK', () => {
  const PROBLEM: ArcProblem = {
    links: 12,
    linkLength: 0.125,
    target: { x: 0, y: 0 },
    rootMin: -Math.PI,
    rootMax: Math.PI,
    bendMax: 35 * DEG,
    floor: Infinity,
    current: { root: -Math.PI / 2, bend: 0 },
  };
  const missAt = (problem: ArcProblem): number => distance(arcEnd(problem, solveArc(problem)), problem.target);

  it('닿는 거리 안의 목표에는 끝이 닿는다', () => {
    for (let angle = 0; angle < 360; angle += 15) {
      for (const reach of [0.1, 0.5, 1, 1.45]) {
        const target = { x: Math.cos(angle * DEG) * reach, y: Math.sin(angle * DEG) * reach };
        expect(missAt({ ...PROBLEM, target })).toBeLessThan(0.01);
      }
    }
  });

  it('밑동 각은 한계를 넘지 않는다', () => {
    const limited = { ...PROBLEM, rootMin: -150 * DEG, rootMax: 70 * DEG };
    for (let angle = 0; angle < 360; angle += 15) {
      const { root } = solveArc({ ...limited, target: { x: Math.cos(angle * DEG), y: Math.sin(angle * DEG) } });
      expect(root).toBeGreaterThanOrEqual(limited.rootMin);
      expect(root).toBeLessThanOrEqual(limited.rootMax);
    }
  });

  it('목표가 조금 움직이면 자세도 조금만 바뀐다', () => {
    let current = solveArc({ ...PROBLEM, target: { x: -1.2, y: 0 } });
    for (let i = 1; i <= 120; i += 1) {
      // 뒤에서 머리 위를 지나 앞까지 1.5도씩 돈다
      const angle = Math.PI + i * 1.5 * DEG;
      const next = solveArc({ ...PROBLEM, target: { x: Math.cos(angle) * 1.2, y: Math.sin(angle) * 1.2 }, current });
      expect(Math.abs(next.root - current.root)).toBeLessThan(5 * DEG);
      expect(Math.abs(next.bend - current.bend)).toBeLessThan(1 * DEG);
      current = next;
    }
  });
});

describe('A 방식 (마우스)', () => {
  for (const pullTip of [false, true]) {
    it(`꼬리 끝이 커서를 늦게 따라와 닿는다 (끝만 당기기 ${pullTip ? '켬' : '끔'})`, () => {
      for (const [dx, dy] of [
        [-1.5, 0],
        [-1.2, -0.8],
        [-0.4, -1.4],
        [0.5, -0.9],
        [0.9, -0.1],
      ]) {
        const run = new Run('A', { config: { 'mouse.pullTip': pullTip } }).point(dx, dy);
        const start = distance(run.tip, run.input.pointer);
        run.seconds(FIXED_DT);
        expect(distance(run.tip, run.input.pointer)).toBeGreaterThan(start * 0.8);
        run.seconds(2);
        expect(distance(run.tip, run.input.pointer), `(${dx}, ${dy})`).toBeLessThan(0.35);
        expect(run.maxTilt).toBeLessThan(45);
      }
    });
  }

  it('상대 커서는 마우스가 움직인 만큼만 움직이고 꼬리가 닿는 반경을 벗어나지 않는다', () => {
    const run = new Run('A', { config: { 'mouse.relative': true } });
    const before = { ...(run.sim.controller.target as Point) };
    run.input.pointerDelta = { x: 0.2, y: -0.3 };
    run.seconds(FIXED_DT);
    const after = run.sim.controller.target as Point;
    expect(after.x - before.x).toBeCloseTo(0.2, 1);
    expect(after.y - before.y).toBeCloseTo(-0.3, 1);
    run.input.pointerDelta = { x: 0, y: -50 };
    run.seconds(FIXED_DT);
    const { tail, turn } = run.sim.tori;
    expect(distance(run.sim.controller.target as Point, tail.hip(turn))).toBeLessThan(tail.length + 0.1);
  });

  it('빨리 휘두르면 상자가 날아가고 몸이 반동으로 기운다', () => {
    const run = new Run('A', { roomData: { ...FLAT, boxes: [box(28.5, -0.25, 0.5, 0)] } }).point(0.6, -0.8).seconds(1.5);
    run.clear();
    run.point(-1.5, 0.2).seconds(1.5);
    expect(run.sim.strikes.recent.length).toBeGreaterThan(0);
    expect(run.object().x).toBeLessThan(27.5);
    expect(run.maxTilt).toBeGreaterThan(5);
    expect(run.maxTilt).toBeLessThan(45);
  });

  it('작은 물건을 집어 머리 위로 옮기고, 놓으면 떨어진다', () => {
    const item = { ...box(28.4, -0.09, 0.18, 0), grabbable: true };
    const run = new Run('A', { roomData: { ...FLAT, boxes: [item] } });
    run.input.pointerActive = true;
    run.input.pointer = { x: 28.4, y: -0.1 };
    run.seconds(1.5);
    run.input.held.pointerGrab = true;
    run.seconds(0.5);
    expect(run.sim.tori.grab.holding).not.toBeNull();
    run.point(0.2, -1.2).seconds(2);
    expect(run.object().y).toBeLessThan(-1.2);
    run.input.held.pointerGrab = false;
    run.seconds(2);
    expect(run.object().y).toBeGreaterThan(-0.9);
  });

  it('잡을 수 없는 상자는 잡지 않는다', () => {
    const run = new Run('A', { roomData: { ...FLAT, boxes: [box(28.5, -0.25, 0.5, 0)] } });
    run.input.held.pointerGrab = true;
    run.input.pointerActive = true;
    run.input.pointer = { x: 28.5, y: -0.4 };
    run.seconds(2);
    expect(run.sim.tori.grab.holding).toBeNull();
  });

  it('잡기 능력이 꺼져 있으면 잡지 않고 꼬리 끝만 꼼지락거린다', () => {
    const item = { ...box(28.4, -0.09, 0.18, 0), grabbable: true };
    const run = new Run('A', { roomData: { ...FLAT, boxes: [item] } });
    run.sim.tori.canGrab = false;
    run.input.pointerActive = true;
    run.input.pointer = { x: 28.4, y: -0.1 };
    run.input.held.pointerGrab = true;
    const tips: number[] = [];
    run.seconds(1.5).seconds(1, () => tips.push(run.sim.tori.tail.targetPose[11]));
    expect(run.sim.tori.grab.holding).toBeNull();
    expect(Math.max(...tips) - Math.min(...tips)).toBeGreaterThan(10 * DEG);
  });

  it('아주 빨리 휘둘러도 얇은 상자를 그냥 지나치지 않는다', () => {
    let hits = 0;
    const tries = 20;
    for (let i = 0; i < tries; i += 1) {
      // 밑동 바로 위, 꼬리 끝이 가장 빠르게 지나는 높이에 얇은 판을 띄워 둔다
      const thin = { x: 29.4 + i * 0.02, y: -1.75, width: 0.06, height: 0.3, angle: 0, grabbable: false };
      const run = new Run('A', { roomData: { ...FLAT, boxes: [thin] }, config: { 'tail.maxTorque': 80 }, settle: 0 });
      const { body } = run.sim.objects[0];
      body.setGravityScale(0, true);
      run.input.pointerActive = true;
      run.input.pointer = { x: 28.2, y: -0.8 };
      run.seconds(1.5);
      run.clear();
      run.input.pointer = { x: 30.6, y: -0.8 };
      run.seconds(0.8);
      expect(run.maxLinkSpeed).toBeGreaterThan(8);
      if (Math.abs(run.object().x - thin.x) > 0.1) hits += 1;
    }
    expect(hits).toBe(tries);
  });
});

describe('B 방식 (자동)', () => {
  it('가만히 있으면 꼬리가 살랑인다', () => {
    const run = new Run('B');
    const ys: number[] = [];
    run.seconds(3, () => ys.push(run.tip.y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.15);
    expect(run.maxTilt).toBeLessThan(8);
  });

  for (const facing of [1, -1] as const) {
    it(`J로 휘두르면 앞쪽 상자가 날아간다 (${facing === 1 ? '오른쪽' : '왼쪽'})`, () => {
      const run = new Run('B', { roomData: { ...FLAT, boxes: [box(30 + facing * 1.05, -0.15, 0.3, 0)] } });
      if (facing === -1) {
        run.input.moveX = -1;
        run.seconds(FIXED_DT);
        run.input.moveX = 0;
        run.seconds(2);
      }
      const from = run.object().x;
      run.clear();
      run.input.pressed.attack = true;
      run.seconds(1.5);
      expect((run.object().x - from) * facing).toBeGreaterThan(1);
      expect(run.maxTilt).toBeGreaterThan(5);
      expect(run.maxTilt).toBeLessThan(45);
      run.seconds(1.5);
      expect(Math.abs(run.sim.tori.torso.rotation()) / DEG).toBeLessThan(8);
    });
  }

  it('K로 작은 물건을 집어 등 위로 들고 걸을 수 있다', () => {
    for (const dx of [-1.3, 0.9]) {
      const item = { ...box(30 + dx, -0.09, 0.18, 0), grabbable: true };
      const run = new Run('B', { roomData: { ...FLAT, boxes: [item] } });
      run.input.held.grab = true;
      // 들어 올린 물건은 조금 출렁이므로 1초 동안의 평균으로 본다
      run.seconds(2);
      const heights: number[] = [];
      run.seconds(1, () => heights.push(run.object().y));
      expect(run.sim.tori.grab.holding, `${dx}`).not.toBeNull();
      expect(heights.reduce((sum, y) => sum + y, 0) / heights.length, `${dx}`).toBeLessThan(-0.7);
      run.input.moveX = 1;
      run.seconds(2);
      expect(run.sim.tori.grab.holding).not.toBeNull();
      expect(Math.abs(run.object().x - run.center.x)).toBeLessThan(1.2);
      run.input.moveX = 0;
      run.input.held.grab = false;
      run.seconds(2);
      expect(run.object().y).toBeGreaterThan(-0.9);
    }
  });

  it('K로 가까운 가지에 걸고 매달린다', () => {
    const run = new Run('B', { roomData: { ...room(FLOOR, [], [branchAt(30, -2.5)]), spawn: { x: 30, y: -0.5 } } });
    run.input.held.grab = true;
    run.input.pressed.jump = true;
    run.seconds(1.5);
    expect(run.sim.tori.grab.hooked).toBe(true);
    run.seconds(2);
    expect(run.sim.tori.hanging).toBe(true);
    expect(run.maxGap).toBeLessThan(0.05);
  });
});

describe('B 방식의 잡을 대상', () => {
  it('물건이 더 가까이 있어도 뛰어오르면 가지를 노려 건다', () => {
    const item = { ...box(29.2, -0.09, 0.18, 0), grabbable: true };
    const roomData = { ...room(FLOOR, [item], [branchAt(32.2, -2.5)]), spawn: { x: 30, y: -0.5 } };
    const run = new Run('B', { roomData });
    run.input.moveX = 1;
    run.input.pressed.jump = true;
    run.seconds(0.15);
    run.input.held.grab = true;
    run.seconds(0.6);
    run.input.moveX = 0;
    run.seconds(0.5);
    expect(run.sim.tori.grab.hooked).toBe(true);
  });

  it('누른 채 걸어가면 뒤에 남은 물건을 놓고 앞에 있는 것을 노린다', () => {
    const behind = { ...box(28, -1.5, 0.18, 0), grabbable: true };
    const ahead = { ...box(34, -0.09, 0.18, 0), grabbable: true };
    const post = ground(27.8, 28.2, 1.4);
    const run = new Run('B', { roomData: { ...FLAT, terrain: [...FLOOR, post], boxes: [behind, ahead] } });
    run.sim.tori.canGrab = false;
    run.input.held.grab = true;
    run.input.moveX = 1;
    run.seconds(1);
    const target = run.sim.controller.target as Point;
    expect(target.x).toBeGreaterThan(run.center.x);
  });
});

describe('돌아서기', () => {
  for (const sectionsLeft of SECTIONS_LEFT) {
    for (const scheme of ['A', 'B'] as const) {
      for (const hipX of [DEFAULTS.tail.hipX, 0]) {
        it(`남은 구간 ${sectionsLeft}, ${scheme} 방식, 밑동 ${hipX}m: 몸이 크게 기울지 않고 꼬리가 벌어지지 않는다`, () => {
          const run = new Run(scheme, { config: { 'tail.hipX': hipX }, sectionsLeft });
          if (scheme === 'A') run.point(-1, -0.6);
          // 1초마다 돌아서며 왕복하고 제자리에서도 돈다
          run.seconds(6, (time) => {
            run.input.moveX = Math.floor(time) % 2 === 0 ? -1 : 1;
          });
          run.input.moveX = 0;
          run.seconds(1);
          for (const direction of [-1, 1]) {
            run.input.moveX = direction;
            run.seconds(FIXED_DT);
            run.input.moveX = 0;
            run.seconds(1);
          }
          expect(run.maxTilt).toBeLessThan(30);
          expect(run.maxGap).toBeLessThan(0.05);
          expect(run.maxLinkSpeed).toBeLessThan(25);
        });
      }
    }
  }

  it('B 방식에서 돌아서면 꼬리가 반대쪽으로 넘어간다', () => {
    const run = new Run('B');
    expect(run.tip.x).toBeLessThan(run.center.x - 0.8);
    run.input.moveX = -1;
    run.seconds(FIXED_DT);
    run.input.moveX = 0;
    run.seconds(1.5);
    expect(run.tip.x).toBeGreaterThan(run.center.x + 0.8);
  });

  it('물건을 들고 돌아서도 놓치거나 튕기지 않는다', () => {
    const item = { ...box(28.7, -0.09, 0.18, 0), grabbable: true };
    const run = new Run('B', { roomData: { ...FLAT, boxes: [item] } });
    run.input.held.grab = true;
    run.seconds(2);
    run.clear();
    run.seconds(4, (time) => {
      run.input.moveX = Math.floor(time) % 2 === 0 ? -1 : 1;
    });
    expect(run.sim.tori.grab.holding).not.toBeNull();
    expect(run.maxTilt).toBeLessThan(40);
    expect(run.maxGap).toBeLessThan(0.05);
  });
});

describe('짧아진 꼬리', () => {
  for (const sectionsLeft of SECTIONS_LEFT) {
    it(`남은 구간 ${sectionsLeft}: B 방식으로 휘두르면 꼬리 끝이 밑동 앞으로 넘어가고 몸이 크게 기울지 않는다`, () => {
      const run = new Run('B', { sectionsLeft });
      run.input.pressed.attack = true;
      let forward = -Infinity;
      run.seconds(0.9, () => {
        forward = Math.max(forward, run.tip.x - run.sim.tori.tail.hip(1).x);
      });
      expect(forward).toBeGreaterThan(0.15);
      expect(run.maxTilt).toBeLessThan(45);
      expect(run.maxGap).toBeLessThan(0.05);
    });

    it(`남은 구간 ${sectionsLeft}: 방 3의 낮은 가지에 밑에서 뛰어도, 달려가며 뛰어도 걸 수 있다`, () => {
      const data = roomByNumber(3);
      const [branch] = data.branches;
      for (const scheme of ['A', 'B'] as const) {
        for (const jumpX of [null, 12.2, 12.5, 12.8]) {
          const name = `${scheme} ${jumpX ?? '밑에서'}`;
          const spawn = jumpX === null ? { x: branch.x, y: 6.2 } : { x: 10, y: 5.5 };
          const run = new Run(scheme, { roomData: { ...data, recorders: [], boxes: [], spawn }, settle: 0.5, sectionsLeft });
          run.input.pointerActive = true;
          run.input.pointer = { x: branch.x, y: branch.y };
          run.input.held.grab = true;
          run.input.held.pointerGrab = true;
          let jumped = jumpX === null;
          run.input.pressed.jump = jumped;
          let hooked = false;
          let widest = 0;
          run.seconds(2.5, () => {
            if (!jumped && run.center.x >= (jumpX as number)) run.input.pressed.jump = jumped = true;
            if (jumpX !== null) run.input.moveX = run.center.x < branch.x ? 1 : 0;
            hooked ||= run.sim.tori.grab.hooked;
            widest = Math.max(widest, widestJointGap(run));
          });
          expect(hooked, name).toBe(true);
          // 거는 순간에는 꼬리가 잠깐 늘어난다(M2에서 잰 달려가며 걸 때의 합계는 꼬리 길이의 6%).
          // 이웃한 마디 그림은 굵기만큼 겹치므로, 관절 하나가 끝 굵기의 절반보다 덜 벌어지면 틈이 보이지 않는다.
          expect(widest, name).toBeLessThan(DEFAULTS.tail.tipThickness / 2);
        }
      }
    }, 60_000);

    it(`남은 구간 ${sectionsLeft}: A 방식으로 커서를 앞뒤로 휘둘러도 꼬리가 벌어지지 않는다`, () => {
      const run = new Run('A', { sectionsLeft });
      run.seconds(3, (time) => run.point(Math.cos(time * 6) * 1.2, -0.6 + Math.sin(time * 6) * 0.5));
      expect(run.maxTilt).toBeLessThan(45);
      expect(run.maxGap).toBeLessThan(0.05);
      expect(run.maxLinkSpeed).toBeLessThan(25);
    });
  }
});

describe('방 2', () => {
  it('가지 세 개에 모두 뛰어서 걸 수 있다', () => {
    const data = roomByNumber(2);
    for (const { x, y } of data.branches) {
      for (const scheme of ['A', 'B'] as const) {
        const run = new Run(scheme, { roomData: { ...data, spawn: { x, y: 6.2 } } });
        run.input.pointerActive = true;
        run.input.pointer = { x, y };
        run.input.held.grab = true;
        run.input.held.pointerGrab = true;
        run.seconds(0.5);
        run.input.pressed.jump = true;
        let hooked = run.sim.tori.grab.hooked;
        run.seconds(1.5, () => {
          hooked ||= run.sim.tori.grab.hooked;
        });
        expect(hooked, `${scheme} ${x}`).toBe(true);
        expect(run.maxGap, `${scheme} ${x}`).toBeLessThan(0.05);
      }
    }
  });

  it('왼쪽 바닥에서 달려가며 뛰면 첫 가지에 걸린다', () => {
    const data = roomByNumber(2);
    const [branch] = data.branches;
    for (const scheme of ['A', 'B'] as const) {
      for (const jumpX of [12.4, 12.8, 13.2]) {
        const run = new Run(scheme, { roomData: { ...data, boxes: [], spawn: { x: 10.5, y: 5.4 } } });
        run.input.pointerActive = true;
        run.input.pointer = { x: branch.x, y: branch.y };
        run.input.held.grab = true;
        run.input.held.pointerGrab = true;
        let jumped = false;
        let hooked = false;
        run.seconds(3, () => {
          if (!jumped && run.center.x >= jumpX) run.input.pressed.jump = jumped = true;
          run.input.moveX = run.center.x > branch.x ? 0 : 1;
          hooked ||= run.sim.tori.grab.hooked;
        });
        expect(hooked, `${scheme} ${jumpX}`).toBe(true);
      }
    }
  });
  it('아무것도 하지 않으면 블록 탑이 서 있다', () => {
    const run = new Run('A', { roomData: roomByNumber(2), settle: 0 });
    const before = run.sim.objects.map(({ body }) => ({ ...body.translation() }));
    run.seconds(4);
    run.sim.objects.forEach(({ body }, i) => expect(distance(body.translation(), before[i])).toBeLessThan(0.05));
  });

  it('꼬리 설정값을 패널 범위의 양 끝으로 밀어도 몸이 튕겨 나가지 않는다', () => {
    const groups = ['tail', 'mouse', 'auto', 'grab', 'hit'];
    for (const [path, { min, max }] of Object.entries(PARAM_META)) {
      if (!groups.includes(path.split('.')[0])) continue;
      for (const scheme of ['A', 'B'] as const) {
        for (const value of min === undefined ? [true] : [min, max as number]) {
          const run = new Run(scheme, { roomData: roomByNumber(2), config: { [path]: value }, settle: 0.5 });
          run.input.held.grab = true;
          run.input.held.pointerGrab = true;
          run.seconds(2, (time) => {
            run.input.moveX = time < 1 ? 1 : -1;
            run.point(Math.cos(time * 8) * 1.2, -0.4 + Math.sin(time * 8));
            if (time > 0.5 && time < 0.5 + FIXED_DT * 1.5) run.input.pressed.attack = true;
          });
          const { x, y } = run.center;
          expect(x > 0 && x < 14 && y < 6 && y > -6, `${scheme} ${path} = ${value}: (${x}, ${y})`).toBe(true);
        }
      }
    }
  }, 120_000);
});
