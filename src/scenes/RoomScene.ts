import Phaser from 'phaser';
import type { Session } from '../config/share';
import { roomByNumber } from '../rooms/rooms';
import { Simulation } from '../sim/simulation';
import { Hud } from '../ui/hud';
import { TuningPanel } from '../ui/tuningPanel';
import { FollowCamera } from '../view/camera';
import { DebugDraw } from '../view/debugDraw';
import { InputReader } from '../view/inputReader';
import type { SystemCommands } from '../view/inputReader';
import { RoomView } from '../view/roomView';
import { ToriView } from '../view/toriView';

/** 탭을 떠났다 돌아왔을 때 다리 그림과 카메라가 한 번에 움직일 시간의 상한(초) */
const MAX_VIEW_SECONDS = 0.1;

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
  private drawnGeneration = -1;

  constructor(session: Session) {
    super('Room');
    this.session = session;
  }

  create(): void {
    this.sim = new Simulation(this.session.config, roomByNumber(this.session.room));
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
      restartRoom: () => this.sim.reset(),
    };
    this.hud = new Hud(document.getElementById('hud') as HTMLElement, commands);
    this.panel = new TuningPanel(this.session, {
      onParamChange: (meta) => (meta.rebuild ? this.sim.reset() : this.sim.applyConfig()),
      onSchemeChange: () => {
        this.sim.applyConfig();
        this.showStatus();
      },
      onRestart: commands.restartRoom,
      notify: (message) => this.hud.notify(message),
      showCopyFallback: (text) => this.hud.showCopyFallback(text),
    });
    this.reader = new InputReader(this.game.canvas, commands);
    this.showStatus();

    // 브라우저 콘솔에서 상태를 들여다보는 용도. 팀용 주소의 빌드에는 넣지 않는다.
    if (!__BUILD_VERSION__.startsWith('main')) Object.assign(window, { tori: { sim: this.sim, input: this.reader.state } });
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, MAX_VIEW_SECONDS);
    this.reader.poll(this.cameras.main);
    this.sim.advance(deltaMs / 1000, this.reader.state);

    if (this.drawnGeneration !== this.sim.generation) this.rebuildViews();
    this.roomView?.update();
    this.toriView?.update(dt);
    const { tori } = this.sim;
    this.follow.update(dt, this.sim.poseOf(tori.torso), tori.facing, this.session.config);
    this.debugDraw.draw(this.sim.world, tori.probeLines);
    this.panel.setFps(this.game.loop.actualFps);
  }

  private rebuildViews(): void {
    this.roomView?.destroy();
    this.toriView?.destroy();
    this.roomView = new RoomView(this, this.sim);
    this.toriView = new ToriView(this, this.sim, this.session.config);
    this.follow.enterRoom(this.sim.roomData);
    this.drawnGeneration = this.sim.generation;
  }

  private showStatus(): void {
    this.hud.setStatus(__BUILD_VERSION__, this.session.scheme);
  }
}
