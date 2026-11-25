import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** Phaser를 쓰면 안 되는 폴더. 아직 없는 폴더는 건너뛴다. */
const PURE_FOLDERS = ['physics', 'tori', 'state', 'sim', 'rooms', 'config'];
const SRC = join(import.meta.dirname, '../src');

const sourceFiles = PURE_FOLDERS.map((folder) => join(SRC, folder))
  .filter((folder) => existsSync(folder))
  .flatMap((folder) =>
    readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(folder, name)),
  );

it('시뮬레이션 쪽 폴더는 Phaser를 import하지 않는다', () => {
  // 폴더 이름이 바뀌어 아무것도 검사하지 않고 통과하는 일을 막는다
  expect(sourceFiles.length).toBeGreaterThan(0);

  // phaser를 직접 가져오는 것과, Phaser를 쓰는 폴더를 거쳐 들어오는 것까지 본다
  const forbidden = /(?:from|import)\s*\(?\s*['"](?:phaser|(?:\.\.\/)+(?:view|scenes|ui)\/)/;
  const offenders = sourceFiles.filter((file) => forbidden.test(readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});
