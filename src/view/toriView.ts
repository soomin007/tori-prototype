import type Phaser from 'phaser';
import type { GameConfig } from '../config/defaults';
import type { Point } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';
import { LegRig } from './legs';
import type { Leg } from './legs';
import { Part, partSpecs, tailPartSpec } from './parts';
import type { BodyPartKey } from './parts';

/** 그리는 순서. 먼 쪽 다리, 꼬리, 몸통, 머리, 가까운 쪽 다리 순으로 앞에 온다. 꼬리는 끝에서 밑동 순으로 앞에 온다. */
const DEPTH = { farLeg: 10, tail: 15, torso: 20, head: 30, nearLeg: 40 };
/** 먼 쪽 다리의 밝기 */
const FAR_SHADE = 0.7;
/** 돌아서는 동안 그림 폭이 0이 되지 않게 남기는 비율 */
const MIN_FLIP = 0.2;

interface LegParts {
  leg: Leg;
  upper: Part;
  lower: Part;
}

/** 토리를 부위별 그림으로 그린다. 방을 다시 만들면 새로 만든다. */
export class ToriView {
  private readonly sim: Simulation;
  private readonly config: GameConfig;
  private readonly rig = new LegRig();
  private readonly torso: Part;
  private readonly head: Part;
  private readonly legs: LegParts[];
  private readonly tail: Part[];

  constructor(scene: Phaser.Scene, sim: Simulation, config: GameConfig) {
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
    const { links } = sim.tori.tail;
    this.tail = links.map(({ section }, i) => {
      const spec = tailPartSpec(config, section, i === links.length - 1);
      return new Part(scene, spec, DEPTH.tail - i / links.length);
    });
  }

  update(dt: number): void {
    const { tori } = this.sim;
    const pose = this.sim.poseOf(tori.torso);
    const flip = (tori.turn >= 0 ? 1 : -1) * Math.max(MIN_FLIP, Math.abs(tori.turn));
    this.torso.place(pose, flip);
    this.head.place(this.sim.poseOf(tori.head), flip);

    // 마디의 -y가 꼬리 끝이고, 그림은 왼쪽이 꼬리 끝이다. 왼쪽을 볼 때는 뒤집어서 등이 위로 오게 한다.
    const side = tori.turn >= 0 ? 1 : -1;
    tori.tail.links.forEach(({ body }, i) => {
      const { x, y, angle } = this.sim.poseOf(body);
      this.tail[i].place({ x, y, angle: angle + (side * Math.PI) / 2 }, side);
    });

    this.rig.update(dt, this.config, {
      pose,
      velocityX: tori.torso.linvel().x,
      turn: tori.turn,
      grounded: tori.grounded,
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
  }
}

/** 아래로 뻗은 그림을 from에서 to로 향하게 하는 각도 */
function segmentAngle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
}
