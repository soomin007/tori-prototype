import RAPIER from '@dimforge/rapier2d-compat';
import type { GameConfig } from '../config/defaults';
import { groundProbeGroups } from '../physics/groups';
import { FixedStepper, PhysicsWorld } from '../physics/world';
import type { Pose } from '../physics/world';
import { roomByNumber } from '../rooms/rooms';
import type { RoomData } from '../rooms/rooms';
import { Tori } from '../tori/body';
import { clearPressed } from './inputState';
import type { InputState } from './inputState';
import { Room } from './roomBuilder';
import type { SimObject } from './roomBuilder';

/**
 * 월드, 방, 토리를 묶어 한 스텝씩 진행한다. 화면 없이도 돈다.
 * 만들기 전에 physics/world.ts의 initPhysics()를 기다려야 한다.
 */
export class Simulation {
  readonly roomData: RoomData;
  private readonly config: GameConfig;
  private readonly stepper = new FixedStepper();
  private physics!: PhysicsWorld;
  private room!: Room;
  tori!: Tori;
  /** 방을 다시 만들 때마다 1씩 커진다. 그리기 쪽은 이 값이 바뀌면 그림을 다시 만든다. */
  generation = 0;
  stepCount = 0;

  constructor(config: GameConfig, roomData: RoomData = roomByNumber(1)) {
    this.config = config;
    this.roomData = roomData;
    this.build();
  }

  get objects(): readonly SimObject[] {
    return this.room.objects;
  }

  /** 디버그 그리기용 Rapier 월드 */
  get world(): RAPIER.World {
    return this.physics.raw;
  }

  /** 방을 처음부터 다시 만든다 */
  reset(): void {
    this.physics.free();
    this.stepper.reset();
    this.stepCount = 0;
    this.generation += 1;
    this.build();
  }

  /** 튜닝 패널에서 바뀐 값을 지금 있는 물체에 반영한다 */
  applyConfig(): void {
    this.physics.applyConfig(this.config);
    this.room.applyMaterials(this.config);
    this.tori.applyConfig();
  }

  /** 프레임 시간만큼 진행한다 */
  advance(frameSeconds: number, input: InputState): void {
    this.stepper.advance(frameSeconds, this.config.physics.maxStepsPerFrame, () => this.step(input));
  }

  /** 고정 스텝 한 번 */
  step(input: InputState): void {
    this.tori.step(input);
    this.physics.step();
    this.stepCount += 1;
    // 한 프레임에 여러 스텝이 돌아도 누른 순간은 한 번만 쓴다. 스텝이 돌지 않은 프레임의 입력은 다음까지 남는다.
    clearPressed(input);
  }

  /** 지금 그릴 자세 */
  poseOf(body: RAPIER.RigidBody): Pose {
    return this.physics.poseOf(body, this.config.view.interpolate ? this.stepper.alpha : 1);
  }

  /** (x, y)에서 아래로 maxDistance까지 디딜 바닥을 찾아 그 y를 준다. 다리 그림이 쓴다. */
  groundBelow(x: number, y: number, maxDistance: number): number | null {
    const ray = new RAPIER.Ray({ x, y }, { x: 0, y: 1 });
    const hit = this.world.castRay(ray, maxDistance, true, undefined, groundProbeGroups());
    return hit ? y + hit.timeOfImpact : null;
  }

  private build(): void {
    this.physics = new PhysicsWorld(this.config);
    this.room = new Room(this.physics, this.roomData, this.config);
    this.tori = new Tori(this.physics, this.config, this.roomData.spawn, (collider) => this.room.surfaceOf(collider));
  }
}
