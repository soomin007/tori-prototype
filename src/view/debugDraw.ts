import type RAPIER from '@dimforge/rapier2d-compat';
import type Phaser from 'phaser';
import { toPx } from '../physics/world';
import type { ProbeLine } from '../tori/body';

const LINE_WIDTH = 2;
const PROBE_HIT_COLOR = 0xffd24a;
const PROBE_MISS_COLOR = 0x8b97a5;

/** Rapier가 주는 콜라이더와 관절 선, 바닥을 찾는 레이캐스트를 그린다. 보간하지 않은 현재 스텝의 실제 위치다. */
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

  draw(world: RAPIER.World, probes: readonly ProbeLine[]): void {
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
    for (const { from, to, hit } of probes) {
      this.graphics.lineStyle(LINE_WIDTH, hit ? PROBE_HIT_COLOR : PROBE_MISS_COLOR, 1);
      this.graphics.lineBetween(toPx(from.x), toPx(from.y), toPx(to.x), toPx(to.y));
    }
  }
}

function toHex(r: number, g: number, b: number): number {
  const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
