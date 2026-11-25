import Phaser from 'phaser';
import { preloadParts } from '../view/parts';

/** 그림과 소리를 불러온 뒤 방으로 넘어간다 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    preloadParts(this);
  }

  create(): void {
    this.scene.start('Room');
  }
}
