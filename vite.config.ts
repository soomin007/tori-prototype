import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** 커밋 해시 앞 7자리. git이 없는 곳에서 빌드해도 멈추지 않는다. */
function commitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 7);
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    // 개발 서버는 아직 커밋하지 않은 코드일 수 있어 뒤에 -dev를 붙인다
    __BUILD_VERSION__: JSON.stringify(command === 'serve' ? `${commitHash()}-dev` : commitHash()),
  },
  build: {
    // Phaser와 Rapier(WASM 포함)가 커서 기본 경고 기준(500kB)을 늘 넘는다
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
