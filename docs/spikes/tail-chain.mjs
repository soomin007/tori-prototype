// 꼬리 체인 물리 가정 실측 (2026-11-25, @dimforge/rapier2d-compat 0.21.0, Node 26.13)
// docs/PLAN.md 7.3과 known-issues.md 1~3번의 수치가 여기서 나왔다.
// 프로젝트 코드가 아니다. tori/tail.ts가 생기면 그쪽 헤드리스 테스트가 이 파일을 대신한다.
// 실행: 의존성을 설치한 뒤 프로젝트 루트에서 `node docs/spikes/tail-chain.mjs`
import RAPIER from '@dimforge/rapier2d-compat';
await RAPIER.init();

const DT = 1 / 60;
const NONE = 0x00010000; // 아무와도 부딪히지 않는 충돌 그룹
const rot = (v, a) => ({ x: Math.cos(a) * v.x - Math.sin(a) * v.y, y: Math.sin(a) * v.x + Math.cos(a) * v.y });
const wp = (body, local) => { const t = body.translation(), r = rot(local, body.rotation()); return { x: t.x + r.x, y: t.y + r.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pct = (n) => n.toFixed(1).padStart(4) + '%';

// 1. 상자가 바닥에 떨어져 멈추는가 (M0 자동 확인과 같은 내용)
{
  const world = new RAPIER.World({ x: 0, y: -9.81 }); world.timestep = DT;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5).setTranslation(0, -0.5), ground);
  const box = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25), box);
  for (let i = 0; i < 240; i++) world.step();
  console.log(`[상자] 4초 뒤 y=${box.translation().y.toFixed(4)} (기대 0.25), 잠듦=${box.isSleeping()}`);
}

// 2. 회전 관절의 위치 모터가 90도를 넘는 목표 각을 쫓는가
function motorTest(targetDeg) {
  const world = new RAPIER.World({ x: 0, y: 0 }); world.timestep = DT;
  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const bar = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.25, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.05).setMass(0.2).setCollisionGroups(NONE), bar);
  const joint = world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: -0.25, y: 0 }), base, bar, true);
  joint.configureMotorPosition(targetDeg * Math.PI / 180, 100, 20);
  for (let i = 0; i < 300; i++) world.step();
  return `${targetDeg}→${(bar.rotation() * 180 / Math.PI).toFixed(1)}`;
}
console.log('[모터] 목표 각→5초 뒤 각(도): ' + [45, 91, 120, 179, -120, 200].map(motorTest).join('  '));

// 3. 꼬리 끝을 가지에 건 채 몸이 매달릴 때 관절이 얼마나 벌어지는가
// kind: 'impulse' | 'multibody' (몸이 뿌리인 multibody 꼬리. 가지를 잡는 관절은 어느 쪽이든 impulse)
// start: 'vertical' (가만히 매달림) | 'horizontal' (수평에서 놓아 흔들림)
function hang({ kind = 'impulse', N = 12, len = 1.5, segMass = 0.05, torsoMass = 3, iters = 4, start = 'vertical', rope = false, secs = 5 }) {
  const world = new RAPIER.World({ x: 0, y: -9.81 }); world.timestep = DT;
  world.numSolverIterations = iters;
  const L = len / N, h = L / 2, r = 0.04, bp = { x: 0, y: 10 };
  const branch = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bp.x, bp.y));
  const dir = start === 'vertical' ? { x: 0, y: -1 } : { x: 1, y: 0 };
  const ang = start === 'vertical' ? 0 : Math.PI / 2; // 마디의 로컬 -Y가 dir을 향하게
  const segs = []; // segs[0]이 가지 쪽(꼬리 끝), segs[N-1]이 몸 쪽(밑동)
  for (let i = 0; i < N; i++) {
    const c = (i + 0.5) * L;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(bp.x + dir.x * c, bp.y + dir.y * c).setRotation(ang));
    world.createCollider(RAPIER.ColliderDesc.capsule(Math.max(h - r, 0.001), r).setMass(segMass).setCollisionGroups(NONE), b);
    segs.push(b);
  }
  const tc = N * L + 0.2;
  const torso = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(bp.x + dir.x * tc, bp.y + dir.y * tc).setRotation(ang));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.2).setMass(torsoMass).setCollisionGroups(NONE), torso);

  const hip = { x: 0, y: 0.2 }, top = { x: 0, y: h }, bot = { x: 0, y: -h };
  const joints = [];
  const link = (multibody, a, la, b, lb) => {
    const data = RAPIER.JointData.revolute(la, lb);
    if (multibody) world.createMultibodyJoint(data, a, b, true); else world.createImpulseJoint(data, a, b, true);
    joints.push({ a, la, b, lb });
  };
  const mb = kind === 'multibody';
  link(mb, torso, hip, segs[N - 1], bot);
  for (let i = N - 2; i >= 0; i--) link(mb, segs[i + 1], top, segs[i], bot);
  link(false, branch, { x: 0, y: 0 }, segs[0], top);
  if (rope) world.createImpulseJoint(RAPIER.JointData.rope(len, hip, top), torso, segs[0], true);

  let maxGap = 0, maxSpeed = 0;
  for (let i = 0; i < secs * 60; i++) {
    world.step();
    let gap = 0;
    for (const j of joints) gap += dist(wp(j.a, j.la), wp(j.b, j.lb));
    maxGap = Math.max(maxGap, gap / len * 100);
    for (const b of [...segs, torso]) { const v = b.linvel(); maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y)); }
  }
  return !Number.isFinite(maxGap) || maxSpeed > 100 ? '폭주' : pct(maxGap);
}

console.log('[체인] 12마디 1.5m 꼬리, 몸 3kg. 값은 5초 동안 관절 벌어짐 합계의 최댓값 / 꼬리 길이 (가만히 매달림 / 수평에서 놓아 흔들림)');
for (const segMass of [0.05, 0.1, 0.15, 0.3]) {
  const cells = [4, 8, 16].map((iters) => `반복 ${String(iters).padStart(2)}: ${hang({ segMass, iters })} / ${hang({ segMass, iters, start: 'horizontal' })}`);
  console.log(`  몸:마디 ${String(Math.round(3 / segMass)).padStart(2)}:1  ${cells.join('   ')}`);
}
console.log('[rope] 엉덩이와 꼬리 끝 사이에 최대 길이 1.5m rope 관절을 더했을 때 (몸:마디 60:1)');
for (const iters of [4, 8]) console.log(`  반복 ${iters}: ${hang({ iters, rope: true })} / ${hang({ iters, rope: true, start: 'horizontal' })}`);
console.log('[multibody] 꼬리 관절을 multibody로 바꿨을 때 (몸:마디 60:1, 반복 4, 8, 16)');
console.log('  ' + [4, 8, 16].map((iters) => `반복 ${iters}: ${hang({ kind: 'multibody', iters })} / ${hang({ kind: 'multibody', iters, start: 'horizontal' })}`).join('   '));
