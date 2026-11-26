import type Phaser from 'phaser';
import type { GameConfig } from '../config/defaults';
import { toPx } from '../physics/world';
import type { ScriptedEvent } from '../sim/scripted';
import type { Simulation } from '../sim/simulation';

/**
 * 대본 사건의 자리표시 그림 색(PLAN 7.8). 예고는 위쪽 인물의 색 깜빡임과 몸짓, 매달린 구조물의 흔들림으로 보여 준다.
 * 깜빡이는 색은 결투 상대의 예고와 같은 주황색이다. 무엇이 올지 같은 신호로 읽히게 한 것이다.
 */
const COLORS = {
  ledge: 0x4a5563,
  ledgeEdge: 0x2f3742,
  figure: 0x59616b,
  figureHead: 0x6f7883,
  warn: 0xff8a3d,
  eye: 0x20262d,
  rope: 0xc9b48a,
  crate: 0x9a7b55,
  crateFrame: 0x5c4630,
};
/** 위쪽 인물의 치수와 발판 두께(m, 자리값) */
const FIGURE = { width: 0.45, height: 1, head: 0.18 };
const LEDGE_THICKNESS = 0.18;
/** 예고 중 색이 바뀌는 빠르기(1초에 몇 번), 구조물이 흔들리는 폭(m)과 빠르기(Hz), 인물이 앞으로 숙이는 거리(m) */
const WARN_HZ = 8;
const SHAKE = { amplitude: 0.05, hz: 14 };
const LEAN = 0.18;
/** 인물은 발판 뒤, 구조물은 토리의 몸과 다리보다 앞에 그린다. 깔린 모습이 보여야 한다. */
const DEPTH = { ledge: -7, figure: -7, rope: -7, crate: 42 };

/** 대본 사건의 높은 발판, 위쪽 인물, 줄, 구조물을 그린다. 방을 다시 만들면 새로 만든다. */
export class EventView {
  private readonly sim: Simulation;
  private readonly config: GameConfig;
  private readonly still: Phaser.GameObjects.Graphics;
  private readonly moving: Phaser.GameObjects.Graphics;
  private readonly crates: Phaser.GameObjects.Graphics;
  private time = 0;

  constructor(scene: Phaser.Scene, sim: Simulation, config: GameConfig) {
    this.sim = sim;
    this.config = config;
    this.still = scene.add.graphics().setDepth(DEPTH.ledge);
    this.moving = scene.add.graphics().setDepth(DEPTH.figure);
    this.crates = scene.add.graphics().setDepth(DEPTH.crate);
    for (const event of sim.scripted) drawLedge(this.still, event);
  }

  update(dt: number): void {
    this.time += dt;
    this.moving.clear();
    this.crates.clear();
    for (const event of this.sim.scripted) {
      this.drawFigure(event);
      if (event.visible) this.drawCrate(event);
    }
  }

  destroy(): void {
    for (const object of [this.still, this.moving, this.crates]) object.destroy();
  }

  /** 발판 위의 인물. 구조물 위를 따라 걷다가 예고하는 동안 멈춰 깜빡이며 앞으로 숙인다. 색은 결투 상대와 겹치지 않게 회색이다. */
  private drawFigure(event: ScriptedEvent): void {
    const g = this.moving;
    const { y } = event.data.ledge;
    const warning = event.phase === 'warning';
    const progress = warning ? Math.min(1, event.elapsed / Math.max(this.config.scripted.warnSeconds, 1e-3)) : 0;
    const on = warning && Math.floor(event.elapsed * WARN_HZ * 2) % 2 === 0;
    const lean = event.phase === 'falling' ? LEAN : LEAN * progress;
    const { width, height, head } = FIGURE;
    const x = event.x;
    // 발밑은 그대로 두고 위로 갈수록 숙인다
    const body = [
      { x: x - width / 2, y },
      { x: x + width / 2, y },
      { x: x + width / 2 + lean, y: y - height },
      { x: x - width / 2 + lean, y: y - height },
    ];
    g.fillStyle(on ? COLORS.warn : COLORS.figure);
    g.beginPath();
    body.forEach((point, i) => (i === 0 ? g.moveTo(toPx(point.x), toPx(point.y)) : g.lineTo(toPx(point.x), toPx(point.y))));
    g.closePath();
    g.fillPath();
    const headX = x + lean * 1.1;
    const headY = y - height - head * 0.8;
    g.fillStyle(on ? COLORS.warn : COLORS.figureHead).fillCircle(toPx(headX), toPx(headY), toPx(head));
    // 아래(구조물 쪽)를 내려다보는 눈
    g.fillStyle(COLORS.eye).fillCircle(toPx(headX), toPx(headY + head * 0.35), toPx(head * 0.16));
  }

  /** 매달린 구조물과 줄. 예고하는 동안 흔들리고, 떨어진 뒤에는 줄이 없다. 깔린 동안에는 토리 등 위에 얹혀 있다. */
  private drawCrate(event: ScriptedEvent): void {
    const hanging = event.phase === 'waiting' || event.phase === 'warning';
    const shake = event.phase === 'warning' ? SHAKE.amplitude * Math.sin(this.time * SHAKE.hz * 2 * Math.PI) : 0;
    const { left, right, top, bottom } = event.box;
    if (hanging) {
      this.moving.lineStyle(3, COLORS.rope, 1);
      this.moving.lineBetween(toPx(event.x), toPx(event.data.ledge.y), toPx(event.x + shake), toPx(top));
    }
    const g = this.crates;
    const [x, y, w, h] = [toPx(left + shake), toPx(top), toPx(right - left), toPx(bottom - top)];
    const alpha = event.phase === 'landed' ? 1 - event.elapsed / Math.max(this.config.scripted.lingerSeconds, 1e-3) : 1;
    g.fillStyle(COLORS.crateFrame, alpha).fillRect(x, y, w, h);
    g.fillStyle(COLORS.crate, alpha).fillRect(x + 4, y + 4, w - 8, h - 8);
    // 널빤지 결
    g.lineStyle(2, COLORS.crateFrame, alpha);
    for (const t of [1 / 3, 2 / 3]) g.lineBetween(x + w * t, y + 4, x + w * t, y + h - 4);
  }
}

/** 인물이 서는 높은 발판. 부딪히지 않는 그림이다. */
function drawLedge(g: Phaser.GameObjects.Graphics, { data: { ledge } }: ScriptedEvent): void {
  const [x, y, w, h] = [toPx(ledge.left), toPx(ledge.y), toPx(ledge.right - ledge.left), toPx(LEDGE_THICKNESS)];
  g.fillStyle(COLORS.ledgeEdge).fillRect(x, y, w, h);
  g.fillStyle(COLORS.ledge).fillRect(x, y, w, h * 0.45);
}
