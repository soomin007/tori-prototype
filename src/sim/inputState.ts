/**
 * 시뮬레이션이 받는 입력. 조작 방식 A와 B가 같은 형식을 쓴다.
 * 장치를 읽는 일은 view/inputReader.ts가 하고, 테스트는 이 객체를 직접 만들어 넣는다.
 */
export interface InputState {
  /** 왼쪽 -1, 오른쪽 1 */
  moveX: number;
  /** 누르고 있는 동안 true */
  held: Record<Action, boolean>;
  /** 눌린 순간 true가 되고, 물리 스텝이 한 번 돌면 지워진다 */
  pressed: Record<Action, boolean>;
  /** 마우스가 가리키는 자리(미터, 방 좌표) */
  pointer: { x: number; y: number };
}

export type Action = 'jump' | 'interact' | 'cutTail' | 'grab' | 'attack';

const ACTIONS: readonly Action[] = ['jump', 'interact', 'cutTail', 'grab', 'attack'];

function emptyActions(): Record<Action, boolean> {
  return { jump: false, interact: false, cutTail: false, grab: false, attack: false };
}

export function createInputState(): InputState {
  return { moveX: 0, held: emptyActions(), pressed: emptyActions(), pointer: { x: 0, y: 0 } };
}

export function clearPressed(input: InputState): void {
  for (const action of ACTIONS) input.pressed[action] = false;
}
