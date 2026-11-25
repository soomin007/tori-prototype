import type Phaser from 'phaser';
import { toPx } from '../physics/world';
import type { RoomData, Surface } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';

/** 도형 색(자리값) */
const SURFACE_COLORS: Record<Surface, number> = { normal: 0x3b4652, slippery: 0x6f9fb8 };
const BOX_COLORS = [0xb98a5a, 0xa87c50, 0xc79a6b];
/** 꼬리로 들 수 있는 물건 */
const GRABBABLE_COLOR = 0xf2c14e;
const BRANCH_COLOR = 0x9a6b42;

/** 움직임을 가늠하게 하는 배경 눈금. 1m마다 가는 선, 5m마다 진한 선이다. */
const GRID_COLOR = 0x8b97a5;
const GRID_ALPHA = { minor: 0.08, major: 0.2 };
const GRID_MAJOR_EVERY = 5;

const DEPTH = { grid: -20, terrain: -10, branch: -5, box: 5 };

/** 지형과 물건을 그린다. 방을 다시 만들면 새로 만든다. */
export class RoomView {
  private readonly sim: Simulation;
  private readonly still: Phaser.GameObjects.Graphics[];
  private readonly boxes: Phaser.GameObjects.Rectangle[];

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.sim = sim;
    const { roomData } = sim;
    this.still = [drawGrid(scene, roomData), drawTerrain(scene, roomData), drawBranches(scene, roomData)];
    this.boxes = sim.objects.map(({ width, height }, i) => {
      const color = roomData.boxes[i].grabbable ? GRABBABLE_COLOR : BOX_COLORS[i % BOX_COLORS.length];
      return scene.add.rectangle(0, 0, toPx(width), toPx(height), color).setDepth(DEPTH.box);
    });
  }

  update(): void {
    this.sim.objects.forEach(({ body }, i) => {
      const { x, y, angle } = this.sim.poseOf(body);
      this.boxes[i].setPosition(toPx(x), toPx(y)).setRotation(angle);
    });
  }

  destroy(): void {
    for (const object of [...this.still, ...this.boxes]) object.destroy();
  }
}

function drawGrid(scene: Phaser.Scene, { bounds }: RoomData): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.grid);
  const line = (index: number, x0: number, y0: number, x1: number, y1: number): void => {
    const major = index % GRID_MAJOR_EVERY === 0;
    g.lineStyle(2, GRID_COLOR, major ? GRID_ALPHA.major : GRID_ALPHA.minor);
    g.lineBetween(toPx(x0), toPx(y0), toPx(x1), toPx(y1));
  };
  for (let x = Math.ceil(bounds.left); x <= bounds.right; x += 1) line(x, x, bounds.top, x, bounds.bottom);
  for (let y = Math.ceil(bounds.top); y <= bounds.bottom; y += 1) line(y, bounds.left, y, bounds.right, y);
  return g;
}

function drawBranches(scene: Phaser.Scene, { branches }: RoomData): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.branch);
  g.fillStyle(BRANCH_COLOR);
  for (const { x, y, length, thickness } of branches) {
    const [width, height] = [toPx(length), toPx(thickness)];
    g.fillRoundedRect(toPx(x) - width / 2, toPx(y) - height / 2, width, height, height / 2);
  }
  return g;
}

function drawTerrain(scene: Phaser.Scene, { terrain }: RoomData): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.terrain);
  for (const { points, surface } of terrain) {
    g.fillStyle(SURFACE_COLORS[surface]);
    g.beginPath();
    points.forEach(({ x, y }, i) => (i === 0 ? g.moveTo(toPx(x), toPx(y)) : g.lineTo(toPx(x), toPx(y))));
    g.closePath();
    g.fillPath();
  }
  return g;
}
