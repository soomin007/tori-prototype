import type { BoxData, BranchData, DuelData, RecorderData, RoomData, ScriptedEventData, Surface, TerrainData } from '../src/rooms/rooms';

/** 테스트용 방. 바닥 윗면이 y = 0이고 위쪽이 음수다. h는 위로 잰 높이다. */
export function ground(x0: number, x1: number, h0 = 0, h1 = h0, surface: Surface = 'normal'): TerrainData {
  return {
    points: [
      { x: x0, y: -h0 },
      { x: x1, y: -h1 },
      { x: x1, y: 2 },
      { x: x0, y: 2 },
    ],
    surface,
  };
}

export function box(x: number, y: number, size: number, angle: number): BoxData {
  return { x, y, width: size, height: size, angle, grabbable: false };
}

export function room(
  terrain: TerrainData[],
  boxes: BoxData[] = [],
  branches: BranchData[] = [],
  recorders: RecorderData[] = [],
  duels: DuelData[] = [],
  events: ScriptedEventData[] = [],
): RoomData {
  const bounds = { left: 0, top: -10, right: 100, bottom: 2 };
  return { number: 0, bounds, spawn: { x: 2, y: -0.5 }, terrain, boxes, branches, recorders, duels, events, npcs: [], decor: [] };
}
