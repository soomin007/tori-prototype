import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import { toLocal } from '../physics/world';
import type { PhysicsWorld } from '../physics/world';
import type { Point } from '../rooms/rooms';
import type { Tail } from './tail';

/** 꼬리 끝으로 잡을 수 있는 것 */
export interface Grabbable {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** 가지처럼 움직이지 않는 것. 잡으면 매달린다. */
  readonly fixed: boolean;
}

interface Hold {
  target: Grabbable;
  joint: RAPIER.RevoluteImpulseJoint;
  /** 잡은 순간 꼬리 끝이 있던 자리와, 끝이 붙을 자리(둘 다 대상 안의 점) */
  from: Point;
  to: Point;
  progress: number;
}

/** 꼬리 끝의 잡기와 걸기. 잡는 동안 끝 마디와 대상을 회전 관절로 잇는다. */
export class TailGrab {
  /** 지금 잡으면 잡히는 대상. 그리기 쪽에서 미리 보여 준다. */
  near: Grabbable | null = null;
  private readonly config: GameConfig;
  private readonly world: RAPIER.World;
  private readonly grabbables: readonly Grabbable[];
  private hold: Hold | null = null;
  /** 놓았지만 아직 토리와 겹쳐 있는 것. 겹친 채로 충돌을 켜면 튕겨 나간다. */
  private readonly releasing = new Set<Grabbable>();

  constructor(physics: PhysicsWorld, config: GameConfig, grabbables: readonly Grabbable[]) {
    this.config = config;
    this.world = physics.raw;
    this.grabbables = grabbables;
  }

  get holding(): Grabbable | null {
    return this.hold?.target ?? null;
  }

  /** 가지에 걸려 있는지 */
  get hooked(): boolean {
    return this.hold?.target.fixed ?? false;
  }

  /** 들고 있거나, 놓았지만 아직 겹쳐 있어서 충돌 그룹을 맡고 있는지 */
  owns(body: RAPIER.RigidBody): boolean {
    const same = (target: Grabbable): boolean => target.body.handle === body.handle;
    return (this.hold !== null && same(this.hold.target)) || [...this.releasing].some(same);
  }

  /** 물리 스텝 직전에 한 번 부른다. body는 놓은 물건이 겹쳤는지 볼 토리의 콜라이더다. */
  update(wants: boolean, tail: Tail, body: readonly RAPIER.Collider[]): void {
    this.near = this.hold ? null : this.findNear(tail.tip);
    if (this.hold && !wants) this.release();
    else if (!this.hold && wants && this.near) this.attach(this.near, tail);
    if (this.hold) this.snap(this.hold);
    this.settleReleased(tail, body);
  }

  /** 밑동을 옮길 때 들고 있는 물건도 같이 옮긴다 */
  shift({ x: dx, y: dy }: Point): void {
    if (!this.hold || this.hold.target.fixed) return;
    const { body } = this.hold.target;
    const { x, y } = body.translation();
    body.setTranslation({ x: x + dx, y: y + dy }, true);
  }

  /** 대상의 겉에서 point에 가장 가까운 점 */
  static closestPoint({ collider }: Grabbable, point: Point): Point {
    return collider.projectPoint(point, true)?.point ?? collider.translation();
  }

  private findNear(tip: Point): Grabbable | null {
    let best: Grabbable | null = null;
    let bestDistance = this.config.grab.radius;
    for (const target of this.grabbables) {
      const { x, y } = TailGrab.closestPoint(target, tip);
      const distance = Math.hypot(x - tip.x, y - tip.y);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  private attach(target: Grabbable, tail: Tail): void {
    const { body, collider, fixed } = target;
    const { tip } = tail;
    const from = toLocal(body, tip);
    const to = toLocal(body, TailGrab.closestPoint(target, tip));
    const data = RAPIER.JointData.revolute(tail.tipAnchor, from);
    const joint = this.world.createImpulseJoint(data, tail.tipLink.body, body, true) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    if (!fixed) {
      // 들고 있는 물건은 토리와 부딪히지 않는다. 부딪히면 꼬리와 서로 밀며 떨린다.
      collider.setCollisionGroups(collisionGroups('Held'));
      this.releasing.delete(target);
    }
    this.hold = { target, joint, from, to, progress: 0 };
    this.near = null;
  }

  private release(): void {
    if (!this.hold) return;
    this.world.removeImpulseJoint(this.hold.joint, true);
    if (!this.hold.target.fixed) this.releasing.add(this.hold.target);
    this.hold = null;
  }

  /** 잡은 자리까지 끝을 조금씩 붙인다. 한 번에 붙이면 낚아채는 힘이 된다. */
  private snap(hold: Hold): void {
    if (hold.progress >= 1) return;
    hold.progress = Math.min(1, hold.progress + FIXED_DT / this.config.grab.snapSeconds);
    const { from, to, progress: t } = hold;
    hold.joint.setAnchor2({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }

  private settleReleased(tail: Tail, body: readonly RAPIER.Collider[]): void {
    for (const target of this.releasing) {
      const mine = [...body, ...tail.links.map((link) => link.collider)];
      if (mine.some((collider) => target.collider.contactCollider(collider, 0) !== null)) continue;
      target.collider.setCollisionGroups(collisionGroups('Prop'));
      this.releasing.delete(target);
    }
  }
}
