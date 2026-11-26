import type Phaser from 'phaser';
import { PPM } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { toPx } from '../physics/world';
import type { Pose } from '../physics/world';
import { sectionThickness } from '../tori/tail';

/**
 * 부위별 그림 자리. src/assets/parts/에 키와 같은 이름의 PNG(예: torso.png)가 있으면 그 그림을 쓰고, 없으면 도형으로 그린다.
 * 그림은 전부 오른쪽을 보는 모습이고, 다리는 곧게 아래로, 꼬리 마디는 왼쪽으로 뻗은 모습이다.
 * 픽셀 크기와 기준점은 docs/art-spec.md에 있다.
 */
export type BodyPartKey = 'torso' | 'head' | 'leg-front-upper' | 'leg-front-lower' | 'leg-hind-upper' | 'leg-hind-lower';
/** 꼬리 마디의 그림. 밑동, 자를 수 있는 구간(1이 몸에서 가장 가깝다), 맨 끝 마디 */
export type TailPartKey = 'tail-base' | `tail-${number}` | 'tail-tip';
/** 회귀 비늘. 꺼진 그림이 없으면 켜진 그림을 어둡게 해서 쓴다. */
export type ScalePartKey = 'rewind-scale' | 'rewind-scale-off';
export type PartKey = BodyPartKey | TailPartKey | ScalePartKey;

export interface PartSpec {
  key: PartKey;
  /** 부위의 크기(m). 그림 파일은 이보다 커도 되고, 그때는 이 크기의 네모가 그림 한가운데에 있다고 본다. */
  width: number;
  height: number;
  /** 기준점(부위 크기에 대한 비율). 이 점을 물리 자세나 관절 자리에 맞춘다. */
  originX: number;
  originY: number;
  /** 그림이 없을 때 쓰는 도형 색(자리값) */
  color: number;
  /** 도형으로 그릴 때 눈을 찍어 앞을 알아보게 한다 */
  eye?: boolean;
}

/** 그림 파일의 1m당 픽셀. 화면(PPM)의 두 배라서 큰 모니터에서도 흐려지지 않는다. */
const ART_PIXELS_PER_METER = 200;

const BODY_COLOR = 0x8fb573;
const HEAD_COLOR = 0x9cc47e;
const LEG_COLOR = 0x7da163;
/** 자르는 자리가 보이게 구간마다 번갈아 쓴다 */
const TAIL_COLORS = [0x86ab6b, 0x9cc47e];
const EYE_COLOR = 0x20262d;
const SCALE_COLOR = 0xffd24a;
/** 꺼진 비늘의 밝기(켜진 비늘에 대한 비율) */
export const SCALE_OFF_SHADE = 0.35;

/** 회귀 비늘 하나의 크기(m, 자리값). 꼬리 마디처럼 가로로 누운 모습이다. */
export const SCALE_SIZE = { width: 0.09, height: 0.07 };

// 빌드할 때 있는 파일만 목록에 들어온다. 없는 파일을 불러 404를 내지 않기 위해서다.
// 작은 파일도 코드에 섞지 않고 따로 배포한다(no-inline).
const FILES = import.meta.glob<string>('../assets/parts/*.png', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

const textureKey = (key: string): string => `part-${key}`;

/** 있는 그림 파일을 모두 불러오기 목록에 넣는다. 씬의 preload에서 부른다. */
export function preloadParts(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(FILES)) {
    const name = path.slice(path.lastIndexOf('/') + 1, -'.png'.length);
    scene.load.image(textureKey(name), url);
  }
}

/** 지금 설정의 치수에서 나온 부위 목록 */
export function partSpecs({ torso, head, legs }: GameConfig): Record<BodyPartKey, PartSpec> {
  const radius = legs.thickness / 2;
  // 윗다리는 양 끝 관절을 반지름만큼 덮고, 아랫다리는 발바닥에서 끝난다
  const upper = { width: legs.thickness, height: legs.upper + legs.thickness, originX: 0.5, color: LEG_COLOR };
  const lower = { width: legs.thickness, height: legs.lower + radius, originX: 0.5, color: LEG_COLOR };
  const upperOriginY = radius / upper.height;
  const lowerOriginY = radius / lower.height;
  return {
    torso: {
      key: 'torso',
      width: torso.length,
      height: torso.thickness,
      originX: 0.5,
      originY: 0.5,
      color: BODY_COLOR,
    },
    head: {
      key: 'head',
      width: head.radius * 2,
      height: head.radius * 2,
      originX: 0.5,
      originY: 0.5,
      color: HEAD_COLOR,
      eye: true,
    },
    'leg-front-upper': { ...upper, key: 'leg-front-upper', originY: upperOriginY },
    'leg-front-lower': { ...lower, key: 'leg-front-lower', originY: lowerOriginY },
    'leg-hind-upper': { ...upper, key: 'leg-hind-upper', originY: upperOriginY },
    'leg-hind-lower': { ...lower, key: 'leg-hind-lower', originY: lowerOriginY },
  };
}

/** 꼬리 마디 하나의 부위. 양 끝 관절을 반지름만큼 덮어 굽어도 틈이 보이지 않는다. */
export function tailPartSpec(config: GameConfig, section: number, tip: boolean): PartSpec {
  const thickness = sectionThickness(config, section);
  return {
    key: tip ? 'tail-tip' : section === 0 ? 'tail-base' : `tail-${section}`,
    width: config.tail.linkLength + thickness,
    height: thickness,
    originX: 0.5,
    originY: 0.5,
    color: TAIL_COLORS[section % TAIL_COLORS.length],
  };
}

/** 회귀 비늘의 부위. off는 꺼진 그림이다. */
export function scalePartSpec(off: boolean): PartSpec {
  return { key: off ? 'rewind-scale-off' : 'rewind-scale', ...SCALE_SIZE, originX: 0.5, originY: 0.5, color: SCALE_COLOR };
}

/** 그림 파일이 들어 있는지 */
export function hasPartImage(scene: Phaser.Scene, key: PartKey): boolean {
  return scene.textures.exists(textureKey(key));
}

/** 화면에 올린 부위 하나 */
export class Part {
  private readonly object: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  private readonly baseScaleX: number;

  /** shade는 먼 쪽 다리를 어둡게 할 때 쓰는 밝기(0~1)다 */
  constructor(scene: Phaser.Scene, spec: PartSpec, depth: number, shade = 1) {
    const key = textureKey(spec.key);
    if (scene.textures.exists(key)) {
      const image = scene.add.image(0, 0, key);
      const offset = (size: number, origin: number): number => (origin - 0.5) * size * ART_PIXELS_PER_METER;
      image.setOrigin(
        0.5 + offset(spec.width, spec.originX) / image.width,
        0.5 + offset(spec.height, spec.originY) / image.height,
      );
      this.object = image.setScale(PPM / ART_PIXELS_PER_METER).setTint(shaded(0xffffff, shade));
    } else {
      this.object = drawShape(scene.add.graphics(), spec, shade);
    }
    this.object.setDepth(depth);
    this.baseScaleX = this.object.scaleX;
  }

  /** flip은 좌우 배율이다. 1이면 그대로(오른쪽), -1이면 뒤집는다. */
  place({ x, y, angle }: Pose, flip = 1): void {
    this.object.setPosition(toPx(x), toPx(y)).setRotation(angle);
    this.object.scaleX = this.baseScaleX * flip;
  }

  setVisible(visible: boolean): void {
    this.object.setVisible(visible);
  }

  destroy(): void {
    this.object.destroy();
  }
}

/** 기준점이 (0, 0)에 오게 둥근 사각형을 그린다 */
function drawShape(g: Phaser.GameObjects.Graphics, spec: PartSpec, shade: number): Phaser.GameObjects.Graphics {
  const [width, height] = [toPx(spec.width), toPx(spec.height)];
  const [left, top] = [-width * spec.originX, -height * spec.originY];
  g.fillStyle(shaded(spec.color, shade));
  g.fillRoundedRect(left, top, width, height, Math.min(width, height) / 2);
  if (spec.eye) g.fillStyle(EYE_COLOR).fillCircle(left + width * 0.72, top + height * 0.38, width * 0.09);
  return g;
}

function shaded(color: number, shade: number): number {
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * shade) << shift;
  return channel(16) | channel(8) | channel(0);
}
