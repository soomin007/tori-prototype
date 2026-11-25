import GUI from 'lil-gui';
import { GROUP_LABELS, PARAM_META, paramPaths, resolveParam } from '../config/defaults';
import type { GameConfig, ParamMeta } from '../config/defaults';
import { SCHEMES, switchScheme } from '../config/presets';
import type { Scheme } from '../config/presets';
import { buildShareUrl } from '../config/share';
import type { Session } from '../config/share';

const PANEL_WIDTH = 320;

export interface PanelHooks {
  /** 설정값이 바뀐 직후 */
  onParamChange(meta: ParamMeta): void;
  onSchemeChange(): void;
  onRestart(): void;
  notify(message: string): void;
  /** 브라우저가 클립보드를 막았을 때 */
  showCopyFallback(text: string): void;
}

/** 설정값 전부를 실행 중에 바꾸는 패널. 항목은 config/defaults.ts의 표를 따라 저절로 생긴다. */
export class TuningPanel {
  private readonly gui = new GUI({ title: '튜닝 패널', width: PANEL_WIDTH });
  private readonly stats = { fps: 0 };

  constructor(session: Session, hooks: PanelHooks) {
    this.gui.add(this.stats, 'fps').name('FPS').decimals(0).disable().listen();

    const schemeModel = { scheme: session.scheme };
    this.gui
      .add(schemeModel, 'scheme', [...SCHEMES])
      .name('꼬리 조작 방식')
      .onChange((next: Scheme) => {
        switchScheme(session.config, session.scheme, next);
        session.scheme = next;
        this.gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
        hooks.onSchemeChange();
      });

    const actions = {
      restart: () => hooks.onRestart(),
      copyLink: () => copy(buildShareUrl(location.href, session), '링크를 복사했습니다.', hooks),
      copyJson: () => {
        const { scheme, room, config } = session;
        return copy(JSON.stringify({ scheme, room, config }, null, 2), '설정 JSON을 복사했습니다.', hooks);
      },
    };
    this.gui.add(actions, 'restart').name('방 처음부터 (R)');
    this.gui.add(actions, 'copyLink').name('지금 설정으로 링크 복사');
    this.gui.add(actions, 'copyJson').name('설정 JSON 복사');

    this.addParams(session.config, hooks);
    this.gui.hide();
  }

  get visible(): boolean {
    return !this.gui._hidden;
  }

  toggle(): void {
    this.gui.show(!this.visible);
  }

  setFps(fps: number): void {
    this.stats.fps = fps;
  }

  private addParams(config: GameConfig, hooks: PanelHooks): void {
    const folders = new Map<string, GUI>();
    for (const path of paramPaths()) {
      const group = path.split('.')[0] as keyof GameConfig;
      const folder = folders.get(group) ?? this.gui.addFolder(GROUP_LABELS[group]);
      folders.set(group, folder);

      const meta = PARAM_META[path];
      const { section, key } = resolveParam(config, path);
      folder
        .add(section, key, meta.min, meta.max, meta.step)
        .name(meta.label)
        .onChange(() => hooks.onParamChange(meta));
    }
  }
}

async function copy(text: string, done: string, hooks: PanelHooks): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    hooks.notify(done);
  } catch {
    hooks.showCopyFallback(text);
  }
}
