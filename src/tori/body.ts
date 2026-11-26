import RAPIER from '@dimforge/rapier2d-compat';
import type { Abilities } from '../config/abilities';
import { DEG, FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups, groundProbeGroups } from '../physics/groups';
import { angleDiff, lerpAngle } from '../physics/world';
import type { PhysicsWorld } from '../physics/world';
import type { Point, Surface } from '../rooms/rooms';
import type { InputState } from '../sim/inputState';
import { TailGrab } from './grab';
import type { Grabbable } from './grab';
import { SeveredTail, Tail } from './tail';
import type { TailCommand } from './tail';

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

/** 토리가 방에 대해 아는 것 */
export interface Surroundings {
  surfaceOf(collider: RAPIER.Collider): Surface;
  grabbables: readonly Grabbable[];
}

const DOWN = { x: 0, y: 1 };
/** 감쇠가 한 스텝에 속도를 뒤집지 않게 하는 상한 */
const MAX_DAMPING_PER_STEP = 0.8;

/**
 * 토리의 몸통, 머리, 꼬리. 몸통은 바닥에 끌지 않고 레이캐스트 스프링으로 띄우고, 회전은 잠그지 않는다.
 * 물리도 화면처럼 y가 아래로 커진다. 그래서 양의 각도는 화면에서 시계 방향이고, 위쪽 속도는 음수다.
 */
export class Tori {
  readonly torso: RAPIER.RigidBody;
  readonly head: RAPIER.RigidBody;
  readonly tail: Tail;
  readonly grab: TailGrab;
  /** 능력표의 balance. 직립 세기에 곱한다. */
  balance = 1;
  /** 능력표의 canGrab. 꺼져 있으면 꼬리 끝만 꼼지락거린다. */
  canGrab = true;
  /** 바라보는 쪽. 오른쪽 1, 왼쪽 -1 */
  facing: 1 | -1 = 1;
  /** 방향 전환의 진행. -1(왼쪽)과 1(오른쪽) 사이를 turnSeconds에 걸쳐 움직인다. */
  turn = 1;
  grounded = false;
  /** 발밑 경사(라디안). 오른쪽이 낮으면 양수다. */
  slope = 0;
  surface: Surface = 'normal';
  probeLines: ProbeLine[] = [];
  /** 결투에서 쓰러져 있는지. 직립 유지와 이동을 끄고 꼬리는 늘어뜨린다(PLAN 7.6). 방을 다시 만들면 풀린다. */
  downed = false;
  /** 대본 사건의 구조물에 깔려 있는지(PLAN 7.8). downed와 함께 켜지고, 배를 아래로 한 채 구조물 밑에 붙잡힌다. */
  pinned = false;

  private readonly config: GameConfig;
  private readonly world: RAPIER.World;
  private readonly surroundings: Surroundings;
  private readonly neck: RAPIER.RevoluteImpulseJoint;
  private readonly torsoCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;
  /** 뛴 직후 띄우는 힘을 끄는 남은 시간 */
  private floatOff = 0;
  /** 발판을 벗어난 뒤 점프를 받아 주는 남은 시간 */
  private coyote = 0;
  /** 미리 누른 점프를 기억하는 남은 시간 */
  private buffer = 0;
  private time = 0;
  /** 버둥거릴 때 꼬리를 흔드는 남은 시간과 방향 */
  private flail = 0;
  private flailSide = 1;
  /** 깔린 몸통을 붙잡아 두는 x */
  private pinX = 0;

  /** sections는 꼬리에 붙일 구간 수(남은 구간)다 */
  constructor(
    physics: PhysicsWorld,
    config: GameConfig,
    spawn: Point,
    surroundings: Surroundings,
    sections = config.tail.sections,
  ) {
    this.config = config;
    this.world = physics.raw;
    this.surroundings = surroundings;
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

    physics.track(this.torso);
    physics.track(this.head);
    this.tail = new Tail(physics, config, this.torso, this.turn, sections);
    this.grab = new TailGrab(physics, config, surroundings.grabbables);
    this.applyConfig();
  }

  /** 능력표 한 줄에서 이미 자리가 있는 값을 반영한다(PLAN 7.5) */
  applyAbilities({ balance, canGrab }: Abilities): void {
    this.balance = balance;
    this.canGrab = canGrab;
  }

  /**
   * 꼬리 끝 구간을 떼어 낸다. 잡기를 먼저 정리해, 걸린 가지는 놓고 들고 있던 물건은 잘린 꼬리에 남긴다.
   * 자를 구간이 없으면 null이다.
   */
  cutTail(): SeveredTail | null {
    if (this.tail.sectionCount === 0) return null;
    const carried = this.grab.detachForCut();
    const links = this.tail.sever();
    if (!links) return null;
    return new SeveredTail(this.config, links, this.turn >= 0 ? 1 : -1, carried);
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
    this.tail.applyConfig();
  }

  /** 몸통과 머리의 콜라이더. 결투에서 상대의 공격이 여기에 닿으면 맞은 것이다. 꼬리는 넣지 않는다(PLAN 7.6). */
  get colliders(): readonly RAPIER.Collider[] {
    return [this.torsoCollider, this.headCollider];
  }

  /**
   * 맞아서 밀려난다. 몸 전체를 적어도 speed로 direction 쪽으로, lift로 위로 움직이게 한다.
   * 부딪혀서 이미 그보다 빠르면 더 보태지 않는다. 떠오르는 동안 띄우는 힘을 잠깐 끈다.
   */
  knockback(direction: number, speed: number, lift: number): void {
    const { x: vx, y: vy } = this.torso.linvel();
    const change = { x: direction * Math.max(direction * vx, speed) - vx, y: Math.min(vy, -lift) - vy };
    for (const body of [this.torso, this.head, ...this.tail.links.map((link) => link.body)]) {
      body.applyImpulse({ x: body.mass() * change.x, y: body.mass() * change.y }, true);
    }
    if (lift > 0) {
      this.floatOff = Math.max(this.floatOff, this.config.jump.floatOffSeconds);
      this.grounded = false;
    }
  }

  /** 결투에서 쓰러진다. direction은 밀려난 쪽이고, 그쪽으로 몸이 돈다. 잡고 있던 것은 놓는다. */
  knockDown(direction: number): void {
    this.downed = true;
    this.grab.update(false, this.tail, this.colliders);
    this.torso.setAngvel(this.torso.angvel() + direction * this.config.duel.downSpin, true);
  }

  /**
   * 대본 사건의 구조물에 깔린다(PLAN 7.8). 쓰러졌을 때처럼 직립 유지, 이동, 점프를 끄지만, 뒤집히지 않고 배를 아래로 한 채
   * x 자리에 붙잡힌다. 잡고 있던 것은 놓는다.
   */
  pinDown(x: number): void {
    this.downed = true;
    this.pinned = true;
    this.pinX = x;
    this.grab.update(false, this.tail, this.colliders);
  }

  /** 쓰러져 버둥거린다. 몸을 side 쪽으로 조금 돌리고 꼬리를 흔든다. 입력마다 눈에 보이게 반응한다(PLAN 7.6). */
  struggle(side: number, twitch: number): void {
    this.torso.applyTorqueImpulse(side * twitch, true);
    this.flail = this.config.duel.struggleWiggleSeconds;
    this.flailSide = side;
  }

  /** 몸통과 머리의 질량 */
  get bodyMass(): number {
    return this.torso.mass() + this.head.mass();
  }

  /** 꼬리까지 더한 질량 */
  get mass(): number {
    return this.bodyMass + this.tail.mass;
  }

  /** 가지에 매달려 발이 떨어져 있는지 */
  get hanging(): boolean {
    return this.grab.hooked && !this.grounded;
  }

  /** 물리 스텝 직전에 한 번 부른다 */
  step(input: InputState, command: TailCommand): void {
    this.time += FIXED_DT;
    // addForce로 준 힘은 지울 때까지 남는다
    this.torso.resetForces(true);
    this.torso.resetTorques(true);
    if (this.downed) {
      this.lie(command);
      return;
    }

    this.updateFacing(input.moveX);
    const hits = this.probeGround();
    this.updateGround(hits);
    this.jump(input.pressed.jump);
    if (this.grounded) this.floatUp(hits);
    this.move(input.moveX);
    this.keepUpright();

    this.grab.update(command.grab && this.canGrab, this.tail, [this.torsoCollider, this.headCollider]);
    if (command.grab && !this.canGrab) this.wriggle(command);
    const swing = this.tail.drive(command, this.turn, this.grab.hooked);
    // 밑동 모터의 반작용 가운데 꼬리 무게를 버티는 몫을 뺀 나머지가 반동이다. 그 일부를 다리가 버틴다.
    if (this.grounded) {
      const brace = command.brace === undefined ? swing * this.config.tail.brace : this.strikeBrace(swing * command.brace);
      this.torso.addTorque(brace, true);
    }
  }

  /**
   * 쓰러져 있을 때. 띄우는 힘, 직립 유지, 이동, 점프를 모두 끄고, 직립 유지 대신 배를 위로 한 자세를 쫓는 약한 토크를 준다.
   * 쓰러질 때 밀려난 쪽으로 돌던 방향 그대로 뒤집힌다. 꼬리는 무게를 버티지 않고 늘어지고, 버둥거리면 잠깐 흔든다.
   * 구조물에 깔렸을 때는 뒤집히지 않고 배를 아래로 한 채 엎드리고, 몸통을 깔린 자리에 붙잡는다.
   */
  private lie(command: TailCommand): void {
    this.updateGround(this.probeGround());
    this.flail = Math.max(0, this.flail - FIXED_DT);
    const { duel, upright } = this.config;
    const maxDamping = (this.torso.principalInertia() * MAX_DAMPING_PER_STEP) / FIXED_DT;
    const flip = angleDiff(this.torso.rotation(), this.pinned ? 0 : Math.PI);
    this.torso.addTorque(-duel.downTorque * flip - Math.min(upright.damping, maxDamping) * this.torso.angvel(), true);
    if (this.pinned) this.holdPinned();
    const span = Math.max(duel.struggleWiggleSeconds, FIXED_DT);
    const wave = this.flail > 0 ? Math.sin((Math.PI * this.flail) / span) : 0;
    const bend = this.flailSide * duel.struggleWiggleDeg * DEG * wave;
    command.pose = this.tail.links.map((_, i) => (i === 0 ? this.tail.jointAngle(0) + bend : bend));
    command.strength = this.flail > 0 ? 1 : duel.downTailStrength;
    command.pull = null;
    command.grab = false;
    command.limp = true;
    this.tail.drive(command, this.turn, false);
  }

  /** 깔린 몸통을 구조물 밑(pinX)에 붙잡는다. 가로로만 당기는 스프링이고, 감쇠는 출렁이지 않는 값이다. */
  private holdPinned(): void {
    const stiffness = this.config.scripted.pinHold;
    const offset = this.torso.translation().x - this.pinX;
    const damping = 2 * Math.sqrt(stiffness * this.bodyMass);
    this.torso.addForce({ x: -stiffness * offset - damping * this.torso.linvel().x, y: 0 }, true);
  }

  /**
   * B 방식으로 칠 때 다리가 버티는 토크. 몸이 이미 기운 쪽으로 더 밀면 기운 만큼 줄여 auto.strikeBraceFadeDeg에서 0이 되게 한다.
   * 칠 때는 반작용보다 세게 버티는데, 머리가 상대나 벽에 닿아 있으면 그 토크가 몸을 앞으로 고꾸라뜨렸다(133도).
   */
  private strikeBrace(torque: number): number {
    const tilt = lerpAngle(0, this.torso.rotation() - this.slope * this.config.upright.slopeFollow, 1);
    if (torque * tilt <= 0) return torque;
    const fade = Math.max(this.config.auto.strikeBraceFadeDeg * DEG, 1e-3);
    return torque * Math.max(0, 1 - Math.abs(tilt) / fade);
  }

  /** 잡기 능력이 없을 때 끝의 마디 셋을 꼼지락거린다 */
  private wriggle({ pose }: TailCommand): void {
    const { wriggleDeg, wriggleHz } = this.config.grab;
    const angle = wriggleDeg * DEG * Math.sin(this.time * wriggleHz * 2 * Math.PI);
    for (let i = Math.max(1, pose.length - 3); i < pose.length; i += 1) pose[i] += angle;
  }

  // ---- 방향 ----

  private updateFacing(moveX: number): void {
    // 가지에 걸린 동안에는 돌아서지 않는다. 밑동을 옮기면 걸린 끝에 매달린 몸이 통째로 끌려간다.
    if (this.grab.hooked) return;
    if (moveX !== 0) this.facing = moveX > 0 ? 1 : -1;
    if (this.turn === this.facing) return;
    const before = this.headOffset();
    const turnBefore = this.turn;
    this.turn = approach(this.turn, this.facing, (2 * FIXED_DT) / this.config.move.turnSeconds);
    const after = this.headOffset();
    const { torsoAnchor, headAnchor } = this.neckAnchors();
    this.neck.setAnchor1(torsoAnchor);
    this.neck.setAnchor2(headAnchor);
    // 관절 앵커만 옮기면 솔버가 머리를 낚아채면서 그 반동으로 몸통이 크게 돈다(실측 49도). 머리도 같이 옮긴다.
    const { x, y } = this.head.translation();
    this.head.setTranslation({ x: x + after.x - before.x, y: y + after.y - before.y }, true);
    this.grab.shift(this.tail.moveHip(turnBefore, this.turn));
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
  get standDistance(): number {
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
      this.surface = this.surroundings.surfaceOf(under.collider);
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

    // 무게를 받치는 힘은 무게중심에 준다. 스프링 힘은 몸통에 주어 착지할 때 머리 무게로 기우뚱한다.
    // 꼬리의 무게는 다 받치지만, 꼬리가 옮긴 무게중심은 일부만(tail.support) 따라가서 남은 만큼 기운다.
    // 일부만 바닥 위에 있으면 받치는 자리가 그쪽으로 옮겨 빈 쪽으로 기운다.
    const { x, y } = this.torso.translation();
    const support = hits.reduce((sum, hit) => sum + hit.x - x, 0) / hits.length;
    const lean = support * float.edgeLean;
    const weight = { x: this.centerOfMassX() + lean, y };
    this.torso.addForceAtPoint({ x: 0, y: -this.mass * physics.gravity }, weight, true);
    this.torso.addForceAtPoint({ x: 0, y: -this.bodyMass * spring }, { x: x + lean, y }, true);
  }

  private centerOfMassX(): number {
    const moment = [this.torso, this.head].reduce((sum, body) => sum + body.translation().x * body.mass(), 0);
    const body = moment / this.bodyMass;
    const whole = (moment + this.tail.momentX) / this.mass;
    return body + (whole - body) * this.config.tail.support;
  }

  // ---- 점프 ----

  private jump(pressed: boolean): void {
    const { jump } = this.config;
    this.buffer = pressed ? Math.max(jump.bufferSeconds, FIXED_DT) : Math.max(0, this.buffer - FIXED_DT);
    if (this.buffer === 0 || (!this.grounded && this.coyote === 0)) return;

    // 떨어지는 중이거나 튀어 오르는 중이어도 같은 높이를 뛰게 한다. 몸통과 머리에 나눠 주어 몸이 돌지 않는다.
    const change = -(jump.speed + this.torso.linvel().y);
    for (const body of [this.torso, this.head]) {
      body.applyImpulse({ x: 0, y: -body.mass() * (jump.speed + body.linvel().y) }, true);
    }
    if (!this.grab.hooked) this.tail.addVelocityY(change);
    this.grounded = false;
    this.buffer = 0;
    this.coyote = 0;
    this.floatOff = jump.floatOffSeconds;
  }

  // ---- 이동과 직립 ----

  private move(moveX: number): void {
    const { move, ground, grab } = this.config;
    const vx = this.torso.linvel().x;
    if (this.hanging) {
      // 매달린 동안에는 흔드는 힘만 준다. 멈추는 힘까지 주면 흔들림이 바로 죽는다.
      this.torso.addForce({ x: moveX * grab.swingAccel * this.bodyMass, y: 0 }, true);
      return;
    }
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
