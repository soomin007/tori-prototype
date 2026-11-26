import Phaser from 'phaser';
import type { Session } from '../config/share';
import { hasRoom, roomByNumber } from '../rooms/rooms';
import { Simulation } from '../sim/simulation';
import { Hud } from '../ui/hud';
import { TuningPanel } from '../ui/tuningPanel';
import { FollowCamera } from '../view/camera';
import { DebugDraw } from '../view/debugDraw';
import { DuelView } from '../view/duelView';
import { EventView } from '../view/eventView';
import { InputReader } from '../view/inputReader';
import type { SystemCommands } from '../view/inputReader';
import { RoomView } from '../view/roomView';
import { TailOverlay } from '../view/tailOverlay';
import { ToriView } from '../view/toriView';

/** 탭을 떠났다 돌아왔을 때 다리 그림과 카메라가 한 번에 움직일 시간의 상한(초) */
const MAX_VIEW_SECONDS = 0.1;
/** 회귀 연출의 자리표시(PLAN 7.4): 꼬리가 끊길 때 화면이 흔들리고, 돌아올 때 하얗게 깜빡인다(ms, 세기) */
const CUT_SHAKE = { ms: 150, intensity: 0.004 };
const REWIND_FLASH_MS = 600;
/** 결투 연출의 자리표시: 토리가 맞으면 짧게, 쓰러지면 길게 흔들린다(ms, 세기) */
const HURT_SHAKE = { ms: 120, intensity: 0.006 };
const DOWN_SHAKE = { ms: 300, intensity: 0.01 };
/** 결투 1을 이긴 뒤 상대가 쓰러지는 것을 보여 주고 "체험판 끝" 화면을 띄울 때까지(ms) */
const DEMO_END_DELAY_MS = 1500;
/** 대본 사건의 구조물이 바닥이나 토리에 떨어질 때 흔들린다(ms, 세기) */
const DROP_SHAKE = { ms: 250, intensity: 0.012 };

/** 시뮬레이션을 프레임마다 진행하고 그린다. 게임 규칙은 sim/에 두고 여기에는 넣지 않는다. */
export class RoomScene extends Phaser.Scene {
  private readonly session: Session;
  private sim!: Simulation;
  private reader!: InputReader;
  private panel!: TuningPanel;
  private hud!: Hud;
  private debugDraw!: DebugDraw;
  private follow!: FollowCamera;
  private roomView?: RoomView;
  private toriView?: ToriView;
  private duelView?: DuelView;
  private eventView?: EventView;
  private overlay?: TailOverlay;
  private drawnGeneration = -1;
  private paused = false;
  /** 체험판의 마지막 결투를 이긴 뒤 지난 시간(ms). 이기기 전에는 null이다. */
  private demoWonFor: number | null = null;

  constructor(session: Session) {
    super('Room');
    this.session = session;
  }

  create(): void {
    const { session } = this;
    const missing = hasRoom(session.room) ? null : session.room;
    if (missing !== null) session.room = 1;
    this.paused = false;
    this.drawnGeneration = -1;
    this.demoWonFor = null;
    this.sim = new Simulation(session.config, roomByNumber(session.room), session.scheme);
    this.follow = new FollowCamera(this.cameras.main);
    this.debugDraw = new DebugDraw(this);

    const commands: SystemCommands = {
      toggleDebug: () => {
        this.debugDraw.toggle();
        this.hud.setToggle('debug', this.debugDraw.visible);
      },
      togglePanel: () => {
        this.panel.toggle();
        this.hud.setToggle('panel', this.panel.visible);
      },
      toggleHelp: () => this.hud.toggleHelp(),
      restartRoom: () => {
        this.sim.reset();
        this.setPaused(false);
      },
      togglePause: () => this.setPaused(!this.paused),
      pause: () => this.setPaused(true),
      goToRoom: (room) => this.goToRoom(room),
      toStart: () => this.scene.start('Start'),
    };
    this.hud = new Hud(document.getElementById('hud') as HTMLElement, commands, session.debug);
    this.panel = new TuningPanel(session, {
      // 몸의 치수를 바꿔도 자른 꼬리와 회귀 횟수는 그대로 둔다
      onParamChange: (meta) => (meta.rebuild ? this.sim.rebuild() : this.sim.applyConfig()),
      onSchemeChange: () => {
        this.sim.setScheme(session.scheme);
        this.sim.applyConfig();
        this.showStatus();
      },
      onRestart: commands.restartRoom,
      notify: (message) => this.hud.notify(message),
      showCopyFallback: (text) => this.hud.showCopyFallback(text),
    });
    this.reader = new InputReader(this.game.canvas, commands, () => this.wantsPointerLock(), session.debug);
    this.showStatus();
    if (missing !== null) this.notifyMissing(missing);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanUp());
    // 브라우저 콘솔에서 상태를 들여다보는 용도. 팀용 주소의 빌드에는 넣지 않는다.
    if (!__BUILD_VERSION__.startsWith('main')) Object.assign(window, { tori: { sim: this.sim, input: this.reader.state } });
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, MAX_VIEW_SECONDS);
    this.reader.poll(this.cameras.main);
    // "체험판 끝" 화면이 뜨면 게임을 멈춘다
    const ended = this.updateDemoEnd(deltaMs);
    if (!this.paused && !ended) this.sim.advance(deltaMs / 1000, this.reader.state);

    this.playEvents();
    // 회귀하면 마지막으로 말을 건 기록관의 방으로 돌아간다
    if (this.sim.state.room !== this.session.room && hasRoom(this.sim.state.room)) {
      this.session.room = this.sim.state.room;
      this.showStatus();
    }
    if (this.drawnGeneration !== this.sim.generation) this.rebuildViews();
    this.hud.showDialogue(this.sim.dialogue);
    this.showDuel();
    const { tori } = this.sim;
    this.roomView?.update();
    this.duelView?.update(this.paused ? 0 : dt);
    this.eventView?.update(this.paused ? 0 : dt);
    this.toriView?.update(this.paused ? 0 : dt);
    this.overlay?.update(this.usesRelativeCursor());
    this.follow.update(dt, this.sim.poseOf(tori.torso), tori.facing, this.session.config);
    this.debugDraw.draw(this.sim);
    this.panel.setFps(this.game.loop.actualFps);
  }

  /** 시뮬레이션에서 일어난 일에 화면 연출을 붙인다 */
  private playEvents(): void {
    const camera = this.cameras.main;
    for (const event of this.sim.drainEvents()) {
      if (event === 'cut') camera.shake(CUT_SHAKE.ms, CUT_SHAKE.intensity);
      else if (event === 'rewind') camera.flash(REWIND_FLASH_MS, 255, 255, 255);
      else if (event === 'tori-hurt') camera.shake(HURT_SHAKE.ms, HURT_SHAKE.intensity);
      else if (event === 'down') camera.shake(DOWN_SHAKE.ms, DOWN_SHAKE.intensity);
      else if (event === 'pinned' || event === 'event-land') camera.shake(DROP_SHAKE.ms, DROP_SHAKE.intensity);
    }
  }

  /** 결투 중에는 전광판을, 쓰러져 있으면 심판 카운트를, 탈락하면 배드엔딩 화면을 띄운다 */
  private showDuel(): void {
    const { duel, eliminated } = this.sim;
    const board = duel?.active
      ? {
          numbers: duel.data.numbers,
          health: [duel.toriHealth / duel.toriMaxHealth, duel.opponent.health / duel.opponent.maxHealth] as const,
        }
      : null;
    this.hud.showScoreboard(board);
    this.hud.showCount(duel?.count ?? null);
    this.hud.showEnding(eliminated);
  }

  /** 체험판의 마지막 결투를 이기고 잠깐 뒤에 "체험판 끝" 화면을 띄운다. 화면이 떠 있으면 true를 준다. */
  private updateDemoEnd(deltaMs: number): boolean {
    if (!this.sim.demoOver) {
      this.demoWonFor = null;
    } else if (!this.paused) {
      this.demoWonFor = (this.demoWonFor ?? 0) + deltaMs;
    }
    const ended = this.demoWonFor !== null && this.demoWonFor >= DEMO_END_DELAY_MS;
    this.hud.showDemoEnd(ended);
    return ended;
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.hud.setPaused(paused);
  }

  private goToRoom(room: number): void {
    if (!hasRoom(room)) {
      this.notifyMissing(room);
      return;
    }
    this.session.room = room;
    this.sim.enterRoom(roomByNumber(room));
    this.setPaused(false);
    this.showStatus();
  }

  private notifyMissing(room: number): void {
    this.hud.notify(`방 ${room}은 아직 없습니다.`);
  }

  private usesRelativeCursor(): boolean {
    return this.session.scheme === 'A' && this.session.config.mouse.relative;
  }

  private wantsPointerLock(): boolean {
    return this.usesRelativeCursor() && !this.paused;
  }

  private rebuildViews(): void {
    this.roomView?.destroy();
    this.duelView?.destroy();
    this.eventView?.destroy();
    this.toriView?.destroy();
    this.overlay?.destroy();
    this.roomView = new RoomView(this, this.sim);
    this.duelView = new DuelView(this, this.sim);
    this.eventView = new EventView(this, this.sim, this.session.config);
    this.toriView = new ToriView(this, this.sim, this.session.config);
    this.overlay = new TailOverlay(this, this.sim);
    this.follow.enterRoom(this.sim.roomData);
    this.drawnGeneration = this.sim.generation;
  }

  private showStatus(): void {
    const { scheme, room } = this.session;
    this.hud.setStatus(__BUILD_VERSION__, scheme, room);
  }

  /** 첫 화면으로 나갈 때. Phaser 물체는 씬이 스스로 지운다. */
  private cleanUp(): void {
    this.reader.dispose();
    this.panel.destroy();
    this.hud.destroy();
    this.sim.free();
    this.roomView = undefined;
    this.duelView = undefined;
    this.eventView = undefined;
    this.toriView = undefined;
    this.overlay = undefined;
  }
}
