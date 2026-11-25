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
  /** 발을 들어 옮기는 중이거나 공중에 있다 */
  lifted: boolean;
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

type Mode = 'stance' | 'swing' | 'air';

interface State extends Leg {
  mode: Mode;
  /** 벌린 다리와 이음 보정을 더하기 전의 발 자리 */
  base: Point;
  /** 발을 들어 옮기기 시작한 자리와 진행(0~1) */
  from: Point;
  progress: number;
  /** 동작이 바뀔 때 그림이 튀지 않게 더했다가 줄여 가는 거리 */
  blend: Point;
}

/** 가까운 쪽과 먼 쪽 다리를 앞뒤로 어긋나게 두는 거리(m) */
const SIDE_SHIFT = 0.04;
/** 이보다 느리면 서 있는 것으로 본다(m/s) */
const IDLE_SPEED = 0.15;
/** 서 있을 때 발이 제자리에서 벗어나도 되는 거리(m) */
const IDLE_SLACK = 0.05;
/** 동작이 바뀔 때 보정이 줄어드는 시간(초) */
const BLEND_SECONDS = 0.04;
/** 공중에서 다리를 편 정도와, 앞뒤 짝이 서로 다르게 펴는 정도 */
const AIR_STRETCH = 0.75;
const AIR_STRETCH_SWAY = 0.08;
/** 다리를 다 폈을 때 무릎이 튀지 않게 남기는 여유 */
const MAX_STRETCH = 0.995;
/** 착지할 때 한 짝은 이미 디뎠고 다른 짝은 발을 이만큼 옮긴 것으로 시작한다 */
const LANDING_SWING = 0.5;

/**
 * 걷는 다리 그림. 물리에는 아무 영향이 없다.
 * 네 발을 박자 하나로 묶는다. 대각선 앞발과 뒷발이 한 짝이고 두 짝은 늘 반 박자 어긋난다.
 * 실제 도마뱀의 걸음을 본떴다. 서 있을 때와 공중에서도 좌우가 같은 자세가 되지 않는다.
 */
export class LegRig {
  readonly legs: readonly Leg[];
  private readonly states: State[];
  /** 걸음의 박자(0~1). 첫째 짝이 발을 디디는 순간이 0이다. */
  private phase = 0;
  /** 걷는 쪽(1, -1). 서 있으면 0 */
  private direction = 0;
  /** 서 있을 때 화면 오른쪽에 놓이는 짝(1이면 첫째 짝) */
  private restSign = 1;
  private sway = 0;
  private wasGrounded = true;
  private started = false;
  /** 이번 프레임에 박자를 다시 맞췄다 */
  private restarted = false;

  constructor() {
    this.states = [true, false].flatMap((front) => [true, false].map((near) => newLeg(front, near)));
    this.legs = this.states;
  }

  update(dt: number, config: GameConfig, input: LegInput): void {
    const landed = input.grounded && !this.wasGrounded;
    this.wasGrounded = input.grounded;
    this.advanceClock(dt, config, input, landed);

    const reach = (config.legs.upper + config.legs.lower) * MAX_STRETCH;
    for (const leg of this.states) {
      leg.facing = input.turn >= 0 ? 1 : -1;
      leg.hip = this.hipPosition(leg, config, input);
      this.moveFoot(leg, dt, config, input, reach, landed);
    }
    for (const leg of this.states) {
      const fade = Math.exp(-dt / BLEND_SECONDS);
      leg.blend = { x: leg.blend.x * fade, y: leg.blend.y * fade };
      // 다리를 옆으로 벌린 모습. 가까운 쪽 발은 화면 아래에, 먼 쪽 발은 위에 놓인다
      const spread = leg.near ? config.legs.sprawl : -config.legs.sprawl;
      leg.foot = { x: leg.base.x + leg.blend.x, y: leg.base.y + leg.blend.y + spread };
      leg.lifted = leg.mode !== 'stance';
      limitReach(leg, reach);
      leg.knee = solveKnee(leg, config.legs.upper, config.legs.lower);
    }
    this.started = true;
  }

  // ---- 박자 ----

  private advanceClock(dt: number, { legs, move }: GameConfig, { velocityX, grounded }: LegInput, landed: boolean): void {
    const speed = Math.abs(velocityX);
    const direction = !grounded || speed < IDLE_SPEED ? 0 : Math.sign(velocityX);
    const wasIdle = this.direction === 0;
    this.restarted = grounded && direction !== 0 && (landed || direction !== this.direction);
    if (this.restarted) {
      // 뒤처진 짝이 먼저 발을 떼도록 박자를 맞춘다. 착지할 때는 이미 디딘 짝이 있게 한다.
      const firstAhead = this.restSign * direction > 0;
      this.phase = firstAhead ? 0 : 0.5;
      if (landed) this.phase = this.phaseAtLanding(legs, speed, move.maxSpeed, firstAhead);
    }
    if (direction === 0 && !wasIdle && grounded) this.restSign = this.aheadSign();
    this.direction = direction;

    const duty = dutyOf(legs, speed, move.maxSpeed);
    const rate = grounded ? (duty * speed) / (2 * legs.stride) : legs.airPedal;
    if (direction !== 0 || !grounded) this.phase = wrap(this.phase + rate * dt);

    // 골반과 어깨의 흔들림은 걷는 동안만 있고, 멈추면 사라진다
    const target = direction === 0 ? 0 : 1;
    this.sway += (target - this.sway) * (1 - Math.exp(-dt / Math.max(legs.stepSeconds, 1e-3)));
  }

  /** 앞선 짝이 막 디딘 때, 다른 짝은 발을 반쯤 옮긴 때의 박자 */
  private phaseAtLanding(legs: GameConfig['legs'], speed: number, maxSpeed: number, firstAhead: boolean): number {
    const duty = dutyOf(legs, speed, maxSpeed);
    // 뒤처진 짝이 이 박자에서 옮기는 중이 되도록 앞선 짝의 박자를 정한다
    const laggingPhase = duty + (1 - duty) * LANDING_SWING;
    const aheadPhase = wrap(laggingPhase - 0.5);
    return firstAhead ? aheadPhase : wrap(aheadPhase - 0.5);
  }

  /** 첫째 짝의 발이 둘째 짝보다 화면 오른쪽에 있으면 1 */
  private aheadSign(): 1 | -1 {
    const offset = (pair: boolean): number =>
      this.states.filter((leg) => firstPair(leg) === pair).reduce((sum, leg) => sum + leg.base.x - leg.hip.x, 0);
    return offset(true) >= offset(false) ? 1 : -1;
  }

  private phaseOf(leg: Leg): number {
    return wrap(this.phase + (firstPair(leg) ? 0 : 0.5));
  }

  // ---- 발 ----

  private moveFoot(leg: State, dt: number, config: GameConfig, input: LegInput, reach: number, landed: boolean): void {
    const { legs, move } = config;
    const before = leg.base;
    const beforeMode = leg.mode;

    if (!input.grounded) {
      this.hang(leg, config, reach, beforeMode);
      return;
    }

    const duty = dutyOf(legs, Math.abs(input.velocityX), move.maxSpeed);
    const walking = this.direction !== 0;
    const p = this.phaseOf(leg);
    const target = this.footTarget(leg, config, input, reach, walking);
    if (!target) {
      this.hang(leg, config, reach, beforeMode);
      return;
    }

    if (walking) {
      if (p >= duty) {
        // 발을 옮긴다. 박자가 진행을 정하므로 두 짝이 함께 들리지 않는다.
        if (leg.mode !== 'swing') {
          leg.mode = 'swing';
          leg.from = { ...before };
        }
        const t = (p - duty) / (1 - duty);
        leg.progress = t;
        leg.base = swingPoint(leg.from, target, t, legs.lift);
      } else if (leg.mode !== 'stance') {
        leg.mode = 'stance';
        leg.base = target;
      }
    } else {
      this.stand(leg, dt, config, target, landed);
    }

    // 착지하거나 발을 옮기던 중에 박자를 다시 맞추면 발 자리가 건너뛴다. 그 거리를 보정으로 남겼다가 줄인다.
    if (this.started && (beforeMode === 'air' || (this.restarted && beforeMode === 'swing'))) {
      leg.blend = { x: leg.blend.x + before.x - leg.base.x, y: leg.blend.y + before.y - leg.base.y };
    }
    if (!this.started) {
      leg.base = { x: target.x, y: target.y };
      leg.mode = 'stance';
    }
  }

  /** 서 있을 때. 제자리에서 벗어난 짝만 한 짝씩 발을 옮긴다. */
  private stand(leg: State, dt: number, { legs }: GameConfig, target: Point, landed: boolean): void {
    if (leg.mode === 'air') {
      // 착지했다. 한 짝은 바로 딛고 다른 짝은 발을 옮겨 딛는다
      const first = firstPair(leg) === this.restSign > 0;
      leg.mode = first || !landed ? 'stance' : 'swing';
      if (leg.mode === 'stance') leg.base = { ...target };
      leg.from = { ...leg.base };
      leg.progress = LANDING_SWING;
    } else if (leg.mode === 'stance') {
      const far = Math.abs(target.x - leg.base.x) > IDLE_SLACK;
      const busy = this.states.some((other) => other.mode === 'swing' && firstPair(other) !== firstPair(leg));
      if (far && !busy) {
        leg.mode = 'swing';
        leg.from = { ...leg.base };
        leg.progress = 0;
      }
    } else {
      // 걷다가 멈추면 옮기던 발을 이어서 디딘다
      leg.progress = Math.min(1, leg.progress + dt / Math.max(legs.stepSeconds, 1e-3));
      leg.base = swingPoint(leg.from, target, leg.progress, legs.lift);
      if (leg.progress === 1) leg.mode = 'stance';
    }
  }

  /** 공중이거나 발밑이 비었을 때. 몸을 따라가며 아래로 늘어지고, 두 짝이 엇갈려 움직인다. */
  private hang(leg: State, { legs }: GameConfig, reach: number, beforeMode: Mode): void {
    const before = leg.base;
    const sway = Math.cos(2 * Math.PI * this.phaseOf(leg));
    leg.mode = 'air';
    leg.progress = 0;
    leg.base = {
      x: leg.hip.x + sway * legs.restSpread,
      y: leg.hip.y + reach * (AIR_STRETCH - sway * AIR_STRETCH_SWAY),
    };
    if (beforeMode !== 'air' && this.started) {
      leg.blend = { x: leg.blend.x + before.x - leg.base.x, y: leg.blend.y + before.y - leg.base.y };
    }
  }

  /** 다음에 디딜 자리. 걸을 때는 보폭만큼 앞이고, 설 때는 짝마다 앞뒤로 갈린다. 발이 닿을 바닥이 없으면 null이다. */
  private footTarget(leg: State, { legs }: GameConfig, { groundBelow }: LegInput, reach: number, walking: boolean): Point | null {
    const ahead = walking
      ? this.direction * legs.stride
      : (firstPair(leg) ? 1 : -1) * this.restSign * legs.restSpread;
    for (const x of [leg.hip.x + ahead, leg.hip.x]) {
      const y = groundBelow(x, leg.hip.y, reach);
      if (y !== null) return { x, y };
    }
    return null;
  }

  // ---- 엉덩이와 어깨 ----

  private hipPosition(leg: Leg, { legs }: GameConfig, { pose, turn }: LegInput): Point {
    const girdle = (leg.front ? legs.frontX : -legs.hindX) * turn;
    const side = (leg.near ? -SIDE_SHIFT : SIDE_SHIFT) * turn;
    // 골반과 어깨가 좌우로 도는 만큼, 발을 디딘 쪽이 앞으로 나간다(발을 떼기 직전에 가장 뒤로 간다)
    const swing = Math.cos(2 * Math.PI * this.phaseOf(leg)) * this.sway * this.direction;
    const pelvis = swing * legs.halfWidth * Math.sin((legs.pelvisDeg * Math.PI) / 180);
    const x = girdle + side + pelvis;
    const [cos, sin] = [Math.cos(pose.angle), Math.sin(pose.angle)];
    return { x: pose.x + x * cos - legs.hipY * sin, y: pose.y + x * sin + legs.hipY * cos };
  }
}

function newLeg(front: boolean, near: boolean): State {
  const zero = (): Point => ({ x: 0, y: 0 });
  return {
    front,
    near,
    facing: 1,
    lifted: false,
    hip: zero(),
    knee: zero(),
    foot: zero(),
    mode: 'stance',
    base: zero(),
    from: zero(),
    progress: 0,
    blend: zero(),
  };
}

/** 가까운 앞발과 먼 뒷발이 첫째 짝, 먼 앞발과 가까운 뒷발이 둘째 짝이다 */
function firstPair(leg: Leg): boolean {
  return leg.front === leg.near;
}

/** 발이 땅에 닿아 있는 비율. 빨라질수록 짧아진다. */
function dutyOf({ dutySlow, dutyFast }: GameConfig['legs'], speed: number, maxSpeed: number): number {
  const fast = Math.min(1, speed / Math.max(maxSpeed, 1e-3));
  return dutySlow + (dutyFast - dutySlow) * fast;
}

function swingPoint(from: Point, target: Point, t: number, lift: number): Point {
  return {
    x: from.x + (target.x - from.x) * t,
    y: from.y + (target.y - from.y) * t - lift * Math.sin(Math.PI * t),
  };
}

function wrap(value: number): number {
  return ((value % 1) + 1) % 1;
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
  const cosine = (upper * upper + distance * distance - lower * lower) / (2 * upper * distance);
  const inner = Math.acos(Math.min(1, Math.max(-1, cosine)));
  // 다리가 아래(90도)를 볼 때 각도가 커지면 화면 왼쪽으로 굽는다
  const bend = (front ? 1 : -1) * facing;
  const angle = Math.atan2(dy, dx) + bend * inner;
  return { x: hip.x + Math.cos(angle) * upper, y: hip.y + Math.sin(angle) * upper };
}
