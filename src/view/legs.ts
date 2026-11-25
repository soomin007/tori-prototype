import type { GameConfig } from '../config/defaults';
import type { Pose } from '../physics/world';
import type { Point } from '../rooms/rooms';

/** 다리 하나의 그릴 자세 */
export interface Leg {
  readonly front: boolean;
  readonly near: boolean;
  hip: Point;
  knee: Point;
  foot: Point;
  /** 무릎이 굽는 쪽. 그림을 뒤집을 때도 쓴다. */
  facing: 1 | -1;
}

export interface LegInput {
  pose: Pose;
  velocityX: number;
  /** 방향 전환의 진행(-1~1). 다리 붙는 자리가 이 값을 따라 반대쪽으로 넘어간다. */
  turn: number;
  grounded: boolean;
  groundBelow(x: number, y: number, maxDistance: number): number | null;
}

interface State extends Leg {
  mode: 'planted' | 'stepping' | 'air';
  /** 걸음의 진행(0~1)과 출발한 자리 */
  progress: number;
  from: Point;
}

/** 먼 쪽과 가까운 쪽 다리를 앞뒤로 어긋나게 두는 거리(m) */
const SIDE_SHIFT = 0.04;
/** 이보다 느리면 서 있는 것으로 본다(m/s) */
const IDLE_SPEED = 0.15;
/** 서 있을 때 발이 제자리에서 벗어나도 되는 거리(m) */
const IDLE_SLACK = 0.06;
/** 공중에서 발이 늘어진 자세로 돌아가는 시간(초) */
const AIR_SECONDS = 0.07;
/** 공중에서 다리를 편 정도 */
const AIR_STRETCH = 0.8;
/** 다리를 다 폈을 때 무릎이 튀지 않게 남기는 여유 */
const MAX_STRETCH = 0.995;

/**
 * 걷는 다리 그림. 물리에는 아무 영향이 없다.
 * 발을 바닥에 딛고 있다가 몸이 보폭만큼 지나가면 앞으로 옮긴다. 대각선 짝끼리 번갈아 옮긴다.
 */
export class LegRig {
  readonly legs: readonly Leg[];
  private readonly states: State[];
  private started = false;

  constructor() {
    this.states = [true, false].flatMap((front) => [true, false].map((near) => newLeg(front, near)));
    this.legs = this.states;
  }

  update(dt: number, config: GameConfig, input: LegInput): void {
    const reach = (config.legs.upper + config.legs.lower) * MAX_STRETCH;
    for (const leg of this.states) {
      const previousHip = leg.hip;
      leg.hip = hipPosition(leg, config, input);
      leg.facing = input.turn >= 0 ? 1 : -1;
      const shift = { x: leg.hip.x - previousHip.x, y: leg.hip.y - previousHip.y };
      this.updateFoot(leg, dt, config, input, reach, shift);
      limitReach(leg, reach);
      leg.knee = solveKnee(leg, config.legs.upper, config.legs.lower);
    }
    this.started = true;
  }

  private updateFoot(leg: State, dt: number, config: GameConfig, input: LegInput, reach: number, shift: Point): void {
    const { legs } = config;
    const { velocityX } = input;
    const target = input.grounded ? this.footTarget(leg, config, input, reach) : null;

    if (!target) {
      // 공중이거나 발밑이 비었다. 몸을 따라가며 아래로 늘어진다.
      const rest = { x: leg.hip.x, y: leg.hip.y + reach * AIR_STRETCH };
      const blend = this.started ? 1 - Math.exp(-dt / AIR_SECONDS) : 1;
      leg.mode = 'air';
      leg.foot.x += shift.x + (rest.x - leg.foot.x - shift.x) * blend;
      leg.foot.y += shift.y + (rest.y - leg.foot.y - shift.y) * blend;
      return;
    }

    if (!this.started) {
      leg.foot = target;
      leg.mode = 'planted';
    } else if (leg.mode === 'air') {
      startStep(leg, 0.5);
    } else if (leg.mode === 'planted' && this.shouldStep(leg, config, velocityX, reach)) {
      startStep(leg, 0);
    }

    if (leg.mode !== 'stepping') return;
    leg.progress = Math.min(1, leg.progress + dt / legs.stepSeconds);
    const t = leg.progress;
    leg.foot.x = leg.from.x + (target.x - leg.from.x) * t;
    leg.foot.y = leg.from.y + (target.y - leg.from.y) * t - legs.lift * Math.sin(Math.PI * t);
    if (t === 1) leg.mode = 'planted';
  }

  /** 다음에 디딜 자리. 걷는 쪽으로 보폭만큼 앞이다. 발이 닿을 바닥이 없으면 null이다. */
  private footTarget(leg: State, { legs, move }: GameConfig, { velocityX, groundBelow }: LegInput, reach: number): Point | null {
    const ahead = legs.stride * clampUnit(velocityX / (move.maxSpeed * 0.5));
    for (const x of [leg.hip.x + ahead, leg.hip.x]) {
      const y = groundBelow(x, leg.hip.y, reach);
      if (y !== null) return { x, y };
    }
    return null;
  }

  private shouldStep(leg: State, { legs }: GameConfig, velocityX: number, reach: number): boolean {
    const behind = leg.foot.x - leg.hip.x;
    if (Math.hypot(behind, leg.foot.y - leg.hip.y) > reach) return true;
    // 다른 대각선 짝이 발을 옮기는 중이면 기다린다
    if (this.states.some((other) => other.mode === 'stepping' && diagonal(other) !== diagonal(leg))) return false;
    if (Math.abs(velocityX) < IDLE_SPEED) return Math.abs(behind) > IDLE_SLACK;
    return behind * Math.sign(velocityX) < -legs.stride || Math.abs(behind) > legs.stride * 1.5;
  }
}

function newLeg(front: boolean, near: boolean): State {
  const zero = (): Point => ({ x: 0, y: 0 });
  return { front, near, facing: 1, hip: zero(), knee: zero(), foot: zero(), mode: 'air', progress: 0, from: zero() };
}

/** 오른쪽 앞과 왼쪽 뒤, 왼쪽 앞과 오른쪽 뒤가 한 짝이다 */
function diagonal(leg: Leg): boolean {
  return leg.front === leg.near;
}

function startStep(leg: State, progress: number): void {
  leg.mode = 'stepping';
  leg.progress = progress;
  leg.from = { ...leg.foot };
}

function hipPosition(leg: Leg, { legs }: GameConfig, { pose, turn }: LegInput): Point {
  const x = (leg.front ? legs.frontX : -legs.hindX) * turn + (leg.near ? -SIDE_SHIFT : SIDE_SHIFT) * turn;
  const [cos, sin] = [Math.cos(pose.angle), Math.sin(pose.angle)];
  return { x: pose.x + x * cos - legs.hipY * sin, y: pose.y + x * sin + legs.hipY * cos };
}

function limitReach(leg: State, reach: number): void {
  const [dx, dy] = [leg.foot.x - leg.hip.x, leg.foot.y - leg.hip.y];
  const length = Math.hypot(dx, dy);
  if (length <= reach) return;
  leg.foot = { x: leg.hip.x + (dx * reach) / length, y: leg.hip.y + (dy * reach) / length };
}

/** 앞다리 팔꿈치는 뒤로, 뒷다리 무릎은 앞으로 굽는다 */
function solveKnee({ hip, foot, front, facing }: Leg, upper: number, lower: number): Point {
  const [dx, dy] = [foot.x - hip.x, foot.y - hip.y];
  const distance = Math.max(Math.hypot(dx, dy), Math.abs(upper - lower) + 1e-3);
  const inner = Math.acos(clampUnit((upper * upper + distance * distance - lower * lower) / (2 * upper * distance)));
  // 다리가 아래(90도)를 볼 때 각도가 커지면 화면 왼쪽으로 굽는다
  const bend = (front ? 1 : -1) * facing;
  const angle = Math.atan2(dy, dx) + bend * inner;
  return { x: hip.x + Math.cos(angle) * upper, y: hip.y + Math.sin(angle) * upper };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
