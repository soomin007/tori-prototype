import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULTS, getParam, PARAM_META, paramPaths } from '../src/config/defaults';
import { buildShareUrl, parseShare } from '../src/config/share';

const PAGE = 'https://example.test/tori/?scheme=B&cfg=old#top';
const cfg = (value: unknown): string => `?cfg=${btoa(JSON.stringify(value)).replace(/=+$/, '')}`;

describe('설정', () => {
  it('모든 설정값이 튜닝 패널 목록에 있고 기본값이 범위 안에 있다', () => {
    expect(Object.keys(PARAM_META).sort()).toEqual(paramPaths().sort());
    for (const path of paramPaths()) {
      const value = getParam(DEFAULTS, path);
      if (typeof value !== 'number') continue;
      const { min, max } = PARAM_META[path];
      expect(value, path).toBeGreaterThanOrEqual(min as number);
      expect(value, path).toBeLessThanOrEqual(max as number);
    }
  });
});

describe('공유 링크', () => {
  it('바꾼 값을 링크로 만들었다가 읽으면 그대로다', () => {
    const config = cloneConfig(DEFAULTS);
    config.physics.gravity = 3.5;
    config.view.interpolate = false;
    const session = { scheme: 'B' as const, room: 3, config };
    const url = new URL(buildShareUrl(PAGE, session));
    expect(url.origin + url.pathname).toBe('https://example.test/tori/');
    expect(parseShare(url.search)).toEqual(session);
  });

  it('기본값과 다른 항목만 넣는다', () => {
    const config = cloneConfig(DEFAULTS);
    const plain = new URL(buildShareUrl(PAGE, { scheme: 'A', room: 1, config }));
    expect(plain.searchParams.has('cfg')).toBe(false);

    config.physics.gravity = 20;
    const changed = new URL(buildShareUrl(PAGE, { scheme: 'A', room: 1, config }));
    expect(JSON.parse(atob(changed.searchParams.get('cfg') as string))).toEqual({ 'physics.gravity': 20 });
  });

  it('모르는 항목, 형이 다른 값, 깨진 값은 무시한다', () => {
    const search = cfg({ 'physics.gravity': 12, 'old.removed': 1, 'physics.solverIterations': 'many' });
    const expected = cloneConfig(DEFAULTS);
    expected.physics.gravity = 12;
    expect(parseShare(search).config).toEqual(expected);

    for (const broken of ['?cfg=%%%', '?cfg=abc', cfg(null), cfg([1]), cfg(7)]) {
      expect(parseShare(broken).config).toEqual(DEFAULTS);
    }
    expect(parseShare('?scheme=Z&room=9')).toMatchObject({ scheme: 'A', room: 1 });
  });

  it('범위를 벗어난 값은 범위 안으로 자른다', () => {
    const { config } = parseShare(cfg({ 'physics.solverIterations': 1e9, 'testBoxes.count': 2.4 }));
    expect(config.physics.solverIterations).toBe(PARAM_META['physics.solverIterations'].max);
    expect(config.testBoxes.count).toBe(2);
  });
});
