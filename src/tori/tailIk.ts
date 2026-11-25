import { wrapAngle } from '../physics/world';
import type { Point } from '../rooms/rooms';

/** 고른 곡률 자세. 모든 관절이 같은 각(bend)만큼 굽어 꼬리가 원호가 된다. */
export interface ArcPose {
  /** 밑동 각(몸통 기준). 0이면 위, 양수면 시계 방향이다. */
  root: number;
  /** 나머지 관절의 각 */
  bend: number;
}

export interface ArcProblem {
  links: number;
  linkLength: number;
  /** 밑동에서 목표점까지, 몸통 방향 */
  target: Point;
  rootMin: number;
  rootMax: number;
  /** 관절 하나의 꺾임 한계 */
  bendMax: number;
  /** 밑동에서 바닥까지의 깊이. 바닥을 뚫는 자세를 피한다. 모르면 Infinity를 준다. */
  floor: number;
  /** 지금 꼬리 모양. 두 해 가운데 이것과 가까운 쪽을 고른다. */
  current: ArcPose;
}

/** 목표에서 1m 벗어나거나 바닥을 1m 파고드는 것을 자세가 이만큼(라디안) 다른 것과 같게 본다 */
const MISS_WEIGHT = 8;
const SEARCH_STEPS = 24;

/** 밑동 각과 굽은 정도 두 값만으로 꼬리 끝을 목표점에 닿게 한다. 닿지 않으면 가장 가까운 자세를 준다. */
export function solveArc(problem: ArcProblem): ArcPose {
  const { links, target, rootMin, rootMax, current } = problem;
  const direction = Math.atan2(target.x, -target.y);
  const size = bendForChord(problem, Math.hypot(target.x, target.y));
  const center = (rootMin + rootMax) / 2;

  let best: ArcPose = { root: center, bend: 0 };
  let bestCost = Infinity;
  for (const sign of [1, -1]) {
    let bend = sign * size;
    let root = center + wrapAngle(direction - ((links - 1) * bend) / 2 - center);
    if (root < rootMin || root > rootMax) {
      root = Math.min(rootMax, Math.max(rootMin, root));
      bend = closestBend(problem, root, sign);
    }
    const end = arcEnd(problem, { root, bend });
    const miss = Math.hypot(end.x - target.x, end.y - target.y);
    const change = Math.abs(root - current.root) + (Math.abs(bend - current.bend) * (links - 1)) / 2;
    const cost = (miss + floorDepth(problem, { root, bend })) * MISS_WEIGHT + change;
    if (cost < bestCost) {
      best = { root, bend };
      bestCost = cost;
    }
  }
  return best;
}

/** 자세가 바닥을 파고드는 깊이 */
function floorDepth({ links, linkLength, floor }: ArcProblem, { root, bend }: ArcPose): number {
  let y = 0;
  let deepest = 0;
  for (let i = 0; i < links; i += 1) {
    y -= Math.cos(root + i * bend) * linkLength;
    deepest = Math.max(deepest, y);
  }
  return Math.max(0, deepest - floor);
}

/** 자세가 만드는 꼬리 끝의 자리(밑동 기준, 몸통 방향) */
export function arcEnd(
  { links, linkLength }: Pick<ArcProblem, 'links' | 'linkLength'>,
  { root, bend }: ArcPose,
): Point {
  const chord = chordLength(links, linkLength, bend);
  const angle = root + ((links - 1) * bend) / 2;
  return { x: Math.sin(angle) * chord, y: -Math.cos(angle) * chord };
}

/** 관절 목표 각의 배열로 바꾼다 */
export function arcToPose({ root, bend }: ArcPose, links: number): number[] {
  return Array.from({ length: links }, (_, i) => (i === 0 ? root : bend));
}

function chordLength(links: number, linkLength: number, bend: number): number {
  const half = bend / 2;
  if (Math.abs(half) < 1e-5) return links * linkLength;
  return Math.abs((linkLength * Math.sin(links * half)) / Math.sin(half));
}

/** 한 바퀴를 다 감는 각을 넘기지 않는 꺾임 한계. 감을수록 양 끝이 가까워지고 한 바퀴에서 만난다. */
function maxBend({ links, bendMax }: ArcProblem): number {
  return Math.min(bendMax, (2 * Math.PI) / links);
}

/** 양 끝 거리가 distance가 되는 굽은 정도 */
function bendForChord(problem: ArcProblem, distance: number): number {
  const { links, linkLength } = problem;
  let low = 0;
  let high = maxBend(problem);
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const middle = (low + high) / 2;
    if (chordLength(links, linkLength, middle) > distance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** 밑동 각이 한계에 걸렸을 때, 그 각에서 목표에 가장 가까워지는 굽은 정도 */
function closestBend(problem: ArcProblem, root: number, sign: number): number {
  const { target } = problem;
  const limit = maxBend(problem);
  const missOf = (size: number): number => {
    const end = arcEnd(problem, { root, bend: sign * size });
    return Math.hypot(end.x - target.x, end.y - target.y);
  };
  const step = limit / SEARCH_STEPS;
  let best = 0;
  for (let i = 1; i <= SEARCH_STEPS; i += 1) if (missOf(i * step) < missOf(best)) best = i * step;
  // 목표가 조금 움직였을 때 자세가 칸 단위로 튀지 않게 다듬는다
  let low = Math.max(0, best - step);
  let high = Math.min(limit, best + step);
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const [a, b] = [low + (high - low) / 3, high - (high - low) / 3];
    if (missOf(a) < missOf(b)) high = b;
    else low = a;
  }
  return (sign * (low + high)) / 2;
}
