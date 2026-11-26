import RAPIER from '@dimforge/rapier2d-compat';
import type { Abilities } from '../config/abilities';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { DuelData } from '../rooms/rooms';
import type { GameState } from '../state/gameState';
import type { Tori } from '../tori/body';
import type { InputState } from './inputState';
import { Opponent } from './opponent';
import type { Box, FoeOrder } from './opponent';
import { StruggleGauge } from './struggle';

/**
 * 결투의 단계(PLAN 7.6). 결투 밖(waiting) → 시작(starting) → 싸움(fighting) → 끝.
 * 싸움은 셋으로 끝난다. 상대의 체력이 0이면 승리(won)다. 토리의 체력이 0이면 쓰러짐과 심판 카운트(downed)로 가고,
 * 거기서 꼬리를 자르면 회귀(cut), 카운트가 먼저 끝나면 탈락(lost)이다.
 */
export type DuelPhase = 'waiting' | 'starting' | 'fighting' | 'downed' | 'won' | 'cut' | 'lost';

/** 그리기 쪽이 연출을 붙일 일 */
export type DuelEvent = 'duel-start' | 'tori-hurt' | 'down' | 'struggle' | 'won' | 'lost';

/** 결투장 벽의 두께(m, 자리값) */
const WALL_WIDTH = 0.3;

/** 단계마다 상대에게 시키는 일 */
const ORDERS: Record<DuelPhase, FoeOrder> = {
  waiting: 'wait',
  starting: 'wait',
  fighting: 'fight',
  downed: 'retreat',
  won: 'wait',
  cut: 'retreat',
  lost: 'retreat',
};

/**
 * 결투장 하나의 진행. 벽, 상대, 두 참가자의 체력, 토리가 맞은 뒤의 경직과 무적, 심판 카운트, 버둥거림 게이지를 들고 있다.
 * 체력은 결투 안에만 있는 값이라 게임 상태(state/)에 넣지 않는다. 이긴 결투만 상태의 duelsWon에 적는다.
 * 꼬리로 상대를 치는 판정은 sim/strike.ts가 하고, 여기서는 상대의 공격이 토리에 닿는지를 본다.
 */
export class Duel {
  readonly data: DuelData;
  readonly opponent: Opponent;
  phase: DuelPhase = 'waiting';
  /** 지금 단계에 들어온 뒤 지난 시간 */
  elapsed = 0;
  readonly toriMaxHealth: number;
  toriHealth: number;
  /** 맞은 토리의 이동과 꼬리 입력이 먹지 않는 남은 시간 */
  stagger = 0;
  /** 맞은 토리가 다시 맞지 않는 남은 시간 */
  invulnerable = 0;
  readonly gauge = new StruggleGauge();

  private readonly world: RAPIER.World;
  private readonly config: GameConfig;
  private readonly abilities: Abilities;
  private readonly emit: (event: DuelEvent) => void;
  private walls: RAPIER.RigidBody[] = [];

  /** 토리의 체력 상한에는 능력표의 maxHealth를 곱한다(PLAN 7.5) */
  constructor(
    physics: PhysicsWorld,
    data: DuelData,
    config: GameConfig,
    abilities: Abilities,
    emit: (event: DuelEvent) => void,
  ) {
    this.data = data;
    this.world = physics.raw;
    this.config = config;
    this.abilities = abilities;
    this.emit = emit;
    this.toriMaxHealth = config.duel.toriHealth * abilities.maxHealth;
    this.toriHealth = this.toriMaxHealth;
    this.opponent = new Opponent(physics, data.opponent, data.opponentX, data.floorY, config);
  }

  /** 벽이 닫혀 있는지 */
  get closed(): boolean {
    return this.walls.length > 0;
  }

  /** 결투 중인지(시작부터 끝나기 전까지). 전광판은 이때만 뜬다. */
  get active(): boolean {
    return this.phase === 'starting' || this.phase === 'fighting' || this.phase === 'downed';
  }

  /**
   * 꼬리로 칠 수 있는 상대. 싸우는 동안에만 있다. 맞아서 경직된 동안에는 없다.
   * 밀려나는 몸과 함께 꼬리가 상대에 대해 빨라져, 휘두르지 않았는데도 타격으로 잡혔다.
   */
  get target(): Opponent | null {
    return this.phase === 'fighting' && this.stagger === 0 ? this.opponent : null;
  }

  /** 심판 카운트에 띄울 숫자(1부터). 쓰러져 있을 때만 있다. */
  get count(): number | null {
    if (this.phase !== 'downed') return null;
    const { countSeconds, countTo } = this.config.duel;
    return Math.min(countTo, Math.floor(this.elapsed / Math.max(countSeconds, FIXED_DT)) + 1);
  }

  /** 맞은 뒤 경직 중이거나 쓰러져 있어서 토리의 이동과 꼬리 입력을 막아야 하는지 */
  get holdsTori(): boolean {
    return this.stagger > 0 || this.phase === 'downed' || this.phase === 'lost';
  }

  /**
   * 물리 스텝 직전. input은 막기 전의 입력이다(쓰러져 있어도 버둥거림은 읽는다).
   * canCut은 자를 구간이 남았는지다. 버둥거림 게이지가 다 찬 스텝에 true를 준다. 그때 자르는 것은 Simulation이 한다.
   */
  beforeStep(tori: Tori, input: InputState, canCut: boolean): boolean {
    const { duel } = this.config;
    this.elapsed += FIXED_DT;
    this.stagger = Math.max(0, this.stagger - FIXED_DT);
    this.invulnerable = Math.max(0, this.invulnerable - FIXED_DT);
    let full = false;

    switch (this.phase) {
      case 'waiting':
        if (this.entered(tori)) this.begin();
        break;
      case 'starting':
        if (this.elapsed + 1e-9 >= duel.startSeconds) this.enter('fighting');
        break;
      case 'fighting':
        this.toriHealth = Math.min(this.toriMaxHealth, this.toriHealth + duel.regenPerSecond * FIXED_DT);
        break;
      case 'downed':
        full = this.gauge.step(input, this.config, canCut);
        if (this.gauge.pulses > 0) {
          tori.struggle(this.gauge.count % 2 === 0 ? 1 : -1, duel.struggleTwitch);
          this.emit('struggle');
        }
        if (!full && this.elapsed + 1e-9 >= duel.countTo * duel.countSeconds) {
          this.enter('lost');
          this.emit('lost');
        }
        break;
      default:
        break;
    }

    if (this.phase !== 'won') {
      this.opponent.step(ORDERS[this.phase], tori.torso.translation().x, this.config.torso.length / 2);
    }
    return full;
  }

  /** 물리 스텝 직후. 꼬리 타격(sim/strike.ts)으로 상대가 쓰러졌는지, 상대의 공격이 토리에 닿았는지를 본다. */
  afterStep(tori: Tori, state: GameState): void {
    if (this.phase !== 'fighting') return;
    if (this.opponent.defeated) {
      this.win(state);
      return;
    }
    this.hitTori(tori);
    if (this.toriHealth > 0) return;
    this.enter('downed');
    this.gauge.reset();
    tori.knockDown(Math.sign(tori.torso.translation().x - this.opponent.x) || this.opponent.facing);
    this.emit('down');
  }

  /** 꼬리가 잘렸다. 회귀 연출이 끝나면 방을 다시 만들므로 결투도 그때 처음으로 돌아간다. */
  markCut(): void {
    if (this.active) this.enter('cut');
  }

  private entered(tori: Tori): boolean {
    const { x } = tori.torso.translation();
    return x >= this.data.startX && x <= this.data.right;
  }

  private begin(): void {
    this.toriHealth = this.toriMaxHealth;
    this.stagger = 0;
    this.invulnerable = 0;
    this.gauge.reset();
    this.closeWalls();
    this.enter('starting');
    this.emit('duel-start');
  }

  private enter(phase: DuelPhase): void {
    this.phase = phase;
    this.elapsed = 0;
  }

  /** 상대의 공격 판정 범위가 토리의 몸통이나 머리에 닿으면 피해, 넉백, 경직이다. 꼬리가 맞는 것은 치지 않는다(PLAN 7.6). */
  private hitTori(tori: Tori): void {
    const { opponent } = this;
    const box = opponent.hitBox;
    const attack = opponent.attack;
    if (!box || !attack || opponent.landed || this.invulnerable > 0) return;
    if (!tori.colliders.some((collider) => overlaps(collider, box))) return;
    const { duel } = this.config;
    opponent.landed = true;
    this.toriHealth = Math.max(0, this.toriHealth - attack.damage);
    this.stagger = duel.hurtStaggerSeconds;
    this.invulnerable = duel.hurtInvulnSeconds;
    const away = Math.sign(tori.torso.translation().x - opponent.x) || opponent.facing;
    // 넉백은 능력표의 poise로 나눈다(PLAN 7.5)
    tori.knockback(away, attack.knockback / Math.max(this.abilities.poise, 1e-3), attack.lift);
    this.emit('tori-hurt');
  }

  private win(state: GameState): void {
    this.enter('won');
    this.openWalls();
    if (!state.duelsWon.includes(this.data.id)) state.duelsWon.push(this.data.id);
    this.emit('won');
  }

  /** 양쪽 끝에 벽을 세운다. 지형처럼 몸, 꼬리, 물건, 상대를 모두 막는다. */
  private closeWalls(): void {
    const { left, right, floorY } = this.data;
    const height = this.config.duel.wallHeight;
    this.walls = [left, right].map((x) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, floorY - height / 2));
      const desc = RAPIER.ColliderDesc.cuboid(WALL_WIDTH / 2, height / 2).setCollisionGroups(collisionGroups('Terrain'));
      this.world.createCollider(desc, body);
      return body;
    });
  }

  private openWalls(): void {
    for (const body of this.walls) this.world.removeRigidBody(body);
    this.walls = [];
  }

  /** 그리기용: 닫힌 벽의 사각형 */
  get wallBoxes(): Box[] {
    if (!this.closed) return [];
    const { left, right, floorY } = this.data;
    const height = this.config.duel.wallHeight;
    return [left, right].map((x) => ({ left: x - WALL_WIDTH / 2, right: x + WALL_WIDTH / 2, top: floorY - height, bottom: floorY }));
  }
}

/** 콜라이더가 방 좌표의 사각형과 겹치는지 */
function overlaps(collider: RAPIER.Collider, { left, right, top, bottom }: Box): boolean {
  const shape = new RAPIER.Cuboid((right - left) / 2, (bottom - top) / 2);
  return collider.intersectsShape(shape, { x: (left + right) / 2, y: (top + bottom) / 2 }, 0);
}
