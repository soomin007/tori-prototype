import type { Scheme } from '../config/presets';
import { element } from './dom';

/** 키와 동작 한 줄 */
type KeyRow = readonly [key: string, label: string];

export interface SchemeGuide {
  title: string;
  summary: string;
  keys: readonly KeyRow[];
}

export const SCHEME_GUIDES: Record<Scheme, SchemeGuide> = {
  A: {
    title: '마우스로 움직이기',
    summary: '꼬리 끝이 마우스 커서를 따라옵니다.',
    keys: [
      ['마우스', '꼬리 움직이기'],
      ['왼쪽 클릭 누르기', '잡기, 가지에 걸기'],
      ['빠르게 휘두르기', '물건 치기'],
    ],
  },
  B: {
    title: '키로 움직이기',
    summary: '꼬리가 저절로 움직입니다.',
    keys: [
      ['J', '휘둘러 치기'],
      ['K 누르기', '잡기, 가지에 걸기'],
    ],
  },
};

export const MOVE_KEYS: readonly KeyRow[] = [
  ['A / D 또는 ← / →', '이동'],
  ['Space', '점프'],
];

export const SYSTEM_KEYS: readonly KeyRow[] = [
  ['1 ~ 4', '방 이동'],
  ['R', '방 처음부터'],
  ['Esc', '일시정지'],
  ['F1', '물리 디버그'],
  ['F2', '튜닝 패널'],
  ['F3', '도움말'],
];

export function keyList(rows: readonly KeyRow[]): HTMLElement {
  const list = element('div', 'key-list');
  for (const [key, label] of rows) {
    const line = element('p', 'key-row');
    line.append(element('kbd', '', key), label);
    list.append(line);
  }
  return list;
}
