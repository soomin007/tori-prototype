import type Phaser from 'phaser';
import { toPx } from '../physics/world';
import type { Point } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';

const DEPTH = 50;
const NEAR_COLOR = 0xffd24a;
const HOLD_COLOR = 0x7cc4ff;
const TARGET_COLOR = 0xffffff;
const STRIKE_COLOR = 0xfff2c0;
/** 타격 자국이 남는 스텝 수 */
const STRIKE_STEPS = 10;
const STRIKE_RADIUS = { from: 0.12, to: 0.45 };
const CUT_COLOR = 0xff6b6b;
const CUT_RADIUS = 0.16;

/** 꼬리 조작을 돕는 표시: 잡을 수 있는 것, 잡은 자리, 상대 커서, 타격 자국, Q를 누르는 동안 자를 자리 */
export class TailOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly sim: Simulation;

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.sim = sim;
    this.graphics = scene.add.graphics().setDepth(DEPTH);
  }

  /** showTarget은 화면에 커서가 없을 때(상대 커서) 꼬리가 노리는 자리를 그릴지다 */
  update(showTarget: boolean): void {
    const g = this.graphics.clear();
    const { tori, strikes, stepCount, controller } = this.sim;
    const tip = this.sim.pointOf(tori.tail.tipLink.body, tori.tail.tipAnchor);

    const { near, holding } = tori.grab;
    if (near) this.ring(this.sim.poseOf(near.body), 0.16, NEAR_COLOR, 0.9);
    if (holding) g.fillStyle(HOLD_COLOR, 0.9).fillCircle(toPx(tip.x), toPx(tip.y), toPx(0.05));

    if (showTarget && controller.target) {
      this.ring(controller.target, 0.07, TARGET_COLOR, 0.8);
      g.fillStyle(TARGET_COLOR, 0.8).fillCircle(toPx(controller.target.x), toPx(controller.target.y), 2);
    }

    for (const { x, y, step } of strikes.recent) {
      const t = (stepCount - step) / STRIKE_STEPS;
      if (t < 1) this.ring({ x, y }, STRIKE_RADIUS.from + (STRIKE_RADIUS.to - STRIKE_RADIUS.from) * t, STRIKE_COLOR, 1 - t);
    }
    this.drawCutHold();
  }

  /** 디버그 키 Q를 누르는 동안, 끝 구간이 붙은 관절에 고리가 차오른다. 다 차면 그 자리가 끊긴다. */
  private drawCutHold(): void {
    const progress = this.sim.cutHoldProgress;
    const point = this.sim.tori.tail.cutPoint;
    if (progress <= 0 || !point) return;
    const [x, y, radius] = [toPx(point.x), toPx(point.y), toPx(CUT_RADIUS)];
    this.graphics.lineStyle(3, CUT_COLOR, 0.3).strokeCircle(x, y, radius);
    this.graphics.lineStyle(3, CUT_COLOR, 1);
    this.graphics.beginPath();
    this.graphics.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    this.graphics.strokePath();
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private ring({ x, y }: Point, radius: number, color: number, alpha: number): void {
    this.graphics.lineStyle(3, color, alpha).strokeCircle(toPx(x), toPx(y), toPx(radius));
  }
}
