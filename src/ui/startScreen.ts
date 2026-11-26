import { SCHEMES } from '../config/presets';
import type { Scheme } from '../config/presets';
import { COMMON_KEYS, keyList, SCHEME_GUIDES } from './controlsGuide';
import { button, element } from './dom';

/** 첫 화면. 꼬리 조작 방식을 고르고 키 안내를 본다. */
export class StartScreen {
  private readonly root: HTMLElement;

  /** current는 링크나 지난 판에서 고른 방식이다. 처음에 그 단추에 초점을 둔다. */
  constructor(root: HTMLElement, current: Scheme, version: string, onChoose: (scheme: Scheme) => void) {
    this.root = root;
    const panel = element('div', 'start');
    const intro = element('p', 'start-intro');
    // 좁은 화면에서도 문장 단위로 줄이 나뉜다
    intro.append(
      element('span', 'nw', '꼬리 조작 방식을 선택해 주세요.'),
      ' ',
      element('span', 'nw', '게임 중에도 튜닝 패널에서 바꿀 수 있습니다.'),
    );
    panel.append(element('h1', '', '토리 프로토타입'), intro);

    const cards = element('div', 'start-cards');
    let focused: HTMLButtonElement | null = null;
    for (const scheme of SCHEMES) {
      const { title, summary, keys } = SCHEME_GUIDES[scheme];
      const card = element('section', 'start-card');
      const start = button(`${scheme}로 시작하기`, 'start-button', () => onChoose(scheme));
      card.append(element('h2', '', `${scheme}. ${title}`), element('p', '', summary), keyList(keys), start);
      cards.append(card);
      if (scheme === current) focused = start;
    }

    const common = element('section', 'start-common');
    common.append(keyList(COMMON_KEYS));
    panel.append(
      cards,
      common,
      element('p', 'start-note', '조작 방식은 아직 정하지 않았습니다. 둘 다 해 보고 비교해 주세요.'),
      element('p', 'start-version', version),
    );
    root.replaceChildren(panel);
    focused?.focus();
  }

  destroy(): void {
    this.root.replaceChildren();
  }
}
