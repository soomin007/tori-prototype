import RAPIER from '@dimforge/rapier2d-compat';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { BoxData, RoomData, Surface, TerrainData } from '../rooms/rooms';

/** 움직이는 물건. 크기는 미터다. */
export interface SimObject {
  kind: 'box';
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  width: number;
  height: number;
}

/** 방 데이터로 만든 바디와 콜라이더 */
export class Room {
  readonly data: RoomData;
  readonly objects: readonly SimObject[];
  private readonly terrain: readonly RAPIER.Collider[];
  private readonly surfaces = new Map<number, Surface>();

  constructor(physics: PhysicsWorld, data: RoomData, config: GameConfig) {
    this.data = data;
    const ground = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.terrain = data.terrain.map((piece) => this.addTerrain(physics.raw, ground, piece));
    this.objects = data.boxes.map((box) => addBox(physics, box));
    this.applyMaterials(config);
  }

  surfaceOf(collider: RAPIER.Collider): Surface {
    return this.surfaces.get(collider.handle) ?? 'normal';
  }

  /** 실행 중에 바뀐 설정을 반영한다 */
  applyMaterials({ ground, props }: GameConfig): void {
    for (const collider of this.terrain) collider.setFriction(ground.friction);
    for (const { collider } of this.objects) {
      collider.setFriction(props.friction);
      collider.setRestitution(props.restitution);
      collider.setDensity(props.density);
    }
  }

  private addTerrain(world: RAPIER.World, body: RAPIER.RigidBody, { points, surface }: TerrainData): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(points.flatMap(({ x, y }) => [x, y])));
    if (!desc) throw new Error('지형 다각형의 점이 한 직선 위에 있다');
    const collider = world.createCollider(desc.setCollisionGroups(collisionGroups('Terrain')), body);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }
}

function addBox(physics: PhysicsWorld, { x, y, width, height, angle }: BoxData): SimObject {
  const body = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setRotation(angle));
  const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setCollisionGroups(collisionGroups('Prop'));
  const collider = physics.raw.createCollider(desc, body);
  physics.track(body);
  return { kind: 'box', body, collider, width, height };
}
