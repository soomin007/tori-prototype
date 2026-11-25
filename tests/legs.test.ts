import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS } from '../src/config/defaults';
import { LegRig } from '../src/view/legs';

const STAND_Y = -(DEFAULTS.float.clearance + DEFAULTS.torso.thickness / 2);
const SIDE_GAP = 0.08;

/** 평지(바닥 y = 0)를 정해진 속도로 움직이는 몸에 다리를 붙여 돌린다 */
class Walk {
  readonly rig = new LegRig();
  readonly config = cloneConfig(DEFAULTS);
  readonly fps: number;
  x = 0;
  vx = 0;
  y = STAND_Y;
  vy = 0;
  grounded = true;

  constructor(fps = 60) {
    this.fps = fps;
  }

  /** 한 프레임. 속도는 실제 이동과 같은 가속, 감속으로 바뀐다. */
  frame(target: number): void {
    const { accel, decel } = this.config.move;
    const rate = (Math.abs(target) > Math.abs(this.vx) ? accel : decel) / this.fps;
    this.vx += Math.max(-rate, Math.min(rate, target - this.vx));
    this.x += this.vx / this.fps;
    if (!this.grounded) {
      this.vy += this.config.physics.gravity / this.fps;
      this.y += this.vy / this.fps;
      if (this.vy > 0 && this.y >= STAND_Y - this.config.float.reach) {
        this.grounded = true;
        this.y = STAND_Y;
      }
    }
    this.rig.update(1 / this.fps, this.config, {
      pose: { x: this.x, y: this.y, angle: 0 },
      velocityX: this.vx,
      turn: 1,
      grounded: this.grounded,
      groundBelow: (_x, y, max) => (-y <= max ? 0 : null),
    });
  }

  run(seconds: number, target: number, each?: () => void): this {
    for (let i = 0; i < Math.round(seconds * this.fps); i += 1) {
      this.frame(target);
      each?.();
    }
    return this;
  }

  jump(): void {
    this.grounded = false;
    this.vy = -this.config.jump.speed;
  }

  lifted(): boolean[] {
    return this.rig.legs.map((leg) => leg.lifted);
  }

  /** 좌우 발의 앞뒤 차이. 앞발과 뒷발을 차례로 주고, 일부러 어긋나게 둔 거리는 뺀다. */
  sideDifference(): [number, number] {
    const [frontNear, frontFar, hindNear, hindFar] = this.rig.legs.map((leg) => leg.foot.x);
    return [frontNear - frontFar + SIDE_GAP, hindNear - hindFar + SIDE_GAP];
  }

  /** 좌우 발이 같은 자세가 아니고, 앞발과 뒷발의 어긋남이 서로 반대다 */
  staggered(): boolean {
    const [front, hind] = this.sideDifference();
    return Math.abs(front) > 0.06 && Math.abs(hind) > 0.06 && Math.sign(front) !== Math.sign(hind);
  }
}

describe('다리 걸음', () => {
  it.each([
    [60, 1],
    [60, 2],
    [60, 4],
    [60, -3],
    [144, 4],
  ])('걷는 동안 네 발이 함께 들리지 않고 좌우가 번갈아 움직인다 (%i fps, %i m/s)', (fps, speed) => {
    const walk = new Walk(fps).run(0.5, 0);
    let frames = 0;
    const liftedFrames = [0, 0, 0, 0];
    walk.run(1, speed);
    walk.run(4, speed, () => {
      const [frontNear, frontFar, hindNear, hindFar] = walk.lifted();
      expect(frontNear && frontFar).toBe(false);
      expect(hindNear && hindFar).toBe(false);
      // 대각선 앞발과 뒷발이 짝이다
      expect(frontNear).toBe(hindFar);
      expect(frontFar).toBe(hindNear);
      walk.lifted().forEach((up, i) => (liftedFrames[i] += Number(up)));
      frames += 1;
    });
    // 발이 땅에 있는 비율이 설정값(느릴 때와 빠를 때 사이)과 맞는다
    const { dutySlow, dutyFast } = DEFAULTS.legs;
    const expected = dutySlow + (dutyFast - dutySlow) * (Math.abs(speed) / DEFAULTS.move.maxSpeed);
    for (const count of liftedFrames) expect(1 - count / frames).toBeCloseTo(expected, 1);
  });

  it('디딘 발은 다리가 닿는 동안 바닥에서 미끄러지지 않는다', () => {
    const walk = new Walk().run(0.5, 0).run(1, 2);
    let previous = walk.rig.legs.map((leg) => ({ x: leg.foot.x, down: !leg.lifted }));
    let worst = 0;
    walk.run(3, 2, () => {
      walk.rig.legs.forEach((leg, i) => {
        if (!leg.lifted && previous[i].down) worst = Math.max(worst, Math.abs(leg.foot.x - previous[i].x));
      });
      previous = walk.rig.legs.map((leg) => ({ x: leg.foot.x, down: !leg.lifted }));
    });
    expect(worst).toBeLessThan(0.01);
  });

  it('서 있을 때와 걷다가 멈춘 뒤에도 좌우 발이 같은 자세가 아니다', () => {
    const walk = new Walk().run(1, 0);
    expect(walk.staggered()).toBe(true);
    for (const seconds of [0.3, 0.7, 1.1, 1.6]) {
      walk.run(seconds, 4).run(2, 0);
      expect(walk.staggered()).toBe(true);
      expect(walk.lifted()).toEqual([false, false, false, false]);
    }
  });

  it('공중과 착지에서도 좌우 발이 같은 자세가 아니고, 네 발이 한꺼번에 들리지 않는다', () => {
    for (const speed of [0, 4]) {
      for (const before of [0.8, 0.85, 0.9, 1.0]) {
        const walk = new Walk().run(before, speed);
        walk.jump();
        let sameInAir = 0;
        let airFrames = 0;
        while (!walk.grounded) {
          walk.frame(speed);
          if (walk.grounded) break;
          airFrames += 1;
          const [front, hind] = walk.sideDifference();
          if (Math.abs(front) < 0.02 && Math.abs(hind) < 0.02) sameInAir += 1;
        }
        // 발을 저으며 엇갈릴 때 잠깐 겹치는 것은 괜찮다
        expect(sameInAir / airFrames).toBeLessThan(0.3);
        walk.run(0.6, speed, () => {
          const up = walk.lifted();
          expect(up.every(Boolean)).toBe(false);
        });
      }
    }
  });
});
