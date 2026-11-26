import RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { readOpponent } from '../config/opponents';
import type { Attack, OpponentData, OpponentKind } from '../config/opponents';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import { seededRandom } from './random';

/**
 * 결투 상대의 단계(PLAN 7.7). 서 있기(결투 전) → 거리 재기 → 예고 → 공격 → 빈틈 → 거리 재기로 돈다.
 * 맞으면 경직됐다가 거리 재기로 돌아온다. 토리가 쓰러지면 물러나고, 체력이 0이 되면 쓰러진다.
 */
export type FoePhase = 'idle' | 'measure' | 'windup' | 'attack' | 'recover' | 'stagger' | 'retreat' | 'defeated';

/**
 * 결투가 상대에게 시키는 일. wait는 결투 전과 시작할 때, retreat는 토리가 쓰러졌을 때다.
 * hold는 싸우는 중이지만 새 공격을 시작하지 않고 그 자리에서 거리만 잰다. 대본 사건이 예고하고 떨어지는 동안이다.
 */
export type FoeOrder = 'wait' | 'fight' | 'hold' | 'retreat';

/** 방 좌표의 사각형 */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 콜라이더가 방 좌표의 사각형과 겹치는지. 상대의 공격과 대본 사건의 구조물이 토리에 닿는지 볼 때 쓴다. */
export function boxOverlaps(collider: RAPIER.Collider, { left, right, top, bottom }: Box): boolean {
  const shape = new RAPIER.Cuboid((right - left) / 2, (bottom - top) / 2);
  return collider.intersectsShape(shape, { x: (left + right) / 2, y: (top + bottom) / 2 }, 0);
}

/** 돌진하다 이보다 느려지면 벽이나 토리에 막힌 것으로 본다(공격 속도에 대한 비율) */
const BLOCKED_RATIO = 0.3;
/** 공격을 시작하고 이 시간이 지나야 막힘을 본다(초). 막 출발했을 때는 아직 느리다. */
const BLOCKED_AFTER = 0.15;
/** 공격 판정 범위를 몸 앞쪽 끝에서 안쪽으로 이만큼 넓힌다(m). 몸이 토리에 붙어 있어도 맞게 한다. */
const HIT_INSET = 0.1;
/** 공격할 때 이 시간 안에 공격 속도에 닿게 가속한다(초) */
const LUNGE_RISE = 0.1;
/** 쓰러질 때 넘어지는 회전 속도(rad/s) */
const TOPPLE_SPIN = 2.5;
/** 쓰러진 몸이 미끄러지지 않고 모서리로 넘어가게 하는 마찰 */
const FALLEN_FRICTION = 0.8;

/**
 * 결투 상대 하나. 회전을 잠근 상자 바디(충돌 그룹 Enemy)에 상대 전용 이동과 공격을 붙였다(PLAN 7.7의 가).
 * 값은 설정에서 스텝마다 읽어서 튜닝 패널에서 바꾼 것이 바로 반영된다. 크기와 질량만 방을 다시 만들 때 반영된다.
 * 공격은 예고를 거쳐야만 시작된다. 예고 단계가 끝나는 곳 말고는 공격 단계로 넘어가는 길이 없다.
 */
export class Opponent {
  readonly kind: OpponentKind;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly width: number;
  readonly height: number;
  readonly maxHealth: number;
  health: number;
  /** 바라보는 쪽. 오른쪽 1, 왼쪽 -1 */
  facing: 1 | -1 = -1;
  phase: FoePhase = 'idle';
  /** 지금 단계에 들어온 뒤 지난 시간 */
  elapsed = 0;
  /** 예고하거나 치거나 빈틈을 보이는 공격. 다른 단계에서는 null이다. */
  attack: Attack | null = null;
  /** 이번 공격으로 토리를 맞혔는지 */
  landed = false;
  /** 체력이 이 밑으로 내려가지 않는다. 처음 한 번의 대본 사건이 일어나기 전에 1이 된다(PLAN 7.8). */
  minHealth = 0;

  private readonly config: GameConfig;
  private readonly random: () => number;
  private measureFor = 0;
  /** 다시 경직될 수 있을 때까지 남은 시간 */
  private staggerWait = 0;

  /** x는 발밑 가운데, floorY는 바닥 윗면이다. 설정을 읽어 공격의 예고 시간이 0이면 오류를 낸다. */
  constructor(physics: PhysicsWorld, kind: OpponentKind, x: number, floorY: number, config: GameConfig) {
    this.kind = kind;
    this.config = config;
    const { body } = readOpponent(config, kind);
    this.width = body.width;
    this.height = body.height;
    this.maxHealth = body.maxHealth;
    this.health = body.maxHealth;
    this.random = seededRandom(body.seed);

    const world = physics.raw;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, floorY - body.height / 2)
      .lockRotations()
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);
    // 마찰 없이 미끄러지게 두고, 움직임은 아래의 drive가 모두 정한다
    const shape = RAPIER.ColliderDesc.cuboid(body.width / 2, body.height / 2)
      .setMass(body.mass)
      .setFriction(0)
      .setCollisionGroups(collisionGroups('Enemy'));
    this.collider = world.createCollider(shape, this.body);
    physics.track(this.body);
  }

  get data(): OpponentData {
    return readOpponent(this.config, this.kind);
  }

  get x(): number {
    return this.body.translation().x;
  }

  get defeated(): boolean {
    return this.phase === 'defeated';
  }

  /** 공격 뒤의 빈틈이나 경직 중. 이때 말고는 방어구가 피해를 줄인다(guardDamage). */
  get opening(): boolean {
    return this.phase === 'recover' || this.phase === 'stagger';
  }

  /** 공격 판정 범위. 공격 중에만 있다. */
  get hitBox(): Box | null {
    if (this.phase !== 'attack' || !this.attack) return null;
    const { x, y } = this.body.translation();
    const front = x + (this.facing * this.width) / 2;
    const inner = front - this.facing * HIT_INSET;
    const outer = front + this.facing * this.attack.reach;
    const feet = y + this.height / 2;
    return {
      left: Math.min(inner, outer),
      right: Math.max(inner, outer),
      top: feet - this.attack.hitTop,
      bottom: feet - this.attack.hitBottom,
    };
  }

  /** 몸 앞쪽 끝에서 토리 몸통 끝까지의 간격. 겹치면 0이다. */
  gapTo(toriX: number, toriHalf: number): number {
    return Math.max(0, Math.abs(toriX - this.x) - this.width / 2 - toriHalf);
  }

  /** 물리 스텝 직전에 한 번 부른다. toriHalf는 토리 몸통 길이의 절반이다. */
  step(order: FoeOrder, toriX: number, toriHalf: number): void {
    const { body, attacks } = this.data;
    this.elapsed += FIXED_DT;
    this.staggerWait = Math.max(0, this.staggerWait - (this.phase === 'stagger' ? 0 : FIXED_DT));
    const gap = this.gapTo(toriX, toriHalf);
    const toward = Math.sign(toriX - this.x) || this.facing;

    if (this.phase === 'defeated') return;
    if (order === 'retreat' && this.phase !== 'stagger' && this.phase !== 'retreat') this.enter('retreat');
    const fighting = order === 'fight' || order === 'hold';
    if (fighting && (this.phase === 'idle' || this.phase === 'retreat')) this.enterMeasure();

    switch (this.phase) {
      case 'idle':
        this.face(toward);
        this.drive(0, body.accel);
        break;
      case 'measure': {
        this.face(toward);
        const choices = attacks.filter(({ minRange, maxRange }) => gap >= minRange && gap <= maxRange);
        // 어느 공격의 거리도 아니면 다가간다. hold면 그 자리에 선다.
        const approach = choices.length === 0 && order !== 'hold';
        this.drive(approach ? toward * body.walkSpeed : 0, body.accel);
        if (choices.length > 0 && this.elapsed >= this.measureFor && order === 'fight') {
          this.attack = choices[Math.floor(this.random() * choices.length)];
          this.enter('windup');
        }
        break;
      }
      case 'windup':
        this.drive(0, body.accel);
        // 공격 단계로 넘어가는 곳은 여기 하나다
        if (this.attack && this.elapsed + 1e-9 >= this.attack.windupSeconds) this.startAttack();
        break;
      case 'attack':
        this.lunge();
        break;
      case 'recover':
        this.drive(0, body.accel);
        if (this.elapsed + 1e-9 >= (this.attack?.recoverSeconds ?? 0)) this.enterMeasure();
        break;
      case 'stagger':
        this.drive(0, body.slideDecel);
        if (this.elapsed + 1e-9 >= body.staggerSeconds) {
          this.staggerWait = body.staggerCooldownSeconds;
          this.enterMeasure(body.measureMinSeconds);
        }
        break;
      case 'retreat':
        this.face(toward);
        this.drive(gap < body.retreatGap ? -toward * body.walkSpeed : 0, body.accel);
        break;
    }
  }

  /**
   * 꼬리에 맞았다. 피해를 받고 토리 반대쪽으로 밀려나고, 경직될 수 있으면 경직된다. 실제로 받은 피해를 준다.
   * push는 밀려나는 속도(m/s)이고 넉백 배율(knockbackTaken)을 여기서 곱한다.
   */
  hurt(damage: number, push: number, fromX: number): number {
    if (this.phase === 'defeated') return 0;
    const { body } = this.data;
    const dealt = Math.max(0, Math.min(this.health - this.minHealth, damage * (this.opening ? 1 : body.guardDamage)));
    this.health -= dealt;
    const away = Math.sign(this.x - fromX) || -this.facing;
    const speed = push * body.knockbackTaken;
    const { x: vx } = this.body.linvel();
    if (away * vx < speed) this.body.applyImpulse({ x: (away * speed - vx) * this.body.mass(), y: 0 }, true);

    if (this.health <= 0) this.fall(away);
    else if (this.canStagger()) this.enter('stagger');
    return dealt;
  }

  private canStagger(): boolean {
    const { armor } = this.data.body;
    if (this.phase === 'stagger' || this.staggerWait > 0) return false;
    return !(armor && (this.phase === 'windup' || this.phase === 'attack'));
  }

  private enter(phase: FoePhase): void {
    this.phase = phase;
    this.elapsed = 0;
    if (phase !== 'windup' && phase !== 'attack' && phase !== 'recover') this.attack = null;
  }

  private enterMeasure(seconds?: number): void {
    const { measureMinSeconds, measureMaxSeconds } = this.data.body;
    const span = Math.max(0, measureMaxSeconds - measureMinSeconds);
    this.measureFor = seconds ?? measureMinSeconds + span * this.random();
    this.enter('measure');
  }

  private startAttack(): void {
    this.landed = false;
    this.enter('attack');
  }

  /** 공격하는 동안 앞으로 나간다. 시간이 다 되거나, 맞히고 멈추는 공격이 맞혔거나, 막히면 빈틈으로 넘어간다. */
  private lunge(): void {
    const attack = this.attack as Attack;
    const speed = attack.lungeSpeed;
    this.drive(this.facing * speed, speed / LUNGE_RISE);
    const blocked = speed > 0 && this.elapsed > BLOCKED_AFTER && this.facing * this.body.linvel().x < speed * BLOCKED_RATIO;
    if (this.elapsed + 1e-9 >= attack.activeSeconds || (attack.stopOnHit && this.landed) || blocked) {
      this.enter('recover');
    }
  }

  /** 체력이 0이 되면 토리 반대쪽으로 넘어진다. 바닥에만 닿아서 토리가 넘어 지나갈 수 있다. */
  private fall(away: number): void {
    this.enter('defeated');
    this.body.lockRotations(false, true);
    this.body.setAngvel(away * TOPPLE_SPIN, true);
    this.collider.setFriction(FALLEN_FRICTION);
    this.collider.setCollisionGroups(collisionGroups('Fallen'));
  }

  private face(direction: number): void {
    if (direction !== 0) this.facing = direction > 0 ? 1 : -1;
  }

  /** 가로 속도를 accel(m/s²)을 넘지 않게 target으로 옮긴다 */
  private drive(target: number, accel: number): void {
    const { x: vx } = this.body.linvel();
    const limit = accel * FIXED_DT;
    const change = Math.min(limit, Math.max(-limit, target - vx));
    this.body.applyImpulse({ x: change * this.body.mass(), y: 0 }, true);
  }
}
