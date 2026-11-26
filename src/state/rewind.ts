import { restoreCheckpoint } from './checkpoints';
import type { Checkpoint } from './checkpoints';
import type { GameState } from './schema';

/** 남은 구간이 0이면 자를 수 없다. 자르기 계기가 와도 아무 일도 일어나지 않는다(PLAN 7.4). */
export function canCut(state: GameState): boolean {
  return state.sectionsLeft > 0;
}

/**
 * 회귀의 상태 부분. meta를 고친 뒤(남은 구간 -1, 회귀 횟수 +1) 체크포인트의 timeline을 복원한다.
 * 그 앞의 자르기와 꿈틀거림, 그 뒤의 방 다시 만들기는 sim/simulation.ts가 한다.
 */
export function rewindState(state: GameState, checkpoint: Checkpoint): void {
  state.sectionsLeft = Math.max(0, state.sectionsLeft - 1);
  state.rewinds += 1;
  restoreCheckpoint(state, checkpoint);
}

/**
 * 자르기에서 회귀까지의 연출 시간. 꼬리가 잘린 순간 시작해, 잘린 꼬리가 꿈틀거리는 동안(자리값 2초) 이어진다.
 * 시간만 센다. 연출 중에 무엇을 할지는 Simulation이 정한다.
 */
export class RewindSequence {
  private elapsed: number | null = null;

  get active(): boolean {
    return this.elapsed !== null;
  }

  /** 지나간 비율(0~1). 연출 중이 아니면 0이다. */
  progress(seconds: number): number {
    return this.elapsed === null ? 0 : Math.min(1, this.elapsed / Math.max(seconds, 1e-6));
  }

  start(): void {
    this.elapsed = 0;
  }

  stop(): void {
    this.elapsed = null;
  }

  /** dt만큼 진행한다. 연출이 끝난 스텝에 true를 주고 멈춘다. */
  advance(dt: number, seconds: number): boolean {
    if (this.elapsed === null) return false;
    this.elapsed += dt;
    if (this.elapsed + 1e-9 < seconds) return false;
    this.elapsed = null;
    return true;
  }
}
