import { DEMO, surveyLink } from '../config/demo';
import type { Scheme } from '../config/presets';
import type { Dialogue } from '../sim/recorder';
import type { SystemCommands } from '../view/inputReader';
import { COMMON_KEYS, keyList, SCHEME_GUIDES, systemKeys } from './controlsGuide';
import { button as makeButton, element } from './dom';

const TOAST_MS = 2500;
/** 탈락했을 때의 글. 엔딩 글은 기획이 정하므로 자리표시다(CLAUDE.md의 반드시 지킬 것 1번). */
const BAD_ENDING_TEXT = '배드엔딩 글 1';

/** 전광판에 띄울 것. 체력은 0~1이다. 앞이 토리, 뒤가 상대다. */
export interface Scoreboard {
  numbers: readonly [string, string];
  health: readonly [number, number];
}

type ToggleName = 'debug' | 'panel' | 'help';

const BUTTONS: { name: ToggleName; command: 'toggleDebug' | 'togglePanel' | 'toggleHelp'; label: string; key: string; tooltip: string }[] = [
  { name: 'debug', command: 'toggleDebug', label: '디버그', key: 'F1', tooltip: '물리 디버그 그리기' },
  { name: 'panel', command: 'togglePanel', label: '패널', key: 'F2', tooltip: '튜닝 패널 열고 닫기' },
  { name: 'help', command: 'toggleHelp', label: '도움말', key: 'F3', tooltip: '조작 도움말 열고 닫기' },
];

/** 화면 구석의 단추, 빌드 버전, 도움말, 일시정지 창, 짧은 알림, 대화 상자. 게임 화면 위에 DOM으로 올린다. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly debug: boolean;
  private readonly pausePanel = element('div', 'hud-pause');
  private readonly buttons = new Map<ToggleName, HTMLButtonElement>();
  private readonly status = element('div', 'hud-status');
  private readonly help = element('div', 'hud-help');
  private readonly toast = element('div', 'hud-toast');
  private readonly copyBox = element('div', 'hud-copy');
  private readonly copyText = element('textarea', '');
  private readonly dialogue = element('div', 'dialogue');
  private readonly speaker = element('p', 'dialogue-speaker');
  private readonly line = element('p', 'dialogue-line');
  private readonly board = element('div', 'scoreboard');
  private readonly boardNumbers = [element('p', 'score-number'), element('p', 'score-number')] as const;
  private readonly boardFills = [element('div', 'score-fill'), element('div', 'score-fill')] as const;
  private readonly count = element('div', 'referee-count');
  private readonly ending = element('div', 'bad-ending');
  private readonly demoEnd = element('div', 'bad-ending demo-end');
  private shownDialogue: Dialogue | null = null;
  private shownBoard = '';
  private shownCount: number | null = null;
  private toastTimer = 0;

  /** debug가 꺼져 있으면 도움말의 디버그 키와 일시정지 창의 "처음부터"를 뺀다(PLAN 7.10) */
  constructor(root: HTMLElement, commands: SystemCommands, debug: boolean) {
    this.root = root;
    this.debug = debug;
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

    this.pausePanel.append(element('h2', '', '일시정지'), makeButton('계속하기', 'hud-button', () => commands.togglePause()));
    if (debug) this.pausePanel.append(makeButton('처음부터', 'hud-button', () => commands.restartRoom()));
    this.pausePanel.append(makeButton('첫 화면으로', 'hud-button', () => commands.toStart()));
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

    // 대사를 넘기는 키(E)는 첫 화면과 도움말에만 적고, 상자에는 넘길 수 있다는 표시만 둔다(PLAN 2.5)
    this.dialogue.append(this.speaker, this.line, element('span', 'dialogue-next', '▼'));
    this.dialogue.setAttribute('aria-live', 'polite');
    this.dialogue.hidden = true;

    // 전광판은 두 참가자의 번호와 체력바만 보여 준다. 문장은 넣지 않는다(PLAN 7.6).
    this.boardNumbers.forEach((number, i) => {
      const side = element('div', 'score');
      const bar = element('div', 'score-bar');
      bar.append(this.boardFills[i]);
      side.append(number, bar);
      this.board.append(side);
    });
    this.board.hidden = true;
    // 심판 카운트는 숫자 하나만 크게 띄운다(PLAN 7.6)
    this.count.hidden = true;
    this.count.setAttribute('aria-live', 'assertive');
    this.ending.append(element('p', '', BAD_ENDING_TEXT), makeButton('처음부터', 'hud-button', () => commands.restartRoom()));
    this.ending.hidden = true;
    this.buildDemoEnd(commands);

    root.replaceChildren(
      bar,
      this.board,
      this.count,
      this.help,
      this.dialogue,
      this.ending,
      this.demoEnd,
      this.pausePanel,
      this.toast,
      this.copyBox,
      this.status,
    );
  }

  /** 결투 중에만 화면 위쪽에 전광판을 띄운다. 프레임마다 불러도 바뀔 때만 고친다. */
  showScoreboard(board: Scoreboard | null): void {
    const key = board ? `${board.numbers.join('|')}|${board.health.map((h) => h.toFixed(3)).join('|')}` : '';
    if (key === this.shownBoard) return;
    this.shownBoard = key;
    this.board.hidden = board === null;
    if (!board) return;
    board.numbers.forEach((number, i) => {
      this.boardNumbers[i].textContent = number;
      this.boardFills[i].style.width = `${Math.round(Math.min(1, Math.max(0, board.health[i])) * 1000) / 10}%`;
    });
  }

  /** 쓰러져 있는 동안 심판이 세는 숫자. 숫자가 바뀔 때마다 다시 튀어나온다. */
  showCount(count: number | null): void {
    if (count === this.shownCount) return;
    this.shownCount = count;
    this.count.hidden = count === null;
    if (count === null) return;
    this.count.textContent = String(count);
    this.count.classList.remove('pop');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
  }

  /** 탈락했을 때의 배드엔딩 화면(PLAN 7.6). 3단계 전까지는 자리표시 글과 처음부터 단추만 둔다. */
  showEnding(shown: boolean): void {
    if (this.ending.hidden !== shown) return;
    this.ending.hidden = !shown;
  }

  /** 체험판의 마지막 결투를 이겼을 때의 "체험판 끝" 화면(PLAN 7.9) */
  showDemoEnd(shown: boolean): void {
    if (this.demoEnd.hidden !== shown) return;
    this.demoEnd.hidden = !shown;
  }

  /**
   * "체험판 끝" 화면. 설문 주소(config/demo.ts)가 있으면 설문 단추를 둔다. 설문은 새 탭에서 열리므로 단추에 바깥 화살표를 달고,
   * 누르기 전에 열릴 주소를 단추 밑에 보여 준다(PLAN 7.9).
   */
  private buildDemoEnd(commands: SystemCommands): void {
    this.demoEnd.append(element('p', '', '체험판 끝'));
    const survey = surveyLink(DEMO.surveyUrl);
    if (survey) {
      const link = element('a', 'hud-button survey-link');
      link.href = survey.href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = survey.href;
      link.setAttribute('aria-label', '설문 열기, 새 탭');
      link.append('설문 열기', element('span', 'external', '↗'));
      this.demoEnd.append(link, element('p', 'survey-url', survey.shown));
    }
    this.demoEnd.append(makeButton('첫 화면으로', 'hud-button', () => commands.toStart()));
    this.demoEnd.hidden = true;
  }

  /** 기록관의 대사를 띄우거나 닫는다. 프레임마다 불러도 바뀔 때만 고친다. */
  showDialogue(dialogue: Dialogue | null): void {
    if (dialogue === this.shownDialogue) return;
    this.shownDialogue = dialogue;
    this.dialogue.hidden = dialogue === null;
    if (!dialogue) return;
    this.speaker.textContent = dialogue.speaker;
    this.line.textContent = dialogue.text;
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
      keyList(COMMON_KEYS),
      element('h3', '', `꼬리 ${scheme}. ${title}`),
      element('p', '', summary),
      keyList(keys),
      element('h3', '', '화면'),
      keyList(systemKeys(this.debug)),
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
