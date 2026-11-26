import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import type { InputState } from './inputState';

/**
 * 버둥거림 게이지(PLAN 7.6). 쓰러져 있는 동안 버둥거리면 차고, 가만히 있으면 준다. 판정은 InputState만 보고 한다.
 * 좌우 이동 키를 번갈아 누를 때마다, 그리고 마우스가 한쪽으로 움직이다 방향이 뒤집힐 때마다 한 번으로 센다.
 * 처음 누른 키와 처음 움직인 마우스도 한 번으로 센다. 첫 입력부터 눈에 보이게 반응해야 하기 때문이다.
 * 조작 방식과 상관없이 두 입력을 다 받는다. 하나만 받게 하려면 설정(duel.struggleKeys, duel.struggleMouse)으로 끈다.
 * 대본 사건으로 깔렸을 때도 같은 게이지를 쓴다(2단계).
 */
export class StruggleGauge {
  /** 0이면 빈 것, 1이면 가득 찬 것 */
  value = 0;
  /** 이번 스텝에 버둥거린 횟수 */
  pulses = 0;
  /** 지금까지 버둥거린 횟수. 꿈틀거리는 방향을 번갈아 정하는 데 쓴다. */
  count = 0;
  private lastSide = 0;
  /** 축마다 지금 방향으로 움직인 거리(부호가 방향)와, 마지막으로 센 방향 */
  private readonly run = { x: 0, y: 0 };
  private readonly counted = { x: 0, y: 0 };
  private idle = Infinity;

  reset(): void {
    this.value = 0;
    this.pulses = 0;
    this.count = 0;
    this.lastSide = 0;
    this.run.x = this.run.y = 0;
    this.counted.x = this.counted.y = 0;
    this.idle = Infinity;
  }

  /** 한 스텝. filling이 거짓이면(자를 구간이 없으면) 버둥거려도 차지 않는다. 가득 찬 스텝에 true를 준다. */
  step(input: InputState, { duel }: GameConfig, filling: boolean): boolean {
    let pulses = 0;
    if (duel.struggleKeys) pulses += this.keys(input.moveX);
    if (duel.struggleMouse) pulses += this.mouse(input.mouseMotion, duel.struggleMouseMin);
    this.pulses = pulses;
    this.count += pulses;
    this.idle = pulses > 0 ? 0 : this.idle + FIXED_DT;
    const before = this.value;
    if (filling) this.value += pulses * duel.strugglePerInput;
    if (this.idle > duel.struggleGraceSeconds) this.value -= duel.struggleDecay * FIXED_DT;
    this.value = Math.min(1, Math.max(0, this.value));
    return filling && this.value >= 1 && before < 1;
  }

  /** 누른 방향이 지난번과 다를 때마다 한 번 */
  private keys(moveX: number): number {
    const side = Math.sign(moveX);
    if (side === 0 || side === this.lastSide) return 0;
    this.lastSide = side;
    return 1;
  }

  /** 축마다, 한 방향으로 min만큼 움직였고 그 방향이 지난번에 센 방향과 다르면 한 번 */
  private mouse(motion: { x: number; y: number }, min: number): number {
    let pulses = 0;
    for (const axis of ['x', 'y'] as const) {
      const move = motion[axis];
      if (move === 0) continue;
      const run = this.run[axis];
      this.run[axis] = Math.sign(move) === Math.sign(run) ? run + move : move;
      const direction = Math.sign(this.run[axis]);
      if (Math.abs(this.run[axis]) >= min && direction !== this.counted[axis]) {
        this.counted[axis] = direction;
        pulses += 1;
      }
    }
    return pulses;
  }
}
