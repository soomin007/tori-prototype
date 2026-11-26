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
  /** 마우스를 한 번이라도 움직였는지. 그 전에는 pointer를 쓰지 않는다. */
  pointerActive: boolean;
  /** 포인터를 잠근 동안 마우스가 움직인 거리(미터). 물리 스텝이 한 번 돌면 지워진다. */
  pointerDelta: { x: number; y: number };
  /**
   * 마우스가 움직인 거리(미터, 화면 기준). 포인터 잠금과 상관없이 쌓이고 물리 스텝이 한 번 돌면 지워진다.
   * 카메라가 움직여도 바뀌지 않아서, 마우스를 흔드는 버둥거림이 이것을 본다.
   */
  mouseMotion: { x: number; y: number };
}

/** pointerGrab은 A 방식, grab과 attack은 B 방식이 쓴다 */
export type Action = 'jump' | 'interact' | 'cutTail' | 'pointerGrab' | 'grab' | 'attack';

const ACTIONS: readonly Action[] = ['jump', 'interact', 'cutTail', 'pointerGrab', 'grab', 'attack'];

function emptyActions(): Record<Action, boolean> {
  return { jump: false, interact: false, cutTail: false, pointerGrab: false, grab: false, attack: false };
}

export function createInputState(): InputState {
  return {
    moveX: 0,
    held: emptyActions(),
    pressed: emptyActions(),
    pointer: { x: 0, y: 0 },
    pointerActive: false,
    pointerDelta: { x: 0, y: 0 },
    mouseMotion: { x: 0, y: 0 },
  };
}

/** 한 스텝만 쓰는 입력을 지운다 */
export function clearMomentary(input: InputState): void {
  for (const action of ACTIONS) input.pressed[action] = false;
  input.pointerDelta.x = 0;
  input.pointerDelta.y = 0;
  input.mouseMotion.x = 0;
  input.mouseMotion.y = 0;
}
