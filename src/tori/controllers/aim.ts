import { DEG } from '../../config/defaults';
import type { GameConfig } from '../../config/defaults';
import { angleDiff, toLocal } from '../../physics/world';
import type { Point } from '../../rooms/rooms';
import type { InputState } from '../../sim/inputState';
import type { Tori } from '../body';
import type { Grabbable } from '../grab';
import type { TailCommand } from '../tail';
import { arcToPose, solveArc } from '../tailIk';

export interface TailContext {
  tori: Tori;
  config: GameConfig;
  grabbables: readonly Grabbable[];
}

/** 조작 방식 하나. 입력을 읽어 꼬리의 목표 자세를 정한다. */
export interface TailController {
  /** 지금 노리는 자리. 그리기 쪽에서 보여 준다. */
  readonly target: Point | null;
  update(input: InputState, context: TailContext): TailCommand;
}

/** 꼬리 끝이 target에 닿는 자세 */
export function aimPose({ tori, config }: TailContext, target: Point): number[] {
  const { tail, torso, turn } = tori;
  const hip = toLocal(torso, tail.hip(turn));
  const local = toLocal(torso, target);
  const links = tail.links.length;
  const { min, max } = tail.rootRange(turn);
  const bends = tail.links.slice(1).map((_, i) => tail.jointAngle(i + 1));
  const pose = solveArc({
    links,
    linkLength: config.tail.linkLength,
    target: { x: local.x - hip.x, y: local.y - hip.y },
    rootMin: min,
    rootMax: max,
    bendMax: config.tail.jointLimitDeg * DEG,
    floor: tori.grounded ? tori.standDistance + config.tail.hipY : Infinity,
    current: {
      root: tail.jointAngle(0),
      bend: bends.length === 0 ? 0 : bends.reduce((sum, bend) => sum + bend, 0) / bends.length,
    },
  });
  return arcToPose(pose, links);
}

/** 밑동이 target을 향해 곧게 뻗은 자세. 끝만 당길 때 꼬리가 한 바퀴 말려 풀리지 않는 것을 막는다. */
export function straightPose({ tori }: TailContext, target: Point): number[] {
  const { tail, torso, turn } = tori;
  const hip = toLocal(torso, tail.hip(turn));
  const local = toLocal(torso, target);
  const { min, max } = tail.rootRange(turn);
  const center = (min + max) / 2;
  const root = center + angleDiff(Math.atan2(local.x - hip.x, hip.y - local.y), center);
  return tail.links.map((_, i) => (i === 0 ? root : 0));
}

/**
 * 밑동을 뒤쪽 수평에서 raiseDeg만큼 들고 관절마다 curlDeg만큼 만 자세.
 * 왼쪽을 보면 부호가 뒤집히고, 돌아서는 동안에는 위를 지나 반대쪽으로 넘어간다.
 */
export function raisedPose({ tori }: TailContext, raiseDeg: number, curlDeg: number): number[] {
  const { turn, tail } = tori;
  return tail.links.map((_, i) => turn * (i === 0 ? raiseDeg - 90 : curlDeg) * DEG);
}

/** 밑동에서 꼬리 길이 안으로 자른 자리 */
export function withinReach({ tori }: TailContext, target: Point): Point {
  const hip = tori.tail.hip(tori.turn);
  const [dx, dy] = [target.x - hip.x, target.y - hip.y];
  const scale = Math.min(1, tori.tail.length / Math.max(Math.hypot(dx, dy), 1e-6));
  return { x: hip.x + dx * scale, y: hip.y + dy * scale };
}
