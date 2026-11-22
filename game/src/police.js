// police.js — the Costa Solana PD: wanted heat, patrol chases,
// roadblocks and the helicopter that ends arguments.
//
// One job: law enforcement. Crime anywhere in the game is reported
// through addWanted(), which fills G.wantedPoints; every 40 points is
// a star, and the stars decide how many patrol cars hunt the player,
// whether roadblocks seal the avenue ahead, and whether the
// helicopter joins at four stars. Heat cools when the player breaks
// line of sight and stays quiet — unless the helicopter is up.

import { CFG } from './config.js';
import { rngRange, rngPick } from './random.js';
import {
  makeCarMesh, makeLightbar, collideCircle,
  steerToward, forwardOf, dist2D, updateCarVisuals,
} from './vehicles.js';
import { makePedMesh } from './pedestrians.js';

export const POINTS_PER_STAR = 40;
const COPS_BY_STARS = [0, 1, 2, 3, 4, 6]; // patrol cars wanted at 0..5 stars
const COP_MAX_SPEED = 40;
const COP_MAX_SPEED_HOT = 43.5; // four stars and up, they stop playing
const SPAWN_MIN_DIST = 115; // patrols arrive from off-screen
const SPAWN_MAX_DIST = 185;
const DESPAWN_DIST = 300;
const QUIET_SECONDS = 14; // crime-free time before heat can cool
const DECAY_RATE = 6; // wanted points per second while cooling

// addWanted(G, points): report a crime. Points accumulate toward the
// next star; the timestamp refreshes, so a crime spree never cools.
// main.js wires this onto G as G.addWanted.
export function addWanted(G, points) {
  G.wantedPoints = Math.min(260, (G.wantedPoints || 0) + points);
  G.lastCrimeAt = G.time;
  syncStars(G);
}

// syncStars(G): fold wanted points into the 0..5 star rating.
export function syncStars(G) {
  G.wanted = Math.min(5, Math.floor((G.wantedPoints || 0) / POINTS_PER_STAR));
}

/* ------------------------------------------------------------------ */
/* Patrol cars: livery, lightbars and arrival from off-screen.         */
/* ------------------------------------------------------------------ */

// makeCopCarMesh() -> a white sedan wearing CSPD livery: black doors,
// a black bonnet stripe and a strobing lightbar on the roof. The
// lightbar rides in the returned record so the strobe can animate.
function makeCopCarMesh() {
  const mesh = makeCarMesh(0xf4f6f7, 'sedan');
  const black = new THREE.MeshLambertMaterial({ color: 0x14181c });
  const doorGeom = new THREE.BoxGeometry(0.05, 0.5, 1.9);
  for (const side of [1, -1]) {
    const door = new THREE.Mesh(doorGeom, black);
    door.position.set(side * 0.96, 0.72, -0.2);
    mesh.add(door);
  }
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1.1), black);
  bonnet.position.set(0, 1.0, 1.45);
  mesh.add(bonnet);
  const lightbar = makeLightbar();
  lightbar.position.set(0, 1.62, -0.25);
  mesh.add(lightbar);
  return { mesh, lightbar };
}

// spawnCop(G): bring one patrol car in from a road 115–185 units
// away from the player — close enough to matter, far enough to
// arrive rather than materialise. Returns the cop record or null.
function spawnCop(G) {
  const pp = G.player.mesh.position;
  const candidates = G.world.carSpawnPoints.filter((s) => {
    const d = dist2D(pp.x, pp.z, s.x, s.z);
    return d >= SPAWN_MIN_DIST && d <= SPAWN_MAX_DIST;
  });
  const spawn = candidates.length
    ? rngPick(G.rng, candidates)
    : G.world.carSpawnPoints.reduce((a, b) =>
      (dist2D(pp.x, pp.z, a.x, a.z) > dist2D(pp.x, pp.z, b.x, b.z) ? a : b));
  const { mesh, lightbar } = makeCopCarMesh();
  mesh.position.set(spawn.x, 0, spawn.z);
  mesh.rotation.y = spawn.heading;
  G.scene.add(mesh);
  const cop = {
    mesh,
    lightbar,
    heading: spawn.heading,
    speed: 14,
    state: 'chase',
    health: 100,
    spin: 0,
    steerVis: 0,
    smoke: null,
    knockCooldown: 0,
    strobeSeed: G.rng() * 10,
  };
  G.cops.push(cop);
  return cop;
}

// removeCop(G, cop): take a patrol car out of the world.
function removeCop(G, cop) {
  G.scene.remove(cop.mesh);
  const idx = G.cops.indexOf(cop);
  if (idx >= 0) G.cops.splice(idx, 1);
}

// playerVelocity(G) -> the player's ground velocity, for leading the
// pursuit: from the driven car when seated, from the stride on foot.
function playerVelocity(G) {
  if (G.player.car) {
    const fwd = forwardOf(G.player.car.heading);
    return { x: fwd.x * G.player.car.speed, z: fwd.z * G.player.car.speed };
  }
  const fwd = forwardOf(G.player.heading);
  return { x: fwd.x * G.player.speed, z: fwd.z * G.player.speed };
}

/* ------------------------------------------------------------------ */
/* The chase: every patrol car hunts the player's predicted position.  */
/* ------------------------------------------------------------------ */

// updateCopCar(G, cop, dt): steer one patrol car at where the player
// is about to be, ram gently rather than ghost through, and knock a
// fleeing on-foot player down only at honest speed.
function updateCopCar(G, cop, dt) {
  const pos = cop.mesh.position;
  const pp = G.player.mesh.position;
  const vel = playerVelocity(G);
  const dist = dist2D(pos.x, pos.z, pp.x, pp.z);

  // Aim at the player's near-future position.
  const lead = Math.min(0.65, dist / 60);
  const aimX = pp.x + vel.x * lead;
  const aimZ = pp.z + vel.z * lead;
  const desired = Math.atan2(aimX - pos.x, aimZ - pos.z);
  cop.heading = steerToward(cop.heading, desired, 2.1 * dt);
  cop.steerVis = Math.sin(Math.min(1, dist / 30)) * 0.3;

  // Full speed at range; match-and-nudge when on the player's bumper
  // so chases read as pursuit, not demolition derby.
  const hot = G.wanted >= 4 ? COP_MAX_SPEED_HOT : COP_MAX_SPEED;
  let goal = hot;
  if (dist < 9) goal = Math.max(Math.abs(G.player.speed) + 3, 10);
  if (dist < 4) goal = 6;
  cop.speed += THREE.MathUtils.clamp(goal - cop.speed, -30 * dt, 13 * dt);

  const fwd = forwardOf(cop.heading);
  const startX = pos.x;
  const startZ = pos.z;
  pos.x += fwd.x * cop.speed * dt;
  pos.z += fwd.z * cop.speed * dt;
  collideCircle(G.world.colliders, pos, 2.2);
  const stepLen = Math.abs(cop.speed) * dt;
  if (stepLen > 0.01 && dist2D(startX, startZ, pos.x, pos.z) < stepLen * 0.35) {
    cop.speed *= 0.4; // ground against a building: back off and retry
    cop.heading += 0.6 * dt;
  }
  cop.mesh.rotation.y = cop.heading;

  // Strobe the lightbar, alternating red and blue.
  const phase = Math.floor((G.time + cop.strobeSeed) * 5) % 2;
  cop.lightbar.userData.redMat.emissiveIntensity = phase === 0 ? 2.4 : 0.15;
  cop.lightbar.userData.blueMat.emissiveIntensity = phase === 0 ? 0.15 : 2.4;

  updateCarVisuals(cop, dt);

  // Running battle with the player's car: shove, spark, slow both.
  if (G.player.car) {
    const cp = G.player.car.mesh.position;
    const d = dist2D(pos.x, pos.z, cp.x, cp.z);
    if (d < 4.3 && d > 0) {
      const nx = (cp.x - pos.x) / d;
      const nz = (cp.z - pos.z) / d;
      cp.x += nx * (4.3 - d) * 0.6;
      cp.z += nz * (4.3 - d) * 0.6;
      pos.x -= nx * (4.3 - d) * 0.4;
      pos.z -= nz * (4.3 - d) * 0.4;
      const impact = Math.abs(cop.speed) + Math.abs(G.player.car.speed);
      if (impact > 14) {
        G.player.car.health = Math.max(0, G.player.car.health - impact * 0.4);
        cop.health = Math.max(0, cop.health - impact * 0.5);
        G.shake = Math.max(G.shake || 0, Math.min(1, impact / 24));
      }
      G.player.car.speed *= 0.8;
      cop.speed *= 0.7;
    }
  }

  // On foot and in reach at speed: a knock, not a kill. The cooldown
  // keeps one car from stun-locking the player.
  cop.knockCooldown = Math.max(0, cop.knockCooldown - dt);
  if (!G.player.car && dist < 2.7 && cop.speed > 6 && cop.knockCooldown <= 0) {
    G.damagePlayer(12);
    const push = forwardOf(cop.heading);
    G.player.mesh.position.x += push.x * 2.2;
    G.player.mesh.position.z += push.z * 2.2;
    cop.speed *= 0.4;
    cop.knockCooldown = 1.6;
    G.shake = Math.max(G.shake || 0, 0.5);
  }
}

/* ------------------------------------------------------------------ */
/* Roadblocks: at three stars the avenue ahead stops being a road.     */
/* ------------------------------------------------------------------ */

// blockadeCountFor(stars) -> how many roadblocks the heat has earned.
function blockadeCountFor(stars) {
  if (stars >= 5) return 2;
  if (stars >= 3) return 1;
  return 0;
}

// placeBlockade(G, block): park two patrol cars angled across the
// road ahead of the player's travel, with an officer standing by.
// The anchor is ~70 units in front of the player, snapped onto the
// nearest road line crossing their path.
function placeBlockade(G, block) {
  const pp = G.player.mesh.position;
  const heading = G.player.car ? G.player.car.heading : G.player.heading;
  const fwd = forwardOf(heading);
  let ax = pp.x + fwd.x * 70;
  let az = pp.z + fwd.z * 70;
  // Snap the anchor onto the road the player is actually using.
  if (Math.abs(fwd.x) > Math.abs(fwd.z)) {
    az = CFG.ROAD_LINES.reduce((a, b) => (Math.abs(b - az) < Math.abs(a - az) ? b : a));
  } else {
    ax = CFG.ROAD_LINES.reduce((a, b) => (Math.abs(b - ax) < Math.abs(a - ax) ? b : a));
  }
  block.x = ax;
  block.z = az;
  const across = Math.abs(fwd.x) > Math.abs(fwd.z)
    ? { x: 0, z: 1 }
    : { x: 1, z: 0 };
  block.cars.forEach((car, i) => {
    const off = i === 0 ? -2.6 : 2.6;
    car.mesh.position.set(ax + across.x * off, 0, az + across.z * off);
    car.heading = heading + (i === 0 ? 0.5 : -0.5) + Math.PI / 2;
    car.mesh.rotation.y = car.heading;
    car.speed = 0;
  });
  block.ped.mesh.position.set(ax + across.x * 5.5, 0, az + across.z * 5.5);
  block.ped.mesh.rotation.y = heading + Math.PI;
  block.ped.heading = heading + Math.PI;
}

// makeBlockade(G): build a roadblock's cars and officer once; it is
// repositioned rather than rebuilt as the chase moves. The officer
// joins G.peds with state 'stand', so weapons and the minimap treat
// them like anyone else — until somebody floors them.
function makeBlockade(G) {
  const cars = [];
  for (let i = 0; i < 2; i++) {
    const { mesh, lightbar } = makeCopCarMesh();
    G.scene.add(mesh);
    cars.push({
      mesh, lightbar, heading: 0, speed: 0, state: 'block',
      health: 100, spin: 0, steerVis: 0, smoke: null, strobeSeed: G.rng() * 10,
    });
  }
  const pedMesh = makePedMesh(G.rng);
  // Officer colours: navy shirt, dark trousers.
  pedMesh.userData.torso.material = new THREE.MeshLambertMaterial({ color: 0x1d3557 });
  G.scene.add(pedMesh);
  const ped = {
    mesh: pedMesh, heading: 0, speed: 0, state: 'stand',
    target: { x: 0, z: 0 }, corners: [], cornerIdx: 0,
    panic: 0, downTimer: 0, health: 100, phase: 0, isCop: true,
  };
  G.peds.push(ped);
  const block = { cars, ped, x: 0, z: 0 };
  placeBlockade(G, block);
  return block;
}

// removeBlockade(G, block): strike a roadblock from the world.
function removeBlockade(G, block) {
  for (const car of block.cars) G.scene.remove(car.mesh);
  G.scene.remove(block.ped.mesh);
  const idx = G.peds.indexOf(block.ped);
  if (idx >= 0) G.peds.splice(idx, 1);
}

// updateBlockades(G, dt): keep the right number of roadblocks in
// play; reposition one when the player blows past it or leaves it
// far behind, and strobe its lightbars while it waits.
export function updateBlockades(G, dt) {
  if (!G.blockades) G.blockades = [];
  const want = blockadeCountFor(G.wanted);
  while (G.blockades.length > want) removeBlockade(G, G.blockades.pop());
  while (G.blockades.length < want) G.blockades.push(makeBlockade(G));
  const pp = G.player.mesh.position;
  for (const block of G.blockades) {
    const d = dist2D(pp.x, pp.z, block.x, block.z);
    if (d < 24 || d > 210) placeBlockade(G, block);
    for (const car of block.cars) {
      const phase = Math.floor((G.time + car.strobeSeed) * 5) % 2;
      car.lightbar.userData.redMat.emissiveIntensity = phase === 0 ? 2.4 : 0.15;
      car.lightbar.userData.blueMat.emissiveIntensity = phase === 0 ? 0.15 : 2.4;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The helicopter: four stars buys you a spotlight and no privacy.     */
/* ------------------------------------------------------------------ */

// makeHeliMesh() -> a patrol helicopter from boxes: cabin, tail boom,
// skids, a spinning main rotor (userData.rotor), tail rotor, and a
// translucent spotlight cone (userData.cone) reaching for the ground.
function makeHeliMesh() {
  const heli = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f6f7 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181c });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1d2f3d });
  const part = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    heli.add(m);
    return m;
  };
  part(2.6, 1.7, 4.6, white, 0, 0, 0); // cabin
  part(2.2, 1.0, 1.4, glass, 0, 0.25, 2.2); // cockpit glass
  part(0.5, 0.5, 4.6, dark, 0, 0.3, -4.2); // tail boom
  part(0.12, 1.3, 0.9, dark, 0, 0.9, -6.4); // tail fin
  part(2.2, 0.08, 0.5, dark, -1.2, -0.95, 0.6); // skid left
  part(2.2, 0.08, 0.5, dark, 1.2, -0.95, 0.6); // skid right
  const rotor = part(8.6, 0.07, 0.55, dark, 0, 1.15, 0);
  const tailRotor = part(0.07, 1.5, 0.3, dark, 0.32, 0.9, -6.4);

  // Spotlight: a fake volumetric cone, apex at the belly, opening
  // toward the street 34 units below.
  const coneGeom = new THREE.ConeGeometry(7, 34, 16, 1, true);
  coneGeom.translate(0, -17, 0);
  const cone = new THREE.Mesh(coneGeom, new THREE.MeshBasicMaterial({
    color: 0xfff2b0, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, fog: false,
  }));
  cone.position.y = -0.8;
  heli.add(cone);

  heli.userData.rotor = rotor;
  heli.userData.tailRotor = tailRotor;
  heli.userData.cone = cone;
  return heli;
}

// updateHelicopter(G, dt): keep the helicopter (or don't) — at four
// stars it takes station over the player, circling at 34 units up,
// spotlight pinned to the street. Its presence freezes heat decay.
function updateHelicopter(G, dt) {
  if (G.wanted >= 4) {
    if (!G.heli) {
      const mesh = makeHeliMesh();
      const pp = G.player.mesh.position;
      mesh.position.set(pp.x + 40, 34, pp.z + 40);
      G.scene.add(mesh);
      G.heli = { mesh, angle: G.rng() * Math.PI * 2 };
    }
    const heli = G.heli;
    const pp = G.player.mesh.position;
    heli.angle += dt * 0.45;
    const wantX = pp.x + Math.cos(heli.angle) * 26;
    const wantZ = pp.z + Math.sin(heli.angle) * 26;
    const blend = 1 - Math.exp(-dt * 1.6);
    heli.mesh.position.x += (wantX - heli.mesh.position.x) * blend;
    heli.mesh.position.z += (wantZ - heli.mesh.position.z) * blend;
    heli.mesh.position.y = 34 + Math.sin(G.time * 0.8) * 1.2;
    heli.mesh.lookAt(pp.x, 0, pp.z);
    heli.mesh.userData.rotor.rotation.y += dt * 28;
    heli.mesh.userData.tailRotor.rotation.x += dt * 34;
  } else if (G.heli) {
    G.scene.remove(G.heli.mesh);
    G.heli = null;
  }
}

/* ------------------------------------------------------------------ */
/* Cooling off, getting caught, and the top-level police update.       */
/* ------------------------------------------------------------------ */

// updateDecay(G, dt): heat cools only when the player has been quiet
// for a while, no patrol is close enough to see them, and the
// helicopter is down. Decay drains points toward zero.
function updateDecay(G, dt) {
  if ((G.wantedPoints || 0) <= 0) return;
  if (G.time - (G.lastCrimeAt || 0) < QUIET_SECONDS) return;
  if (G.heli) return;
  const pp = G.player.mesh.position;
  for (const cop of G.cops) {
    if (dist2D(pp.x, pp.z, cop.mesh.position.x, cop.mesh.position.z) < 55) return;
  }
  G.wantedPoints = Math.max(0, G.wantedPoints - DECAY_RATE * dt);
  syncStars(G);
}

// updateBusted(G, dt): the closing circle. On foot, an officer within
// arm's reach fills the meter — fastest when the player stands still.
// In a stopped car with a patrol alongside, it fills slowly. Reaching
// 1 ends the run: G.mode = 'busted', and main.js shows the screen.
function updateBusted(G, dt) {
  if (G.bustedMeter === undefined) G.bustedMeter = 0;
  if (G.mode !== 'play') return;
  const pp = G.player.mesh.position;
  let pressure = 0;
  if (!G.player.car) {
    for (const cop of G.cops) {
      if (dist2D(pp.x, pp.z, cop.mesh.position.x, cop.mesh.position.z) < 4.5) {
        pressure = Math.max(pressure, G.player.speed < 1 ? 1.3 : 0.65);
      }
    }
    if (G.blockades) {
      for (const block of G.blockades) {
        if (block.ped.state === 'stand'
          && dist2D(pp.x, pp.z, block.ped.mesh.position.x, block.ped.mesh.position.z) < 3) {
          pressure = Math.max(pressure, 1.1);
        }
      }
    }
  } else if (Math.abs(G.player.car.speed) < 2) {
    for (const cop of G.cops) {
      if (dist2D(pp.x, pp.z, cop.mesh.position.x, cop.mesh.position.z) < 6) {
        pressure = Math.max(pressure, 0.55);
      }
    }
  }
  if (pressure > 0) {
    G.bustedMeter = Math.min(1, G.bustedMeter + pressure * dt);
    if (G.bustedMeter >= 1) G.mode = 'busted';
  } else {
    G.bustedMeter = Math.max(0, G.bustedMeter - dt * 1.4);
  }
}

// updatePolice(G, dt): the whole force in one call — keep patrol
// numbers matched to the stars, drive the chase, hold the
// roadblocks, fly the helicopter, cool the heat, count the bust.
export function updatePolice(G, dt) {
  if (G.bustedMeter === undefined) G.bustedMeter = 0;
  syncStars(G);

  const want = COPS_BY_STARS[G.wanted] || 0;
  const pp = G.player.mesh.position;
  // Distant patrols are quietly reassigned when heat drops or they
  // lose the trail entirely.
  for (let i = G.cops.length - 1; i >= 0; i--) {
    const cop = G.cops[i];
    const d = dist2D(pp.x, pp.z, cop.mesh.position.x, cop.mesh.position.z);
    if (d > DESPAWN_DIST || (G.cops.length > want && d > 130)
      || (G.wanted === 0 && d > 60)) {
      removeCop(G, cop);
    }
  }
  let guard = 0;
  while (G.cops.length < want && guard++ < 8) {
    if (!spawnCop(G)) break;
  }

  for (const cop of G.cops) updateCopCar(G, cop, dt);
  updateBlockades(G, dt);
  updateHelicopter(G, dt);
  updateDecay(G, dt);
  updateBusted(G, dt);
}
