import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT, PPM } from '../config/defaults';
import type { GameConfig } from '../config/defaults';

let ready: Promise<void> | undefined;

/** Rapier를 쓰기 전에 한 번 기다린다. 여러 번 불러도 한 번만 초기화한다. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export const toPx = (meters: number): number => meters * PPM;
export const toMeters = (px: number): number => px / PPM;

/** 위치(미터)와 각도(라디안) */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** 두 각도 사이를 짧은 쪽으로 잇는다. Rapier의 각도는 -π와 π 사이라 그냥 이으면 한 바퀴 돈다. */
export function lerpAngle(from: number, to: number, t: number): number {
  const turn = Math.PI * 2;
  const diff = ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
  return from + diff * t;
}

export function lerpPose(from: Pose, to: Pose, t: number): Pose {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    angle: lerpAngle(from.angle, to.angle, t),
  };
}

/** 프레임 시간을 모아 고정 스텝으로 나눈다 */
export class FixedStepper {
  private accumulator = 0;

  /**
   * 프레임 시간만큼 step을 부르고, 실제로 돌린 스텝 수를 돌려준다.
   * maxSteps보다 밀린 시간은 버린다(탭을 떠났다 돌아왔을 때 몰아서 돌지 않게).
   */
  advance(frameSeconds: number, maxSteps: number, step: () => void): number {
    this.accumulator += Math.max(0, frameSeconds);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < maxSteps) {
      step();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (this.accumulator >= FIXED_DT) this.accumulator %= FIXED_DT;
    return steps;
  }

  /** 직전 스텝(0)과 현재 스텝(1) 사이에서 지금 그릴 자리 */
  get alpha(): number {
    return this.accumulator / FIXED_DT;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/** Rapier 월드와, 보간에 쓸 직전 스텝의 자세를 들고 있는다 */
export class PhysicsWorld {
  readonly raw: RAPIER.World;
  private readonly tracked = new Map<RAPIER.RigidBody, { previous: Pose; current: Pose }>();

  constructor(config: GameConfig) {
    this.raw = new RAPIER.World({ x: 0, y: 0 });
    this.raw.timestep = FIXED_DT;
    this.applyConfig(config);
  }

  /** 실행 중에 바뀐 설정을 반영한다 */
  applyConfig(config: GameConfig): void {
    // 물리도 화면처럼 y가 아래로 커지므로 중력은 양수다
    this.raw.gravity = { x: 0, y: config.physics.gravity };
    this.raw.numSolverIterations = config.physics.solverIterations;
    // 잠든 물체는 중력이 바뀌어도 스스로 깨지 않는다
    this.raw.forEachRigidBody((body) => body.wakeUp());
  }

  /** 움직이는 물체를 보간 대상으로 등록한다 */
  track(body: RAPIER.RigidBody): void {
    const pose = readPose(body);
    this.tracked.set(body, { previous: pose, current: pose });
  }

  step(): void {
    this.raw.step();
    for (const [body, poses] of this.tracked) {
      poses.previous = poses.current;
      poses.current = readPose(body);
    }
  }

  /** 그릴 자세. 등록하지 않은 물체(움직이지 않는 지형)는 지금 자세를 그대로 준다. */
  poseOf(body: RAPIER.RigidBody, alpha: number): Pose {
    const poses = this.tracked.get(body);
    return poses ? lerpPose(poses.previous, poses.current, alpha) : readPose(body);
  }

  free(): void {
    this.tracked.clear();
    this.raw.free();
  }
}

function readPose(body: RAPIER.RigidBody): Pose {
  const { x, y } = body.translation();
  return { x, y, angle: body.rotation() };
}
