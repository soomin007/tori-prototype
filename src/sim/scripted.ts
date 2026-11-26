import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import type { ScriptedEventData } from '../rooms/rooms';
import type { Tori } from '../tori/body';
import { boxOverlaps } from './opponent';
import type { Box } from './opponent';

/**
 * 대본 사건의 단계(PLAN 7.8). 기다림 → 예고 → 떨어짐 → 빗나가 바닥에 닿음(landed) 또는 토리를 깖(pinned).
 * 떨어지는 단계로 넘어가는 곳은 예고가 끝나는 곳 하나뿐이라, 예고 없이 동작하는 길이 없다.
 */
export type EventPhase = 'waiting' | 'warning' | 'falling' | 'landed' | 'pinned';

/** 그리기 쪽이 연출을 붙일 일. 깔린 것은 결투가 알린다('pinned'). */
export type EventSignal = 'event-warn' | 'event-drop' | 'event-land';

/** 사건이 한 스텝에 보는 것. 사건이 딸린 결투가 채운다. */
export interface EventContext {
  /** 결투가 싸움 중인지. 아니면 계기를 보지 않고, 떨어져도 토리를 깔지 않는다. */
  fighting: boolean;
  /** 싸움이 시작된 뒤 지난 시간 */
  fightSeconds: number;
  /** 체력 비율(0~1) */
  toriHealth: number;
  foeHealth: number;
  /** 계기와 상관없이 지금 일으킨다. 처음 한 번의 사건 전에 누가 쓰러지려 할 때다(scripted.forceFirst). */
  force: boolean;
}

/** 결투장 벽 안쪽. 구조물은 이 안에서만 움직이고 floorY에 떨어진다. */
export interface ArenaInside {
  left: number;
  right: number;
  floorY: number;
}

/**
 * 결투에 딸린 대본 사건 하나. 결투가 시작되면 매달린 구조물이 토리 위로 천천히 따라오고(scripted.aimSpeed),
 * 계기가 오면 그 자리에 멈춘 채 위쪽 인물이 예고한 뒤 떨어진다. 몸통이나 머리에 닿으면 토리를 깔고,
 * 결투는 쓰러졌을 때처럼 버둥거림으로 간다(sim/duel.ts). 예고가 시작되면 떨어질 자리가 정해지므로, 예고를 보고 비키면 피한다.
 * 처음 한 번(first)은 예고와 낙하 동안에도 토리보다 두 배 빠르게 따라와 반드시 깐다.
 * 구조물은 부딪히는 바디 없이 사각형으로만 움직인다. 물건이나 상대를 밀지 않고, 깔린 토리를 붙잡는 것은 Tori.pinDown이 한다.
 * 회귀하면 방을 다시 만들면서 새로 생기므로 같은 계기에 같은 일이 일어난다.
 */
export class ScriptedEvent {
  readonly data: ScriptedEventData;
  phase: EventPhase = 'waiting';
  /** 지금 단계에 들어온 뒤 지난 시간 */
  elapsed = 0;
  /** 구조물 가운데의 x */
  x: number;
  /** 구조물 아랫면의 y */
  bottom: number;
  /** 회귀 0번이고 scripted.forceFirst가 켜져 있으면 참이다. 떨어지는 동안에도 토리를 따라가 반드시 깐다(PLAN 7.8). */
  readonly first: boolean;

  private readonly config: GameConfig;
  private readonly floorY: number;
  /** 구조물 가운데가 움직일 수 있는 범위 */
  private readonly span: { min: number; max: number };
  private speed = 0;

  /** rewinds는 방을 만들 때의 회귀 횟수다. 예고 시간이 0이면 오류를 낸다(예고 없이 동작하지 못한다). */
  constructor(data: ScriptedEventData, config: GameConfig, rewinds: number, inside: ArenaInside) {
    if (!(config.scripted.warnSeconds > 0)) throw new Error(`대본 사건 ${data.id}의 예고 시간이 0이다`);
    this.data = data;
    this.config = config;
    this.first = rewinds === 0 && config.scripted.forceFirst;
    this.floorY = inside.floorY;
    const half = data.drop.width / 2;
    this.span = { min: inside.left + half, max: Math.max(inside.left + half, inside.right - half) };
    this.x = clamp(data.drop.x, this.span.min, this.span.max);
    this.bottom = data.drop.y;
  }

  /** 예고하거나 떨어지는 중인지. 이때 상대는 새 공격을 시작하지 않는다(scripted.holdFoe). */
  get busy(): boolean {
    return this.phase === 'warning' || this.phase === 'falling';
  }

  /** 처음 한 번의 사건이 아직 끝나지 않아, 두 참가자가 쓰러지지 않게 지키는 중인지(scripted.forceFirst) */
  get guards(): boolean {
    return this.first && (this.phase === 'waiting' || this.busy);
  }

  /** 그릴지. 빗나간 구조물은 바닥에 lingerSeconds 동안 남았다가 사라진다. */
  get visible(): boolean {
    return this.phase !== 'landed' || this.elapsed < this.config.scripted.lingerSeconds;
  }

  /** 구조물의 사각형(방 좌표) */
  get box(): Box {
    const { width, height } = this.data.drop;
    return { left: this.x - width / 2, right: this.x + width / 2, top: this.bottom - height, bottom: this.bottom };
  }

  /** 물리 스텝 직전에 한 번 부른다. 이번 스텝에 토리를 깔았으면 true를 준다. */
  step(context: EventContext, tori: Tori, emit: (signal: EventSignal) => void): boolean {
    const { scripted } = this.config;
    this.elapsed += FIXED_DT;
    const toriX = tori.torso.translation().x;
    switch (this.phase) {
      case 'waiting':
        this.aim(toriX, scripted.aimSpeed);
        if (context.fighting && (context.force || this.triggered(context, toriX))) {
          this.enter('warning');
          emit('event-warn');
        }
        return false;
      case 'warning':
        // 떨어질 자리는 예고가 시작될 때 정해진다. 처음 한 번만 계속 따라온다.
        if (this.first) this.aim(toriX, this.chaseSpeed);
        // 떨어지는 단계로 넘어가는 곳은 여기 하나다
        if (this.elapsed + 1e-9 >= scripted.warnSeconds) {
          this.enter('falling');
          emit('event-drop');
        }
        return false;
      case 'falling':
        return this.fall(context, tori, emit);
      case 'pinned':
        this.restOn(tori);
        return false;
      default:
        return false;
    }
  }

  /** 처음 한 번 따라오는 빠르기. 토리의 최고 속도의 두 배라 달려도 벗어나지 못한다. */
  private get chaseSpeed(): number {
    return 2 * this.config.move.maxSpeed;
  }

  /** 계기 가운데 하나라도 맞는지 */
  private triggered({ fightSeconds, toriHealth, foeHealth }: EventContext, toriX: number): boolean {
    const { trigger } = this.data;
    return (
      (trigger.fightSeconds !== undefined && fightSeconds + 1e-9 >= trigger.fightSeconds) ||
      (trigger.foeHealthBelow !== undefined && foeHealth < trigger.foeHealthBelow) ||
      (trigger.toriHealthBelow !== undefined && toriHealth < trigger.toriHealthBelow) ||
      (trigger.toriPastX !== undefined && toriX > trigger.toriPastX)
    );
  }

  /** 떨어진다. 싸움 중에 몸통이나 머리에 닿으면 토리를 깔고, 바닥까지 닿지 않으면 빗나간 것이다. */
  private fall(context: EventContext, tori: Tori, emit: (signal: EventSignal) => void): boolean {
    const toriX = tori.torso.translation().x;
    // 처음 한 번은 떨어지는 동안에도 토리 위를 따라간다(scripted.forceFirst)
    if (this.first) this.aim(toriX, this.chaseSpeed);
    this.speed += this.config.scripted.fallAccel * FIXED_DT;
    this.bottom = Math.min(this.floorY, this.bottom + this.speed * FIXED_DT);
    const box = this.box;
    if (context.fighting && tori.colliders.some((collider) => boxOverlaps(collider, box))) {
      this.enter('pinned');
      // 등 한가운데에 얹힌다
      this.x = clamp(toriX, this.span.min, this.span.max);
      return true;
    }
    if (this.bottom >= this.floorY) {
      this.enter('landed');
      emit('event-land');
    }
    return false;
  }

  /** 깔린 동안 구조물은 토리 등 위에 얹혀 있다. 토리가 바닥에 눕는 만큼 같이 내려가고, 다시 올라가지 않는다. */
  private restOn(tori: Tori): void {
    const { thickness } = this.config.torso;
    const back = tori.torso.translation().y - thickness / 2;
    this.bottom = Math.min(this.floorY - thickness, Math.max(this.bottom, back));
  }

  /** 구조물을 토리 위로 speed(m/s)만큼 옮긴다. 결투장 벽 안쪽을 벗어나지 않는다. */
  private aim(toriX: number, speed: number): void {
    const target = clamp(toriX, this.span.min, this.span.max);
    const most = speed * FIXED_DT;
    this.x += Math.max(-most, Math.min(most, target - this.x));
  }

  private enter(phase: EventPhase): void {
    this.phase = phase;
    this.elapsed = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
