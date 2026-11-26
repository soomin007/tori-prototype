import type Phaser from 'phaser';
import { toPx } from '../physics/world';
import type { BoxData, DecorData, DoorData, NpcData, RecorderData, RoomData, Surface } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';

/** 도형 색(자리값) */
const SURFACE_COLORS: Record<Surface, number> = { normal: 0x3b4652, slippery: 0x6f9fb8 };
const BOX_COLORS = [0xb98a5a, 0xa87c50, 0xc79a6b];
/** 꼬리로 들 수 있는 물건 */
const GRABBABLE_COLOR = 0xf2c14e;
/** 그림이 정해진 물건(BoxData.look) */
const LOOK_COLORS: Record<NonNullable<BoxData['look']>, number> = { fruit: 0xd8604a, junk: 0x7f8c99 };
/** 친구 NPC 자리와 나무 */
const NPC_COLORS = { body: 0x6fa587, head: 0x8cc0a2, eye: 0x20262d };
const TREE_COLORS = { trunk: 0x6b5240, leaves: 0x3f6b4a };
const BRANCH_COLOR = 0x9a6b42;
const RECORDER_COLORS = { body: 0x8f86c9, head: 0xa9a1dc, eye: 0x20262d };
const DOOR_COLORS = { panel: 0x6b5240, frame: 0x45352a };
const BUBBLE_COLOR = 0xe8ecf0;

/** 기록관 자리표시 그림의 치수(m, 자리값) */
const RECORDER_SIZE = { width: 0.5, height: 1.1, head: 0.2 };
/** 말풍선이 기록관 머리 위로 떠 있는 높이(m) */
const BUBBLE_GAP = 0.25;

/** 움직임을 가늠하게 하는 배경 눈금. 1m마다 가는 선, 5m마다 진한 선이다. */
const GRID_COLOR = 0x8b97a5;
const GRID_ALPHA = { minor: 0.08, major: 0.2 };
const GRID_MAJOR_EVERY = 5;

const DEPTH = { grid: -20, decor: -15, terrain: -10, recorder: -8, door: -6, branch: -5, box: 5, bubble: 45 };

/** 지형, 물건, 기록관과 문을 그린다. 방을 다시 만들면 새로 만든다. */
export class RoomView {
  private readonly sim: Simulation;
  private readonly still: Phaser.GameObjects.Graphics[];
  private readonly boxes: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse)[];
  /** 기록관마다의 문. 문이 없는 기록관은 null이다. */
  private readonly doors: (Phaser.GameObjects.Graphics | null)[];
  private readonly bubble: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.sim = sim;
    const { roomData } = sim;
    this.still = [
      drawGrid(scene, roomData),
      drawTerrain(scene, roomData),
      drawBranches(scene, roomData),
      drawRecorders(scene, sim.recorders.map(({ data }) => data)),
      drawNpcs(scene, sim.npcs),
      drawDecor(scene, roomData.decor),
    ];
    this.boxes = sim.objects.map(({ width, height, data }, i) => {
      const color = data.look ? LOOK_COLORS[data.look] : data.grabbable ? GRABBABLE_COLOR : BOX_COLORS[i % BOX_COLORS.length];
      const shape =
        data.look === 'fruit'
          ? scene.add.ellipse(0, 0, toPx(width), toPx(height), color)
          : scene.add.rectangle(0, 0, toPx(width), toPx(height), color);
      if (data.look === 'junk') shape.setStrokeStyle(3, 0x4f5a66);
      return shape.setDepth(DEPTH.box);
    });
    this.doors = sim.recorders.map(({ data }) => (data.door ? drawDoor(scene, data.door) : null));
    this.bubble = scene.add.graphics().setDepth(DEPTH.bubble);
  }

  update(): void {
    this.sim.objects.forEach(({ body }, i) => {
      const { x, y, angle } = this.sim.poseOf(body);
      this.boxes[i].setPosition(toPx(x), toPx(y)).setRotation(angle);
    });
    this.sim.recorders.forEach(({ doorClosed }, i) => this.doors[i]?.setVisible(doorClosed));
    // 말을 걸 수 있으면 기록관 머리 위에 빈 말풍선을 띄운다. 글은 쓰지 않는다(PLAN 2.5).
    this.bubble.clear();
    const near = this.sim.nearRecorder;
    if (near) drawBubble(this.bubble, near.data);
  }

  destroy(): void {
    for (const object of [...this.still, ...this.boxes, this.bubble]) object.destroy();
    for (const door of this.doors) door?.destroy();
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

/** 기록관의 자리표시 그림. 몸통과 머리, 토리 쪽(왼쪽)을 보는 눈 */
function drawRecorders(scene: Phaser.Scene, recorders: readonly RecorderData[]): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.recorder);
  const { width, height, head } = RECORDER_SIZE;
  for (const { x, y } of recorders) {
    const [left, top] = [toPx(x - width / 2), toPx(y - height)];
    g.fillStyle(RECORDER_COLORS.body).fillRoundedRect(left, top, toPx(width), toPx(height), toPx(width) / 3);
    const headY = y - height - head * 0.8;
    g.fillStyle(RECORDER_COLORS.head).fillCircle(toPx(x), toPx(headY), toPx(head));
    g.fillStyle(RECORDER_COLORS.eye).fillCircle(toPx(x - head * 0.45), toPx(headY - head * 0.1), toPx(head * 0.14));
  }
  return g;
}

/** 친구 NPC 자리. 기록관과 같은 모양에 색만 다른 자리표시다. 토리가 오는 쪽(왼쪽)을 본다. */
function drawNpcs(scene: Phaser.Scene, npcs: readonly NpcData[]): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.recorder);
  const { width, height, head } = RECORDER_SIZE;
  for (const { x, y } of npcs) {
    const [w, h] = [width * 0.85, height * 0.8];
    g.fillStyle(NPC_COLORS.body).fillRoundedRect(toPx(x - w / 2), toPx(y - h), toPx(w), toPx(h), toPx(w) / 3);
    const headY = y - h - head * 0.8;
    g.fillStyle(NPC_COLORS.head).fillCircle(toPx(x), toPx(headY), toPx(head));
    g.fillStyle(NPC_COLORS.eye).fillCircle(toPx(x - head * 0.45), toPx(headY - head * 0.1), toPx(head * 0.14));
  }
  return g;
}

/** 부딪히지 않는 나무. 줄기와 둥근 잎이다. */
function drawDecor(scene: Phaser.Scene, decor: readonly DecorData[]): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.decor);
  for (const { x, y, height, radius } of decor) {
    const trunk = radius * 0.25;
    g.fillStyle(TREE_COLORS.trunk).fillRect(toPx(x - trunk / 2), toPx(y - height), toPx(trunk), toPx(height));
    g.fillStyle(TREE_COLORS.leaves).fillCircle(toPx(x), toPx(y - height), toPx(radius));
  }
  return g;
}

function drawDoor(scene: Phaser.Scene, { x, y, width, height }: DoorData): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.door);
  const [left, top, w, h] = [toPx(x - width / 2), toPx(y - height), toPx(width), toPx(height)];
  g.fillStyle(DOOR_COLORS.frame).fillRect(left - 4, top - 4, w + 8, h + 4);
  g.fillStyle(DOOR_COLORS.panel).fillRect(left, top, w, h);
  return g;
}

/** 꼬리가 기록관 쪽으로 붙은 둥근 말풍선과 점 세 개 */
function drawBubble(g: Phaser.GameObjects.Graphics, { x, y }: RecorderData): void {
  const { height, head } = RECORDER_SIZE;
  const [width, tall] = [toPx(0.42), toPx(0.26)];
  const bottom = toPx(y - height - head * 1.8 - BUBBLE_GAP);
  const [cx, top] = [toPx(x), bottom - tall];
  g.fillStyle(BUBBLE_COLOR, 0.95).fillRoundedRect(cx - width / 2, top, width, tall, tall / 2);
  g.fillTriangle(cx - 6, bottom - 1, cx + 6, bottom - 1, cx, bottom + 8);
  g.fillStyle(RECORDER_COLORS.eye);
  for (const dx of [-1, 0, 1]) g.fillCircle(cx + dx * width * 0.22, top + tall / 2, 3);
}
