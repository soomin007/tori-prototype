import type Phaser from 'phaser';
import { toMeters } from '../physics/world';
import { createInputState } from '../sim/inputState';
import type { Action } from '../sim/inputState';

/** 게임 진행과 상관없이 늘 먹는 키. 화면 단추도 같은 함수를 부른다. */
export interface SystemCommands {
  toggleDebug(): void;
  togglePanel(): void;
  toggleHelp(): void;
  restartRoom(): void;
  togglePause(): void;
  pause(): void;
  goToRoom(room: number): void;
  toStart(): void;
}

type SimpleCommand = Exclude<keyof SystemCommands, 'goToRoom'>;

/** 기능 키는 브라우저 기본 동작(F1 도움말, F3 찾기)을 막는다 */
const FUNCTION_KEYS: Record<string, SimpleCommand> = {
  F1: 'toggleDebug',
  F2: 'togglePanel',
  F3: 'toggleHelp',
};

const LETTER_COMMANDS: Record<string, SimpleCommand> = {
  KeyR: 'restartRoom',
  Escape: 'togglePause',
};

const ROOM_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };

/** 브라우저가 Esc로 포인터 잠금을 풀면서 Esc 키도 보낼 수 있어, 이 시간 안의 Esc는 버린다(ms) */
const UNLOCK_ESCAPE_MS = 300;

/** 키 위치(KeyboardEvent.code) → 동작. 글자로 받으면 한글 입력 상태에서 달라질 수 있다. */
const ACTION_KEYS: Record<string, Action> = {
  Space: 'jump',
  KeyE: 'interact',
  KeyQ: 'cutTail',
  KeyJ: 'attack',
  KeyK: 'grab',
  Mouse0: 'pointerGrab',
};

const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const GAME_KEYS = new Set([...Object.keys(ACTION_KEYS), ...LEFT_KEYS, ...RIGHT_KEYS]);

/** 키보드와 마우스를 읽어 InputState에 적는다 */
export class InputReader {
  readonly state = createInputState();
  private readonly down = new Set<string>();
  private readonly client = { x: 0, y: 0 };
  private readonly listeners = new AbortController();
  private readonly canvas: HTMLCanvasElement;
  private readonly commands: SystemCommands;
  private readonly wantsLock: () => boolean;
  private unlockedAt = -Infinity;

  /** wantsLock은 지금 포인터를 잠가야 하는지(상대 커서)를 알려 준다 */
  constructor(canvas: HTMLCanvasElement, commands: SystemCommands, wantsLock: () => boolean) {
    this.canvas = canvas;
    this.commands = commands;
    this.wantsLock = wantsLock;

    const { signal } = this.listeners;
    // 튜닝 패널(lil-gui)이 키 이벤트를 안에서 멈추므로 먼저 받는다(capture)
    const early = { signal, capture: true };
    window.addEventListener('keydown', (e) => this.onKeyDown(e), early);
    window.addEventListener('keyup', (e) => this.release(e.code), early);
    window.addEventListener('blur', () => this.releaseAll(), { signal });
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`), { signal });
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e), { signal });
    document.addEventListener('pointerlockchange', () => this.onLockChange(), { signal });

    // 단추나 패널을 마우스로 누른 뒤 초점이 남으면 Space가 그것을 다시 누른다
    document.addEventListener('click', (e) => e.detail > 0 && blurFocused('button, input[type="checkbox"]'), { signal });
    document.addEventListener('change', () => blurFocused('select'), { signal });
  }

  /** 프레임마다 시뮬레이션보다 먼저 부른다 */
  poll(camera: Phaser.Cameras.Scene2D.Camera): void {
    if (this.locked && !this.wantsLock()) document.exitPointerLock();
    const isDown = (code: string): boolean => this.down.has(code);
    this.state.moveX = Number(RIGHT_KEYS.some(isDown)) - Number(LEFT_KEYS.some(isDown));

    // 마우스가 가만히 있어도 카메라가 움직이면 가리키는 자리가 바뀐다
    const rect = this.canvas.getBoundingClientRect();
    const px = ((this.client.x - rect.left) / rect.width) * this.canvas.width;
    const py = ((this.client.y - rect.top) / rect.height) * this.canvas.height;
    const world = camera.getWorldPoint(px, py);
    this.state.pointer.x = toMeters(world.x);
    this.state.pointer.y = toMeters(world.y);
  }

  dispose(): void {
    this.listeners.abort();
    if (this.locked) document.exitPointerLock();
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** 잠금이 풀린 것을 일시정지 신호로 삼는다. 상대 커서를 꺼서 우리가 푼 것이면 멈추지 않는다. */
  private onLockChange(): void {
    if (this.locked) return;
    this.unlockedAt = performance.now();
    if (this.wantsLock()) this.commands.pause();
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Ctrl+R 같은 브라우저 단축키는 건드리지 않는다
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const functionCommand = FUNCTION_KEYS[event.code];
    if (functionCommand) {
      event.preventDefault();
      if (!event.repeat) this.commands[functionCommand]();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select')) return;
    if (event.code === 'Space' && target?.closest('button')) return;

    const room = ROOM_KEYS[event.code];
    if (room) {
      if (!event.repeat) this.commands.goToRoom(room);
      return;
    }

    const letterCommand = LETTER_COMMANDS[event.code];
    if (letterCommand) {
      if (event.code === 'Escape' && performance.now() - this.unlockedAt < UNLOCK_ESCAPE_MS) return;
      if (!event.repeat) this.commands[letterCommand]();
      return;
    }

    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    this.press(event.code);
  }

  private onMouseMove(event: MouseEvent): void {
    this.client.x = event.clientX;
    this.client.y = event.clientY;
    this.state.pointerActive = true;
    if (!this.locked) return;
    const scale = this.canvas.width / this.canvas.getBoundingClientRect().width;
    this.state.pointerDelta.x += toMeters(event.movementX * scale);
    this.state.pointerDelta.y += toMeters(event.movementY * scale);
  }

  private onMouseDown(event: MouseEvent): void {
    // Phaser가 mousedown의 기본 동작을 막아서, 패널 입력 칸의 초점이 저절로 풀리지 않는다
    blurFocused('input, textarea, select, button');
    this.onMouseMove(event);
    if (this.wantsLock() && !this.locked) {
      // 이 클릭은 포인터를 잠그는 데 쓴다. 브라우저가 막으면 다음 클릭에서 다시 시도한다.
      void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
      return;
    }
    this.press(`Mouse${event.button}`);
  }

  private press(code: string): void {
    // 누르고 있으면 keydown이 반복해서 온다. 눌린 순간은 한 번만 센다.
    if (this.down.has(code)) return;
    this.down.add(code);
    const action = ACTION_KEYS[code];
    if (!action) return;
    this.state.pressed[action] = true;
    this.state.held[action] = true;
  }

  private release(code: string): void {
    if (!this.down.delete(code)) return;
    const action = ACTION_KEYS[code];
    if (!action) return;
    this.state.held[action] = [...this.down].some((other) => ACTION_KEYS[other] === action);
  }

  private releaseAll(): void {
    for (const code of [...this.down]) this.release(code);
  }
}

function blurFocused(selector: string): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches(selector)) focused.blur();
}
