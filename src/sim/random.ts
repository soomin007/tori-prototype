/**
 * 씨앗을 고정한 난수(mulberry32). 같은 씨앗이면 같은 수열이 나와, 결투 상대가 같은 입력에 같은 결투를 한다(PLAN 7.7).
 * 0 이상 1 미만의 수를 준다.
 */
export function seededRandom(seed: number): () => number {
  let state = Math.floor(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
