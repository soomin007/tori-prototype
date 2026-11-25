import RAPIER from '@dimforge/rapier2d-compat';
import { M0_ROOM } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import { FixedStepper, PhysicsWorld } from '../physics/world';
import type { Pose } from '../physics/world';
import { clearPressed } from './inputState';
import type { InputState } from './inputState';

/** 그리기 쪽에 알려 주는 물체 하나. 크기는 미터다. */
export interface SimObject {
  kind: 'terrain' | 'box';
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  width: number;
  height: number;
}

/**
 * 월드와 방을 묶어 한 스텝씩 진행한다. 화면 없이도 돈다.
 * 만들기 전에 physics/world.ts의 initPhysics()를 기다려야 한다.
 */
export class Simulation {
  private readonly config: GameConfig;
  private physics: PhysicsWorld;
  private readonly stepper = new FixedStepper();
  private list: SimObject[] = [];
  /** 방을 다시 만들 때마다 1씩 커진다. 그리기 쪽은 이 값이 바뀌면 그림을 다시 만든다. */
  generation = 0;
  stepCount = 0;

  constructor(config: GameConfig) {
    this.config = config;
    this.physics = new PhysicsWorld(config);
    this.buildRoom();
  }

  get objects(): readonly SimObject[] {
    return this.list;
  }

  /** 디버그 그리기용 Rapier 월드 */
  get world(): RAPIER.World {
    return this.physics.raw;
  }

  /** 방을 처음부터 다시 만든다 */
  reset(): void {
    this.physics.free();
    this.physics = new PhysicsWorld(this.config);
    this.stepper.reset();
    this.stepCount = 0;
    this.generation += 1;
    this.buildRoom();
  }

  /** 튜닝 패널에서 바뀐 값을 지금 있는 물체에 반영한다 */
  applyConfig(): void {
    this.physics.applyConfig(this.config);
    for (const object of this.list) this.applyMaterial(object);
  }

  /** 프레임 시간만큼 진행한다 */
  advance(frameSeconds: number, input: InputState): void {
    this.stepper.advance(frameSeconds, this.config.physics.maxStepsPerFrame, () => this.step(input));
  }

  /** 고정 스텝 한 번 */
  step(input: InputState): void {
    this.physics.step();
    this.stepCount += 1;
    // 한 프레임에 여러 스텝이 돌아도 누른 순간은 한 번만 쓴다. 스텝이 돌지 않은 프레임의 입력은 다음까지 남는다.
    clearPressed(input);
  }

  /** 지금 그릴 자세 */
  poseOf(object: SimObject): Pose {
    return this.physics.poseOf(object.body, this.config.view.interpolate ? this.stepper.alpha : 1);
  }

  private buildRoom(): void {
    this.list = [];
    const room = M0_ROOM;
    const wallHeight = room.height + room.wallExtraHeight;
    const wallY = room.height - wallHeight / 2;

    this.addTerrain(room.width / 2, room.height - room.floorThickness / 2, room.width, room.floorThickness);
    this.addTerrain(room.wallThickness / 2, wallY, room.wallThickness, wallHeight);
    this.addTerrain(room.width - room.wallThickness / 2, wallY, room.wallThickness, wallHeight);

    // 세 줄로 조금씩 어긋나게 쌓아, 떨어지면서 서로 부딪히게 한다. 열 때마다 같은 자리다.
    const { count, size } = this.config.testBoxes;
    for (let i = 0; i < count; i += 1) {
      const column = (i % 3) - 1;
      const x = room.width / 2 + column * size * 0.8 + (i % 2) * size * 0.25;
      this.addBox(x, 1 - i * size * 1.4, i * 0.35);
    }
  }

  private addTerrain(x: number, y: number, width: number, height: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
    this.addObject('terrain', body, width, height);
  }

  private addBox(x: number, y: number, angle: number): void {
    const { size } = this.config.testBoxes;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setRotation(angle);
    const body = this.world.createRigidBody(desc);
    this.addObject('box', body, size, size);
    this.physics.track(body);
  }

  private addObject(kind: SimObject['kind'], body: RAPIER.RigidBody, width: number, height: number): void {
    const groups = collisionGroups(kind === 'box' ? 'Prop' : 'Terrain');
    const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setCollisionGroups(groups);
    const object: SimObject = { kind, body, collider: this.world.createCollider(desc, body), width, height };
    this.applyMaterial(object);
    this.list.push(object);
  }

  private applyMaterial({ kind, collider }: SimObject): void {
    const { ground, testBoxes } = this.config;
    if (kind === 'terrain') {
      collider.setFriction(ground.friction);
    } else {
      collider.setFriction(testBoxes.friction);
      collider.setRestitution(testBoxes.restitution);
      collider.setDensity(testBoxes.density);
    }
  }
}
