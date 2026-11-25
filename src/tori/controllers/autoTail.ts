import { DEG, FIXED_DT } from '../../config/defaults';
import type { Point } from '../../rooms/rooms';
import type { InputState } from '../../sim/inputState';
import { TailGrab } from '../grab';
import type { Grabbable } from '../grab';
import type { TailCommand } from '../tail';
import { aimPose, raisedPose } from './aim';
import type { TailContext, TailController } from './aim';

/** B 방식. 평소에는 저절로 살랑이고, 키를 누르면 휘두르거나 잡으러 간다. */
export class AutoTail implements TailController {
  target: Point | null = null;
  private time = 0;
  /** 휘두르기를 시작한 뒤 지난 시간. 휘두르지 않으면 null이다. */
  private swing: number | null = null;
  /** 잡으러 가는 대상. 키를 누르고 있는 동안 바꾸지 않는다. */
  private chosen: Grabbable | null = null;

  update(input: InputState, context: TailContext): TailCommand {
    const { tori } = context;
    this.time += FIXED_DT;
    this.target = null;
    const command: TailCommand = { pose: [], strength: 1, pull: null, grab: input.held.grab };

    this.advanceSwing(input.pressed.attack && !tori.grab.hooked, context);
    this.chosen = input.held.grab ? this.choose(context) : null;

    if (tori.grab.hooked) command.pose = this.relaxed(context);
    else if (this.swing !== null) this.swingPose(this.swing, command, context);
    else if (tori.grab.holding) command.pose = this.aim(this.carryPoint(context), context);
    // 끝이 아니라 밑동에서 가까운 점을 노린다. 끝에서 가까운 점은 끝이 지나칠 때 함께 밀려간다.
    else if (this.chosen) command.pose = this.aim(TailGrab.closestPoint(this.chosen, tori.tail.hip(tori.turn)), context);
    else command.pose = this.idle(context);
    return command;
  }

  private aim(target: Point, context: TailContext): number[] {
    this.target = target;
    return aimPose(context, target);
  }

  // ---- 평소 ----

  private idle(context: TailContext): number[] {
    const { idleRaiseDeg, idleCurlDeg, waveDeg, waveHz, waveLag } = context.config.auto;
    const pose = raisedPose(context, idleRaiseDeg, idleCurlDeg);
    const phase = this.time * waveHz * 2 * Math.PI;
    return pose.map((angle, i) => angle + waveDeg * DEG * Math.sin(phase - i * waveLag));
  }

  /** 매달린 동안에는 밑동 각을 고집하지 않고 곧게 늘어진다 */
  private relaxed({ tori }: TailContext): number[] {
    return tori.tail.links.map((_, i) => (i === 0 ? tori.tail.jointAngle(0) : 0));
  }

  // ---- 휘두르기 ----

  private advanceSwing(pressed: boolean, { config, tori }: TailContext): void {
    const { windSeconds, strikeSeconds, recoverSeconds } = config.auto;
    if (this.swing !== null) {
      this.swing += FIXED_DT;
      if (this.swing >= windSeconds + strikeSeconds + recoverSeconds || tori.grab.hooked) this.swing = null;
    }
    if (pressed && this.swing === null) this.swing = 0;
  }

  /** 뒤로 젖혔다가 앞으로 넘기고 평소 자세로 돌아온다 */
  private swingPose(time: number, command: TailCommand, context: TailContext): void {
    const { auto } = context.config;
    const idle = this.idle(context);
    const wind = raisedPose(context, auto.windRaiseDeg, auto.windCurlDeg);
    const strike = raisedPose(context, auto.strikeRaiseDeg, auto.strikeCurlDeg);
    const strikeEnd = auto.windSeconds + auto.strikeSeconds;
    if (time < auto.windSeconds) {
      command.pose = blend(idle, wind, smooth(time / auto.windSeconds));
    } else if (time < strikeEnd) {
      // 목표를 한 번에 앞으로 옮기고, 얼마나 빨리 따라갈지는 모터의 힘 상한이 정한다
      command.pose = strike;
      command.strength = auto.strikePower;
    } else {
      command.pose = blend(strike, idle, smooth((time - strikeEnd) / auto.recoverSeconds));
    }
  }

  // ---- 잡기 ----

  /** 밑동에서 가장 가까운 잡을 수 있는 것 */
  private choose({ tori, config, grabbables }: TailContext): Grabbable | null {
    const hip = tori.tail.hip(tori.turn);
    const reach = tori.tail.length * config.auto.reachFactor;
    const distanceTo = (target: Grabbable): number => {
      const { x, y } = TailGrab.closestPoint(target, hip);
      return Math.hypot(x - hip.x, y - hip.y);
    };
    if (tori.grab.holding) return tori.grab.holding;
    if (this.chosen && distanceTo(this.chosen) <= reach) return this.chosen;
    let best: Grabbable | null = null;
    let bestDistance = reach;
    for (const target of grabbables) {
      const distance = distanceTo(target);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** 들고 있을 때 꼬리 끝을 둘 자리(몸통 위) */
  private carryPoint({ tori, config }: TailContext): Point {
    const { x, y } = tori.torso.translation();
    return { x: x - config.auto.carryBack * tori.turn, y: y - config.auto.carryUp };
  }
}

function blend(from: number[], to: number[], t: number): number[] {
  return from.map((angle, i) => angle + (to[i] - angle) * t);
}

/** 천천히 시작해 천천히 끝나는 진행 */
function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
