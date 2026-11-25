import type RAPIER from '@dimforge/rapier2d-compat';
import type Phaser from 'phaser';
import { toPx } from '../physics/world';

const LINE_WIDTH = 2;

/** Rapier가 주는 콜라이더와 관절 선을 그린다. 보간하지 않은 현재 스텝의 실제 위치다. */
export class DebugDraw {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(1000).setVisible(false);
  }

  get visible(): boolean {
    return this.graphics.visible;
  }

  toggle(): void {
    this.graphics.setVisible(!this.graphics.visible);
  }

  draw(world: RAPIER.World): void {
    if (!this.graphics.visible) return;
    this.graphics.clear();
    const { vertices, colors } = world.debugRender();
    // 선 하나는 점 두 개(x, y)이고, 점마다 색 네 칸(RGBA, 0~1)이 있다
    for (let line = 0; line * 4 < vertices.length; line += 1) {
      const v = line * 4;
      const c = line * 8;
      this.graphics.lineStyle(LINE_WIDTH, toHex(colors[c], colors[c + 1], colors[c + 2]), colors[c + 3]);
      this.graphics.lineBetween(toPx(vertices[v]), toPx(vertices[v + 1]), toPx(vertices[v + 2]), toPx(vertices[v + 3]));
    }
  }
}

function toHex(r: number, g: number, b: number): number {
  const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
