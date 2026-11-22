// player.js — the player character: a holidaymaker in a teal shirt
// who walks the promenade, borrows cars (with or without asking), and
// is followed everywhere by the third-person camera.
//
// One job: the player. createPlayer dresses a pedestrian mesh in the
// player's colours; updatePlayer moves it on foot or hands the frame
// to vehicles.driveCar when seated; updateCamera keeps the golden-hour
// shot framed behind them, on foot or at speed.

import { CFG } from './config.js';
import { collideCircle, driveCar, steerToward, forwardOf, rightOf, dist2D } from './vehicles.js';
import { makePedMesh } from './pedestrians.js';

const WALK_SPEED = 5.2;
const SPRINT_MULT = 1.9;
const ENTER_RANGE = 3.2; // how close a door must be to use it

// createPlayer(G) -> G.player. Builds the mesh at the world's
// playerStart, facing north into the city (heading PI: forward
// (sin PI, cos PI) = (0, -1), away from the beach at his back).
// The shared ped mesh is re-dressed: teal shirt, dark shorts and a
// coral cap, so the player reads instantly among the crowd.
export function createPlayer(G) {
  const mesh = makePedMesh(G.rng);
  const u = mesh.userData;
  u.torso.material = new THREE.MeshLambertMaterial({ color: 0x0e7c86 }); // teal shirt
  const capMat = new THREE.MeshLambertMaterial({ color: 0xff6b4a }); // coral cap
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), capMat);
  capTop.position.set(0, 1.78, 0);
  mesh.add(capTop);
  const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.24), capMat);
  capBrim.position.set(0, 1.73, 0.3);
  mesh.add(capBrim);

  mesh.position.set(G.world.playerStart.x, 0, G.world.playerStart.z);
  G.scene.add(mesh);

  G.player = {
    mesh,
    heading: Math.PI,
    speed: 0,
    car: null, // the car record being driven, or null on foot
    radius: 0.55,
    walkPhase: 0,
  };
  G.cameraYaw = Math.PI; // camera starts behind him, looking north
  G.cameraPitch = 0.32;
  return G.player;
}

/* ------------------------------------------------------------------ */
/* Getting into cars: borrowing, stealing, and the graceful exit.      */
/* ------------------------------------------------------------------ */

// nearestCarTo(G, x, z, range) -> the closest car record, or null.
function nearestCarTo(G, x, z, range) {
  let best = null;
  let bestDist = range;
  for (const car of G.cars) {
    if (car.state === 'player') continue;
    const d = dist2D(x, z, car.mesh.position.x, car.mesh.position.z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

// spawnDriverPed(G, car): when a moving car is taken, its driver is
// tipped out onto the street as a brand-new pedestrian who flees.
function spawnDriverPed(G, car) {
  const mesh = makePedMesh(G.rng);
  const side = rightOf(car.heading);
  mesh.position.set(
    car.mesh.position.x + side.x * 2.4,
    0,
    car.mesh.position.z + side.z * 2.4,
  );
  G.scene.add(mesh);
  const away = Math.atan2(
    mesh.position.x - car.mesh.position.x,
    mesh.position.z - car.mesh.position.z,
  );
  // The driver's home block, so pedestrians.updatePeds can settle
  // them back onto a sidewalk ring once the panic passes. Block
  // centres sit at 45 mod BLOCK on both axes (see city.js).
  const snapCenter = (v) => Math.round((v - 45) / CFG.BLOCK) * CFG.BLOCK + 45;
  const cx = snapCenter(mesh.position.x);
  const cz = snapCenter(mesh.position.z);
  G.peds.push({
    mesh,
    heading: away,
    speed: 1.8,
    state: 'flee',
    target: {
      x: mesh.position.x + Math.sin(away) * 30,
      z: mesh.position.z + Math.cos(away) * 30,
    },
    corners: [
      { x: cx - 34, z: cz - 34 },
      { x: cx + 34, z: cz - 34 },
      { x: cx + 34, z: cz + 34 },
      { x: cx - 34, z: cz + 34 },
    ],
    cornerIdx: 0,
    panic: 4,
    downTimer: 0,
    health: 100,
    phase: 0,
  });
}

// enterCar(G, car): seat the player in a car. A moving car with a
// driver is a carjacking — the driver is ejected and the law takes
// an interest. A parked car is quieter, unless a patrol is watching.
function enterCar(G, car) {
  if (car.state === 'traffic' && car.driver) {
    spawnDriverPed(G, car);
    car.driver = null;
    G.addWanted(25);
    G.danger = {
      x: car.mesh.position.x,
      z: car.mesh.position.z,
      until: G.time + 3,
    };
    if (typeof G.notify === 'function') G.notify('Carjacked! The driver will remember that.');
  } else {
    // Parked and empty: only a nearby patrol makes it a crime.
    for (const cop of G.cops) {
      if (dist2D(car.mesh.position.x, car.mesh.position.z,
        cop.mesh.position.x, cop.mesh.position.z) < 35) {
        G.addWanted(15);
        break;
      }
    }
  }
  car.state = 'player';
  car.speed = 0;
  G.player.car = car;
  G.player.speed = 0;
  G.player.mesh.visible = false;
}

// exitCar(G): step out at the driver's side; the car becomes parked
// wherever it was left, engine off, doors metaphorically closed.
function exitCar(G) {
  const car = G.player.car;
  if (!car) return;
  const side = rightOf(car.heading);
  const pos = G.player.mesh.position;
  pos.set(
    car.mesh.position.x - side.x * 2.3,
    0,
    car.mesh.position.z - side.z * 2.3,
  );
  collideCircle(G.world.colliders, pos, G.player.radius);
  G.player.heading = car.heading;
  car.state = 'parked';
  car.speed = 0;
  G.player.car = null;
  G.player.speed = 0;
  G.player.mesh.visible = true;
}

/* ------------------------------------------------------------------ */
/* Per-frame update: walk, sprint, drive, and the F key's whole life.  */
/* ------------------------------------------------------------------ */

// animatePlayerWalk(player, dt): the same pendulum limbs as the
// crowd, phased by the player's own stride.
function animatePlayerWalk(player, dt) {
  const u = player.mesh.userData;
  if (player.speed > 0.1) {
    player.walkPhase += dt * player.speed * 3.4;
    const swing = Math.sin(player.walkPhase) * Math.min(0.65, 0.3 + player.speed * 0.07);
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.7;
    u.armR.rotation.x = swing * 0.7;
    player.mesh.position.y = Math.abs(Math.cos(player.walkPhase)) * 0.05;
  } else {
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
    u.armL.rotation.x *= 0.8;
    u.armR.rotation.x *= 0.8;
    player.mesh.position.y = 0;
  }
}

// updatePlayer(G, dt): one frame of the player. In a car, the frame
// belongs to vehicles.driveCar and the body stays hidden in the
// driver's seat. On foot, movement is camera-relative: W walks away
// from the camera, Shift sprints, and the body turns to face travel.
export function updatePlayer(G, dt) {
  const player = G.player;
  const input = G.input;

  if (input.interactPressed) {
    if (player.car) {
      exitCar(G);
    } else {
      const car = nearestCarTo(G, player.mesh.position.x, player.mesh.position.z, ENTER_RANGE);
      if (car) enterCar(G, car);
    }
  }

  if (player.car) {
    driveCar(G, player.car, dt);
    player.speed = Math.abs(player.car.speed);
    player.heading = player.car.heading;
    // Keep the (invisible) body in the driver's seat so danger,
    // busted checks and the minimap all track the car.
    player.mesh.position.copy(player.car.mesh.position);
    return;
  }

  // Camera-relative wish direction on the ground plane.
  const camFwd = forwardOf(G.cameraYaw || 0);
  const camRight = rightOf(G.cameraYaw || 0);
  let mx = 0;
  let mz = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) { mx += camFwd.x; mz += camFwd.z; }
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) { mx -= camFwd.x; mz -= camFwd.z; }
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) { mx += camRight.x; mz += camRight.z; }
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) { mx -= camRight.x; mz -= camRight.z; }

  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0.01) {
    mx /= len;
    mz /= len;
    const sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    player.speed = WALK_SPEED * (sprint ? SPRINT_MULT : 1);
    const desired = Math.atan2(mx, mz);
    player.heading = steerToward(player.heading, desired, 11 * dt);
    const pos = player.mesh.position;
    pos.x += mx * player.speed * dt;
    pos.z += mz * player.speed * dt;
    collideCircle(G.world.colliders, pos, player.radius);
    pos.x = THREE.MathUtils.clamp(pos.x, -CFG.WORLD_HALF - 4, CFG.WORLD_HALF + 4);
    pos.z = THREE.MathUtils.clamp(pos.z, -CFG.WORLD_HALF - 4, CFG.WORLD_HALF + 60);
  } else {
    player.speed = 0;
  }
  player.mesh.rotation.y = player.heading;
  animatePlayerWalk(player, dt);
}

/* ------------------------------------------------------------------ */
/* Camera: a smooth golden-hour dolly behind the player's shoulders.   */
/* ------------------------------------------------------------------ */

// updateCamera(G, dt): orbit with the mouse, chase with a soft lag.
// Distance and height stretch when driving; G.shake (set by impacts
// and gunfire elsewhere) rattles the frame and decays here. In
// shotMode the screenshot director owns the camera — hands off.
export function updateCamera(G, dt) {
  if (G.shotMode) return;
  const input = G.input;
  G.cameraYaw -= (input.mouseDX || 0) * 0.0032;
  G.cameraPitch = THREE.MathUtils.clamp(
    (G.cameraPitch ?? 0.32) + (input.mouseDY || 0) * 0.0028,
    0.08,
    1.1,
  );

  const player = G.player;
  const driving = !!player.car;
  const dist = driving ? 11.5 : 7.5;
  const target = player.mesh.position;
  const yaw = G.cameraYaw;
  const pitch = G.cameraPitch;

  // Desired camera spot: behind the player along the view direction,
  // raised by the pitch; when driving, add a small lead so the road
  // ahead stays in frame.
  const back = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  let wantX = target.x + back.x * dist;
  let wantZ = target.z + back.z * dist;
  let wantY = target.y + 1.6 + Math.sin(pitch) * dist;
  if (driving) {
    const fwd = forwardOf(player.car.heading);
    wantX += fwd.x * 2.2;
    wantZ += fwd.z * 2.2;
  }
  wantY = Math.max(wantY, 0.7);

  const cam = G.camera;
  const blend = 1 - Math.exp(-dt * 8);
  cam.position.x += (wantX - cam.position.x) * blend;
  cam.position.y += (wantY - cam.position.y) * blend;
  cam.position.z += (wantZ - cam.position.z) * blend;

  // Impact shake: a decaying sinusoidal rattle on top of the dolly.
  G.shake = Math.max(0, (G.shake || 0) - dt * 2.4);
  const s = G.shake * 0.14;
  const t = G.time * 71;
  cam.position.x += Math.sin(t * 1.13) * s;
  cam.position.y += Math.sin(t * 1.71 + 2) * s * 0.7;

  cam.lookAt(target.x, target.y + 1.7, target.z);
}
