import RAPIER from '@dimforge/rapier2d-compat';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { Grabbable } from '../tori/grab';
import { appears } from '../rooms/rooms';
import type { BoxData, BranchData, RoomData, Surface, TerrainData } from '../rooms/rooms';
import type { GameState } from '../state/gameState';
import { Recorder } from './recorder';

/** 움직이는 물건. 크기는 미터다. */
export interface SimObject {
  kind: 'box';
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  width: number;
  height: number;
  /** 이 물건을 만든 방 데이터 */
  data: BoxData;
}

/** 방 데이터로 만든 바디와 콜라이더. 방에 놓는 것은 회귀 횟수로 거른다(PLAN 7.4). */
export class Room {
  readonly data: RoomData;
  readonly objects: readonly SimObject[];
  /** 꼬리 끝으로 잡을 수 있는 물건과 가지 */
  readonly grabbables: readonly Grabbable[];
  readonly recorders: readonly Recorder[];
  private readonly terrain: readonly RAPIER.Collider[];
  private readonly surfaces = new Map<number, Surface>();

  /** state의 회귀 횟수로 놓을 것을 거르고, 말을 건 기록관의 문은 열어 둔다 */
  constructor(physics: PhysicsWorld, data: RoomData, config: GameConfig, state: GameState) {
    this.data = data;
    const ground = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.terrain = data.terrain.map((piece) => this.addTerrain(physics.raw, ground, piece));
    this.objects = data.boxes.filter((box) => appears(box, state.rewinds)).map((box) => addBox(physics, box));
    this.grabbables = [
      ...this.objects.filter(({ data: box }) => box.grabbable).map(({ body, collider }) => ({ body, collider, fixed: false })),
      ...data.branches.map((branch) => addBranch(physics, branch)),
    ];
    this.recorders = data.recorders
      .filter((recorder) => appears(recorder, state.rewinds))
      .map((recorder) => new Recorder(physics, recorder, state.talkedTo.includes(recorder.id)));
    this.applyMaterials(config);
  }

  surfaceOf(collider: RAPIER.Collider): Surface {
    return this.surfaces.get(collider.handle) ?? 'normal';
  }

  recorder(id: string | null): Recorder | null {
    return this.recorders.find((recorder) => recorder.id === id) ?? null;
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

function addBranch(physics: PhysicsWorld, { x, y, length, thickness }: BranchData): Grabbable {
  const body = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
  const desc = RAPIER.ColliderDesc.cuboid(length / 2, thickness / 2).setCollisionGroups(collisionGroups('Branch'));
  return { body, collider: physics.raw.createCollider(desc, body), fixed: true };
}

function addBox(physics: PhysicsWorld, data: BoxData): SimObject {
  const { x, y, width, height, angle } = data;
  const body = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setRotation(angle));
  const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setCollisionGroups(collisionGroups('Prop'));
  const collider = physics.raw.createCollider(desc, body);
  physics.track(body);
  return { kind: 'box', body, collider, width, height, data };
}
