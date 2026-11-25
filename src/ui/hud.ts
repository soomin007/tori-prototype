import type { Scheme } from '../config/presets';
import type { SystemCommands } from '../view/inputReader';
import { keyList, MOVE_KEYS, SCHEME_GUIDES, SYSTEM_KEYS } from './controlsGuide';
import { button as makeButton, element } from './dom';

const TOAST_MS = 2500;

type ToggleName = 'debug' | 'panel' | 'help';

const BUTTONS: { name: ToggleName; command: 'toggleDebug' | 'togglePanel' | 'toggleHelp'; label: string; key: string; tooltip: string }[] = [
  { name: 'debug', command: 'toggleDebug', label: '디버그', key: 'F1', tooltip: '물리 디버그 그리기' },
  { name: 'panel', command: 'togglePanel', label: '패널', key: 'F2', tooltip: '튜닝 패널 열고 닫기' },
  { name: 'help', command: 'toggleHelp', label: '도움말', key: 'F3', tooltip: '조작 도움말 열고 닫기' },
];

/** 화면 구석의 단추, 빌드 버전, 도움말, 일시정지 창, 짧은 알림. 게임 화면 위에 DOM으로 올린다. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly pausePanel = element('div', 'hud-pause');
  private readonly buttons = new Map<ToggleName, HTMLButtonElement>();
  private readonly status = element('div', 'hud-status');
  private readonly help = element('div', 'hud-help');
  private readonly toast = element('div', 'hud-toast');
  private readonly copyBox = element('div', 'hud-copy');
  private readonly copyText = element('textarea', '');
  private toastTimer = 0;

  constructor(root: HTMLElement, commands: SystemCommands) {
    this.root = root;
    const bar = element('div', 'hud-bar');
    for (const { name, command, label, key, tooltip } of BUTTONS) {
      const button = element('button', 'hud-button');
      button.type = 'button';
      button.title = tooltip;
      button.append(label, element('kbd', '', key));
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => commands[command]());
      this.buttons.set(name, button);
      bar.append(button);
    }

    this.pausePanel.append(
      element('h2', '', '일시정지'),
      makeButton('계속하기', 'hud-button', () => commands.togglePause()),
      makeButton('방 처음부터', 'hud-button', () => commands.restartRoom()),
      makeButton('첫 화면으로', 'hud-button', () => commands.toStart()),
    );
    this.pausePanel.hidden = true;
    this.help.hidden = true;
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');

    const close = element('button', 'hud-button', '닫기');
    close.type = 'button';
    close.addEventListener('click', () => {
      this.copyBox.hidden = true;
    });
    this.copyText.readOnly = true;
    this.copyText.rows = 6;
    this.copyBox.append(
      element('p', '', '복사하지 못했습니다.'),
      element('p', '', '아래 내용을 직접 복사해 주세요.'),
      this.copyText,
      close,
    );
    this.copyBox.hidden = true;

    root.replaceChildren(bar, this.help, this.pausePanel, this.toast, this.copyBox, this.status);
  }

  destroy(): void {
    window.clearTimeout(this.toastTimer);
    this.root.replaceChildren();
  }

  setPaused(paused: boolean): void {
    this.pausePanel.hidden = !paused;
  }

  setToggle(name: ToggleName, on: boolean): void {
    this.buttons.get(name)?.setAttribute('aria-pressed', String(on));
  }

  /** 팀원이 어느 버전을 해 봤는지 말할 수 있게 늘 보여 준다 */
  setStatus(version: string, scheme: Scheme, room: number): void {
    this.status.textContent = `${version} · 방 ${room} · 조작 ${scheme}`;
    const { title, summary, keys } = SCHEME_GUIDES[scheme];
    this.help.replaceChildren(
      element('h2', '', '조작 도움말'),
      keyList(MOVE_KEYS),
      element('h3', '', `꼬리 ${scheme}. ${title}`),
      element('p', '', summary),
      keyList(keys),
      element('h3', '', '화면'),
      keyList(SYSTEM_KEYS),
    );
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
    this.setToggle('help', !this.help.hidden);
  }

  /** 클립보드가 막혔을 때 직접 복사할 수 있게 내용을 골라 놓은 채로 보여 준다 */
  showCopyFallback(text: string): void {
    this.copyText.value = text;
    this.copyBox.hidden = false;
    this.copyText.select();
  }

  notify(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, TOAST_MS);
  }
}
