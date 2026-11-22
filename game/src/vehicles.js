// vehicles.js — every car in Costa Solana: how they look, how traffic
// flows around the street grid, and how the player's stolen ride drives.
//
// One job: vehicles. The mesh factory builds low-poly tropical traffic
// from boxes and cylinders; the traffic brain walks cars along the road
// lines from city.js, turning at intersections; driveCar() turns the
// keyboard into arcade driving for whichever car the player has taken.
//
// Heading convention (shared with city.js): forward is
// (sin(heading), 0, cos(heading)); heading 0 faces +Z (south),
// Math.PI / 2 faces +X (east); models are built facing +Z and get
// mesh.rotation.y = heading. Right-hand traffic: the driving lane sits
// LANE_OFF metres to the driver's right of each road centre line.

import { CFG } from './config.js';
import { rngRange, rngPick, rngChance } from './random.js';

export const LANE_OFF = 5.5; // lane offset from a road centre line
const TRAFFIC_BASE_SPEED = 12; // cruise speed of civilian traffic

/* ------------------------------------------------------------------ */
/* Small shared maths: headings, steering, forward vectors.            */
/* ------------------------------------------------------------------ */

// wrapAngle(a) -> the same angle folded into [-PI, PI], so steering
// always takes the short way around the compass.
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// steerToward(current, target, maxStep) -> current heading rotated
// toward target by at most maxStep radians (frame-rate independent
// when maxStep = rate * dt).
export function steerToward(current, target, maxStep) {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

// forwardOf(heading) -> { x, z } unit forward vector on the ground.
export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

// rightOf(heading) -> { x, z } unit vector to the driver's right.
export function rightOf(heading) {
  return { x: -Math.cos(heading), z: Math.sin(heading) };
}

// dist2D(ax, az, bx, bz) -> ground-plane distance between two points.
export function dist2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/* ------------------------------------------------------------------ */
/* Mesh factory: low-poly cars from boxes, glass and cylinders.        */
/* ------------------------------------------------------------------ */

// Per-kind body plans. Length runs along Z (the facing direction),
// width along X. cabinZ shifts the glasshouse toward the nose (+) or
// tail (-); pickup and sport get their own extra trim below.
const CAR_KINDS = {
  sedan: { len: 4.4, wid: 1.9, bodyH: 0.62, cabinLen: 2.1, cabinH: 0.52, cabinZ: -0.25, wheelR: 0.34 },
  hatch: { len: 3.9, wid: 1.85, bodyH: 0.66, cabinLen: 2.4, cabinH: 0.54, cabinZ: -0.05, wheelR: 0.33 },
  pickup: { len: 4.9, wid: 2.0, bodyH: 0.68, cabinLen: 1.5, cabinH: 0.56, cabinZ: 0.95, wheelR: 0.38 },
  van: { len: 4.8, wid: 2.0, bodyH: 1.45, cabinLen: 1.1, cabinH: 0.5, cabinZ: 1.55, wheelR: 0.38 },
  sport: { len: 4.6, wid: 1.95, bodyH: 0.46, cabinLen: 1.9, cabinH: 0.4, cabinZ: -0.35, wheelR: 0.36 },
};

// Materials shared by every car (paint is per-car).
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1d2f3d });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x17181a });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x2b2f33 });
const headlightMat = new THREE.MeshLambertMaterial({ color: 0xfff3b0, emissive: 0xffedb5, emissiveIntensity: 0.9 });
const taillightMat = new THREE.MeshLambertMaterial({ color: 0x7a1610, emissive: 0xd42a1e, emissiveIntensity: 0.7 });

// box(w, h, d, mat, x, y, z) -> a mesh added to parent, centre at x,y,z.
function box(parent, w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// makeWheel(radius) -> a steering pivot group holding a spin group
// holding the tyre. Pivot.rotation.y steers (front wheels), the spin
// group's rotation.x rolls the tyre as the car moves.
function makeWheel(radius) {
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const tyreGeom = new THREE.CylinderGeometry(radius, radius, 0.24, 12);
  tyreGeom.rotateZ(Math.PI / 2); // axle along X, the car's lateral axis
  const tyre = new THREE.Mesh(tyreGeom, tyreMat);
  spin.add(tyre);
  pivot.add(spin);
  pivot.userData.spin = spin;
  return pivot;
}

// makeCarMesh(colorHex, kind) -> THREE.Group facing +Z.
// kind: 'sedan' | 'hatch' | 'pickup' | 'van' | 'sport'.
// group.userData.wheels lists the four wheel pivots (front pair first)
// so updates can spin and steer them; userData.plan is the body plan.
export function makeCarMesh(colorHex, kind = 'sedan') {
  const plan = CAR_KINDS[kind] || CAR_KINDS.sedan;
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const car = new THREE.Group();

  // Body shell and glasshouse.
  const bodyY = plan.wheelR + plan.bodyH / 2 - 0.06;
  box(car, plan.wid, plan.bodyH, plan.len, paint, 0, bodyY, 0);
  const cabinY = bodyY + plan.bodyH / 2 + plan.cabinH / 2 - 0.04;
  box(car, plan.wid - 0.24, plan.cabinH, plan.cabinLen, glassMat, 0, cabinY, plan.cabinZ);
  // Roof cap in paint colour so the glass reads as a band, not a blob.
  box(car, plan.wid - 0.3, 0.07, plan.cabinLen - 0.25, paint, 0, cabinY + plan.cabinH / 2, plan.cabinZ);
  // Bumpers.
  box(car, plan.wid + 0.04, 0.16, 0.18, trimMat, 0, plan.wheelR + 0.05, plan.len / 2);
  box(car, plan.wid + 0.04, 0.16, 0.18, trimMat, 0, plan.wheelR + 0.05, -plan.len / 2);

  if (kind === 'pickup') {
    // Open cargo bed behind the cab: floor lip and two side walls.
    box(car, plan.wid - 0.1, 0.34, 1.9, paint, 0, bodyY + plan.bodyH / 2 + 0.1, -1.35);
    box(car, 0.08, 0.3, 1.9, trimMat, plan.wid / 2 - 0.06, bodyY + plan.bodyH / 2 + 0.28, -1.35);
    box(car, 0.08, 0.3, 1.9, trimMat, -plan.wid / 2 + 0.06, bodyY + plan.bodyH / 2 + 0.28, -1.35);
  }
  if (kind === 'sport') {
    // Rear wing on two little struts.
    box(car, plan.wid - 0.2, 0.06, 0.34, trimMat, 0, bodyY + plan.bodyH / 2 + 0.34, -plan.len / 2 + 0.3);
    box(car, 0.08, 0.3, 0.08, trimMat, 0.6, bodyY + plan.bodyH / 2 + 0.16, -plan.len / 2 + 0.3);
    box(car, 0.08, 0.3, 0.08, trimMat, -0.6, bodyY + plan.bodyH / 2 + 0.16, -plan.len / 2 + 0.3);
  }

  // Lights: warm heads at the nose, red tails at the back.
  const lightY = bodyY + plan.bodyH / 2 - 0.18;
  box(car, 0.34, 0.13, 0.06, headlightMat, plan.wid / 2 - 0.32, lightY, plan.len / 2 + 0.02);
  box(car, 0.34, 0.13, 0.06, headlightMat, -plan.wid / 2 + 0.32, lightY, plan.len / 2 + 0.02);
  box(car, 0.34, 0.11, 0.06, taillightMat, plan.wid / 2 - 0.32, lightY, -plan.len / 2 - 0.02);
  box(car, 0.34, 0.11, 0.06, taillightMat, -plan.wid / 2 + 0.32, lightY, -plan.len / 2 - 0.02);

  // Wheels: front pair steers, all four spin.
  const wheels = [];
  const wheelZ = plan.len / 2 - 0.95;
  for (const [wx, wz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const wheel = makeWheel(plan.wheelR);
    wheel.position.set(wx * (plan.wid / 2 - 0.02), plan.wheelR, wz * wheelZ);
    car.add(wheel);
    wheels.push(wheel);
  }
  car.userData.wheels = wheels;
  car.userData.plan = plan;
  return car;
}

// makeLightbar() -> the red/blue roof bar for police cars. The two
// lamp materials ride along in userData so police.js can strobe them
// by swapping emissiveIntensity.
export function makeLightbar() {
  const bar = new THREE.Group();
  box(bar, 1.3, 0.1, 0.42, trimMat, 0, 0.05, 0);
  const redMat = new THREE.MeshLambertMaterial({ color: 0x8c1d12, emissive: 0xff2a1a, emissiveIntensity: 0.2 });
  const blueMat = new THREE.MeshLambertMaterial({ color: 0x123a8c, emissive: 0x2a6bff, emissiveIntensity: 0.2 });
  box(bar, 0.58, 0.14, 0.36, redMat, -0.33, 0.16, 0);
  box(bar, 0.58, 0.14, 0.36, blueMat, 0.33, 0.16, 0);
  bar.userData.redMat = redMat;
  bar.userData.blueMat = blueMat;
  return bar;
}

/* ------------------------------------------------------------------ */
/* Collision: circles against the city's building AABBs.               */
/* ------------------------------------------------------------------ */

// collideCircle(colliders, pos, radius) -> pos pushed out of every
// AABB (expanded by radius) it overlaps. Mutates and returns pos;
// pos may be a THREE.Vector3 or any { x, z } object. Only the ground
// plane is resolved — buildings are treated as infinitely tall here
// because cars and people never fly.
export function collideCircle(colliders, pos, radius) {
  for (const c of colliders) {
    const hw = c.hw + radius;
    const hd = c.hd + radius;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    // Inside the expanded box: escape along the shallower axis.
    const pushX = hw - Math.abs(dx);
    const pushZ = hd - Math.abs(dz);
    if (pushX < pushZ) {
      pos.x = c.x + (dx >= 0 ? hw : -hw);
    } else {
      pos.z = c.z + (dz >= 0 ? hd : -hd);
    }
  }
  return pos;
}

/* ------------------------------------------------------------------ */
/* Damage smoke: one shared sprite texture, puffed by hurt cars.       */
/* ------------------------------------------------------------------ */

let smokeTexture = null;

// getSmokeTexture() -> a soft radial-gradient sprite, built once.
function getSmokeTexture() {
  if (smokeTexture) return smokeTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(60,60,60,0.55)');
  grad.addColorStop(1, 'rgba(60,60,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  smokeTexture = new THREE.CanvasTexture(canvas);
  return smokeTexture;
}

// ensureSmoke(car): attach the (hidden) smoke sprite over the bonnet.
function ensureSmoke(car) {
  if (car.smoke) return car.smoke;
  const mat = new THREE.SpriteMaterial({ map: getSmokeTexture(), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(0, 1.5, car.mesh.userData.plan.len / 2 - 0.6);
  sprite.scale.set(1.6, 1.6, 1);
  sprite.visible = false;
  car.mesh.add(sprite);
  car.smoke = sprite;
  return sprite;
}

/* ------------------------------------------------------------------ */
/* Spawning: traffic that drives, and parked cars that wait.           */
/* ------------------------------------------------------------------ */

const CAR_KIND_NAMES = ['sedan', 'hatch', 'pickup', 'van', 'sport'];

// laneFromSpawn(spawn) -> { axis, line, dir } describing which road a
// spawn point belongs to and which way along it the car travels.
// Spawn headings come from city.js already sitting in the right lane.
function laneFromSpawn(spawn) {
  if (spawn.heading === Math.PI / 2) return { axis: 'x', line: spawn.z - LANE_OFF, dir: 1 };
  if (spawn.heading === -Math.PI / 2) return { axis: 'x', line: spawn.z + LANE_OFF, dir: -1 };
  if (spawn.heading === 0) return { axis: 'z', line: spawn.x + LANE_OFF, dir: 1 };
  return { axis: 'z', line: spawn.x - LANE_OFF, dir: -1 };
}

// travelHeading(axis, dir) -> the compass heading of that motion.
function travelHeading(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

// makeCarObject(G, spawn, state) -> a car record around a fresh mesh.
function makeCarObject(G, spawn, state) {
  const kind = rngPick(G.rng, CAR_KIND_NAMES);
  const color = rngPick(G.rng, CFG.CAR_COLORS);
  const mesh = makeCarMesh(color, kind);
  mesh.position.set(spawn.x, 0, spawn.z);
  mesh.rotation.y = spawn.heading;
  G.scene.add(mesh);
  const lane = laneFromSpawn(spawn);
  return {
    mesh,
    kind,
    color,
    heading: spawn.heading,
    speed: 0,
    targetSpeed: rngRange(G.rng, 10, 16),
    state, // 'traffic' | 'parked' | 'player'
    axis: lane.axis,
    line: lane.line,
    dir: lane.dir,
    health: 100,
    driver: state === 'traffic' ? { present: true } : null,
    decideAt: null, // crossing coordinate a turn was last planned for
    turn: null, // { axis, line, dir } chosen for the next crossing
    spin: 0, // accumulated wheel roll
    steerVis: 0, // smoothed front-wheel yaw for display
    smoke: null,
    knockCooldown: 0,
  };
}

// spawnTraffic(G, trafficCount, parkedCount): fill G.cars from the
// world's spawn points — the first trafficCount become moving traffic
// (spread along their avenues), the next parkedCount become parked
// cars nudged to the kerb with no driver.
export function spawnTraffic(G, trafficCount, parkedCount) {
  const points = G.world.carSpawnPoints;
  const used = new Set();
  const takePoint = () => {
    for (let tries = 0; tries < 24; tries++) {
      const idx = Math.floor(G.rng() * points.length);
      if (!used.has(idx)) {
        used.add(idx);
        return points[idx];
      }
    }
    return points[Math.floor(G.rng() * points.length)];
  };

  for (let i = 0; i < trafficCount; i++) {
    const spawn = { ...takePoint() };
    // Spread traffic along its road instead of bunching on spawn dots.
    if (spawn.heading === Math.PI / 2 || spawn.heading === -Math.PI / 2) {
      spawn.x += rngRange(G.rng, -30, 30);
    } else {
      spawn.z += rngRange(G.rng, -30, 30);
    }
    const car = makeCarObject(G, spawn, 'traffic');
    car.speed = car.targetSpeed * 0.7;
    G.cars.push(car);
  }

  for (let i = 0; i < parkedCount; i++) {
    const base = takePoint();
    const spawn = { ...base };
    // Nudge from the driving lane out to the kerb (a further LANE_OFF
    // to the driver's right) so parked cars hug the sidewalk.
    const right = rightOf(spawn.heading);
    spawn.x += right.x * LANE_OFF;
    spawn.z += right.z * LANE_OFF;
    const car = makeCarObject(G, spawn, 'parked');
    car.speed = 0;
    G.cars.push(car);
  }
}

/* ------------------------------------------------------------------ */
/* Traffic brain: follow the lane, choose turns, mind the neighbours.  */
/* ------------------------------------------------------------------ */

// laneCenter(car) -> the coordinate the car should hold on its
// cross-axis to stay in its right-hand lane.
function laneCenter(car) {
  if (car.axis === 'x') return car.line + (car.dir > 0 ? LANE_OFF : -LANE_OFF);
  return car.line + (car.dir > 0 ? -LANE_OFF : LANE_OFF);
}

// nextCrossingAhead(car) -> the road line coordinate of the next
// intersection in front of the car, or null beyond the grid edge.
function nextCrossingAhead(car) {
  const lines = CFG.ROAD_LINES;
  const along = car.axis === 'x' ? car.mesh.position.x : car.mesh.position.z;
  let best = null;
  for (const line of lines) {
    const ahead = (line - along) * car.dir;
    if (ahead > 1 && (best === null || ahead < best.dist)) {
      best = { line, dist: ahead };
    }
  }
  return best;
}

// planTurn(G, car, crossing): at each fresh intersection, mostly go
// straight; sometimes turn onto the crossing road. Turns record the
// new axis/line/dir the car will adopt once it reaches the corner.
function planTurn(G, car, crossing) {
  car.decideAt = crossing;
  const roll = G.rng();
  if (roll < 0.52) {
    car.turn = null; // straight through
    return;
  }
  const fwd = forwardOf(car.heading);
  // Left of (fx, fz) is (fz, -fx); right is (-fz, fx).
  const turnVec = roll < 0.76 ? { x: fwd.z, z: -fwd.x } : { x: -fwd.z, z: fwd.x };
  if (Math.abs(turnVec.x) > Math.abs(turnVec.z)) {
    car.turn = { axis: 'x', line: crossing, dir: turnVec.x > 0 ? 1 : -1 };
  } else {
    car.turn = { axis: 'z', line: crossing, dir: turnVec.z > 0 ? 1 : -1 };
  }
}

// guidePoint(car, crossing) -> the world point the steering aims at:
// down the lane normally, or into the new lane when a turn is on.
function guidePoint(car, crossing) {
  const pos = car.mesh.position;
  if (car.turn && crossing && crossing.dist < 13) {
    // Aim past the corner, already centred on the new lane.
    if (car.turn.axis === 'x') {
      return { x: pos.x + car.turn.dir * 26, z: car.turn.line + (car.turn.dir > 0 ? LANE_OFF : -LANE_OFF) };
    }
    return { x: car.turn.line + (car.turn.dir > 0 ? -LANE_OFF : LANE_OFF), z: pos.z + car.turn.dir * 26 };
  }
  if (car.axis === 'x') return { x: pos.x + car.dir * 26, z: laneCenter(car) };
  return { x: laneCenter(car), z: pos.z + car.dir * 26 };
}

// obstacleAhead(G, car) -> distance to the nearest car, pedestrian or
// the player blocking this car's lane, or Infinity when clear. Used
// to slow traffic into queues instead of ghosting through each other.
function obstacleAhead(G, car) {
  const pos = car.mesh.position;
  const fwd = forwardOf(car.heading);
  let nearest = Infinity;
  const probe = (ox, oz, radius) => {
    const dx = ox - pos.x;
    const dz = oz - pos.z;
    const along = dx * fwd.x + dz * fwd.z;
    if (along < 0.5 || along > 13) return;
    const lateral = Math.abs(dx * fwd.z - dz * fwd.x);
    if (lateral < 1.7 + radius && along < nearest) nearest = along;
  };
  for (const other of G.cars) {
    if (other === car || other.state === 'player') continue;
    probe(other.mesh.position.x, other.mesh.position.z, 1.6);
  }
  if (G.player && G.player.car) {
    probe(G.player.car.mesh.position.x, G.player.car.mesh.position.z, 1.6);
  } else if (G.player) {
    probe(G.player.mesh.position.x, G.player.mesh.position.z, 0.4);
  }
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.state === 'dead') continue;
    probe(ped.mesh.position.x, ped.mesh.position.z, 0.4);
  }
  return nearest;
}

// updateTraffic(G, dt): advance every 'traffic' car one frame —
// steer for the guide point, commit turns at corners, brake for
// obstacles, and never leave the island.
export function updateTraffic(G, dt) {
  for (const car of G.cars) {
    if (car.state !== 'traffic') continue;
    const pos = car.mesh.position;

    // Off the island (a shunt, a bad corner): aim back at the plaza.
    if (Math.abs(pos.x) > CFG.WORLD_HALF + 24 || Math.abs(pos.z) > CFG.WORLD_HALF + 24) {
      const home = Math.atan2(45 - pos.x, 45 - pos.z);
      car.heading = steerToward(car.heading, home, 1.8 * dt);
      car.speed = Math.min(car.speed + 8 * dt, car.targetSpeed);
      moveCar(G, car, dt);
      continue;
    }

    const crossing = nextCrossingAhead(car);
    if (crossing && crossing.dist < 17 && car.decideAt !== crossing.line) {
      planTurn(G, car, crossing.line);
    }
    // Commit the planned turn once the corner is reached.
    if (car.turn && crossing && crossing.dist < 2.5) {
      car.axis = car.turn.axis;
      car.line = car.turn.line;
      car.dir = car.turn.dir;
      car.turn = null;
    }
    if (crossing && crossing.dist < 1) car.decideAt = crossing.line;

    const guide = guidePoint(car, crossing);
    const desired = Math.atan2(guide.x - pos.x, guide.z - pos.z);
    car.heading = steerToward(car.heading, desired, 1.7 * dt);
    car.steerVis = wrapAngle(desired - car.heading);

    const block = obstacleAhead(G, car);
    let goal = car.targetSpeed;
    if (block < 6) goal = 0;
    else if (block < 11) goal = car.targetSpeed * 0.4;
    car.speed += THREE.MathUtils.clamp(goal - car.speed, -22 * dt, 7 * dt);
    if (car.speed < 0) car.speed = 0;

    moveCar(G, car, dt);
  }
}

// moveCar(G, car, dt): integrate a car along its heading, resolve
// building collisions, and refresh its mesh + wheels.
function moveCar(G, car, dt) {
  const pos = car.mesh.position;
  const fwd = forwardOf(car.heading);
  const stepX = fwd.x * car.speed * dt;
  const stepZ = fwd.z * car.speed * dt;
  const startX = pos.x;
  const startZ = pos.z;
  pos.x += stepX;
  pos.z += stepZ;
  collideCircle(G.world.colliders, pos, 2.1);
  // If the wall ate most of the step, bleed speed so the car grinds
  // to a halt instead of tunnelling through on the next frame.
  const stepLen = dist2D(0, 0, stepX, stepZ);
  const traveled = dist2D(startX, startZ, pos.x, pos.z);
  if (stepLen > 0.01 && traveled < stepLen * 0.4) {
    car.speed *= 0.45;
  }
  car.mesh.rotation.y = car.heading;
  updateCarVisuals(car, dt);
}

// updateCarVisuals(car, dt): spin the wheels with distance travelled,
// yaw the front pair with the car's steering, and puff smoke from
// cars whose health has dropped under a third.
export function updateCarVisuals(car, dt) {
  car.spin += (car.speed * dt) / (car.mesh.userData.plan.wheelR || 0.34);
  const wheels = car.mesh.userData.wheels;
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].userData.spin.rotation.x = car.spin;
    if (i < 2) wheels[i].rotation.y = THREE.MathUtils.clamp(car.steerVis * 1.6, -0.5, 0.5);
  }
  if (car.health < 35) {
    const smoke = ensureSmoke(car);
    smoke.visible = true;
    const pulse = 1.4 + Math.sin(performance.now() * 0.012 + car.spin) * 0.35;
    smoke.scale.set(pulse, pulse, 1);
  } else if (car.smoke) {
    car.smoke.visible = false;
  }
}

/* ------------------------------------------------------------------ */
/* Player driving: arcade throttle, steering, handbrake and mayhem.    */
/* ------------------------------------------------------------------ */

// carMaxSpeed(car): sports cars run faster, vans haul slower.
function carMaxSpeed(car) {
  if (car.kind === 'sport') return 46;
  if (car.kind === 'van') return 32;
  if (car.kind === 'pickup') return 35;
  return 38;
}

// driveCar(G, car, dt): one frame of player driving. Reads G.input
// keys, integrates speed/heading, collides with buildings, other cars
// and — regrettably for them — pedestrians.
export function driveCar(G, car, dt) {
  const keys = G.input.keys;
  const pos = car.mesh.position;
  const maxSpeed = carMaxSpeed(car);
  const accel = keys.has('KeyW') || keys.has('ArrowUp');
  const brake = keys.has('KeyS') || keys.has('ArrowDown');
  const handbrake = keys.has('Space');

  if (accel) car.speed += (car.speed < 0 ? 26 : 15) * dt;
  if (brake) car.speed -= (car.speed > 0.5 ? 26 : 9) * dt;
  if (!accel && !brake) {
    // Engine drag and rolling resistance bleed speed to a stop.
    car.speed -= car.speed * 0.55 * dt;
    if (Math.abs(car.speed) < 0.12) car.speed = 0;
  }
  if (handbrake) car.speed -= car.speed * 2.6 * dt;
  car.speed = THREE.MathUtils.clamp(car.speed, -11, maxSpeed);

  // Steering authority grows with speed, fades at a crawl, and flips
  // in reverse like a real wheel.
  const steerIn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
    - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const authority = THREE.MathUtils.clamp(Math.abs(car.speed) / 9, 0, 1) * (handbrake ? 1.5 : 1);
  const turnRate = steerIn * authority * 1.45 * (car.speed < -0.1 ? -1 : 1);
  car.heading += turnRate * dt;
  car.steerVis = THREE.MathUtils.lerp(car.steerVis, steerIn * 0.45 * Math.sign(car.speed || 1), 1 - Math.exp(-dt * 10));

  const fwd = forwardOf(car.heading);
  const stepX = fwd.x * car.speed * dt;
  const stepZ = fwd.z * car.speed * dt;
  const speedBefore = Math.abs(car.speed);
  const startX = pos.x;
  const startZ = pos.z;
  pos.x += stepX;
  pos.z += stepZ;
  collideCircle(G.world.colliders, pos, 2.2);
  const intended = dist2D(0, 0, stepX, stepZ);
  const traveled = dist2D(startX, startZ, pos.x, pos.z);
  if (intended > 0.01 && traveled < intended * 0.45) {
    // Wall impact: damage and shake scale with the speed we lost.
    const impact = speedBefore * (1 - traveled / intended);
    if (impact > 7) {
      car.health = Math.max(0, car.health - impact * 1.6);
      G.shake = Math.max(G.shake || 0, Math.min(1, impact / 16));
    }
    car.speed *= 0.35;
  }

  collideWithCars(G, car, dt);
  runOverPeds(G, car);
  car.mesh.rotation.y = car.heading;
  updateCarVisuals(car, dt);
}

// collideWithCars(G, car, dt): soft circle shoves between the player's
// car and every other car; hard shoves cost both cars health.
function collideWithCars(G, car, dt) {
  const pos = car.mesh.position;
  const others = G.cops ? G.cars.concat(G.cops) : G.cars;
  for (const other of others) {
    if (other === car) continue;
    const op = other.mesh.position;
    const d = dist2D(pos.x, pos.z, op.x, op.z);
    if (d >= 4.3 || d === 0) continue;
    const nx = (pos.x - op.x) / d;
    const nz = (pos.z - op.z) / d;
    const overlap = 4.3 - d;
    pos.x += nx * overlap * 0.6;
    pos.z += nz * overlap * 0.6;
    op.x -= nx * overlap * 0.4;
    op.z -= nz * overlap * 0.4;
    const impact = Math.abs(car.speed) + Math.abs(other.speed || 0);
    if (impact > 12) {
      car.health = Math.max(0, car.health - impact * 0.5);
      other.health = Math.max(0, other.health - impact * 0.7);
      G.shake = Math.max(G.shake || 0, Math.min(1, impact / 22));
      car.speed *= 0.55;
    } else {
      car.speed *= 0.85;
    }
    other.mesh.rotation.y = other.heading;
  }
}

// runOverPeds(G, car): the dark arithmetic of a fast car meeting a
// pedestrian. The ped goes down, the law notices, the car barely slows.
function runOverPeds(G, car) {
  if (Math.abs(car.speed) < 3.5) return;
  const pos = car.mesh.position;
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.state === 'dead') continue;
    const pp = ped.mesh.position;
    if (dist2D(pos.x, pos.z, pp.x, pp.z) > 2.1) continue;
    if (typeof G.hitPed === 'function') {
      G.hitPed(ped, car);
    } else {
      ped.state = 'down';
      ped.downTimer = 4;
      ped.health = Math.max(0, (ped.health ?? 100) - 55);
    }
    G.addWanted(30);
    G.danger = { x: pp.x, z: pp.z, until: G.time + 3 };
    G.shake = Math.max(G.shake || 0, 0.35);
    car.speed *= 0.92;
  }
}
