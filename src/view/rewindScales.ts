import type Phaser from 'phaser';
import type { GameConfig } from '../config/defaults';
import type { Point } from '../rooms/rooms';
import type { Simulation } from '../sim/simulation';
import { sectionThickness } from '../tori/tail';
import { hasPartImage, Part, SCALE_OFF_SHADE, scalePartSpec } from './parts';

/** 몸통(20)보다 앞. 첫 비늘이 몸통 뒤 끝과 겹쳐도 가려지지 않는다. */
const DEPTH = 22;
/** 밑동이 붙은 자리에서 첫 비늘까지, 마지막 비늘에서 밑동 끝까지(m, 자리값) */
const MARGIN = { start: 0.08, end: 0.05 };
/** 비늘 가운데를 꼬리 가운데 선에서 등 쪽으로 옮기는 정도(밑동 반지름에 대한 비율, 자리값) */
const DORSAL = 0.7;

interface Scale {
  on: Part;
  off: Part;
  /** 붙는 밑동 마디 */
  link: number;
  /** 오른쪽을 볼 때 그 마디에서 본 자리 */
  local: Point;
}

/**
 * 회귀 비늘(PLAN 7.3). 남은 회귀 수를 글 없이 보여 준다. 몸에서 가까운 비늘부터 1구간, 2구간, 3구간과 짝이고,
 * 짝인 구간이 잘리면 꺼진다. 자를 수 없는 밑동에 나란히 그려서, 구간을 잘라도 꺼진 비늘이 남아 보인다.
 * 어디에 어떤 모양으로 그릴지는 디자인이 정한다(docs/art-spec.md). 지금은 밑동의 등 쪽 가장자리에 둔다.
 */
export class RewindScales {
  private readonly sim: Simulation;
  private readonly scales: Scale[];

  constructor(scene: Phaser.Scene, sim: Simulation, config: GameConfig) {
    this.sim = sim;
    const { sections, baseLinks, linkLength } = config.tail;
    const base = baseLinks * linkLength;
    const start = Math.min(MARGIN.start, base / 2);
    const end = Math.max(start, base - MARGIN.end);
    const dorsal = (sectionThickness(config, 0) / 2) * DORSAL;
    const offImage = hasPartImage(scene, 'rewind-scale-off');
    this.scales = Array.from({ length: sections }, (_, k) => {
      const along = sections === 1 ? (start + end) / 2 : start + ((end - start) * k) / (sections - 1);
      const link = Math.min(baseLinks - 1, Math.floor(along / linkLength));
      return {
        on: new Part(scene, scalePartSpec(false), DEPTH),
        // 꺼진 그림이 없으면 켜진 그림을 어둡게 한다
        off: new Part(scene, scalePartSpec(offImage), DEPTH, offImage ? 1 : SCALE_OFF_SHADE),
        link,
        local: { x: dorsal, y: -(along - (link + 0.5) * linkLength) },
      };
    });
  }

  update(): void {
    const { tail, turn } = this.sim.tori;
    const side = turn >= 0 ? 1 : -1;
    const lit = tail.sectionCount;
    this.scales.forEach(({ on, off, link, local }, k) => {
      const { body } = tail.links[link];
      const { x, y } = this.sim.pointOf(body, { x: local.x * side, y: local.y });
      const pose = { x, y, angle: this.sim.poseOf(body).angle + (side * Math.PI) / 2 };
      const shown = k < lit ? on : off;
      on.setVisible(shown === on);
      off.setVisible(shown === off);
      shown.place(pose, side);
    });
  }

  destroy(): void {
    for (const { on, off } of this.scales) {
      on.destroy();
      off.destroy();
    }
  }
}
