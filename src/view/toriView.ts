import type Phaser from 'phaser';
import type { GameConfig } from '../config/defaults';
import type { Point } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';
import type { SeveredTail, TailLink } from '../tori/tail';
import { LegRig } from './legs';
import type { Leg } from './legs';
import { Part, partSpecs, tailPartSpec } from './parts';
import type { BodyPartKey } from './parts';
import { RewindScales } from './rewindScales';

/**
 * 그리는 순서. 먼 쪽 다리, 잘린 꼬리, 꼬리, 몸통, 머리, 가까운 쪽 다리 순으로 앞에 온다.
 * 꼬리는 끝에서 밑동 순으로 앞에 온다. 회귀 비늘은 rewindScales.ts에 있다.
 */
const DEPTH = { farLeg: 10, severed: 12, tail: 15, torso: 20, head: 30, nearLeg: 40 };
/** 먼 쪽 다리의 밝기 */
const FAR_SHADE = 0.7;
/** 돌아서는 동안 그림 폭이 0이 되지 않게 남기는 비율 */
const MIN_FLIP = 0.2;

interface LegParts {
  leg: Leg;
  upper: Part;
  lower: Part;
}

interface SeveredParts {
  piece: SeveredTail;
  parts: Part[];
}

/** 토리를 부위별 그림으로 그린다. 방을 다시 만들면 새로 만든다. */
export class ToriView {
  private readonly scene: Phaser.Scene;
  private readonly sim: Simulation;
  private readonly config: GameConfig;
  private readonly rig = new LegRig();
  private readonly torso: Part;
  private readonly head: Part;
  private readonly legs: LegParts[];
  private readonly scales: RewindScales;
  private tail: Part[];
  private severed: SeveredParts[] = [];

  constructor(scene: Phaser.Scene, sim: Simulation, config: GameConfig) {
    this.scene = scene;
    this.sim = sim;
    this.config = config;
    const specs = partSpecs(config);
    this.torso = new Part(scene, specs.torso, DEPTH.torso);
    this.head = new Part(scene, specs.head, DEPTH.head);
    this.legs = this.rig.legs.map((leg) => {
      const make = (segment: 'upper' | 'lower'): Part => {
        const key: BodyPartKey = `leg-${leg.front ? 'front' : 'hind'}-${segment}`;
        return new Part(scene, specs[key], leg.near ? DEPTH.nearLeg : DEPTH.farLeg, leg.near ? 1 : FAR_SHADE);
      };
      return { leg, lower: make('lower'), upper: make('upper') };
    });
    this.tail = this.linkParts(sim.tori.tail.links, DEPTH.tail);
    this.scales = new RewindScales(scene, sim, config);
  }

  update(dt: number): void {
    const { tori } = this.sim;
    const pose = this.sim.poseOf(tori.torso);
    const flip = (tori.turn >= 0 ? 1 : -1) * Math.max(MIN_FLIP, Math.abs(tori.turn));
    this.torso.place(pose, flip);
    this.head.place(this.sim.poseOf(tori.head), flip);

    // 살아 있는 꼬리를 자르면 마디 수와 맨 끝 마디가 바뀐다
    const { links } = tori.tail;
    if (links.length !== this.tail.length) {
      for (const part of this.tail) part.destroy();
      this.tail = this.linkParts(links, DEPTH.tail);
    }
    this.placeLinks(this.tail, links, tori.turn >= 0 ? 1 : -1);
    this.updateSevered();
    this.scales.update();

    this.rig.update(dt, this.config, {
      pose,
      velocityX: tori.torso.linvel().x,
      turn: tori.turn,
      grounded: tori.grounded && !tori.downed,
      downed: tori.downed,
      groundBelow: (x, y, maxDistance) => this.sim.groundBelow(x, y, maxDistance),
    });
    for (const { leg, upper, lower } of this.legs) {
      upper.place({ ...leg.hip, angle: segmentAngle(leg.hip, leg.knee) }, leg.facing);
      lower.place({ ...leg.knee, angle: segmentAngle(leg.knee, leg.foot) }, leg.facing);
    }
  }

  destroy(): void {
    for (const part of [this.torso, this.head, ...this.tail]) part.destroy();
    for (const { upper, lower } of this.legs) {
      upper.destroy();
      lower.destroy();
    }
    for (const { parts } of this.severed) for (const part of parts) part.destroy();
    this.scales.destroy();
  }

  /**
   * 마디마다 그림 하나. 끝 그림은 잘리지 않은 꼬리의 맨 끝 마디에만 쓴다.
   * 자른 뒤 남은 꼬리는 잘린 자리에서 뭉툭하게 끝난다. 실제 도마뱀도 끊긴 자리가 뾰족해지지 않는다.
   */
  private linkParts(links: readonly TailLink[], depth: number): Part[] {
    const last = this.config.tail.sections;
    return links.map(({ section }, i) => {
      const spec = tailPartSpec(this.config, section, section === last && i === links.length - 1);
      return new Part(this.scene, spec, depth - i / links.length);
    });
  }

  /** 마디의 -y가 꼬리 끝이고, 그림은 왼쪽이 꼬리 끝이다. 왼쪽을 볼 때는 뒤집어서 등이 위로 오게 한다. */
  private placeLinks(parts: Part[], links: readonly TailLink[], side: 1 | -1): void {
    links.forEach(({ body }, i) => {
      const { x, y, angle } = this.sim.poseOf(body);
      parts[i].place({ x, y, angle: angle + (side * Math.PI) / 2 }, side);
    });
  }

  /** 잘린 꼬리는 잘린 순간 보던 쪽 그대로 그린다 */
  private updateSevered(): void {
    for (const piece of this.sim.severed.slice(this.severed.length)) {
      this.severed.push({ piece, parts: this.linkParts(piece.links, DEPTH.severed) });
    }
    for (const { piece, parts } of this.severed) this.placeLinks(parts, piece.links, piece.side);
  }
}

/** 아래로 뻗은 그림을 from에서 to로 향하게 하는 각도 */
function segmentAngle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
}
