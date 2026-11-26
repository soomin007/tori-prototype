import RAPIER from '@dimforge/rapier2d-compat';
import { abilitiesFor } from '../config/abilities';
import type { Abilities } from '../config/abilities';
import { FIXED_DT } from '../config/defaults';
import type { GameConfig } from '../config/defaults';
import { DEFAULT_SCHEME } from '../config/presets';
import type { Scheme } from '../config/presets';
import { groundProbeGroups } from '../physics/groups';
import { FixedStepper, PhysicsWorld } from '../physics/world';
import type { Pose } from '../physics/world';
import { roomByNumber } from '../rooms/rooms';
import type { Point, RoomData } from '../rooms/rooms';
import { takeCheckpoint } from '../state/checkpoints';
import type { Checkpoint } from '../state/checkpoints';
import { createGameState } from '../state/gameState';
import type { GameState } from '../state/gameState';
import { canCut, rewindState, RewindSequence } from '../state/rewind';
import { Tori } from '../tori/body';
import type { TailController } from '../tori/controllers/aim';
import { AutoTail } from '../tori/controllers/autoTail';
import { MouseTail } from '../tori/controllers/mouseTail';
import type { SeveredTail } from '../tori/tail';
import type { Duel, DuelEvent } from './duel';
import { clearMomentary, createInputState } from './inputState';
import type { InputState } from './inputState';
import type { Dialogue, Recorder } from './recorder';
import { Room } from './roomBuilder';
import type { SimObject } from './roomBuilder';
import { Strikes } from './strike';

/** 그리기 쪽이 연출을 붙일 일. 체크포인트가 생긴 것은 화면에 알리지 않으므로 없다(PLAN 7.8). */
export type SimEvent = 'cut' | 'rewind' | DuelEvent;

/**
 * 월드, 방, 토리, 게임 상태를 묶어 한 스텝씩 진행한다. 화면 없이도 돈다.
 * 상태는 방을 다시 만들어도 남는다. 회귀는 상태를 고친 뒤 방을 다시 만든다(PLAN 7.4).
 * 만들기 전에 physics/world.ts의 initPhysics()를 기다려야 한다.
 */
export class Simulation {
  roomData: RoomData;
  /** 게임 상태(state/schema.ts). 처음부터 하기(R)만 새로 만든다. */
  state: GameState;
  /** 마지막 체크포인트. 기록관에게 한 번도 말을 걸지 않았으면 처음 상태다. */
  checkpoint: Checkpoint;
  /** 화면에 띄운 기록관의 대사. 대화 중에는 이동과 꼬리 입력을 막는다. */
  dialogue: Dialogue | null = null;
  /** 떼어 내 꿈틀거리는 꼬리. 방을 다시 만들 때 사라진다. */
  severed: SeveredTail[] = [];
  tori!: Tori;
  controller!: TailController;
  strikes!: Strikes;
  /** 남은 구간의 능력표 줄(PLAN 7.5). 남은 구간이 바뀌면 방을 다시 만들므로 그때 다시 읽는다. */
  abilities!: Abilities;
  /** 방을 다시 만들 때마다 1씩 커진다. 그리기 쪽은 이 값이 바뀌면 그림을 다시 만든다. */
  generation = 0;
  stepCount = 0;

  private scheme: Scheme;
  private readonly config: GameConfig;
  private readonly stepper = new FixedStepper();
  private readonly sequence = new RewindSequence();
  private readonly events: SimEvent[] = [];
  /** 회귀로 돌아갈 수 있게 들어가 본 방을 번호로 기억한다. 테스트용 방은 ROOMS에 없다. */
  private readonly knownRooms = new Map<number, RoomData>();
  /** 막은 입력. 대화를 시작할 때 잡고 있던 것만 이어서 잡는다. */
  private readonly blockedInput = createInputState();
  private keptGrab = { grab: false, pointerGrab: false };
  /** 상태를 만들 때의 tail.sections. 패널에서 구간 수를 바꾸면 자른 횟수를 그대로 두고 맞춘다. */
  private fullSections: number;
  private cutHold = 0;
  private cutLatched = false;
  private physics!: PhysicsWorld;
  private room!: Room;

  /** initial로 새 판의 상태를 바꾼다(예: 남은 꼬리 구간). 방 번호는 roomData를 따른다. */
  constructor(
    config: GameConfig,
    roomData: RoomData = roomByNumber(1),
    scheme: Scheme = DEFAULT_SCHEME,
    initial: Partial<GameState> = {},
  ) {
    this.config = config;
    this.roomData = roomData;
    this.scheme = scheme;
    this.knownRooms.set(roomData.number, roomData);
    this.fullSections = config.tail.sections;
    this.state = createGameState({ sectionsLeft: config.tail.sections, ...initial, room: roomData.number });
    this.checkpoint = takeCheckpoint(this.state);
    this.build(roomData.spawn);
  }

  get objects(): readonly SimObject[] {
    return this.room.objects;
  }

  get recorders(): readonly Recorder[] {
    return this.room.recorders;
  }

  get duels(): readonly Duel[] {
    return this.room.duels;
  }

  /** 지금 화면에 보여 줄 결투. 결투 밖이거나 이긴 뒤면 없다. */
  get duel(): Duel | null {
    return this.room.duels.find((duel) => duel.active || duel.phase === 'cut' || duel.phase === 'lost') ?? null;
  }

  /** 결투에서 져서 탈락했는지. 배드엔딩 화면을 띄운다(PLAN 7.6). */
  get eliminated(): boolean {
    return this.room.duels.some((duel) => duel.phase === 'lost');
  }

  /** 디버그 그리기용 Rapier 월드 */
  get world(): RAPIER.World {
    return this.physics.raw;
  }

  /** 꼬리가 잘린 뒤 회귀하기 전까지 */
  get rewinding(): boolean {
    return this.sequence.active;
  }

  /** 말을 걸 수 있는 기록관. 대화 중이거나 회귀 연출 중이면 없다. */
  get nearRecorder(): Recorder | null {
    if (this.dialogue || this.sequence.active) return null;
    const center = this.tori.torso.translation();
    return this.room.recorders.find((recorder) => recorder.hears(center, this.config)) ?? null;
  }

  /** 디버그 키 Q를 누른 정도(0~1). 자를 수 없으면 0이다. */
  get cutHoldProgress(): number {
    if (this.cutLatched || this.sequence.active || !canCut(this.state)) return 0;
    return Math.min(1, this.cutHold / Math.max(this.config.cut.holdSeconds, FIXED_DT));
  }

  /** 꼬리 조작 방식을 바꾼다. 방은 그대로 둔다. */
  setScheme(scheme: Scheme): void {
    this.scheme = scheme;
    this.controller = createController(scheme);
  }

  /** 다른 방으로 옮긴다. 상태는 그대로 두고 방 번호만 바꾼다. */
  enterRoom(roomData: RoomData): void {
    this.settleRewind();
    this.knownRooms.set(roomData.number, roomData);
    this.roomData = roomData;
    this.state.room = roomData.number;
    this.stepper.reset();
    this.rebuildWorld(roomData.spawn);
  }

  free(): void {
    this.physics.free();
  }

  /** 처음부터(R). 방을 처음 배치로 다시 만들고 상태와 체크포인트도 새 판으로 돌린다(PLAN 7.10). */
  reset(): void {
    this.sequence.stop();
    this.fullSections = this.config.tail.sections;
    this.state = createGameState({ sectionsLeft: this.fullSections, room: this.roomData.number });
    this.checkpoint = takeCheckpoint(this.state);
    this.stepper.reset();
    this.rebuildWorld(this.roomData.spawn);
  }

  /** 튜닝 패널에서 다시 만들어야 하는 값을 바꿨을 때. 상태는 그대로 두고 방을 처음 배치로 다시 만든다. */
  rebuild(): void {
    this.fitSections();
    this.stepper.reset();
    if (this.sequence.active) this.finishRewind();
    else this.rebuildWorld(this.roomData.spawn);
  }

  /** 튜닝 패널에서 바뀐 값을 지금 있는 물체에 반영한다 */
  applyConfig(): void {
    this.physics.applyConfig(this.config);
    this.room.applyMaterials(this.config);
    this.tori.applyConfig();
  }

  /**
   * 자르기 계기. 꼬리 끝 구간을 떼어 내고 회귀 연출을 시작한다. 디버그 키 Q와 버둥거림 게이지(묶음 나)가 부른다.
   * 남은 구간이 0이거나 이미 연출 중이면 아무 일도 일어나지 않고 false를 준다.
   */
  cutTail(): boolean {
    if (this.sequence.active || !canCut(this.state)) return false;
    const piece = this.tori.cutTail();
    if (!piece) return false;
    this.severed.push(piece);
    this.dialogue = null;
    this.sequence.start();
    for (const duel of this.room.duels) duel.markCut();
    this.events.push('cut');
    return true;
  }

  /** 쌓인 일을 꺼낸다. 그리기 쪽이 프레임마다 부른다. */
  drainEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  /** 프레임 시간만큼 진행한다 */
  advance(frameSeconds: number, input: InputState): void {
    this.stepper.advance(frameSeconds, this.config.physics.maxStepsPerFrame, () => this.step(input));
  }

  /** 고정 스텝 한 번 */
  step(input: InputState): void {
    this.holdCutKey(input);
    this.handleTalk(input);
    this.stepDuels(input);
    const live = this.liveInput(input);
    const { tori, config } = this;
    const command = this.controller.update(live, { tori, config, grabbables: this.room.grabbables });
    tori.step(live, command);
    for (const piece of this.severed) piece.drive();
    const foes = this.room.duels.flatMap(({ target }) => (target ? [target] : []));
    this.strikes.before(tori, this.objects, foes);
    this.physics.step();
    this.stepCount += 1;
    this.strikes.after(this.world, tori, this.objects, config, this.stepCount, foes, this.abilities.whipPower);
    for (const duel of this.room.duels) duel.afterStep(tori, this.state);
    // 방을 다시 만들면 지금 월드를 지우므로 스텝의 맨 끝에서 한다
    if (this.sequence.advance(FIXED_DT, config.cut.rewindSeconds)) this.finishRewind();
    // 한 프레임에 여러 스텝이 돌아도 누른 순간은 한 번만 쓴다. 스텝이 돌지 않은 프레임의 입력은 다음까지 남는다.
    clearMomentary(input);
  }

  /** 지금 그릴 자세 */
  poseOf(body: RAPIER.RigidBody): Pose {
    return this.physics.poseOf(body, this.config.view.interpolate ? this.stepper.alpha : 1);
  }

  /** 바디 안의 점이 지금 그려질 자리 */
  pointOf(body: RAPIER.RigidBody, local: Point): Point {
    const { x, y, angle } = this.poseOf(body);
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x: x + local.x * cos - local.y * sin, y: y + local.x * sin + local.y * cos };
  }

  /** (x, y)에서 아래로 maxDistance까지 디딜 바닥을 찾아 그 y를 준다. 다리 그림이 쓴다. */
  groundBelow(x: number, y: number, maxDistance: number): number | null {
    const ray = new RAPIER.Ray({ x, y }, { x: 0, y: 1 });
    const hit = this.world.castRay(ray, maxDistance, true, undefined, groundProbeGroups());
    return hit ? y + hit.timeOfImpact : null;
  }

  // ---- 기록관 ----

  /** E를 누르면 가까운 기록관에게 말을 걸고, 대화 중이면 대사를 닫는다 */
  private handleTalk(input: InputState): void {
    if (!input.pressed.interact || this.sequence.active) return;
    if (this.dialogue) {
      this.dialogue = null;
      return;
    }
    const recorder = this.nearRecorder;
    if (recorder) this.talk(recorder, input);
  }

  /** 말을 건다. 문을 열고 그 순간의 timeline을 체크포인트로 남긴다. 체크포인트가 생긴 것은 알리지 않는다. */
  private talk(recorder: Recorder, input: InputState): void {
    const { state } = this;
    state.recorder = recorder.id;
    if (!state.talkedTo.includes(recorder.id)) state.talkedTo.push(recorder.id);
    recorder.openDoor();
    this.checkpoint = takeCheckpoint(state);
    this.dialogue = recorder.dialogue();
    this.keptGrab = { grab: input.held.grab, pointerGrab: input.held.pointerGrab };
  }

  // ---- 결투 ----

  /** 결투를 한 스텝 진행한다. 쓰러져 버둥거린 게이지가 다 차면 꼬리를 자른다(PLAN 7.6의 자르기 계기). */
  private stepDuels(input: InputState): void {
    for (const duel of this.room.duels) {
      if (duel.beforeStep(this.tori, input, canCut(this.state))) this.cutTail();
    }
  }

  /** 대화 중, 회귀 연출 중, 결투에서 맞아 경직됐거나 쓰러져 있을 때는 이동과 꼬리 입력을 막는다 */
  private liveInput(input: InputState): InputState {
    const held = this.room.duels.some((duel) => duel.holdsTori);
    if (!this.dialogue && !this.sequence.active && !held) return input;
    const talking = this.dialogue !== null;
    this.blockedInput.held.grab = talking && this.keptGrab.grab;
    this.blockedInput.held.pointerGrab = talking && this.keptGrab.pointerGrab;
    return this.blockedInput;
  }

  // ---- 자르기와 회귀 ----

  /** 디버그 키 Q를 cut.holdSeconds만큼 누르고 있으면 자른다. 한 번 자르면 키를 뗄 때까지 다시 자르지 않는다. */
  private holdCutKey(input: InputState): void {
    if (!input.held.cutTail) {
      this.cutHold = 0;
      this.cutLatched = false;
      return;
    }
    if (this.cutLatched || this.sequence.active) return;
    this.cutHold += FIXED_DT;
    if (this.cutHold + 1e-9 < this.config.cut.holdSeconds) return;
    this.cutHold = 0;
    this.cutLatched = true;
    this.cutTail();
  }

  /** 꿈틀거림이 끝나면 meta를 고치고 timeline을 되돌린 뒤 방을 다시 만들고, 그 기록관의 같은 대사를 띄운다(PLAN 7.4) */
  private finishRewind(): void {
    this.sequence.stop();
    rewindState(this.state, this.checkpoint);
    const roomData = this.knownRooms.get(this.state.room) ?? roomByNumber(this.state.room);
    this.roomData = roomData;
    this.state.room = roomData.number;
    const stand = roomData.recorders.find(({ id }) => id === this.state.recorder)?.stand;
    // 스텝 안이므로 stepper는 비우지 않는다(known-issues 17번)
    this.rebuildWorld(stand ?? roomData.spawn);
    // 회귀 횟수로 걸러 기록관이 나타나지 않으면 대사도 없다
    const recorder = this.room.recorder(this.state.recorder);
    if (recorder) this.dialogue = recorder.dialogue();
    this.events.push('rewind');
  }

  /** 연출 중에 방을 옮기면, 남은 연출을 건너뛰고 회귀의 상태 부분만 마친다 */
  private settleRewind(): void {
    if (!this.sequence.active) return;
    this.sequence.stop();
    rewindState(this.state, this.checkpoint);
  }

  /** 설정의 구간 수가 바뀌었으면 자른 횟수를 그대로 두고 남은 구간을 맞춘다 */
  private fitSections(): void {
    const { sections } = this.config.tail;
    if (sections === this.fullSections) return;
    const cuts = this.fullSections - this.state.sectionsLeft;
    this.fullSections = sections;
    this.state.sectionsLeft = Math.max(0, sections - cuts);
  }

  // ---- 만들기 ----

  private rebuildWorld(spawn: Point): void {
    this.physics.free();
    this.stepCount = 0;
    this.generation += 1;
    this.build(spawn);
  }

  private build(spawn: Point): void {
    const { config, state } = this;
    this.physics = new PhysicsWorld(config);
    // 남은 구간이 바뀌면 방을 다시 만들므로, 능력표도 여기서 다시 읽는다
    this.abilities = abilitiesFor(state.sectionsLeft);
    this.room = new Room(this.physics, this.roomData, config, state, this.abilities, (event) => this.events.push(event));
    const surroundings = { surfaceOf: (c: RAPIER.Collider) => this.room.surfaceOf(c), grabbables: this.room.grabbables };
    this.tori = new Tori(this.physics, config, spawn, surroundings, state.sectionsLeft);
    this.tori.applyAbilities(this.abilities);
    this.strikes = new Strikes();
    this.controller = createController(this.scheme);
    this.severed = [];
    this.dialogue = null;
    this.keptGrab = { grab: false, pointerGrab: false };
    this.cutHold = 0;
  }
}

function createController(scheme: Scheme): TailController {
  return scheme === 'A' ? new MouseTail() : new AutoTail();
}
