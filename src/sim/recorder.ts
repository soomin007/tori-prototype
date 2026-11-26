import RAPIER from '@dimforge/rapier2d-compat';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { Point, RecorderData } from '../rooms/rooms';

/** 화면에 띄울 대사 한 줄 */
export interface Dialogue {
  /** 말하는 기록관의 id */
  recorder: string;
  speaker: string;
  text: string;
}

/** 대화 상자의 이름 칸. 기록관은 기획에 있는 역할 이름이다. */
const SPEAKER = '기록관';

/**
 * 방에 놓인 기록관 하나와 그 문(PLAN 7.8). 문은 지형처럼 몸, 꼬리, 물건을 모두 막는다.
 * 문이 열려 있는지는 상태의 talkedTo가 정하므로, 회귀로 방을 다시 만들면 체크포인트 때의 모습으로 돌아간다.
 */
export class Recorder {
  readonly data: RecorderData;
  private readonly world: RAPIER.World;
  private door: RAPIER.Collider | null = null;

  constructor(physics: PhysicsWorld, data: RecorderData, doorOpen: boolean) {
    this.data = data;
    this.world = physics.raw;
    if (data.door && !doorOpen) {
      const { x, y, width, height } = data.door;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y - height / 2));
      const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setCollisionGroups(collisionGroups('Terrain'));
      this.door = this.world.createCollider(desc, body);
    }
  }

  get id(): string {
    return this.data.id;
  }

  /** 문이 앞길을 막고 있는지 */
  get doorClosed(): boolean {
    return this.door !== null;
  }

  openDoor(): void {
    if (!this.door) return;
    this.world.removeCollider(this.door, true);
    this.door = null;
  }

  /** 토리의 몸통 중심이 감지 영역 안에 있는지 */
  hears({ x, y }: Point, { recorder }: GameConfig): boolean {
    return Math.abs(x - this.data.x) <= recorder.talkRange && Math.abs(y - this.data.y) <= recorder.talkHeight;
  }

  /** 번호와 시각을 넣은 대사 */
  dialogue(): Dialogue {
    const { id, line, number, time } = this.data;
    return { recorder: id, speaker: SPEAKER, text: line.replaceAll('{번호}', number).replaceAll('{시각}', time) };
  }
}
