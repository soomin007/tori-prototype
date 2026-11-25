import type RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { Point } from '../rooms/rooms';
import type { Tori } from '../tori/body';
import type { SimObject } from './roomBuilder';

/** 내려치는 방향이 이 배수의 역수(30도)를 넘으면 완전히 바깥쪽으로 돌린다 */
const DOWN_TURN = 2;

/** 타격 하나. 그리기 쪽에서 자국을 보여 준다. */
export interface Strike extends Point {
  /** 물건에 대한 마디의 속도(m/s) */
  speed: number;
  /** 몇 번째 스텝에서 쳤는지 */
  step: number;
}

/** 휘둘러 치기. 꼬리 마디가 빠르게 물건에 닿으면 물건을 튕겨 낸다. 조작 방식 A와 B가 같은 판정을 쓴다. */
export class Strikes {
  /** 가장 최근의 타격 몇 개 */
  readonly recent: Strike[] = [];
  private readonly cooldown = new Map<SimObject, number>();
  private readonly flying = new Set<SimObject>();
  private linkVelocity: Point[] = [];
  private objectVelocity: Point[] = [];

  /** 물리 스텝 직전. 부딪힌 뒤에는 속도가 서로 섞이므로 부딪히기 전 속도를 적어 둔다. */
  before(tori: Tori, objects: readonly SimObject[]): void {
    this.linkVelocity = tori.tail.links.map(({ body }) => body.linvel());
    this.objectVelocity = objects.map(({ body }) => body.linvel());
  }

  /** 물리 스텝 직후 */
  after(world: RAPIER.World, tori: Tori, objects: readonly SimObject[], { hit }: GameConfig, step: number): void {
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
      this.recent.push({ ...tori.tail.links[link].body.translation(), speed, step });
      if (this.recent.length > 8) this.recent.shift();
    });
  }
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
