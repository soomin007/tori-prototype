import RAPIER from '@dimforge/rapier2d-compat';
import type { Abilities } from '../config/abilities';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { Grabbable } from '../tori/grab';
import { appears } from '../rooms/rooms';
import type { BoxData, BranchData, NpcData, RoomData, Surface, TerrainData } from '../rooms/rooms';
import type { GameState } from '../state/gameState';
import { Duel } from './duel';
import type { DuelEvent } from './duel';
import { Recorder } from './recorder';
import type { ScriptedEvent } from './scripted';

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
  /** 결투장. 이긴 결투는 만들지 않는다. */
  readonly duels: readonly Duel[];
  /** 대본 사건. 저마다 딸린 결투가 진행한다. 이긴 결투의 사건은 만들지 않는다. */
  readonly events: readonly ScriptedEvent[];
  /** 친구 NPC 자리. 회귀 횟수로 거른다. */
  readonly npcs: readonly NpcData[];
  /** 매달린 물건과, 떨어질 때까지 남은 시간. 토리가 지나가기 전에는 null이다. */
  private readonly hanging: { object: SimObject; wait: number | null }[];
  private readonly terrain: readonly RAPIER.Collider[];
  private readonly surfaces = new Map<number, Surface>();

  /**
   * state의 회귀 횟수로 놓을 것을 거르고, 말을 건 기록관의 문은 열어 둔다. 이긴 결투(state.duelsWon)와 그 사건은 만들지 않는다.
   * abilities는 남은 구간의 능력표 줄이고 결투가 토리의 체력 상한과 넉백에 쓴다. emit은 결투가 알리는 일을 받는다.
   */
  constructor(
    physics: PhysicsWorld,
    data: RoomData,
    config: GameConfig,
    state: GameState,
    abilities: Abilities,
    emit: (event: DuelEvent) => void,
  ) {
    this.data = data;
    const ground = physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.terrain = data.terrain.map((piece) => this.addTerrain(physics.raw, ground, piece));
    this.objects = data.boxes.filter((box) => appears(box, state.rewinds)).map((box) => addBox(physics, box));
    this.hanging = this.objects.filter(({ data: box }) => box.hang).map((object) => ({ object, wait: null }));
    this.npcs = data.npcs.filter((npc) => appears(npc, state.rewinds));
    this.grabbables = [
      ...this.objects.filter(({ data: box }) => box.grabbable).map(({ body, collider }) => ({ body, collider, fixed: false })),
      ...data.branches.map((branch) => addBranch(physics, branch)),
    ];
    this.recorders = data.recorders
      .filter((recorder) => appears(recorder, state.rewinds))
      .map((recorder) => new Recorder(physics, recorder, state.talkedTo.includes(recorder.id)));
    this.duels = data.duels
      .filter((duel) => appears(duel, state.rewinds) && !state.duelsWon.includes(duel.id))
      .map((duel) => new Duel(physics, duel, config, abilities, emit, state.rewinds));
    this.events = data.events
      .filter((event) => appears(event, state.rewinds))
      .flatMap((event) => {
        if (!data.duels.some(({ id }) => id === event.duel)) throw new Error(`대본 사건 ${event.id}의 결투 ${event.duel}가 방에 없다`);
        const duel = this.duels.find(({ data: { id } }) => id === event.duel);
        return duel ? [duel.addEvent(event)] : [];
      });
    this.applyMaterials(config);
  }

  surfaceOf(collider: RAPIER.Collider): Surface {
    return this.surfaces.get(collider.handle) ?? 'normal';
  }

  /** 토리의 몸통 중심이 지나간 자리에 매달린 물건을 정한 시간 뒤에 떨어뜨린다. 스텝마다 부른다. */
  releaseHanging(toriX: number): void {
    for (const hold of this.hanging) {
      const { body, data } = hold.object;
      if (!data.hang || body.isDynamic()) continue;
      if (hold.wait === null && toriX > data.hang.untilX) hold.wait = data.hang.delaySeconds;
      if (hold.wait === null) continue;
      if (hold.wait <= 1e-9) body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      hold.wait -= FIXED_DT;
    }
  }

  recorder(id: string | null): Recorder | null {
    return this.recorders.find((recorder) => recorder.id === id) ?? null;
  }

  /** 실행 중에 바뀐 설정을 반영한다 */
  applyMaterials({ ground, props }: GameConfig): void {
    for (const collider of this.terrain) collider.setFriction(ground.friction);
    for (const { collider, data } of this.objects) {
      collider.setFriction(props.friction);
      collider.setRestitution(props.restitution);
      collider.setDensity(data.density ?? props.density);
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

/** 매달린 물건(열매)은 떨어질 때까지 움직이지 않는 바디로 만든다 */
function addBox(physics: PhysicsWorld, data: BoxData): SimObject {
  const { x, y, width, height, angle } = data;
  const bodyDesc = data.hang ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
  const body = physics.raw.createRigidBody(bodyDesc.setTranslation(x, y).setRotation(angle));
  const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setCollisionGroups(collisionGroups('Prop'));
  const collider = physics.raw.createCollider(desc, body);
  physics.track(body);
  return { kind: 'box', body, collider, width, height, data };
}
