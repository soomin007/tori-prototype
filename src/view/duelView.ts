import type Phaser from 'phaser';
import { toPx } from '../physics/world';
import type { Point } from '../rooms/rooms';
import type { Duel } from '../sim/duel';
import type { Box, Opponent } from '../sim/opponent';
import type { Simulation } from '../sim/simulation';

/**
 * 상대의 자리표시 그림 색. 예고는 자세 변화(웅크리고 뒤로 젖힘)와 색 깜빡임으로 보여 준다(PLAN 7.7).
 * 빈틈(공격 뒤)에는 흐린 색으로 바뀌어, 그때가 칠 때라는 것을 글 없이 알린다.
 */
const FOE_COLORS = {
  body: 0x7d6a8c,
  armor: 0x56475f,
  warn: 0xff8a3d,
  open: 0xb3a9bd,
  hurt: 0xffffff,
  fallen: 0x4f4857,
  eye: 0x20262d,
};
const WALL_COLORS = { panel: 0x6b5240, frame: 0x45352a };
/** 버둥거림 게이지. 잘릴 자리 위로 lift(m)만큼 띄운 고리다. */
const GAUGE = { radius: 0.2, width: 0.07, lift: 0.5, back: 0x20262d, fill: 0xf2c14e, empty: 0x6a7480 };
/** 예고 중 색이 바뀌는 빠르기(1초에 몇 번) */
const WARN_HZ = 8;
/** 예고 끝에 몸을 젖히는 거리와 웅크리는 높이, 공격할 때 앞으로 숙이는 거리(m) */
const POSE = { windupLean: 0.16, windupCrouch: 0.14, attackLean: 0.2, recoverCrouch: 0.1, staggerLean: 0.14 };
/** 밀치기의 팔 굵기와 붙는 높이(몸 높이에 대한 비율, 발밑 0, 머리 1) */
const ARM = { thickness: 0.16, height: 0.55 };
/** 맞았을 때 하얗게 깜빡이는 시간, 버둥거릴 때 게이지가 커졌다 돌아오는 시간(초) */
const FLASH_SECONDS = 0.1;
const PULSE_SECONDS = 0.15;
const DEPTH = { wall: -6, foe: 4, gauge: 48 };

/** 결투장의 벽, 상대, 버둥거림 게이지를 그린다. 방을 다시 만들면 새로 만든다. */
export class DuelView {
  private readonly sim: Simulation;
  private readonly walls: Phaser.GameObjects.Graphics;
  private readonly foes: Phaser.GameObjects.Graphics;
  private readonly gauge: Phaser.GameObjects.Graphics;
  private time = 0;
  private readonly flash = new Map<Duel, { health: number; left: number }>();
  private pulse = 0;
  private pulses = 0;

  constructor(scene: Phaser.Scene, sim: Simulation) {
    this.sim = sim;
    this.walls = scene.add.graphics().setDepth(DEPTH.wall);
    this.foes = scene.add.graphics().setDepth(DEPTH.foe);
    this.gauge = scene.add.graphics().setDepth(DEPTH.gauge);
  }

  update(dt: number): void {
    this.time += dt;
    this.walls.clear();
    this.foes.clear();
    this.gauge.clear();
    for (const duel of this.sim.duels) {
      for (const box of duel.wallBoxes) drawWall(this.walls, box);
      this.drawFoe(duel, dt);
      this.drawGauge(duel, dt);
    }
  }

  destroy(): void {
    for (const object of [this.walls, this.foes, this.gauge]) object.destroy();
  }

  // ---- 상대 ----

  private drawFoe(duel: Duel, dt: number): void {
    const foe = duel.opponent;
    const flash = this.flash.get(duel) ?? { health: foe.health, left: 0 };
    flash.left = foe.health < flash.health ? FLASH_SECONDS : Math.max(0, flash.left - dt);
    flash.health = foe.health;
    this.flash.set(duel, flash);

    const { lean, crouch, color } = this.look(foe);
    const place = posePlacer(this.sim.poseOf(foe.body), foe, lean, crouch);
    const g = this.foes;
    const { width: w, height: h, facing } = foe;
    g.fillStyle(flash.left > 0 ? FOE_COLORS.hurt : color);
    fillPolygon(g, [place(-w / 2, h / 2), place(w / 2, h / 2), place(w / 2, -h / 2), place(-w / 2, -h / 2)]);
    // 방어구를 두른 가슴
    if (!foe.defeated) {
      g.fillStyle(FOE_COLORS.armor);
      fillPolygon(g, [place(-w / 2, -h * 0.05), place(w / 2, -h * 0.05), place(w / 2, -h * 0.3), place(-w / 2, -h * 0.3)]);
    }
    // 바라보는 쪽의 눈
    const eye = place(facing * w * 0.28, -h / 2 + 0.2);
    g.fillStyle(FOE_COLORS.eye).fillCircle(eye.x, eye.y, toPx(0.05));
    this.drawArm(foe, place);
  }

  /** 단계마다의 자세와 색. 예고 동안 색이 깜빡이고, 끝으로 갈수록 더 웅크리고 젖힌다. */
  private look(foe: Opponent): { lean: number; crouch: number; color: number } {
    const { facing, phase, attack, elapsed } = foe;
    switch (phase) {
      case 'windup': {
        const t = smooth(elapsed / Math.max(attack?.windupSeconds ?? 1, 1e-3));
        const on = Math.floor(elapsed * WARN_HZ * 2) % 2 === 0;
        return { lean: -facing * POSE.windupLean * t, crouch: POSE.windupCrouch * t, color: on ? FOE_COLORS.warn : FOE_COLORS.body };
      }
      case 'attack':
        return { lean: facing * POSE.attackLean, crouch: 0, color: FOE_COLORS.body };
      case 'recover':
        return { lean: facing * POSE.attackLean * 0.3, crouch: POSE.recoverCrouch, color: FOE_COLORS.open };
      case 'stagger':
        return { lean: -facing * POSE.staggerLean, crouch: 0, color: FOE_COLORS.open };
      case 'defeated':
        return { lean: 0, crouch: 0, color: FOE_COLORS.fallen };
      default:
        return { lean: 0, crouch: 0, color: FOE_COLORS.body };
    }
  }

  /** 판정 범위가 몸 앞으로 나가는 공격(밀치기)은 예고 동안 팔을 당기고 공격할 때 뻗는다 */
  private drawArm(foe: Opponent, place: (x: number, y: number) => Point): void {
    const { attack, phase, facing, width: w, height: h } = foe;
    if (!attack || attack.reach <= 0.3 || (phase !== 'windup' && phase !== 'attack')) return;
    const front = (facing * w) / 2;
    const out = phase === 'attack' ? attack.reach : -w * 0.3;
    const y = h / 2 - h * ARM.height;
    const half = ARM.thickness / 2;
    const tip = front + facing * out;
    this.foes.fillStyle(FOE_COLORS.armor);
    fillPolygon(this.foes, [place(front - facing * w * 0.4, y - half), place(tip, y - half), place(tip, y + half), place(front - facing * w * 0.4, y + half)]);
  }

  // ---- 버둥거림 게이지 ----

  /** 쓰러져 있는 동안 꼬리에서 잘릴 자리 위에 띄운다. 자를 구간이 없으면 꼬리 끝 위에 빈 고리만 띄운다. */
  private drawGauge(duel: Duel, dt: number): void {
    if (duel.phase !== 'downed' && duel.phase !== 'cut') {
      this.pulses = duel.gauge.count;
      return;
    }
    if (duel.gauge.count !== this.pulses) this.pulse = PULSE_SECONDS;
    this.pulses = duel.gauge.count;
    this.pulse = Math.max(0, this.pulse - dt);

    const { tail } = this.sim.tori;
    const anchor = tail.cutPoint;
    const at = anchor ?? tail.tip;
    const value = duel.phase === 'cut' ? 1 : duel.gauge.value;
    const radius = toPx(GAUGE.radius * (1 + 0.3 * (this.pulse / PULSE_SECONDS)));
    const [x, y] = [toPx(at.x), toPx(at.y - GAUGE.lift)];
    const g = this.gauge;
    g.lineStyle(toPx(GAUGE.width), GAUGE.back, 0.75);
    g.strokeCircle(x, y, radius);
    if (!anchor || value <= 0) {
      g.lineStyle(toPx(GAUGE.width) * 0.4, GAUGE.empty, 0.9);
      g.strokeCircle(x, y, radius);
      return;
    }
    g.lineStyle(toPx(GAUGE.width), GAUGE.fill, 1);
    g.beginPath();
    g.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + value * Math.PI * 2, false);
    g.strokePath();
  }
}

/**
 * 상대 몸 안의 점(가운데 기준, 아래가 +y)을 그릴 자리로 옮기는 함수.
 * 발밑은 그대로 두고 위로 갈수록 lean만큼 옆으로 밀고 crouch만큼 낮춘다. 쓰러질 때는 몸의 회전을 따른다.
 */
function posePlacer(
  pose: { x: number; y: number; angle: number },
  { height }: Opponent,
  lean: number,
  crouch: number,
): (x: number, y: number) => Point {
  const [cos, sin] = [Math.cos(pose.angle), Math.sin(pose.angle)];
  return (px, py) => {
    const up = (height / 2 - py) / height;
    const lx = px + lean * up;
    const ly = py + crouch * up;
    return { x: toPx(pose.x + lx * cos - ly * sin), y: toPx(pose.y + lx * sin + ly * cos) };
  };
}

/** 이미 고른 색으로 다각형을 채운다. 점은 픽셀 좌표다. */
function fillPolygon(g: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  g.beginPath();
  points.forEach(({ x, y }, i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.fillPath();
}

function drawWall(g: Phaser.GameObjects.Graphics, { left, right, top, bottom }: Box): void {
  const [x, y, w, h] = [toPx(left), toPx(top), toPx(right - left), toPx(bottom - top)];
  g.fillStyle(WALL_COLORS.frame).fillRect(x - 4, y - 4, w + 8, h + 4);
  g.fillStyle(WALL_COLORS.panel).fillRect(x, y, w, h);
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
