import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, FIXED_DT } from '../src/config/defaults';
import { FixedStepper, initPhysics, lerpAngle } from '../src/physics/world';
import { createInputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import { box, ground, room } from './testRooms';

beforeAll(() => initPhysics());

const SIZE = 0.6;
const WALL = 10;
/** 토리와 떨어진 자리에 세 줄로 어긋나게 쌓아, 떨어지면서 서로 부딪히게 한다 */
const BOXES = Array.from({ length: 6 }, (_, i) => {
  const x = 12 + ((i % 3) - 1) * SIZE * 0.8 + (i % 2) * SIZE * 0.25;
  return box(x, -1 - i * SIZE * 1.4, SIZE, i * 0.35);
});
const BOX_ROOM = room([ground(0, 8), ground(8, 9, WALL), ground(9, 15), ground(15, 16, WALL)], BOXES);

function runSeconds(sim: Simulation, seconds: number): void {
  const input = createInputState();
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) sim.step(input);
}

describe('헤드리스 물리', () => {
  it('상자가 바닥에 떨어져 멈춘다', () => {
    const sim = new Simulation(cloneConfig(DEFAULTS), BOX_ROOM);
    const boxes = sim.objects;
    expect(boxes).toHaveLength(BOXES.length);

    const startY = boxes.map(({ body }) => body.translation().y);
    runSeconds(sim, 8);

    boxes.forEach(({ body, height }, i) => {
      const { x, y } = body.translation();
      const { x: vx, y: vy } = body.linvel();
      expect(y).toBeGreaterThan(startY[i]);
      // 바닥을 뚫지 않고(1cm까지 봐준다) 벽 안에 있다
      expect(y).toBeLessThanOrEqual(-height / 2 + 0.01);
      expect(x).toBeGreaterThan(9);
      expect(x).toBeLessThan(15);
      expect(Math.hypot(vx, vy)).toBeLessThan(0.01);
      expect(Math.abs(body.angvel())).toBeLessThan(0.01);
    });
    // 적어도 하나는 바닥에 닿아 있다
    const lowest = Math.max(...boxes.map(({ body }) => body.translation().y));
    expect(lowest).toBeCloseTo(-SIZE / 2, 1);
  });

  it('멈춰 잠든 상자도 중력을 바꾸면 바로 반응한다', () => {
    const config = cloneConfig(DEFAULTS);
    const sim = new Simulation(config, BOX_ROOM);
    runSeconds(sim, 10);
    const { body } = sim.objects[0];
    expect(body.isSleeping()).toBe(true);

    // 패널 범위(0 이상)에는 없는 값이지만, 잠에서 깨는지는 위로 띄워야 드러난다
    config.physics.gravity = -5;
    sim.applyConfig();
    const before = body.translation().y;
    runSeconds(sim, 0.5);
    expect(body.translation().y).toBeLessThan(before - 0.1);
  });
});

describe('고정 스텝과 보간', () => {
  it('프레임 길이가 달라도 같은 시간이면 같은 스텝 수를 돌린다', () => {
    for (const fps of [30, 60, 144]) {
      const stepper = new FixedStepper();
      let steps = 0;
      for (let i = 0; i < fps * 2; i += 1) steps += stepper.advance(1 / fps, 5, () => {});
      expect(Math.abs(steps - 120)).toBeLessThanOrEqual(1);
    }
  });

  it('한 프레임에 정한 스텝까지만 돌리고 밀린 시간은 버린다', () => {
    const stepper = new FixedStepper();
    expect(stepper.advance(10, 5, () => {})).toBe(5);
    expect(stepper.alpha).toBeLessThan(1);
    expect(stepper.advance(FIXED_DT, 5, () => {})).toBeLessThanOrEqual(2);
  });

  it('각도는 짧은 쪽으로 보간한다', () => {
    const middle = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(middle)).toBeCloseTo(Math.PI, 5);
    expect(lerpAngle(0.2, 0.4, 0.5)).toBeCloseTo(0.3, 5);
  });
});
