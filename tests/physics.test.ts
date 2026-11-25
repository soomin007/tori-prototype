import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, FIXED_DT, M0_ROOM } from '../src/config/defaults';
import { FixedStepper, initPhysics, lerpAngle } from '../src/physics/world';
import { createInputState } from '../src/sim/inputState';
import { Simulation } from '../src/sim/simulation';
import type { SimObject } from '../src/sim/simulation';

beforeAll(() => initPhysics());

const boxesOf = (sim: Simulation): SimObject[] => sim.objects.filter((o) => o.kind === 'box');

function runSeconds(sim: Simulation, seconds: number): void {
  const input = createInputState();
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i += 1) sim.step(input);
}

describe('헤드리스 물리', () => {
  it('상자가 바닥에 떨어져 멈춘다', () => {
    const sim = new Simulation(cloneConfig(DEFAULTS));
    const boxes = boxesOf(sim);
    expect(boxes).toHaveLength(DEFAULTS.testBoxes.count);

    const startY = boxes.map((box) => box.body.translation().y);
    runSeconds(sim, 8);

    const floorTop = M0_ROOM.height - M0_ROOM.floorThickness;
    boxes.forEach((box, i) => {
      const { x, y } = box.body.translation();
      const { x: vx, y: vy } = box.body.linvel();
      expect(y).toBeGreaterThan(startY[i]);
      // 바닥을 뚫지 않고(1cm까지 봐준다) 벽 안에 있다
      expect(y).toBeLessThanOrEqual(floorTop - box.height / 2 + 0.01);
      expect(x).toBeGreaterThan(M0_ROOM.wallThickness);
      expect(x).toBeLessThan(M0_ROOM.width - M0_ROOM.wallThickness);
      expect(Math.hypot(vx, vy)).toBeLessThan(0.01);
      expect(Math.abs(box.body.angvel())).toBeLessThan(0.01);
    });
    // 적어도 하나는 바닥에 닿아 있다
    const lowest = Math.max(...boxes.map((box) => box.body.translation().y));
    expect(lowest).toBeCloseTo(floorTop - DEFAULTS.testBoxes.size / 2, 1);
  });

  it('멈춰 잠든 상자도 중력을 바꾸면 바로 반응한다', () => {
    const config = cloneConfig(DEFAULTS);
    const sim = new Simulation(config);
    runSeconds(sim, 10);
    const [box] = boxesOf(sim);
    expect(box.body.isSleeping()).toBe(true);

    // 패널 범위(0 이상)에는 없는 값이지만, 잠에서 깨는지는 위로 띄워야 드러난다
    config.physics.gravity = -5;
    sim.applyConfig();
    const before = box.body.translation().y;
    runSeconds(sim, 0.5);
    expect(box.body.translation().y).toBeLessThan(before - 0.1);
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
