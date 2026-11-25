import Phaser from 'phaser';
import type { Session } from '../config/share';
import { toPx } from '../physics/world';
import { Simulation } from '../sim/simulation';
import type { SimObject } from '../sim/simulation';
import { Hud } from '../ui/hud';
import { TuningPanel } from '../ui/tuningPanel';
import { DebugDraw } from '../view/debugDraw';
import { InputReader } from '../view/inputReader';
import type { SystemCommands } from '../view/inputReader';

/** 도형 색(자리값) */
const TERRAIN_COLOR = 0x3b4652;
const BOX_COLORS = [0xd9a066, 0x8fb573, 0x7aa5c9];

/** 시뮬레이션을 프레임마다 진행하고 그린다. 게임 규칙은 sim/에 두고 여기에는 넣지 않는다. */
export class RoomScene extends Phaser.Scene {
  private readonly session: Session;
  private sim!: Simulation;
  private reader!: InputReader;
  private panel!: TuningPanel;
  private hud!: Hud;
  private debugDraw!: DebugDraw;
  private shapes: { object: SimObject; shape: Phaser.GameObjects.Rectangle }[] = [];
  private drawnGeneration = -1;

  constructor(session: Session) {
    super('Room');
    this.session = session;
  }

  create(): void {
    this.sim = new Simulation(this.session.config);
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

    // 개발 중에 브라우저 콘솔에서 상태를 들여다보는 용도. 배포 빌드에는 들어가지 않는다.
    if (import.meta.env.DEV) Object.assign(window, { tori: { sim: this.sim, input: this.reader.state } });
  }

  override update(_time: number, deltaMs: number): void {
    this.reader.poll(this.cameras.main);
    this.sim.advance(deltaMs / 1000, this.reader.state);

    if (this.drawnGeneration !== this.sim.generation) this.rebuildShapes();
    for (const { object, shape } of this.shapes) {
      const { x, y, angle } = this.sim.poseOf(object);
      shape.setPosition(toPx(x), toPx(y)).setRotation(angle);
    }
    this.debugDraw.draw(this.sim.world);
    this.panel.setFps(this.game.loop.actualFps);
  }

  private rebuildShapes(): void {
    for (const { shape } of this.shapes) shape.destroy();
    this.shapes = this.sim.objects.map((object, i) => {
      const color = object.kind === 'terrain' ? TERRAIN_COLOR : BOX_COLORS[i % BOX_COLORS.length];
      return { object, shape: this.add.rectangle(0, 0, toPx(object.width), toPx(object.height), color) };
    });
    this.drawnGeneration = this.sim.generation;
  }

  private showStatus(): void {
    this.hud.setStatus(__BUILD_VERSION__, this.session.scheme);
  }
}
