import Phaser from 'phaser';

/** 그림과 소리를 불러오는 자리. 아직 불러올 것이 없어 바로 방으로 넘어간다. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Room');
  }
}
