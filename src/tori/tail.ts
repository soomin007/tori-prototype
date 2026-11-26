import RAPIER from '@dimforge/rapier2d-compat';
import { DEG, FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import { angleDiff, toWorld } from '../physics/world';
import type { PhysicsWorld } from '../physics/world';
import type { Point } from '../rooms/rooms';
import type { Grabbable } from './grab';

/** 꼬리 마디 하나. 마디의 -y 방향이 꼬리 끝을 향한다. 각도 0이면 위를 보고 -90도면 왼쪽을 본다. */
export interface TailLink {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** 앞 마디(0번은 몸통)와 잇는 관절 */
  readonly joint: RAPIER.RevoluteImpulseJoint;
  /** 밑동은 0, 자를 수 있는 구간은 몸에서 가까운 쪽부터 1, 2, 3 */
  readonly section: number;
  readonly radius: number;
}

/** 조작 방식(컨트롤러)이 스텝마다 정하는 것. 목표 자세만 다르고 그 뒤는 같다. */
export interface TailCommand {
  /** 관절 목표 각(라디안). 0번은 몸통 기준, 나머지는 앞 마디 기준이다. */
  pose: number[];
  /** 모터 강성과 힘 상한에 곱한다 */
  strength: number;
  /** 끝만 당길 때의 목표점. 자세로 움직일 때는 null이다. */
  pull: Point | null;
  /** 잡기 입력을 누르고 있는지 */
  grab: boolean;
  /** 다리가 꼬리의 반동을 버티는 비율. 없으면 tail.brace를 쓴다. B 방식이 칠 때 더 세게 버틴다. */
  brace?: number;
  /** 꼬리 무게를 버티지 않고 늘어뜨린다. 결투에서 쓰러졌을 때 쓴다. */
  limp?: boolean;
}

/** 밑동의 목표 각은 모터 목표 각이 접히는 180도에서 이만큼 떨어뜨린다(known-issues 3번) */
const MAX_TARGET = 175 * DEG;

/**
 * 꼬리 사슬. 마디는 회전 관절로 잇고 관절마다 모터가 목표 자세를 쫓는다.
 * 남은 구간 수만큼의 구간으로 만들고, 살아 있는 동안에도 끝 구간을 떼어 낼 수 있다(sever).
 * 마디 수를 쓰는 곳(IK, 조작 방식, 받치는 힘, 타격 판정, 그리기)은 모두 links를 그때그때 읽는다.
 */
export class Tail {
  /** 디버그 그리기용. 모터에 마지막으로 넣은 목표 자세다. */
  targetPose: number[] = [];
  private readonly chain: TailLink[];
  private readonly config: GameConfig;
  private readonly world: RAPIER.World;
  private readonly torso: RAPIER.RigidBody;

  /** sections는 밑동 뒤에 붙일 구간 수(남은 구간)다 */
  constructor(physics: PhysicsWorld, config: GameConfig, torso: RAPIER.RigidBody, turn: number, sections: number) {
    this.config = config;
    this.world = physics.raw;
    this.torso = torso;
    this.chain = this.build(turn, sections);
    this.applyConfig();
    for (const { body } of this.chain) physics.track(body);
  }

  /** 밑동부터 끝까지의 마디 */
  get links(): readonly TailLink[] {
    return this.chain;
  }

  /** 붙어 있는 구간 수. 밑동만 남으면 0이다. */
  get sectionCount(): number {
    return this.tipLink.section;
  }

  /** 끝 구간이 붙은 관절의 자리. 자를 구간이 없으면 null이다. */
  get cutPoint(): Point | null {
    const first = this.firstOfTipSection();
    if (first === null) return null;
    return toWorld(this.chain[first].body, { x: 0, y: this.config.tail.linkLength / 2 });
  }

  get length(): number {
    return this.chain.length * this.config.tail.linkLength;
  }

  get mass(): number {
    return this.links.reduce((sum, { body }) => sum + body.mass(), 0);
  }

  /** 마디들의 x에 질량을 곱해 더한 값. 전체 무게중심을 낼 때 쓴다. */
  get momentX(): number {
    return this.links.reduce((sum, { body }) => sum + body.mass() * body.translation().x, 0);
  }

  get tipLink(): TailLink {
    return this.links[this.links.length - 1];
  }

  /** 꼬리 끝의 자리 */
  get tip(): Point {
    return toWorld(this.tipLink.body, this.tipAnchor);
  }

  /** 끝 마디에서 본 꼬리 끝 */
  get tipAnchor(): Point {
    return { x: 0, y: -this.config.tail.linkLength / 2 };
  }

  /** 밑동이 붙은 바디 */
  get root(): RAPIER.RigidBody {
    return this.torso;
  }

  /** 엉덩이와 꼬리 끝 사이를 꼬리 길이로 묶는 관절. 걸린 동안에는 돌아서지 않으므로 앵커가 바뀌지 않는다. */
  ropeData(): RAPIER.JointData {
    return RAPIER.JointData.rope(this.length, this.links[0].joint.anchor1(), this.tipAnchor);
  }

  /** 밑동이 붙은 자리 */
  hip(turn: number): Point {
    return toWorld(this.torso, this.hipAnchor(turn));
  }

  /** 밑동이 돌 수 있는 범위(몸통 기준). 돌아서면 좌우가 뒤집힌다. */
  rootRange(turn: number): { min: number; max: number } {
    const { rootUpDeg, rootDownDeg } = this.config.tail;
    const right = { min: -90 - rootDownDeg, max: -90 + rootUpDeg };
    const t = (1 - turn) / 2;
    return {
      min: (right.min + (-right.max - right.min) * t) * DEG,
      max: (right.max + (-right.min - right.max) * t) * DEG,
    };
  }

  /** 지금 관절 각. 0번은 몸통 기준이다. */
  jointAngle(index: number): number {
    const parent = index === 0 ? this.torso : this.links[index - 1].body;
    return angleDiff(this.links[index].body.rotation(), parent.rotation());
  }

  /** 관절이 벌어진 거리를 모두 더한 값 */
  jointGap(turn: number): number {
    const half = this.config.tail.linkLength / 2;
    return this.links.reduce((sum, { body }, i) => {
      const from = i === 0 ? this.hip(turn) : toWorld(this.links[i - 1].body, { x: 0, y: -half });
      const to = toWorld(body, { x: 0, y: half });
      return sum + Math.hypot(to.x - from.x, to.y - from.y);
    }, 0);
  }

  /** 실행 중에 바뀐 값 가운데 매 스텝 읽지 않는 것을 반영한다 */
  applyConfig(): void {
    const { tail } = this.config;
    const limit = tail.jointLimitDeg * DEG;
    // 밑동의 단단한 제한은 좌우 어느 쪽을 보든 같게 두고, 보는 방향에 따른 범위는 목표 각을 자를 때 쓴다.
    // 돌아서는 0.2초 사이에 단단한 제한을 뒤집으면 꼬리를 때려 넘기는 힘이 된다.
    const root = Math.min(MAX_TARGET, Math.max(90 + tail.rootDownDeg, tail.rootUpDeg - 90) * DEG);
    this.links.forEach(({ joint, collider, body }, i) => {
      if (i === 0) joint.setLimits(-root, root);
      else joint.setLimits(-limit, limit);
      collider.setFriction(tail.friction);
      body.setSoftCcdPrediction(tail.softCcd);
    });
  }

  /** 돌아설 때 밑동을 옮긴다. 앵커와 마디를 같이 옮겨야 반동이 없다(known-issues 8번). 옮긴 거리를 준다. */
  moveHip(fromTurn: number, toTurn: number): Point {
    const before = this.hip(fromTurn);
    const after = this.hip(toTurn);
    const delta = { x: after.x - before.x, y: after.y - before.y };
    this.links[0].joint.setAnchor1(this.hipAnchor(toTurn));
    for (const { body } of this.links) {
      const { x, y } = body.translation();
      body.setTranslation({ x: x + delta.x, y: y + delta.y }, true);
    }
    return delta;
  }

  /** 점프할 때 몸과 같은 만큼 속도를 더해 꼬리가 몸을 잡아당기지 않게 한다 */
  addVelocityY(change: number): void {
    for (const { body } of this.links) body.applyImpulse({ x: 0, y: body.mass() * change }, true);
  }

  /**
   * 끝 구간을 떼어 내고 떼어 낸 마디를 준다. 떼어 낸 마디끼리는 이어진 채로 남는다. 자를 구간이 없으면 null이다.
   * 잡기는 먼저 정리해야 한다(Tori.cutTail). 떼어 낸 첫 마디의 joint는 지운 관절이라 다시 쓰지 않는다.
   */
  sever(): TailLink[] | null {
    const first = this.firstOfTipSection();
    if (first === null) return null;
    const piece = this.chain.splice(first);
    this.world.removeImpulseJoint(piece[0].joint, true);
    this.targetPose = this.targetPose.slice(0, first);
    return piece;
  }

  /** 끝 구간의 첫 마디 번호. 밑동만 남았으면 null이다. */
  private firstOfTipSection(): number | null {
    const section = this.sectionCount;
    return section === 0 ? null : this.chain.findIndex((link) => link.section === section);
  }

  /** 물리 스텝 직전에 한 번 부른다. hooked는 끝이 가지에 걸려 있는지다. 밑동 모터가 낼 토크의 어림값을 준다. */
  drive(command: TailCommand, turn: number, hooked: boolean): number {
    const { tail, grab, mouse } = this.config;
    let strength = command.strength;
    if (hooked) strength *= grab.hangMotor;
    if (command.pull) strength *= mouse.pullMotor;

    const limit = tail.jointLimitDeg * DEG;
    const root = this.rootRange(turn);
    // 가지에 걸렸거나 끝만 당길 때는 꼬리가 제 무게를 버티지 않는다
    const sag = hooked || command.pull || command.limp ? null : this.gravityTorques();
    this.targetPose = this.links.map((_, i) =>
      i === 0 ? clamp(command.pose[0] ?? 0, root.min, root.max) : clamp(command.pose[i] ?? 0, -limit, limit),
    );
    let rootTorque = 0;
    this.links.forEach(({ joint, body }, i) => {
      const scale = this.jointScale(i) * strength;
      const stiffness = Math.max(tail.stiffness * scale, 1e-3);
      const raw = this.targetPose[i] - (sag ? (sag[i] * tail.gravityComp) / stiffness : 0);
      const target = clamp(raw, -MAX_TARGET, MAX_TARGET);
      const damping = stiffness * tail.dampingSeconds;
      const maxForce = tail.maxTorque * scale;
      joint.configureMotorPosition(target, stiffness, damping);
      joint.setMotorMaxForce(maxForce);
      if (i > 0) return;
      const spin = body.angvel() - this.torso.angvel();
      rootTorque = clamp(stiffness * (target - this.jointAngle(0)) - damping * spin, -maxForce, maxForce);
    });

    for (const { body } of this.links) body.resetForces(true);
    if (command.pull) this.pullTip(command.pull, turn);
    return rootTorque + (sag ? sag[0] : 0);
  }

  /** 끝에서 멀수록 더 많은 마디를 움직여야 하므로 밑동으로 갈수록 세다 */
  private jointScale(index: number): number {
    const { tipRatio } = this.config.tail;
    const rest = (this.links.length - index) / this.links.length;
    return tipRatio + (1 - tipRatio) * rest * rest;
  }

  /** 관절마다 그 뒤 마디들의 무게가 주는 토크 */
  private gravityTorques(): number[] {
    const { gravity } = this.config.physics;
    const half = this.config.tail.linkLength / 2;
    const torques: number[] = [];
    let mass = 0;
    let momentX = 0;
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      const { body } = this.links[i];
      mass += body.mass();
      momentX += body.mass() * body.translation().x;
      torques[i] = (momentX - mass * toWorld(body, { x: 0, y: half }).x) * gravity;
    }
    return torques;
  }

  /**
   * 꼬리 끝이 목표점에 가게 마디들을 당긴다. 끝에 힘을 다 주면 끝 마디부터 말려 엉키므로, 끝에 가까울수록 세게 나눠 준다.
   * 몸 바깥의 힘이라 반작용을 엉덩이에 되돌려 꼬리로 몸을 끌어 날지 못하게 한다.
   */
  private pullTip(target: Point, turn: number): void {
    const { pullStiffness, pullDamping, pullMaxForce } = this.config.mouse;
    const tip = this.tip;
    const velocity = this.tipLink.body.velocityAtPoint(tip);
    const base = this.torso.linvel();
    // 감쇠가 한 스텝에 꼬리의 속도를 뒤집지 않게 한다
    const damping = Math.min(pullDamping, (this.mass * 0.5) / FIXED_DT);
    const x = (target.x - tip.x) * pullStiffness - (velocity.x - base.x) * damping;
    const y = (target.y - tip.y) * pullStiffness - (velocity.y - base.y) * damping;
    const scale = Math.min(1, pullMaxForce / Math.max(Math.hypot(x, y), 1e-6));
    const weights = this.links.map((_, i) => (i + 1) ** 2);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    this.links.forEach(({ body }, i) => {
      const share = (scale * weights[i]) / total;
      body.addForce({ x: x * share, y: y * share }, true);
    });
    this.torso.addForceAtPoint({ x: -x * scale, y: -y * scale }, this.hip(turn), true);
  }

  private hipAnchor(turn: number): Point {
    const { hipX, hipY } = this.config.tail;
    return { x: -hipX * turn, y: -hipY };
  }

  private build(turn: number, sections: number): TailLink[] {
    const { tail } = this.config;
    const half = tail.linkLength / 2;
    // 처음에는 뒤로 곧게 뻗은 모습이다
    const angle = this.torso.rotation() - (Math.PI / 2) * turn;
    const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
    const hip = this.hip(turn);

    const links: TailLink[] = [];
    const count = tail.baseLinks + Math.max(0, Math.min(sections, tail.sections)) * tail.linksPerSection;
    for (let i = 0; i < count; i += 1) {
      const section = i < tail.baseLinks ? 0 : 1 + Math.floor((i - tail.baseLinks) / tail.linksPerSection);
      const radius = sectionThickness(this.config, section) / 2;
      const center = (i + 0.5) * tail.linkLength;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(hip.x + direction.x * center, hip.y + direction.y * center)
          .setRotation(angle)
          .setAdditionalMassProperties(0, { x: 0, y: 0 }, tail.armature)
          .setCanSleep(false),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(Math.max(half - radius, 0.001), radius)
          .setMass(tail.linkMass)
          .setCollisionGroups(collisionGroups('Tail')),
        body,
      );
      const parent = i === 0 ? this.torso : links[i - 1].body;
      const anchor = i === 0 ? this.hipAnchor(turn) : { x: 0, y: -half };
      const data = RAPIER.JointData.revolute(anchor, { x: 0, y: half });
      // multibody 관절은 끝을 걸었을 때 폭주한다(known-issues 2번)
      const joint = this.world.createImpulseJoint(data, parent, body, true) as RAPIER.RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      links.push({ body, collider, joint, section, radius });
    }
    return links;
  }
}

/**
 * 떼어 낸 꼬리 구간. 마디끼리 이어진 채 떨어져, 관절 모터에 사인파 목표를 넣어 꿈틀거린다(PLAN 7.3).
 * 충돌 그룹은 꼬리 그대로라 토리의 몸과 남은 꼬리와는 부딪히지 않는다. 회귀하며 방을 다시 만들 때 함께 사라진다.
 */
export class SeveredTail {
  readonly links: readonly TailLink[];
  /** 잘린 순간 토리가 보던 쪽(오른쪽 1, 왼쪽 -1). 그림을 뒤집는 데 쓴다. */
  readonly side: 1 | -1;
  /** 꼬리 끝에 들고 있다가 함께 떨어지는 물건 */
  readonly carried: Grabbable | null;
  private readonly config: GameConfig;
  private time = 0;

  constructor(config: GameConfig, links: readonly TailLink[], side: 1 | -1, carried: Grabbable | null) {
    this.config = config;
    this.links = links;
    this.side = side;
    this.carried = carried;
    // 끝만 당기기(A 방식)로 준 힘은 지울 때까지 남는다
    for (const { body } of links) body.resetForces(true);
  }

  /** 물리 스텝 직전에 한 번 부른다 */
  drive(): void {
    const { wriggleDeg, wriggleHz, wriggleLag, wriggleStiffness, wriggleDampingSeconds, wriggleTorque } = this.config.cut;
    this.time += FIXED_DT;
    const phase = this.time * wriggleHz * 2 * Math.PI;
    // 0번 마디의 관절은 자를 때 지웠다
    for (let i = 1; i < this.links.length; i += 1) {
      const { joint } = this.links[i];
      const target = wriggleDeg * DEG * Math.sin(phase - i * wriggleLag);
      joint.configureMotorPosition(target, wriggleStiffness, wriggleStiffness * wriggleDampingSeconds);
      joint.setMotorMaxForce(wriggleTorque);
    }
  }
}

/** 구간의 굵기. 밑동에서 끝으로 갈수록 가늘어진다. 그림도 이 값을 쓴다. */
export function sectionThickness({ tail }: GameConfig, section: number): number {
  const t = tail.sections === 0 ? 0 : section / tail.sections;
  return tail.baseThickness + (tail.tipThickness - tail.baseThickness) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
