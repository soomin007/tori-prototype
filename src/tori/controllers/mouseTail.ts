import type { Point } from '../../rooms/rooms';
import type { InputState } from '../../sim/inputState';
import type { TailCommand } from '../tail';
import { aimPose, raisedPose, straightPose, withinReach } from './aim';
import type { TailContext, TailController } from './aim';

/** A 방식. 마우스 커서를 꼬리 끝의 목표점으로 삼는다. */
export class MouseTail implements TailController {
  target: Point | null = null;
  /** 상대 커서에서 몸통 중심으로부터 가상 커서까지 */
  private offset: Point | null = null;

  update(input: InputState, context: TailContext): TailCommand {
    const { mouse, auto } = context.config;
    this.target = mouse.relative ? this.virtualCursor(input, context) : this.cursor(input, context);
    const command: TailCommand = {
      // 마우스를 아직 움직이지 않았으면 뒤로 늘어뜨린다
      pose: raisedPose(context, auto.idleRaiseDeg, auto.idleCurlDeg),
      strength: 1,
      pull: null,
      grab: input.held.pointerGrab,
    };
    if (!this.target) return command;
    if (mouse.pullTip) {
      command.pull = this.target;
      command.pose = straightPose(context, this.target);
    } else {
      command.pose = aimPose(context, this.target);
    }
    return command;
  }

  private cursor({ pointer, pointerActive }: InputState, context: TailContext): Point | null {
    this.offset = null;
    return pointerActive ? withinReach(context, pointer) : null;
  }

  /** 마우스가 움직인 만큼 옮긴다. 꼬리가 닿는 반경을 벗어나지 않고, 몸이 움직이면 같이 움직인다. */
  private virtualCursor({ pointerDelta }: InputState, context: TailContext): Point {
    const { sensitivity } = context.config.mouse;
    const center = context.tori.torso.translation();
    const from = this.offset ?? this.startOffset(context);
    const moved = {
      x: center.x + from.x + pointerDelta.x * sensitivity,
      y: center.y + from.y + pointerDelta.y * sensitivity,
    };
    const target = withinReach(context, moved);
    this.offset = { x: target.x - center.x, y: target.y - center.y };
    return target;
  }

  private startOffset({ tori }: TailContext): Point {
    const center = tori.torso.translation();
    const { tip } = tori.tail;
    return { x: tip.x - center.x, y: tip.y - center.y };
  }
}
