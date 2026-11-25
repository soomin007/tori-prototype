/**
 * 테스트 방 데이터. 길이는 미터이고 y는 아래로 커진다. 배치와 치수는 전부 자리값이다.
 * 이 파일은 데이터만 담는다. 바디와 콜라이더는 sim/roomBuilder.ts가 만든다.
 */

export interface Point {
  x: number;
  y: number;
}

/** 바닥 재질. 재질마다의 가속, 감속 배율은 config의 ground에 있다. */
export type Surface = 'normal' | 'slippery';

/** 볼록 다각형 하나. 오목한 지형은 여러 개로 나눠 적는다. */
export interface TerrainData {
  points: readonly Point[];
  surface: Surface;
}

export interface BoxData {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  /** 꼬리 끝으로 들 수 있는지 */
  grabbable: boolean;
}

/** 꼬리를 걸고 매달리는 가지. 몸이나 물건과는 부딪히지 않는다. */
export interface BranchData {
  x: number;
  y: number;
  length: number;
  thickness: number;
}

export interface RoomData {
  /** 카메라가 벗어나지 않는 범위 */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** 처음 설 자리. 몸통 중심이다. */
  spawn: Point;
  terrain: readonly TerrainData[];
  boxes: readonly BoxData[];
  branches: readonly BranchData[];
}

/** 바닥 윗면의 y. 아래 도우미는 이 높이에서 위로 잰 값(h)을 받는다. */
const FLOOR_Y = 6;
/** 바닥 아랫면의 y. 화면 아래 끝이다. */
const FLOOR_BOTTOM_Y = 7.2;

const at = (x: number, h: number): Point => ({ x, y: FLOOR_Y - h });

/** x0에서 x1까지, 높이가 h0에서 h1로 변하는 땅. 화면 아래 끝까지 채운다. */
function ground(x0: number, x1: number, h0 = 0, h1 = h0, surface: Surface = 'normal'): TerrainData {
  const points = [at(x0, h0), at(x1, h1), { x: x1, y: FLOOR_BOTTOM_Y }, { x: x0, y: FLOOR_BOTTOM_Y }];
  return { points, surface };
}

/** 공중에 뜬 발판. h는 윗면의 높이다. */
function platform(x0: number, x1: number, h: number, thickness: number): TerrainData {
  return { points: [at(x0, h), at(x1, h), at(x1, h - thickness), at(x0, h - thickness)], surface: 'normal' };
}

/** 계단. 첫 단의 높이가 h0이고 한 단마다 rise만큼 변한다(음수면 내려간다). */
function stairs(x0: number, h0: number, count: number, run: number, rise: number): TerrainData[] {
  return Array.from({ length: count }, (_, i) => ground(x0 + i * run, x0 + (i + 1) * run, h0 + i * rise));
}

const WALL_HEIGHT = 12;

function wall(x0: number, x1: number): TerrainData {
  return ground(x0, x1, WALL_HEIGHT);
}

/** 방 1: 이동. 왼쪽부터 평지, 오르막과 내리막, 낮은 턱, 계단, 좁은 발판, 미끄러운 바닥 순서다. */
const MOVE_ROOM: RoomData = {
  bounds: { left: -0.5, top: -3, right: 57.5, bottom: FLOOR_BOTTOM_Y },
  spawn: at(2, 0.5),
  terrain: [
    wall(-1.5, 0),
    ground(0, 11),
    // 오르막 약 17도, 내리막 약 22도
    ground(11, 15, 0, 1.2),
    ground(15, 17, 1.2),
    ground(17, 20, 1.2, 0),
    ground(20, 23),
    // 낮은 턱 0.2m
    ground(23, 25, 0.2),
    ground(25, 28),
    // 한 단이 0.2m인 계단. 여섯 단(길이 0.4m)을 오르고 다섯 단(길이 0.48m)을 내려온다
    ...stairs(28, 0.2, 6, 0.4, 0.2),
    ground(30.4, 32.4, 1.2),
    ...stairs(32.4, 1, 5, 0.48, -0.2),
    ground(34.8, 46),
    // 좁은 발판. 아래로 지나갈 수 있게 띄워 둔다
    platform(37, 37.8, 1.1, 0.15),
    platform(39.2, 39.8, 1.4, 0.15),
    platform(41.2, 41.7, 1.4, 0.15),
    platform(43.1, 43.9, 1.1, 0.15),
    ground(46, 54, 0, 0, 'slippery'),
    ground(54, 57),
    wall(57, 58.5),
  ],
  boxes: [],
  branches: [],
};

/** 바닥이나 다른 상자 위에 놓인 상자. h는 아랫면의 높이다. */
function box(x: number, width: number, height = width, h = 0, grabbable = false): BoxData {
  return { x, y: FLOOR_Y - h - height / 2, width, height, angle: 0, grabbable };
}

/** 한 층에 세 개씩 어긋나게 쌓은 블록 탑 */
function tower(x: number, rows: number, width: number, height: number): BoxData[] {
  return Array.from({ length: rows }, (_, row) => {
    const shift = row % 2 === 0 ? 0 : width / 2;
    const count = row % 2 === 0 ? 3 : 2;
    return Array.from({ length: count }, (_, i) => box(x + shift + i * width, width - 0.01, height, row * height));
  }).flat();
}

function branch(x: number, h: number, length = 0.7): BranchData {
  return { x, y: FLOOR_Y - h, length, thickness: 0.1 };
}

/** 방 2: 꼬리. 왼쪽부터 크기가 다른 상자와 작은 물건, 높이가 다른 가지 3개(아래는 구덩이), 좁은 틈, 블록 탑 순서다. */
const TAIL_ROOM: RoomData = {
  bounds: { left: -0.5, top: -3, right: 40.5, bottom: FLOOR_BOTTOM_Y },
  spawn: at(3, 0.5),
  terrain: [
    wall(-1.5, 0),
    ground(0, 14),
    // 가지 아래의 구덩이. 매달렸을 때 발이 닿지 않고, 떨어져도 뛰어서 나올 수 있다
    ground(14, 23, -0.8),
    ground(23, 40),
    // 꼬리가 낄 만한 좁은 틈: 세로 틈 하나와, 벽에 난 가로 틈 하나
    ground(26, 26.6, 0.8),
    ground(26.78, 27.4, 0.8),
    ground(29.4, 30.4, 0.5),
    platform(29.4, 30.4, 1.3, 0.62),
    wall(40, 41.5),
  ],
  boxes: [
    box(5.2, 0.3),
    box(6.4, 0.5),
    box(7.9, 0.8),
    box(9.4, 0.18, 0.18, 0, true),
    box(10.1, 0.22, 0.22, 0, true),
    box(10.8, 0.14, 0.3, 0, true),
    box(31.6, 0.18, 0.18, 0, true),
    ...tower(34.5, 6, 0.4, 0.3),
  ],
  branches: [branch(15.4, 1.8), branch(18.2, 2.2), branch(21.2, 2.5)],
};

/** 방 번호 - 1이 자리다. 방 3은 M4, 방 4는 M3에서 채운다. */
export const ROOMS: readonly RoomData[] = [MOVE_ROOM, TAIL_ROOM];

export function hasRoom(room: number): boolean {
  return ROOMS[room - 1] !== undefined;
}

/** 아직 없는 번호면 방 1을 준다 */
export function roomByNumber(room: number): RoomData {
  return ROOMS[room - 1] ?? ROOMS[0];
}
