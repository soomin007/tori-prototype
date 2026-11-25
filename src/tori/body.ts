import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups, groundProbeGroups } from '../physics/groups';
import { lerpAngle } from '../physics/world';
import type { PhysicsWorld } from '../physics/world';
import type { Point, Surface } from '../rooms/rooms';
import type { InputState } from '../sim/inputState';

/** 디버그 그리기용 레이캐스트 한 줄 */
export interface ProbeLine {
  from: Point;
  to: Point;
  hit: boolean;
}

interface GroundHit extends Point {
  /** 몸통 중심에서 레이캐스트를 쏜 자리까지, 몸통 방향 */
  offset: number;
  distance: number;
  collider: RAPIER.Collider;
}

type SurfaceLookup = (collider: RAPIER.Collider) => Surface;

const DEG = Math.PI / 180;
const DOWN = { x: 0, y: 1 };
/** 감쇠가 한 스텝에 속도를 뒤집지 않게 하는 상한 */
const MAX_DAMPING_PER_STEP = 0.8;

/**
 * 토리의 몸통과 머리. 몸통은 바닥에 끌지 않고 레이캐스트 스프링으로 띄우고, 회전은 잠그지 않는다.
 * 물리도 화면처럼 y가 아래로 커진다. 그래서 양의 각도는 화면에서 시계 방향이고, 위쪽 속도는 음수다.
 */
export class Tori {
  readonly torso: RAPIER.RigidBody;
  readonly head: RAPIER.RigidBody;
  /** 능력표의 balance(M3). 직립 세기에 곱한다. */
  balance = 1;
  /** 바라보는 쪽. 오른쪽 1, 왼쪽 -1 */
  facing: 1 | -1 = 1;
  /** 방향 전환의 진행. -1(왼쪽)과 1(오른쪽) 사이를 turnSeconds에 걸쳐 움직인다. */
  turn = 1;
  grounded = false;
  /** 발밑 경사(라디안). 오른쪽이 낮으면 양수다. */
  slope = 0;
  surface: Surface = 'normal';
  probeLines: ProbeLine[] = [];

  private readonly config: GameConfig;
  private readonly world: RAPIER.World;
  private readonly surfaceOf: SurfaceLookup;
  private readonly neck: RAPIER.RevoluteImpulseJoint;
  private readonly torsoCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;
  /** 뛴 직후 띄우는 힘을 끄는 남은 시간 */
  private floatOff = 0;
  /** 발판을 벗어난 뒤 점프를 받아 주는 남은 시간 */
  private coyote = 0;
  /** 미리 누른 점프를 기억하는 남은 시간 */
  private buffer = 0;

  constructor(physics: PhysicsWorld, config: GameConfig, spawn: Point, surfaceOf: SurfaceLookup) {
    this.config = config;
    this.world = physics.raw;
    this.surfaceOf = surfaceOf;
    const { torso, head } = config;

    // 스프링으로 떠 있는 몸은 늘 힘을 받으므로 재우지 않는다
    const dynamic = (x: number, y: number): RAPIER.RigidBody =>
      this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setCanSleep(false));

    this.torso = dynamic(spawn.x, spawn.y);
    const radius = torso.thickness / 2;
    const halfStraight = Math.max(0.01, torso.length / 2 - radius);
    this.torsoCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfStraight, radius)
        .setRotation(Math.PI / 2)
        .setMass(torso.mass)
        .setCollisionGroups(collisionGroups('Body')),
      this.torso,
    );

    this.head = dynamic(spawn.x + head.neckX + head.forward, spawn.y - head.neckY - head.up);
    this.headCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(head.radius).setMass(head.mass).setCollisionGroups(collisionGroups('Body')),
      this.head,
    );

    const { torsoAnchor, headAnchor } = this.neckAnchors();
    const joint = RAPIER.JointData.revolute(torsoAnchor, headAnchor);
    this.neck = this.world.createImpulseJoint(joint, this.torso, this.head, true) as RAPIER.RevoluteImpulseJoint;
    this.neck.setContactsEnabled(false);
    this.applyConfig();

    physics.track(this.torso);
    physics.track(this.head);
  }

  /** 실행 중에 바뀐 값 가운데 매 스텝 읽지 않는 것을 반영한다 */
  applyConfig(): void {
    const { torso, head } = this.config;
    for (const collider of [this.torsoCollider, this.headCollider]) {
      collider.setFriction(torso.friction);
      collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    }
    const limit = head.limitDeg * DEG;
    this.neck.setLimits(-limit, limit);
    this.neck.configureMotorPosition(0, head.stiffness, head.damping);
  }

  get mass(): number {
    return this.torso.mass() + this.head.mass();
  }

  /** 물리 스텝 직전에 한 번 부른다 */
  step(input: InputState): void {
    // addForce로 준 힘은 지울 때까지 남는다
    this.torso.resetForces(true);
    this.torso.resetTorques(true);

    this.updateFacing(input.moveX);
    const hits = this.probeGround();
    this.updateGround(hits);
    this.jump(input.pressed.jump);
    if (this.grounded) this.floatUp(hits);
    this.move(input.moveX);
    this.keepUpright();
  }

  // ---- 방향 ----

  private updateFacing(moveX: number): void {
    if (moveX !== 0) this.facing = moveX > 0 ? 1 : -1;
    if (this.turn === this.facing) return;
    const before = this.headOffset();
    this.turn = approach(this.turn, this.facing, (2 * FIXED_DT) / this.config.move.turnSeconds);
    const after = this.headOffset();
    const { torsoAnchor, headAnchor } = this.neckAnchors();
    this.neck.setAnchor1(torsoAnchor);
    this.neck.setAnchor2(headAnchor);
    // 관절 앵커만 옮기면 솔버가 머리를 낚아채면서 그 반동으로 몸통이 크게 돈다(실측 49도). 머리도 같이 옮긴다.
    const { x, y } = this.head.translation();
    this.head.setTranslation({ x: x + after.x - before.x, y: y + after.y - before.y }, true);
  }

  /** 목이 꺾이지 않았을 때 몸통 중심에서 머리 중심까지 */
  private headOffset(): Point {
    const { torsoAnchor, headAnchor } = this.neckAnchors();
    const local = { x: torsoAnchor.x - headAnchor.x, y: torsoAnchor.y - headAnchor.y };
    const angle = this.torso.rotation();
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos };
  }

  private neckAnchors(): { torsoAnchor: Point; headAnchor: Point } {
    const { neckX, neckY, forward, up } = this.config.head;
    return {
      torsoAnchor: { x: neckX * this.turn, y: -neckY },
      headAnchor: { x: -forward * this.turn, y: up },
    };
  }

  // ---- 바닥 ----

  /** 몸통 축의 뒤, 가운데, 앞에서 아래로 쏜다. 화면 왼쪽 것이 먼저 오게 돌려준다. */
  private probeGround(): GroundHit[] {
    const { x, y } = this.torso.translation();
    const angle = this.torso.rotation();
    const { probeSpread } = this.config.float;
    const length = this.standDistance + this.config.float.reach;
    const groups = groundProbeGroups();

    const hits: GroundHit[] = [];
    this.probeLines = [];
    for (const offset of [-probeSpread, 0, probeSpread]) {
      const from = { x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset };
      const hit = this.world.castRay(new RAPIER.Ray(from, DOWN), length, true, undefined, groups);
      const distance = hit?.timeOfImpact ?? length;
      this.probeLines.push({ from, to: { x: from.x, y: from.y + distance }, hit: hit !== null });
      if (hit) hits.push({ x: from.x, y: from.y + distance, offset, distance, collider: hit.collider });
    }
    return hits.sort((a, b) => a.x - b.x);
  }

  /** 떠 있을 때 몸통 축에서 바닥까지의 거리 */
  private get standDistance(): number {
    return this.config.torso.thickness / 2 + this.config.float.clearance;
  }

  private updateGround(hits: GroundHit[]): void {
    const { jump, upright } = this.config;
    this.floatOff = Math.max(0, this.floatOff - FIXED_DT);
    this.grounded = hits.length > 0 && this.floatOff === 0;
    this.coyote = this.grounded ? jump.coyoteSeconds : Math.max(0, this.coyote - FIXED_DT);

    const blend = 1 - Math.exp(-FIXED_DT / Math.max(upright.slopeSmoothSeconds, 1e-3));
    this.slope += ((this.grounded ? this.measureSlope(hits) : 0) - this.slope) * blend;

    if (this.grounded) {
      const under = hits.find((hit) => hit.offset === 0) ?? nearest(hits);
      this.surface = this.surfaceOf(under.collider);
    }
  }

  private measureSlope(hits: GroundHit[]): number {
    const left = hits[0];
    const right = hits[hits.length - 1];
    if (right.x - left.x < 0.05) return 0;
    const slope = Math.atan2(right.y - left.y, right.x - left.x);
    return Math.abs(slope) <= this.config.upright.maxSlopeDeg * DEG ? slope : 0;
  }

  /** 가장 가까운 바닥을 기준으로 정해진 높이에 띄운다 */
  private floatUp(hits: GroundHit[]): void {
    const { float, physics } = this.config;
    const error = this.standDistance - nearest(hits).distance;
    const { x: vx, y: vy } = this.torso.linvel();
    // 경사를 걸을 때 바닥을 따라 오르내리는 속도는 출렁임이 아니므로 뺀다
    const bounce = vy - vx * Math.tan(this.slope);

    const omega = 2 * Math.PI * float.frequency;
    const damping = Math.min(2 * float.dampingRatio * omega, MAX_DAMPING_PER_STEP / FIXED_DT);
    const spring = Math.max(omega * omega * error + damping * bounce, -float.pullDown);

    // 무게를 받치는 힘은 전체 무게중심에 준다. 스프링 힘은 몸통에 주어 착지할 때 머리 무게로 기우뚱한다.
    // 일부만 바닥 위에 있으면 받치는 자리가 그쪽으로 옮겨 빈 쪽으로 기운다.
    const { x, y } = this.torso.translation();
    const support = hits.reduce((sum, hit) => sum + hit.x - x, 0) / hits.length;
    const lean = support * float.edgeLean;
    const weight = { x: this.centerOfMassX() + lean, y };
    this.torso.addForceAtPoint({ x: 0, y: -this.mass * physics.gravity }, weight, true);
    this.torso.addForceAtPoint({ x: 0, y: -this.mass * spring }, { x: x + lean, y }, true);
  }

  private centerOfMassX(): number {
    const weighted = [this.torso, this.head].reduce((sum, body) => sum + body.translation().x * body.mass(), 0);
    return weighted / this.mass;
  }

  // ---- 점프 ----

  private jump(pressed: boolean): void {
    const { jump } = this.config;
    this.buffer = pressed ? Math.max(jump.bufferSeconds, FIXED_DT) : Math.max(0, this.buffer - FIXED_DT);
    if (this.buffer === 0 || (!this.grounded && this.coyote === 0)) return;

    // 떨어지는 중이거나 튀어 오르는 중이어도 같은 높이를 뛰게 한다. 몸통과 머리에 나눠 주어 몸이 돌지 않는다.
    for (const body of [this.torso, this.head]) {
      body.applyImpulse({ x: 0, y: -body.mass() * (jump.speed + body.linvel().y) }, true);
    }
    this.grounded = false;
    this.buffer = 0;
    this.coyote = 0;
    this.floatOff = jump.floatOffSeconds;
  }

  // ---- 이동과 직립 ----

  private move(moveX: number): void {
    const { move, ground } = this.config;
    const vx = this.torso.linvel().x;
    const target = moveX * move.maxSpeed;
    // 가는 쪽으로 더 빨라질 때만 가속 값을 쓰고, 느려지거나 되돌아설 때는 감속 값을 쓴다
    const speedingUp = moveX !== 0 && vx * moveX >= 0 && Math.abs(target) > Math.abs(vx);
    let rate = speedingUp ? move.accel : move.decel;
    if (!this.grounded) rate *= move.airControl;
    else if (this.surface === 'slippery') rate *= speedingUp ? ground.slipperyAccel : ground.slipperyDecel;

    const force = this.mass * clamp((target - vx) / FIXED_DT, -rate, rate);
    const { x, y } = this.torso.translation();
    const lever = this.grounded ? move.lever : 0;
    this.torso.addForceAtPoint({ x: force, y: 0 }, { x, y: y + lever }, true);
  }

  /** 기울기에 PD 토크를 준다. 경사에서는 경사를 따라 눕는 만큼을 목표로 삼는다. */
  private keepUpright(): void {
    const { upright } = this.config;
    const factor = this.grounded ? 1 : upright.airFactor;
    const tilt = lerpAngle(0, this.torso.rotation() - this.slope * upright.slopeFollow, 1);
    const maxDamping = (this.torso.principalInertia() * MAX_DAMPING_PER_STEP) / FIXED_DT;
    const damping = Math.min(upright.damping * factor, maxDamping);
    const strength = upright.strength * this.balance * factor;
    this.torso.addTorque(-strength * tilt - damping * this.torso.angvel(), true);
  }
}

function nearest(hits: GroundHit[]): GroundHit {
  return hits.reduce((best, hit) => (hit.distance < best.distance ? hit : best));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(value: number, target: number, change: number): number {
  return value < target ? Math.min(target, value + change) : Math.max(target, value - change);
}
