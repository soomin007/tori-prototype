import type RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { Point } from '../rooms/rooms';
import type { Tori } from '../tori/body';
import type { Opponent } from './opponent';
import type { SimObject } from './roomBuilder';

/** 내려치는 방향이 이 배수의 역수(30도)를 넘으면 완전히 바깥쪽으로 돌린다 */
const DOWN_TURN = 2;

/** 타격 하나. 그리기 쪽에서 자국을 보여 준다. */
export interface Strike extends Point {
  /** 물건이나 상대에 대한 마디의 속도(m/s) */
  speed: number;
  /** 몇 번째 스텝에서 쳤는지 */
  step: number;
  /** 상대에게 준 피해. 물건을 쳤으면 0이다. */
  damage: number;
}

/**
 * 휘둘러 치기(PLAN 7.3, 7.6). 꼬리 마디가 기준 속도(hit.minSpeed)를 넘어 물건에 닿으면 물건을 튕겨 내고,
 * 결투 상대에 닿으면 피해를 주고 밀어낸다. 조작 방식 A와 B가 같은 판정을 쓴다.
 */
export class Strikes {
  /** 가장 최근의 타격 몇 개 */
  readonly recent: Strike[] = [];
  private readonly cooldown = new Map<SimObject | Opponent, number>();
  private readonly flying = new Set<SimObject>();
  private linkVelocity: Point[] = [];
  private objectVelocity: Point[] = [];
  private foeVelocity: Point[] = [];

  /** 물리 스텝 직전. 부딪힌 뒤에는 속도가 서로 섞이므로 부딪히기 전 속도를 적어 둔다. */
  before(tori: Tori, objects: readonly SimObject[], foes: readonly Opponent[] = []): void {
    this.linkVelocity = tori.tail.links.map(({ body }) => body.linvel());
    this.objectVelocity = objects.map(({ body }) => body.linvel());
    this.foeVelocity = foes.map(({ body }) => body.linvel());
  }

  /**
   * 물리 스텝 직후. foes는 지금 칠 수 있는 결투 상대이고 before에 준 것과 같아야 한다.
   * whipPower는 능력표의 값으로, 상대에게 주는 피해에 곱한다(PLAN 7.5).
   */
  after(
    world: RAPIER.World,
    tori: Tori,
    objects: readonly SimObject[],
    config: GameConfig,
    step: number,
    foes: readonly Opponent[] = [],
    whipPower = 1,
  ): void {
    this.hitObjects(world, tori, objects, config, step);
    this.hitFoes(tori, foes, config, step, whipPower);
  }

  private hitObjects(world: RAPIER.World, tori: Tori, objects: readonly SimObject[], { hit }: GameConfig, step: number): void {
    objects.forEach((object, o) => {
      const wait = Math.max(0, (this.cooldown.get(object) ?? 0) - FIXED_DT);
      this.cooldown.set(object, wait);
      if (wait > 0 || tori.grab.owns(object.body)) return;
      if (this.flying.delete(object)) object.collider.setCollisionGroups(collisionGroups('Prop'));

      let fastest: { velocity: Point; speed: number; link: number } | null = null;
      tori.tail.links.forEach(({ collider }, i) => {
        const velocity = {
          x: this.linkVelocity[i].x - this.objectVelocity[o].x,
          y: this.linkVelocity[i].y - this.objectVelocity[o].y,
        };
        const speed = Math.hypot(velocity.x, velocity.y);
        if (speed < hit.minSpeed || speed <= (fastest?.speed ?? 0)) return;
        if (touching(world, collider, object.collider)) fastest = { velocity, speed, link: i };
      });
      if (!fastest) return;
      const { velocity, speed, link } = fastest as { velocity: Point; speed: number; link: number };
      launch(object, velocity, speed, tori, hit);
      this.cooldown.set(object, hit.cooldownSeconds);
      // 튕겨 나가는 동안 꼬리에 다시 걸리면 그 자리에 떨어지므로 잠깐 토리를 지나가게 한다
      object.collider.setCollisionGroups(collisionGroups('Held'));
      this.flying.add(object);
      this.remember({ ...tori.tail.links[link].body.translation(), speed, step, damage: 0 });
    });
  }

  /**
   * 결투 상대. 피해는 마디 속도에 비례하고 상한이 있다(PLAN 7.6). 한 번 휘두를 때 여러 마디가 닿아도
   * duel.strikeCooldownSeconds 동안은 다시 치지 않는다.
   */
  private hitFoes(
    tori: Tori,
    foes: readonly Opponent[],
    { hit, duel }: GameConfig,
    step: number,
    whipPower: number,
  ): void {
    foes.forEach((foe, f) => {
      const wait = Math.max(0, (this.cooldown.get(foe) ?? 0) - FIXED_DT);
      this.cooldown.set(foe, wait);
      if (wait > 0 || foe.defeated) return;
      const before = this.foeVelocity[f] ?? foe.body.linvel();
      let fastest: { speed: number; link: number } | null = null;
      tori.tail.links.forEach(({ collider }, i) => {
        const speed = Math.hypot(this.linkVelocity[i].x - before.x, this.linkVelocity[i].y - before.y);
        if (speed < hit.minSpeed || speed <= (fastest?.speed ?? 0)) return;
        if (overlapping(collider, foe.collider)) fastest = { speed, link: i };
      });
      if (!fastest) return;
      const { speed, link } = fastest as { speed: number; link: number };
      const damage = Math.min(duel.maxDamage, duel.damagePerSpeed * speed) * whipPower;
      const push = Math.min(duel.maxPush, duel.strikePush * speed);
      const dealt = foe.hurt(damage, push, tori.torso.translation().x);
      this.cooldown.set(foe, duel.strikeCooldownSeconds);
      this.remember({ ...tori.tail.links[link].body.translation(), speed, step, damage: dealt });
    });
  }

  private remember(strike: Strike): void {
    this.recent.push(strike);
    if (this.recent.length > 8) this.recent.shift();
  }
}

/** 꼬리는 상대의 몸과 부딪히지 않으므로(physics/groups.ts) 접촉 대신 두 도형이 겹치는지를 본다 */
function overlapping(link: RAPIER.Collider, foe: RAPIER.Collider): boolean {
  return foe.intersectsShape(link.shape, link.translation(), link.rotation());
}

function touching(world: RAPIER.World, a: RAPIER.Collider, b: RAPIER.Collider): boolean {
  let found = false;
  world.contactPair(a, b, (manifold) => {
    found ||= manifold.numContacts() > 0;
  });
  return found;
}

function launch(object: SimObject, velocity: Point, speed: number, tori: Tori, hit: GameConfig['hit']): void {
  const { body } = object;
  const outward = Math.sign(body.translation().x - tori.torso.translation().x) || 1;
  // 바닥에 있는 물건을 아래로 내려치면 튕길 곳이 없으므로, 내려칠수록 토리 바깥쪽으로 돌린다
  const down = Math.max(0, velocity.y) / speed;
  const along = velocity.x / speed;
  const turnOut = Math.min(1, down * DOWN_TURN);
  const x = along + (outward * Math.max(Math.abs(along), down) - along) * turnOut;
  const y = Math.min(0, velocity.y / speed) - hit.lift;
  const size = Math.hypot(x, y) || 1;
  const direction = { x: x / size, y: y / size };

  const mass = body.mass();
  const factor = Math.min(1, hit.pushMass / Math.max(mass, 1e-3));
  const goal = Math.min(hit.maxLaunch, hit.power * speed) * factor;
  const now = body.linvel();
  const missing = goal - (now.x * direction.x + now.y * direction.y);
  if (missing <= 0) return;
  body.applyImpulse({ x: direction.x * missing * mass, y: direction.y * missing * mass }, true);
}
