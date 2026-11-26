import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from './config/defaults';
import { parseShare } from './config/share';
import { initPhysics } from './physics/world';
import { BootScene } from './scenes/BootScene';
import { RoomScene } from './scenes/RoomScene';
import { StartScene } from './scenes/StartScene';

async function start(): Promise<void> {
  await initPhysics();
  // 팀용 주소(main)의 빌드는 디버그 키를 끈 채로 연다. 주소에 ?debug=1을 붙이면 켜진다(PLAN 7.10).
  const session = parseShare(location.search, !__BUILD_VERSION__.startsWith('main'));
  new Phaser.Game({
    type: Phaser.WEBGL,
    backgroundColor: '#20262d',
    scale: {
      parent: 'game',
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
    },
    // 프레임 시간을 다듬지 않은 값으로 받는다. 고정 스텝과 보간은 physics/world.ts가 한다.
    fps: { smoothStep: false },
    // 키는 view/inputReader.ts가 KeyboardEvent.code로 직접 받는다
    input: { keyboard: false },
    // 소리는 발표용 스테이지에서 넣는다
    audio: { noAudio: true },
    banner: false,
    scene: [new BootScene(), new StartScene(session), new RoomScene(session)],
  });
}

start().catch((error: unknown) => {
  console.error(error);
  document.getElementById('load-error')?.classList.add('shown');
});
