import type { OpponentKind } from '../config/opponents';

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

/**
 * 방에 놓는 것(NPC, 물건, 결투 상대, 대본 사건)이 나타나는 회귀 횟수 범위(PLAN 7.4). 둘 다 없으면 늘 나타난다.
 * 방을 다시 만들 때 회귀 횟수로 거른다. 회귀할수록 친구 NPC가 줄어드는 기획을 데이터로 받는 자리다.
 */
export interface Appearance {
  /** 회귀를 이만큼 한 뒤부터 나타난다 */
  minRewinds?: number;
  /** 회귀를 이만큼 한 때까지만 나타난다 */
  maxRewinds?: number;
}

/** 회귀 횟수가 rewinds일 때 나타나는지 */
export function appears({ minRewinds = 0, maxRewinds = Infinity }: Appearance, rewinds: number): boolean {
  return rewinds >= minRewinds && rewinds <= maxRewinds;
}

export interface BoxData extends Appearance {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  /** 꼬리 끝으로 들 수 있는지 */
  grabbable: boolean;
  /** 밀도(kg/m²). 없으면 설정의 props.density를 쓴다. */
  density?: number;
  /** 그림. 없으면 상자다. 모양만 바뀌고 물리는 같다. */
  look?: 'fruit' | 'junk';
  /**
   * 매달려 있다가 떨어지는 물건(열매). 토리의 몸통 중심이 untilX를 넘고 delaySeconds가 지나면 떨어진다.
   * 그 전에는 움직이지 않는다.
   */
  hang?: { untilX: number; delaySeconds: number };
}

/**
 * 친구 NPC가 서는 자리(PLAN 2.6). 지금은 말을 걸 수 없는 자리표시 그림이다.
 * 회귀할수록 사라지는 것은 Appearance의 회귀 횟수 범위로 적는다. 누가 언제 사라지는지는 기획이 정한다.
 */
export interface NpcData extends Appearance {
  id: string;
  /** 발밑 가운데 */
  x: number;
  y: number;
}

/** 부딪히지 않는 그림(자리표시). 길에 놓인 나무의 모양만 보여 준다. (x, y)는 밑동이다. */
export interface DecorData {
  kind: 'tree';
  x: number;
  y: number;
  /** 밑동에서 잎 가운데까지 */
  height: number;
  /** 잎의 반지름 */
  radius: number;
}

/** 말을 걸기 전까지 앞길을 막는 문. 아랫변 가운데가 (x, y)다. */
export interface DoorData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 기록관(PLAN 7.8). 감지 영역에 들어가 E를 누르면 말을 건다. 말을 건 순간이 회귀 지점이 된다는 것은 화면에 알리지 않는다.
 * 대사에 {번호}와 {시각}을 적으면 number와 time으로 바뀐다. 글은 모두 자리표시다.
 */
export interface RecorderData extends Appearance {
  /** 상태에 이 이름으로 적힌다. 방이 달라도 겹치면 안 된다. */
  id: string;
  /** 발밑 가운데 */
  x: number;
  y: number;
  /** 회귀하면 토리가 서는 자리(몸통 중심) */
  stand: Point;
  line: string;
  number: string;
  time: string;
  /** 말을 걸어야 지나갈 수 있는 기록관이면 앞길을 막는 문 */
  door: DoorData | null;
}

/** 꼬리를 걸고 매달리는 가지. 몸이나 물건과는 부딪히지 않는다. */
export interface BranchData {
  x: number;
  y: number;
  length: number;
  thickness: number;
}

/**
 * 결투장과 그 상대(PLAN 7.6). 토리의 몸통 중심이 startX를 넘어 들어서면 left와 right에 벽이 닫히고 결투가 시작된다.
 * 벽은 결투가 끝나면 열린다. 이긴 결투는 상태의 duelsWon에 id로 적히고, 방을 다시 만들어도 다시 생기지 않는다.
 */
export interface DuelData extends Appearance {
  /** 상태에 이 이름으로 적힌다. 방이 달라도 겹치면 안 된다. */
  id: string;
  /** 결투장 왼쪽 끝과 오른쪽 끝의 x. 벽의 가운데가 여기에 선다. */
  left: number;
  right: number;
  /** 결투장 바닥 윗면의 y */
  floorY: number;
  /** 토리의 몸통 중심이 이 x를 넘으면 결투가 시작된다 */
  startX: number;
  /** 상대 종류(config/opponents.ts) */
  opponent: OpponentKind;
  /** 상대가 처음 서는 자리(발밑 가운데의 x). 토리 쪽(왼쪽)을 보고 선다. */
  opponentX: number;
  /** 전광판에 나오는 번호. 자리표시다. 앞이 토리, 뒤가 상대다. */
  numbers: readonly [string, string];
  /** 이기면 "체험판 끝" 화면을 띄우는 결투(PLAN 7.9). 12월 2일 체험판의 결투 1이다. */
  endsDemo?: boolean;
}

/**
 * 대본 사건의 계기(PLAN 7.8). 적은 것 가운데 하나라도 맞으면 온다.
 * 시간과 체력 비율은 사건이 딸린 결투가 싸움 중일 때만 본다.
 */
export interface EventTrigger {
  /** 싸움이 시작된 뒤 지난 시간(초) */
  fightSeconds?: number;
  /** 상대의 체력이 이 비율보다 낮아지면 */
  foeHealthBelow?: number;
  /** 토리의 체력이 이 비율보다 낮아지면. 쓰러지기 전에 사건이 먼저 오게 하는 자리다(PLAN 7.8). */
  toriHealthBelow?: number;
  /** 토리의 몸통 중심이 이 x를 넘으면 */
  toriPastX?: number;
}

/**
 * 대본 사건(PLAN 7.8). 계기가 오면 위쪽 인물이 예고 동작을 하고, 예고가 끝나면 매달린 구조물을 떨어뜨린다.
 * 구조물에 깔린 토리는 결투에서 쓰러졌을 때와 같은 버둥거림으로 꼬리를 자른다(PLAN 7.6).
 * 회귀하면 방을 다시 만들면서 사건도 처음으로 돌아가므로, 같은 계기에 같은 일이 다시 일어난다.
 * 예고 시간, 떨어지는 빠르기, 처음 한 번의 규칙은 config의 scripted에 있다. 배치와 치수는 자리값이다.
 */
export interface ScriptedEventData extends Appearance {
  /** 방이 달라도 겹치면 안 된다 */
  id: string;
  /** 이 사건이 일어나는 결투(DuelData.id). 사건은 그 결투가 시작된 뒤에만 일어난다. */
  duel: string;
  trigger: EventTrigger;
  /** 매달린 구조물. 처음에는 가운데가 x에 있고, 아랫면이 y에 있다. */
  drop: { x: number; y: number; width: number; height: number };
  /** 떨어뜨리는 인물이 서 있는 높은 발판(그림만 있고 부딪히지 않는다). y는 윗면이다. */
  ledge: { left: number; right: number; y: number };
}

export interface RoomData {
  /** 방 번호. 숫자 키와 주소의 ?room=, 상태의 room이 이 번호를 쓴다. 테스트용 방은 0이다. */
  number: number;
  /** 카메라가 벗어나지 않는 범위 */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** 처음 설 자리. 몸통 중심이다. */
  spawn: Point;
  terrain: readonly TerrainData[];
  boxes: readonly BoxData[];
  branches: readonly BranchData[];
  recorders: readonly RecorderData[];
  duels: readonly DuelData[];
  events: readonly ScriptedEventData[];
  npcs: readonly NpcData[];
  decor: readonly DecorData[];
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
  number: 1,
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
  recorders: [],
  duels: [],
  events: [],
  npcs: [],
  decor: [],
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
  number: 2,
  bounds: { left: -0.5, top: -3, right: 40.5, bottom: FLOOR_BOTTOM_Y },
  spawn: at(3, 0.5),
  terrain: [
    wall(-1.5, 0),
    ground(0, 14),
    // 가지 아래의 구덩이. 떨어져도 뛰어서 나올 수 있다. 가지는 달려가며 뛰었을 때 머리 위를 지나는 높이다
    ground(14, 23, -0.4),
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
  branches: [branch(15.4, 2.7), branch(18.2, 2.8), branch(21.2, 2.9)],
  recorders: [],
  duels: [],
  events: [],
  npcs: [],
  decor: [],
};

/**
 * 기록관과 그 앞에 서는 자리. 토리는 기록관의 왼쪽에 오른쪽을 보고 선다.
 * gateX를 주면 그 자리에 문을 세워, 말을 걸기 전까지 지나가지 못한다.
 */
function recorder(id: string, x: number, gateX: number | null, line = '기록관 대사 1'): RecorderData {
  return {
    id,
    ...at(x, 0),
    stand: at(x - 1.1, 0.5),
    line,
    number: '번호 1',
    time: '시각 1',
    // 높이 2.8m는 뛰어도 넘지 못한다(점프로 몸통 위가 바닥에서 약 2.1m까지 오른다)
    door: gateX === null ? null : { ...at(gateX, 0), width: 0.3, height: 2.8 },
  };
}

/**
 * 결투장 하나. 시작하는 자리는 왼쪽 벽에서 3m 안쪽이다. 꼬리를 뒤로 뻗어도(약 1.9m) 닫히는 벽에 걸리지 않는다.
 */
function arena(id: string, left: number, right: number, numbers: readonly [string, string]): DuelData {
  return { id, left, right, floorY: FLOOR_Y, startX: left + 3, opponent: 'opponent-1', opponentX: right - 3, numbers };
}

/**
 * 방 3: 결투 시험장(PLAN 9절). 왼쪽부터 기록관과 문, 짧은 길, 결투장 순서다.
 * 길에는 짧아진 꼬리로 해 볼 것(작은 물건, 상자, 낮은 가지)을 둔다. 가지는 밑동만 남은 꼬리로도 뛰어서 닿는 높이다.
 */
const DUEL_ROOM: RoomData = {
  number: 3,
  bounds: { left: -0.5, top: -3, right: 33.5, bottom: FLOOR_BOTTOM_Y },
  spawn: at(2, 0.5),
  terrain: [
    wall(-1.5, 0),
    ground(0, 13),
    // 가지 아래의 얕은 구덩이. 매달린 모습이 보이게 판다
    ground(13, 15.6, -0.5),
    ground(15.6, 33),
    wall(33, 34.5),
  ],
  boxes: [box(9, 0.18, 0.18, 0, true), box(11, 0.5)],
  branches: [branch(14.3, 2)],
  recorders: [recorder('duel-1', 5.5, 6.7)],
  // 결투 1(x 19~32). 상대와 토리는 번호로만 부른다
  duels: [arena('duel-1', 19, 32, ['번호 1', '번호 2'])],
  events: [],
  npcs: [],
  decor: [],
};

/** 나무에 매달린 열매. 토리가 untilX를 넘고 delaySeconds 뒤에 떨어진다. h는 아랫면의 높이다. */
function fruit(x: number, h: number, untilX: number, delaySeconds: number): BoxData {
  return { ...box(x, 0.2, 0.2, h), look: 'fruit', hang: { untilX, delaySeconds } };
}

function npc(id: string, x: number, appearance: Appearance = {}): NpcData {
  return { id, ...at(x, 0), ...appearance };
}

function tree(x: number, height: number, radius: number): DecorData {
  return { kind: 'tree', ...at(x, 0), height, radius };
}

/** 등록장 길의 턱 높이. 뛰어서는 오르지 못하고(몸통 아랫면이 약 1.63m까지 뜬다), 폐품을 디디면 오른다. */
const LEDGE_H = 1.8;
/** 폐품 한 변. 디디고 뛰면 몸통 아랫면이 약 2.3m까지 뜬다. */
const JUNK_SIZE = 0.7;

/**
 * 방 4: 기 구간의 앞부분인 등록장 길(12월 2일 체험판, PLAN 9절과 10절의 2단계). 왼쪽부터 친구 NPC 자리, 열매가 떨어지는 나무,
 * 폐품과 높은 턱, 친구 NPC 자리, 기록관과 문, 결투 1의 결투장 순서다. 글로 가르치지 않고 배치로 해 보게 한다(PLAN 2.5).
 * 열매는 다가가면 머리 위로 떨어져 꼬리로 쳐 보게 하고, 폐품은 꼬리로 끌거나 몸으로 밀어 턱 앞에 놓고 디디게 한다.
 * 결투 도중 위쪽 인물이 구조물을 떨어뜨린다(대본 사건, PLAN 7.8). 결투 1을 이기면 "체험판 끝" 화면이다(PLAN 7.9).
 * 두 번째 친구 NPC는 기록관 가까이에 두어, 회귀한 뒤 사라진 것이 보이는 자리에 있다. 배치와 치수는 모두 자리값이다.
 */
const GI_ROOM: RoomData = {
  number: 4,
  bounds: { left: -0.5, top: -3, right: 44.5, bottom: FLOOR_BOTTOM_Y },
  spawn: at(2, 0.5),
  terrain: [wall(-1.5, 0), ground(0, 16.5), ground(16.5, 20.5, LEDGE_H), ground(20.5, 43), wall(43, 44.5)],
  boxes: [
    fruit(8.3, 2.5, 6.8, 0),
    fruit(9.1, 2.7, 6.8, 0.45),
    fruit(9.9, 2.45, 6.8, 0.9),
    { ...box(13.4, JUNK_SIZE, JUNK_SIZE, 0, true), look: 'junk', density: 1.5 },
  ],
  branches: [],
  recorders: [recorder('gi-1', 24.5, 25.7)],
  duels: [{ ...arena('gi-duel-1', 27.5, 41.5, ['번호 1', '번호 2']), endsDemo: true }],
  events: [
    {
      id: 'gi-drop-1',
      duel: 'gi-duel-1',
      // 싸움을 시작하고 8초 뒤나, 토리의 체력이 절반 밑으로 내려가면 온다
      trigger: { fightSeconds: 8, toriHealthBelow: 0.5 },
      // 발판 위 인물의 머리가 화면 위쪽의 전광판에 가리지 않는 높이다
      drop: { ...at(34.5, 3.2), width: 1.4, height: 0.4 },
      ledge: { left: 27.5, right: 41.5, y: at(0, 3.9).y },
    },
  ],
  npcs: [npc('gi-friend-1', 4.4), npc('gi-friend-2', 21.9)],
  decor: [tree(9.1, 3.2, 1.3)],
};

/** 방 번호 - 1이 자리다. 방 4가 체험판의 첫 방이다(config/share.ts의 DEFAULT_ROOM). */
export const ROOMS: readonly RoomData[] = [MOVE_ROOM, TAIL_ROOM, DUEL_ROOM, GI_ROOM];

export function hasRoom(room: number): boolean {
  return ROOMS[room - 1] !== undefined;
}

/** 아직 없는 번호면 방 1을 준다 */
export function roomByNumber(room: number): RoomData {
  return ROOMS[room - 1] ?? ROOMS[0];
}
