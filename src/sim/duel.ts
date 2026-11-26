import RAPIER from '@dimforge/rapier2d-compat';
import type { Abilities } from '../config/abilities';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { collisionGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/world';
import type { DuelData, ScriptedEventData } from '../rooms/rooms';
import type { GameState } from '../state/gameState';
import type { Tori } from '../tori/body';
import type { InputState } from './inputState';
import { boxOverlaps, Opponent } from './opponent';
import type { Box, FoeOrder } from './opponent';
import { ScriptedEvent } from './scripted';
import type { EventContext, EventSignal } from './scripted';
import { StruggleGauge } from './struggle';

/**
 * 결투의 단계(PLAN 7.6). 결투 밖(waiting) → 시작(starting) → 싸움(fighting) → 끝.
 * 싸움은 셋으로 끝난다. 상대의 체력이 0이면 승리(won)다. 토리의 체력이 0이면 쓰러짐과 심판 카운트(downed)로 가고,
 * 거기서 꼬리를 자르면 회귀(cut), 카운트가 먼저 끝나면 탈락(lost)이다.
 */
export type DuelPhase = 'waiting' | 'starting' | 'fighting' | 'downed' | 'won' | 'cut' | 'lost';

/** 그리기 쪽이 연출을 붙일 일. pinned는 대본 사건의 구조물에 깔린 것이다. */
export type DuelEvent = 'duel-start' | 'tori-hurt' | 'down' | 'pinned' | 'struggle' | 'won' | 'lost' | EventSignal;

/** 결투장 벽의 두께(m, 자리값) */
const WALL_WIDTH = 0.3;
/** 처음 한 번의 대본 사건이 일어나기 전에 두 참가자의 체력이 내려가지 않는 하한(scripted.forceFirst) */
const GUARD_HEALTH = 1;

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
 * 결투에 딸린 대본 사건(sim/scripted.ts)도 여기서 진행한다. 구조물에 깔리면 쓰러졌을 때와 같은 단계(downed)로 가서
 * 같은 심판 카운트와 버둥거림 게이지를 쓴다(PLAN 7.6).
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
  /** 이 결투에 딸린 대본 사건 */
  readonly events: ScriptedEvent[] = [];
  /** 쓰러진 것이 대본 사건의 구조물에 깔려서인지 */
  pinned = false;
  /**
   * 다시 깔렸는데 자르지 않기로 해서(scripted.repinCuts), 기록관 앞으로 돌아가 다시 할 때가 됐는지.
   * Simulation이 스텝 끝에서 보고 돌려보낸다.
   */
  retryDue = false;

  private readonly world: RAPIER.World;
  private readonly config: GameConfig;
  private readonly abilities: Abilities;
  private readonly emit: (event: DuelEvent) => void;
  /** 방을 만들 때의 회귀 횟수 */
  private readonly rewinds: number;
  private walls: RAPIER.RigidBody[] = [];
  /** 깔린 뒤 버둥거림으로 자르지 않고 다시 하기를 기다리는 중인지 */
  private retrying = false;
  /** 이번 스텝에 자를 구간이 남았는지 */
  private canCut = true;

  /** 토리의 체력 상한에는 능력표의 maxHealth를 곱한다(PLAN 7.5). rewinds는 방을 만들 때의 회귀 횟수다. */
  constructor(
    physics: PhysicsWorld,
    data: DuelData,
    config: GameConfig,
    abilities: Abilities,
    emit: (event: DuelEvent) => void,
    rewinds = 0,
  ) {
    this.data = data;
    this.world = physics.raw;
    this.config = config;
    this.abilities = abilities;
    this.emit = emit;
    this.rewinds = rewinds;
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

  /** 심판 카운트에 띄울 숫자(1부터). 쓰러져 있고 심판이 세는 동안만 있다. */
  get count(): number | null {
    if (!this.counting) return null;
    const { countSeconds, countTo } = this.config.duel;
    return Math.min(countTo, Math.floor(this.elapsed / Math.max(countSeconds, FIXED_DT)) + 1);
  }

  /** 대본 사건을 붙인다. 방을 만들 때 Room이 부른다. */
  addEvent(data: ScriptedEventData): ScriptedEvent {
    const { left, right, floorY } = this.data;
    const inside = { left: left + WALL_WIDTH / 2, right: right - WALL_WIDTH / 2, floorY };
    const event = new ScriptedEvent(data, this.config, this.rewinds, inside);
    this.events.push(event);
    return event;
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
    this.canCut = canCut;
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
        full = this.stepDowned(tori, input, canCut);
        break;
      default:
        break;
    }

    this.stepEvents(tori);
    if (this.phase !== 'won') {
      this.opponent.step(this.order, tori.torso.translation().x, this.config.torso.length / 2);
    }
    return full;
  }

  /** 상대에게 시킬 일. 대본 사건이 예고하고 떨어지는 동안에는 새 공격을 시작하지 않는다(scripted.holdFoe). */
  private get order(): FoeOrder {
    const order = ORDERS[this.phase];
    if (order === 'fight' && this.config.scripted.holdFoe && this.events.some((event) => event.busy)) return 'hold';
    return order;
  }

  /**
   * 심판이 세는지. 쓰러졌으면 늘 세고, 깔렸으면 scripted.pinCount를 따른다. 자를 구간이 없으면 깔려도 센다.
   * 다시 깔렸는데 자르지 않기로 했으면 세지 않고 기록관 앞으로 돌아간다.
   */
  private get counting(): boolean {
    if (this.phase !== 'downed' || this.retrying) return false;
    return !this.pinned || this.config.scripted.pinCount || !this.canCut;
  }

  /** 쓰러져 있거나 깔려 있을 때. 버둥거리면 게이지가 차고, 심판이 다 세면 탈락이다. 게이지가 다 찬 스텝에 true를 준다. */
  private stepDowned(tori: Tori, input: InputState, canCut: boolean): boolean {
    const { duel, scripted } = this.config;
    const full = this.gauge.step(input, this.config, canCut && !this.retrying);
    if (this.gauge.pulses > 0) {
      tori.struggle(this.gauge.count % 2 === 0 ? 1 : -1, duel.struggleTwitch);
      this.emit('struggle');
    }
    if (this.retrying && this.elapsed + 1e-9 >= scripted.retrySeconds) this.retryDue = true;
    if (!full && this.counting && this.elapsed + 1e-9 >= duel.countTo * duel.countSeconds) {
      this.enter('lost');
      this.emit('lost');
    }
    return full;
  }

  /**
   * 딸린 대본 사건을 진행한다. 계기는 싸우는 동안에만 보고, 토리를 까는 것도 싸우는 동안뿐이다.
   * 처음 한 번의 사건이 끝나기 전에는 두 참가자의 체력이 1 밑으로 내려가지 않고, 1이 되면 사건이 바로 온다(scripted.forceFirst).
   * 처음 하는 사람이 사건 전에 쓰러지거나 이겨서 첫 절단을 건너뛰지 않게 한 것이다(PLAN 7.8).
   */
  private stepEvents(tori: Tori): void {
    if (this.phase === 'waiting' || this.events.length === 0) return;
    const fighting = this.phase === 'fighting';
    const guarding = fighting && this.guarding;
    this.opponent.minHealth = guarding ? GUARD_HEALTH : 0;
    const context: EventContext = {
      fighting,
      fightSeconds: fighting ? this.elapsed : 0,
      toriHealth: this.toriHealth / this.toriMaxHealth,
      foeHealth: this.opponent.health / this.opponent.maxHealth,
      force: guarding && (this.toriHealth <= GUARD_HEALTH || this.opponent.health <= GUARD_HEALTH),
    };
    for (const event of this.events) {
      if (event.step(context, tori, this.emit) && this.phase === 'fighting') this.pin(tori, event);
    }
  }

  /** 처음 한 번의 대본 사건이 아직 끝나지 않았는지 */
  private get guarding(): boolean {
    return this.events.some((event) => event.guards);
  }

  /** 대본 사건의 구조물에 깔렸다. 쓰러졌을 때처럼 심판이 세고 버둥거림 게이지가 찬다. */
  private pin(tori: Tori, event: ScriptedEvent): void {
    this.enter('downed');
    this.pinned = true;
    // 회귀한 뒤 또 깔렸는데 자르지 않기로 했으면, 버둥거려도 자르지 않고 다시 하기를 기다린다(11.1의 4번)
    this.retrying = this.rewinds > 0 && !this.config.scripted.repinCuts;
    this.stagger = 0;
    this.gauge.reset();
    tori.pinDown(event.x);
    this.emit('pinned');
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
    if (!tori.colliders.some((collider) => boxOverlaps(collider, box))) return;
    const { duel } = this.config;
    opponent.landed = true;
    this.toriHealth = Math.max(this.guarding ? GUARD_HEALTH : 0, this.toriHealth - attack.damage);
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
