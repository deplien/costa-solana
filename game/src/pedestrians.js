// pedestrians.js — the people of Costa Solana: how they look, where
// they stroll, and how fast they run when the day goes wrong.
//
// One job: pedestrians. Peds wander the sidewalk ring of their home
// block corner to corner, enjoying golden hour — until G.danger marks
// a nearby crime scene, when they flee from it at a sprint. A ped who
// is knocked down lies still for a few seconds, then gets up running;
// one whose health is gone stays down.

import { CFG } from './config.js';
import { rngRange, rngPick } from './random.js';
import { collideCircle, steerToward, dist2D } from './vehicles.js';

// Bright holiday shirts and the range of skin tones on the promenade.
const SHIRT_COLORS = [
  0xff6b6b, 0xfeca57, 0x48dbfb, 0x1dd1a1, 0xf368e0, 0xff9f43,
  0x54a0ff, 0x5f27cd, 0xff9ff3, 0x00d2d3, 0xee5253, 0xfd79a8,
];
const SKIN_TONES = [0xf1c27d, 0xffdbac, 0xe0ac69, 0xc68642, 0x8d5524];
const PANTS_COLORS = [0x2c3e50, 0x576574, 0x8395a7, 0x6d4c41, 0xf7f1e3];

// part(parent, w, h, d, mat, x, y, z) -> a box mesh on the ped group.
function part(parent, w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// limb(w, h, d, mat, x, y, z) -> a swinging limb: a group pivoted at
// its top end with the box hanging below, so rotation.x swings it
// like a pendulum while walking.
function limb(w, h, d, mat, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.y = -h / 2;
  pivot.add(mesh);
  return pivot;
}

// makePedMesh(rng) -> a ~1.8-unit humanoid Group facing +Z: two legs,
// a bright shirt, two arms and a head, all boxes and one sphere. The
// swinging parts ride in userData (legL, legR, armL, armR, torso) so
// updates can animate the walk and the player can be re-dressed.
export function makePedMesh(rng) {
  const ped = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: rngPick(rng, SHIRT_COLORS) });
  const pants = new THREE.MeshLambertMaterial({ color: rngPick(rng, PANTS_COLORS) });
  const skin = new THREE.MeshLambertMaterial({ color: rngPick(rng, SKIN_TONES) });

  const legL = limb(0.17, 0.78, 0.2, pants, -0.13, 0.78, 0);
  const legR = limb(0.17, 0.78, 0.2, pants, 0.13, 0.78, 0);
  ped.add(legL);
  ped.add(legR);

  const torso = part(ped, 0.54, 0.64, 0.28, shirt, 0, 1.1, 0);
  const armL = limb(0.14, 0.66, 0.16, shirt, -0.36, 1.38, 0);
  const armR = limb(0.14, 0.66, 0.16, shirt, 0.36, 1.38, 0);
  ped.add(armL);
  ped.add(armR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.position.set(0, 1.62, 0);
  ped.add(head);

  ped.userData.legL = legL;
  ped.userData.legR = legR;
  ped.userData.armL = armL;
  ped.userData.armR = armR;
  ped.userData.torso = torso;
  ped.userData.head = head;
  return ped;
}

/* ------------------------------------------------------------------ */
/* Sidewalk routing: peds pace the ring of their home block.           */
/* ------------------------------------------------------------------ */

// blockCenterFor(x, z) -> the centre of the block a spawn corner
// belongs to. Spawn points sit at centre ± 34 on both axes (see
// city.js pedSpawnPoints), and true centres are the coordinates
// congruent to 45 mod 90 — exactly one of the two candidates fits.
function blockCenterFor(x, z) {
  const axis = (v) => {
    const plus = v + 34;
    const mod = ((plus % CFG.BLOCK) + CFG.BLOCK) % CFG.BLOCK;
    return mod === 45 ? plus : v - 34;
  };
  return { x: axis(x), z: axis(z) };
}

// blockCorners(center) -> the four sidewalk corners of a block.
function blockCorners(center) {
  return [
    { x: center.x - 34, z: center.z - 34 },
    { x: center.x + 34, z: center.z - 34 },
    { x: center.x + 34, z: center.z + 34 },
    { x: center.x - 34, z: center.z + 34 },
  ];
}

// nearestCornerIndex(corners, x, z) -> index of the closest corner.
function nearestCornerIndex(corners, x, z) {
  let best = 0;
  let bestDist = Infinity;
  corners.forEach((c, i) => {
    const d = dist2D(x, z, c.x, c.z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// spawnPeds(G, count): scatter count pedestrians over the world's
// sidewalk spawn points. Each ped remembers its block's corners and
// paces them in order; state starts at 'walk'.
// Ped record: { mesh, heading, speed, state, target, corners,
// cornerIdx, panic, downTimer, health, phase }.
export function spawnPeds(G, count) {
  const points = G.world.pedSpawnPoints;
  for (let i = 0; i < count; i++) {
    const spawn = points[Math.floor(G.rng() * points.length)];
    const mesh = makePedMesh(G.rng);
    mesh.position.set(spawn.x, 0, spawn.z);
    G.scene.add(mesh);
    const corners = blockCorners(blockCenterFor(spawn.x, spawn.z));
    const cornerIdx = nearestCornerIndex(corners, spawn.x, spawn.z);
    const nextIdx = (cornerIdx + (G.rng() < 0.5 ? 1 : 3)) % 4;
    const target = corners[nextIdx];
    const ped = {
      mesh,
      heading: Math.atan2(target.x - spawn.x, target.z - spawn.z),
      speed: rngRange(G.rng, 1.2, 2.2),
      state: 'walk', // 'walk' | 'flee' | 'down' | 'dead' | 'stand'
      target,
      corners,
      cornerIdx: nextIdx,
      panic: 0,
      downTimer: 0,
      health: 100,
      phase: G.rng() * Math.PI * 2,
    };
    mesh.rotation.y = ped.heading;
    G.peds.push(ped);
  }
}

/* ------------------------------------------------------------------ */
/* Per-frame update: stroll, flee, fall, recover.                      */
/* ------------------------------------------------------------------ */

const FLEE_RADIUS = 26; // how close danger has to be to spook a ped
const FLEE_SPEED = 4.5; // panic sprint — over twice the fastest stroll
const DOWN_SECONDS = 4; // time spent on the pavement before rising

// animateWalk(ped, dt, speed): swing the limbs and bob the body in
// step with the ground covered; ease back to rest when standing.
function animateWalk(ped, dt, speed) {
  const u = ped.mesh.userData;
  if (speed > 0.1) {
    ped.phase += dt * speed * 3.4;
    const swing = Math.sin(ped.phase) * Math.min(0.65, 0.3 + speed * 0.09);
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.7;
    u.armR.rotation.x = swing * 0.7;
    ped.mesh.position.y = Math.abs(Math.cos(ped.phase)) * 0.05;
  } else {
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
    u.armL.rotation.x *= 0.8;
    u.armR.rotation.x *= 0.8;
    ped.mesh.position.y = 0;
  }
}

// nextCornerTarget(ped): advance to the following corner of the
// block ring and aim for it.
function nextCornerTarget(ped) {
  ped.cornerIdx = (ped.cornerIdx + 1) % 4;
  ped.target = ped.corners[ped.cornerIdx];
}

// startFleeing(G, ped, fromX, fromZ): point the ped away from a
// threat and mark it panicked for a few seconds.
function startFleeing(G, ped, fromX, fromZ) {
  const pos = ped.mesh.position;
  const dx = pos.x - fromX;
  const dz = pos.z - fromZ;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  ped.target = { x: pos.x + (dx / len) * 34, z: pos.z + (dz / len) * 34 };
  ped.state = 'flee';
  ped.panic = Math.max(ped.panic, 2.6);
}

// updatePeds(G, dt): advance every pedestrian one frame.
// - 'walk': pace the block ring at ped.speed.
// - 'flee': sprint from G.danger (or the last threat) while panic lasts.
// - 'down': lie still; after DOWN_SECONDS, rise and flee — unless
//   health is gone, in which case the ped turns 'dead' and stays.
// - 'stand' / 'dead': no motion at all (roadblock officers, the fallen).
export function updatePeds(G, dt) {
  const danger = G.danger && G.time <= G.danger.until ? G.danger : null;
  for (const ped of G.peds) {
    const pos = ped.mesh.position;

    if (ped.state === 'dead' || ped.state === 'stand') continue;

    if (ped.state === 'down') {
      // Whoever floored this ped (a bumper, a bullet), the pavement
      // pose is enforced here so every knockdown reads the same.
      ped.mesh.rotation.x = -Math.PI / 2;
      pos.y = 0.25;
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        if (ped.health <= 0) {
          ped.state = 'dead';
        } else {
          // Back on their feet, and not staying to chat about it.
          ped.mesh.rotation.x = 0;
          pos.y = 0;
          const src = danger || { x: pos.x + 10, z: pos.z };
          startFleeing(G, ped, src.x, src.z);
        }
      }
      continue;
    }

    // A fresh scare nearby overrides an evening stroll.
    if (danger && ped.state === 'walk'
      && dist2D(pos.x, pos.z, danger.x, danger.z) < FLEE_RADIUS) {
      startFleeing(G, ped, danger.x, danger.z);
    }

    if (ped.state === 'flee') {
      ped.panic -= dt;
      if (ped.panic <= 0 && !danger) {
        // Calm again: rejoin the block ring at the nearest corner.
        ped.state = 'walk';
        ped.cornerIdx = nearestCornerIndex(ped.corners, pos.x, pos.z);
        nextCornerTarget(ped);
      }
    }

    // Walk/flee locomotion toward the current target.
    const dx = ped.target.x - pos.x;
    const dz = ped.target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.8) {
      if (ped.state === 'walk') {
        nextCornerTarget(ped);
      } else {
        // Fleeing and out of road: keep running the same way.
        ped.target = { x: pos.x + dx * 4 + 6, z: pos.z + dz * 4 };
      }
      continue;
    }
    const speed = ped.state === 'flee' ? FLEE_SPEED : ped.speed;
    const desired = Math.atan2(dx, dz);
    ped.heading = steerToward(ped.heading, desired, 7 * dt);
    pos.x += Math.sin(ped.heading) * speed * dt;
    pos.z += Math.cos(ped.heading) * speed * dt;
    collideCircle(G.world.colliders, pos, 0.5);
    // Keep beachcombers and everyone else on the island.
    pos.x = THREE.MathUtils.clamp(pos.x, -CFG.WORLD_HALF - 6, CFG.WORLD_HALF + 6);
    pos.z = THREE.MathUtils.clamp(pos.z, -CFG.WORLD_HALF - 6, CFG.WORLD_HALF + 30);
    ped.mesh.rotation.y = ped.heading;
    animateWalk(ped, dt, speed);
  }
}

// knockDownPed(ped, seconds = DOWN_SECONDS): put a ped on the
// pavement — shared by weapons fire and traffic accidents in spirit;
// exported so missions or police can floor someone without reaching
// into the record's fields.
export function knockDownPed(ped, seconds = DOWN_SECONDS) {
  if (ped.state === 'dead') return;
  ped.state = 'down';
  ped.downTimer = seconds;
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.position.y = 0.25;
}
