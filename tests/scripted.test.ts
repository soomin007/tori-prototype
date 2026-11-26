import { beforeAll, describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, FIXED_DT } from '../src/config/defaults';
import type { ParamValue } from '../src/config/defaults';
import type { Scheme } from '../src/config/presets';
import { initPhysics } from '../src/physics/world';
import type { ScriptedEventData } from '../src/rooms/rooms';
import type { FoePhase } from '../src/sim/opponent';
import type { EventPhase } from '../src/sim/scripted';
import { Simulation } from '../src/sim/simulation';
import type { GameState } from '../src/state/gameState';
import { alternateKeys, Duelist, duelRoom, PASSIVE, RECORDER, shakeMouse } from './duelist';

beforeAll(() => initPhysics());

const { warnSeconds } = DEFAULTS.scripted;
const { baseLinks, linksPerSection } = DEFAULTS.tail;

/** 결투장(x 8~30) 위에 매달린 구조물. 싸움이 시작되고 6초 뒤나, 토리의 체력이 절반 밑으로 내려가면 떨어진다. */
const DROP: ScriptedEventData = {
  id: 'drop-test',
  duel: 'duel-test',
  trigger: { fightSeconds: 6, toriHealthBelow: 0.5 },
  drop: { x: 18, y: -3.7, width: 1.4, height: 0.4 },
  ledge: { left: 8, right: 30, y: -4.6 },
};

/** 상대가 멀리(간격 9m) 서서 공격하지 않는 결투 시험 방. 토리가 달아날 자리가 있다. */
const FAR_FOE = { opponentX: 26 };

interface FightOptions {
  config?: Record<string, ParamValue>;
  initial?: Partial<GameState>;
  event?: ScriptedEventData;
  opponentX?: number;
}

/** 기록관에게 말을 건 뒤 결투장에 들어가 싸움이 시작될 때까지 */
function fight(scheme: Scheme, { config = PASSIVE, initial = {}, event = DROP, opponentX }: FightOptions = {}): Duelist {
  const run = new Duelist(scheme, duelRoom({ events: [event], opponentX }), config, initial);
  run.pressE().pressE();
  return walkIn(run);
}

/** 결투장 시작 자리까지 걸어가 싸움이 시작될 때까지 기다린다 */
function walkIn(run: Duelist): Duelist {
  run.input.moveX = 1;
  run.until(() => run.duel.phase !== 'waiting', 6);
  run.input.moveX = 0;
  run.until(() => run.duel.phase === 'fighting', 3);
  expect(run.duel.phase).toBe('fighting');
  return run;
}

/** 사건의 단계가 바뀔 때마다 그때의 싸움 경과 시간을 적으며 until까지 돌린다 */
function watch(run: Duelist, until: (phase: EventPhase) => boolean, seconds: number): { phase: EventPhase; fight: number }[] {
  const log: { phase: EventPhase; fight: number }[] = [];
  let fightSeconds = run.duel.elapsed;
  run.until(() => {
    const { phase } = run.sim.scripted[0];
    if (log.at(-1)?.phase !== phase) log.push({ phase, fight: fightSeconds });
    fightSeconds += FIXED_DT;
    return until(phase);
  }, seconds);
  return log;
}

const resolved = (phase: EventPhase): boolean => phase === 'pinned' || phase === 'landed';

describe('대본 사건', () => {
  it('계기가 오면 예고를 먼저 내고, 예고 시간이 지난 뒤에 떨어져 토리를 깐다', () => {
    const run = fight('B');
    const log = watch(run, resolved, 12);
    expect(log.map(({ phase }) => phase)).toEqual(['waiting', 'warning', 'falling', 'pinned']);
    const [, warning, falling] = log;
    expect(warning.fight).toBeGreaterThanOrEqual((DROP.trigger.fightSeconds as number) - 1e-6);
    expect(warning.fight).toBeLessThan((DROP.trigger.fightSeconds as number) + 3 * FIXED_DT);
    expect(falling.fight - warning.fight).toBeGreaterThanOrEqual(warnSeconds - 1e-6);
    const order = ['event-warn', 'event-drop', 'pinned'].map((event) => run.events.indexOf(event as never));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(run.duel).toMatchObject({ phase: 'downed', pinned: true });
    expect(run.sim.tori.pinned).toBe(true);
    // 깔린 동안 심판이 센다(scripted.pinCount)
    expect(run.duel.count).toBe(1);
  });

  it('토리의 체력이 계기의 비율 밑으로 내려가면 예고가 오고, 예고와 낙하 동안 상대는 새 공격을 시작하지 않는다', () => {
    const quick = { 'foe1.measureMinSeconds': 0.2, 'foe1.measureMaxSeconds': 0.3 };
    const run = fight('B', { config: quick, event: { ...DROP, trigger: { toriHealthBelow: 0.5 } } });
    const event = run.sim.scripted[0];
    let warnedAt: number | null = null;
    // 체력은 물리 스텝 뒤에 줄고 계기는 다음 스텝 앞에서 보므로, 비율 밑으로 내려간 뒤 한 스텝까지는 기다린다
    let lateSteps = 0;
    const windups: FoePhase[] = [];
    let previous = run.foe.phase;
    run.until(() => {
      const ratio = run.duel.toriHealth / run.duel.toriMaxHealth;
      if (event.phase === 'waiting' && ratio < 0.5) lateSteps += 1;
      if (event.phase !== 'waiting') warnedAt ??= ratio;
      if (event.busy && run.foe.phase === 'windup' && previous !== 'windup') windups.push(run.foe.phase);
      previous = run.foe.phase;
      return resolved(event.phase);
    }, 30);
    expect(warnedAt).not.toBeNull();
    expect(warnedAt as unknown as number).toBeLessThan(0.5);
    expect(lateSteps).toBeLessThanOrEqual(1);
    expect(windups).toEqual([]);
    expect(event.phase).toBe('pinned');
  });

  for (const scheme of ['A', 'B'] as const) {
    it(`${scheme} 방식: 깔린 뒤 버둥거려 게이지가 차면 꼬리가 끊기고 기록관 앞으로 회귀한다`, () => {
      const run = fight(scheme);
      watch(run, resolved, 12);
      expect(run.duel.pinned).toBe(true);
      run.seconds(2.5, scheme === 'A' ? shakeMouse(run) : alternateKeys(run));
      expect(run.events).toContain('cut');
      expect(run.sim.tori.tail.links.length).toBe(baseLinks + 2 * linksPerSection);
      run.input.moveX = 0;
      run.input.mouseMotion = { x: 0, y: 0 };
      run.seconds(DEFAULTS.cut.rewindSeconds + 0.1);
      expect(run.events).toContain('rewind');
      expect(run.sim.state).toMatchObject({ rewinds: 1, sectionsLeft: 2 });
      expect(Math.abs(run.center.x - RECORDER.stand.x)).toBeLessThan(0.5);
      expect(run.sim.dialogue?.text).toBe(RECORDER.line);
      expect(run.sim.tori.pinned).toBe(false);
      expect(run.duel.phase).toBe('waiting');
      expect(run.sim.scripted[0].phase).toBe('waiting');
    });
  }

  it('회귀한 뒤에도 같은 계기에 같은 사건이 일어난다', () => {
    const run = fight('B');
    const first = watch(run, resolved, 12);
    run.seconds(2.5, alternateKeys(run));
    run.input.moveX = 0;
    run.until(() => run.sim.state.rewinds === 1 && !run.sim.rewinding, 4);
    expect(run.sim.scripted[0]).toMatchObject({ phase: 'waiting', first: false });
    // 회귀하면 같은 대사가 떠 있다. 닫고 다시 들어간다.
    walkIn(run.pressE());
    const second = watch(run, resolved, 12);
    expect(second.map(({ phase }) => phase)).toEqual(first.map(({ phase }) => phase));
    expect(second[1].fight).toBeCloseTo(first[1].fight, 6);
  });

  it('처음에는 예고를 보고 달아나도 깔리고, 회귀한 뒤에는 달아나면 피한다', () => {
    const escape = (initial: Partial<GameState>): EventPhase => {
      const run = fight('B', { initial, opponentX: FAR_FOE.opponentX });
      const event = run.sim.scripted[0];
      run.until(() => event.phase === 'warning', 10);
      run.input.moveX = 1;
      run.until(() => resolved(event.phase), 4);
      return event.phase;
    };
    expect(escape({})).toBe('pinned');
    expect(escape({ rewinds: 1, sectionsLeft: 2 })).toBe('landed');
  });

  it('처음에는 사건 전에 토리가 쓰러지지 않고, 쓰러질 만큼 맞으면 사건이 바로 온다', () => {
    const brutal = { 'foe1.measureMinSeconds': 0.2, 'foe1.measureMaxSeconds': 0.3, 'foe1Dash.damage': 100, 'foe1Shove.damage': 100 };
    const run = fight('B', { config: brutal, event: { ...DROP, trigger: { fightSeconds: 60 } } });
    const event = run.sim.scripted[0];
    let lowest = Infinity;
    run.until(() => {
      lowest = Math.min(lowest, run.duel.toriHealth);
      return resolved(event.phase);
    }, 20);
    expect(event.phase).toBe('pinned');
    expect(lowest).toBe(1);
    expect(run.events).not.toContain('down');
  });

  it('처음에는 사건 전에 상대도 쓰러지지 않고, 체력이 1이 되면 사건이 바로 온다', () => {
    const run = fight('B', { event: { ...DROP, trigger: { fightSeconds: 60 } } });
    run.seconds(FIXED_DT);
    run.foe.hurt(1000, 0, run.center.x);
    expect(run.foe.health).toBe(1);
    run.seconds(2 * FIXED_DT);
    expect(run.sim.scripted[0].phase).toBe('warning');
    expect(run.duel.phase).toBe('fighting');
  });

  it('회귀한 뒤 또 깔렸을 때 자르지 않기로 하면, 버둥거려도 자르지 않고 잠깐 뒤 기록관 앞으로 돌아가 다시 한다', () => {
    const config = { ...PASSIVE, 'scripted.repinCuts': false };
    const run = fight('B', { config, initial: { rewinds: 1, sectionsLeft: 2 } });
    const links = run.sim.tori.tail.links.length;
    watch(run, resolved, 12);
    expect(run.duel.pinned).toBe(true);
    expect(run.duel.count).toBeNull();
    run.seconds(DEFAULTS.scripted.retrySeconds + 0.1, alternateKeys(run));
    expect(run.events).not.toContain('cut');
    expect(run.events).toContain('rewind');
    expect(run.sim.state).toMatchObject({ rewinds: 1, sectionsLeft: 2 });
    expect(run.sim.tori.tail.links.length).toBe(links);
    expect(Math.abs(run.center.x - RECORDER.stand.x)).toBeLessThan(0.5);
    expect(run.sim.dialogue?.text).toBe(RECORDER.line);
  });

  it('깔렸을 때 심판이 세지 않게 하면 카운트가 끝날 시간이 지나도 탈락하지 않는다', () => {
    const run = fight('B', { config: { ...PASSIVE, 'scripted.pinCount': false } });
    watch(run, resolved, 12);
    run.seconds(DEFAULTS.duel.countTo * DEFAULTS.duel.countSeconds + 0.5);
    expect(run.duel).toMatchObject({ phase: 'downed', pinned: true, count: null });
    expect(run.sim.eliminated).toBe(false);
  });

  it('예고 시간이 0인 사건은 방을 만들 때 오류다', () => {
    const config = cloneConfig(DEFAULTS);
    config.scripted.warnSeconds = 0;
    expect(() => new Simulation(config, duelRoom({ events: [DROP] }), 'B')).toThrow();
  });
});
