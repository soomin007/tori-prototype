import Phaser from 'phaser';
import { switchScheme } from '../config/presets';
import type { Session } from '../config/share';
import { StartScreen } from '../ui/startScreen';

/** 조작 방식을 고르는 첫 화면. 화면은 DOM으로 올린다. */
export class StartScene extends Phaser.Scene {
  private readonly session: Session;

  constructor(session: Session) {
    super('Start');
    this.session = session;
  }

  create(): void {
    const { session } = this;
    const root = document.getElementById('hud') as HTMLElement;
    const screen = new StartScreen(root, session.scheme, __BUILD_VERSION__, (scheme) => {
      switchScheme(session.config, session.scheme, scheme);
      session.scheme = scheme;
      this.scene.start('Room');
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => screen.destroy());
  }
}
