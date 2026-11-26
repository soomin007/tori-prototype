import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/config/defaults';
import {
  parseCheckpoint,
  restoreCheckpoint,
  serializeCheckpoint,
  takeCheckpoint,
} from '../src/state/checkpoints';
import { createGameState } from '../src/state/gameState';
import { canCut, rewindState, RewindSequence } from '../src/state/rewind';
import { META_KEYS, SCHEMA, STATE_KEYS, TIMELINE_KEYS } from '../src/state/schema';

/** 기록관에게 말을 건 뒤 이것저것 바뀐 상태 */
function playedState() {
  const state = createGameState({ sectionsLeft: 3 });
  state.room = 3;
  state.recorder = 'duel-1';
  state.talkedTo.push('duel-1');
  state.npcs.friend = 'met';
  state.habits.tailHits = 4;
  return state;
}

describe('상태 두 갈래', () => {
  it('모든 항목이 timeline과 meta 가운데 한쪽에만 있다', () => {
    expect([...TIMELINE_KEYS, ...META_KEYS].sort()).toEqual([...STATE_KEYS].sort());
    expect(TIMELINE_KEYS.filter((key) => (META_KEYS as string[]).includes(key))).toEqual([]);
    expect(META_KEYS).toEqual(expect.arrayContaining(['sectionsLeft', 'rewinds', 'memory']));
  });

  it('새 판의 상태를 고쳐도 처음 값은 그대로다', () => {
    const state = createGameState();
    state.talkedTo.push('a');
    state.memory.seen = true;
    expect(SCHEMA.talkedTo.initial).toEqual([]);
    expect(createGameState().memory).toEqual({});
  });
});

describe('체크포인트와 회귀', () => {
  it('회귀하면 timeline은 마지막 체크포인트 시점으로 돌아가고, meta는 남은 구간과 회귀 횟수만 바뀐다', () => {
    const state = playedState();
    const checkpoint = takeCheckpoint(state);
    // 체크포인트 뒤에 일어난 일
    state.room = 1;
    state.recorder = 'other';
    state.talkedTo.push('other');
    state.duelsWon.push('duel-1');
    state.npcs.friend = 'gone';
    state.memory.sawDrop = true;

    rewindState(state, checkpoint);
    expect(state.room).toBe(3);
    expect(state.recorder).toBe('duel-1');
    expect(state.talkedTo).toEqual(['duel-1']);
    expect(state.duelsWon).toEqual([]);
    expect(state.npcs).toEqual({ friend: 'met' });
    expect(state.sectionsLeft).toBe(2);
    expect(state.rewinds).toBe(1);
    expect(state.memory).toEqual({ sawDrop: true });
  });

  it('체크포인트는 그 뒤에 상태를 고쳐도 바뀌지 않는다', () => {
    const state = playedState();
    const checkpoint = takeCheckpoint(state);
    state.talkedTo.push('other');
    state.habits.tailHits = 9;
    expect(checkpoint.timeline.talkedTo).toEqual(['duel-1']);
    expect(checkpoint.timeline.habits).toEqual({ tailHits: 4 });
  });

  it('체크포인트를 직렬화했다가 복원하면 똑같다', () => {
    const state = playedState();
    state.routes.fork = 'left';
    state.hand = '아이템 A';
    const checkpoint = takeCheckpoint(state);
    const parsed = parseCheckpoint(serializeCheckpoint(checkpoint));
    expect(parsed).toEqual(checkpoint);

    const restored = createGameState();
    restoreCheckpoint(restored, parsed!);
    expect(takeCheckpoint(restored)).toEqual(checkpoint);
  });

  it('읽을 때 모르는 항목은 버리고, 빠지거나 형이 다른 항목은 처음 값을 쓴다', () => {
    const text = JSON.stringify({ version: 1, timeline: { room: 3, talkedTo: 'x', unknown: 1 } });
    const parsed = parseCheckpoint(text)!;
    expect(parsed.timeline.room).toBe(3);
    expect(parsed.timeline.talkedTo).toEqual([]);
    expect(parsed.timeline.recorder).toBeNull();
    expect('unknown' in parsed.timeline).toBe(false);
  });

  it('판이 다르거나 깨진 글자는 읽지 않는다', () => {
    expect(parseCheckpoint('{')).toBeNull();
    expect(parseCheckpoint(JSON.stringify({ version: 99, timeline: {} }))).toBeNull();
    expect(parseCheckpoint('[]')).toBeNull();
  });

  it('남은 구간이 0이면 자를 수 없다', () => {
    expect(canCut(createGameState({ sectionsLeft: 1 }))).toBe(true);
    expect(canCut(createGameState({ sectionsLeft: 0 }))).toBe(false);
  });
});

describe('회귀 연출 시간', () => {
  it('정한 시간이 지난 스텝에 한 번만 끝난다', () => {
    const sequence = new RewindSequence();
    expect(sequence.advance(FIXED_DT, 2)).toBe(false);
    sequence.start();
    let ends = 0;
    let steps = 0;
    for (let i = 0; i < 200; i += 1) {
      if (sequence.active) steps += 1;
      if (sequence.advance(FIXED_DT, 2)) ends += 1;
    }
    expect(ends).toBe(1);
    expect(steps).toBe(120);
    expect(sequence.active).toBe(false);
  });
});
