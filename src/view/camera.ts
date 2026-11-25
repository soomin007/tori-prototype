import type Phaser from 'phaser';
import type { GameConfig } from '../config/defaults';
import { toPx } from '../physics/world';
import type { Point, RoomData } from '../rooms/rooms';

/** 토리를 따라가는 카메라. 부드럽게 따라가는 정도가 화면 주사율에 따라 달라지지 않게 시간으로 계산한다. */
export class FollowCamera {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private x = 0;
  private y = 0;
  private look = 0;
  private placed = false;

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    this.camera = camera;
  }

  /** 방에 들어올 때. 다음 update에서 토리에게 바로 옮겨 간다. */
  enterRoom({ bounds }: RoomData): void {
    const [width, height] = [bounds.right - bounds.left, bounds.bottom - bounds.top];
    this.camera.setBounds(toPx(bounds.left), toPx(bounds.top), toPx(width), toPx(height));
    this.placed = false;
  }

  update(dt: number, target: Point, facing: number, { camera }: GameConfig): void {
    const step = (seconds: number): number => (this.placed ? 1 - Math.exp(-dt / Math.max(seconds, 1e-3)) : 1);
    this.look += (facing * camera.lookAhead - this.look) * step(camera.lookSeconds);
    this.x += (target.x - this.x) * step(camera.followSeconds);
    this.y += (target.y - camera.offsetY - this.y) * step(camera.followSecondsY);
    this.placed = true;
    this.camera.centerOn(toPx(this.x + this.look), toPx(this.y));
  }
}
