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

/** 어느 주소의 빌드인지. 배포할 때 deploy.yml이 main이나 dev를 넣고, 이 PC에서 띄우면 local이다. */
const channel = process.env.CHANNEL || 'local';

export default defineConfig({
  base: './',
  define: {
    __BUILD_VERSION__: JSON.stringify(`${channel} ${commitHash()}`),
  },
  build: {
    // Phaser와 Rapier(WASM 포함)가 커서 기본 경고 기준(500kB)을 늘 넘는다
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 배포하는 컴퓨터는 이 PC보다 두 배쯤 느리다(known-issues 16번)
    testTimeout: 30_000,
  },
});
