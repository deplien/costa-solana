// shots.js — deterministic screenshot staging for the dossier. When
// the game is opened with ?shot=<name>, main.js builds the whole world
// as usual, then calls applyShot once to pose the player, cars, police
// and camera for that exact frame. Simulation stays frozen afterwards,
// so every capture of a given shot is pixel-stable.
//
// Only contract APIs are used: cars and peds are repositioned through
// their records, wanted heat goes through police.js, and the camera is
// placed directly because player.js skips its own camera in shot mode.

import { makeCarMesh, makeLightbar } from './vehicles.js';
import { addWanted, updatePolice } from './police.js';

// --- Posing helpers ------------------------------------------------------

function setCarPose(car, x, z, heading, speed) {
  car.mesh.position.set(x, 0, z);
  car.heading = heading;
  car.mesh.rotation.y = heading;
  car.speed = speed || 0;
}

function setPlayerOnFoot(G, x, z, heading) {
  const p = G.player;
  p.car = null;
  p.mesh.visible = true;
  p.mesh.position.set(x, 0, z);
  p.heading = heading;
  p.mesh.rotation.y = heading;
  p.speed = 0;
}

function putPlayerInCar(G, car, x, z, heading, speed) {
  setCarPose(car, x, z, heading, speed);
  car.state = 'player';
  car.driver = 'player';
  G.player.car = car;
  G.player.mesh.visible = false;
  G.player.mesh.position.set(x, 0, z);
  G.player.heading = heading;
}

function setCamera(G, x, y, z, lookX, lookY, lookZ) {
  G.camera.position.set(x, y, z);
  G.camera.lookAt(lookX, lookY, lookZ);
}

// Heading that makes an actor at (x,z) face the point (tx,tz).
function headingToward(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}

function nearestCar(G, x, z, kinds) {
  let best = null;
  let bestD = Infinity;
  for (const car of G.cars) {
    if (kinds && !kinds.includes(car.kind)) continue;
    const dx = car.mesh.position.x - x;
    const dz = car.mesh.position.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// --- The stagings --------------------------------------------------------

function stageTitle(G) {
  G.mode = 'title';
  // Dress the beachfront avenue with a few cruising cars so the title
  // vista already shows a living city.
  const avenueCars = G.cars.filter((c) => c.state === 'traffic').slice(0, 3);
  const spots = [
    { x: -90, z: 356.8, h: Math.PI / 2 },
    { x: 5, z: 363.2, h: -Math.PI / 2 },
    { x: 64, z: 356.8, h: Math.PI / 2 },
  ];
  avenueCars.forEach((car, i) => {
    if (spots[i]) setCarPose(car, spots[i].x, spots[i].z, spots[i].h, 0);
  });
  setCamera(G, -120, 26, 470, 60, 10, 180);
}

function stageCover(G) {
  G.mode = 'play';
  const start = G.world.playerStart;
  const car = nearestCar(G, start.x, start.z, ['sport']) || nearestCar(G, start.x, start.z);
  if (car) setCarPose(car, -38, 330, 0.5, 0);
  // Hero pose: the player beside the driver door, facing the lens,
  // with the car, the arch and the golden skyline behind.
  const camX = -30, camZ = 318;
  setPlayerOnFoot(G, -35.4, 331.5, headingToward(-35.4, 331.5, camX, camZ));
  G.wanted = 0;
  setCamera(G, camX, 2.2, camZ, -35.4, 1.3, 331.5);
}

function stageDrive(G) {
  G.mode = 'play';
  const car = nearestCar(G, 90, -180, ['sedan', 'hatch']) || nearestCar(G, 90, -180);
  if (car) putPlayerInCar(G, car, 90, -180, Math.PI / 2, 16);
  // Traffic company on the same downtown road: two ahead, one alongside.
  const others = G.cars.filter((c) => c !== car && c.state === 'traffic').slice(0, 3);
  const spots = [
    { x: 112, z: -183.2, h: Math.PI / 2 },
    { x: 138, z: -183.2, h: Math.PI / 2 },
    { x: 96, z: -176.8, h: Math.PI / 2 },
  ];
  others.forEach((c, i) => {
    if (spots[i]) setCarPose(c, spots[i].x, spots[i].z, spots[i].h, 12);
  });
  G.cameraYaw = Math.PI / 2;
  setCamera(G, 79, 4.5, -180, 100, 1.2, -180);
}

// The chase frame: five stars on the beachfront avenue, police in the
// mirrors, a helicopter overhead and a blockade waiting down the road.
function stageChase(G) {
  G.mode = 'play';
  const hero = nearestCar(G, 0, 360, ['sport']) || nearestCar(G, 0, 360);
  if (hero) putPlayerInCar(G, hero, 0, 360, Math.PI / 2, 30);
  G.cameraYaw = Math.PI / 2;

  // 200 points = exactly five stars. Stepping the real police system
  // spawns genuine pursuit cars and the helicopter; after each step we
  // herd any cop that spawned ahead of the player back behind, so the
  // frame reads as a chase, not an ambush.
  addWanted(G, 200);
  const fwdX = Math.sin(Math.PI / 2);
  const fwdZ = Math.cos(Math.PI / 2);
  for (let step = 0; step < 40; step++) {
    updatePolice(G, 0.1);
    for (const cop of G.cops) {
      if (!cop || !cop.mesh) continue;
      const relX = cop.mesh.position.x - 0;
      const relZ = cop.mesh.position.z - 360;
      const ahead = relX * fwdX + relZ * fwdZ;
      if (ahead > 4) {
        const back = 22 + (step % 3) * 7;
        const side = (step % 2 === 0 ? -1 : 1) * 4.5;
        cop.mesh.position.set(0 - fwdX * back + fwdZ * side, 0, 360 - fwdZ * back - fwdX * side);
        cop.heading = Math.PI / 2;
        cop.mesh.rotation.y = Math.PI / 2;
      }
    }
    if (G.cops.length >= 2 && G.heli) break;
  }

  // Helicopter: park it above and behind the hero car, rotor spun.
  if (G.heli) {
    G.heli.position.set(10, 26, 344);
    G.heli.rotation.y = Math.PI / 2;
    G.heli.traverse((child) => {
      const p = child.geometry && child.geometry.parameters;
      if (p && p.width >= 3 && p.height <= 0.35) child.rotation.y += 0.9;
    });
  }

  // If the police system did not raise a blockade of its own, dress
  // one from prop cars across the avenue ahead.
  if (!G.blockades || G.blockades.length === 0) {
    const propA = new THREE.Group();
    propA.add(makeCarMesh(0xf2f2f2, 'sedan'));
    propA.add(makeLightbar());
    propA.position.set(70, 0, 354.5);
    propA.rotation.y = 0.15;
    const propB = new THREE.Group();
    propB.add(makeCarMesh(0xf2f2f2, 'sedan'));
    propB.add(makeLightbar());
    propB.position.set(70, 0, 365.5);
    propB.rotation.y = -0.1;
    G.scene.add(propA);
    G.scene.add(propB);
  }

  setCamera(G, -13, 5.2, 349, 26, 1.5, 362);
}

// The mission frame: the player meets Lucia at her beachfront kiosk,
// story mission 1 about to begin, objective and subtitle on screen.
function stageMission(G) {
  G.mode = 'play';
  G.storyIndex = 0;
  const start = G.world.playerStart; // Lucia waits at (-45, 340)
  setPlayerOnFoot(G, -52, 333, headingToward(-52, 333, start.x, start.z));
  if (G.say) {
    G.say(['Lucia Ferrer: You came. Good — Solana rewards the bold.']);
  }
  setCamera(G, -58, 3.2, 322, -48.5, 1.2, 336.5);
}

// --- Entry point -----------------------------------------------------------
// Called once by main.js after the world, actors and mission system
// exist. Unknown names fall back to the cover staging.

export function applyShot(G, name) {
  switch (name) {
    case 'title':
      stageTitle(G);
      break;
    case 'drive':
      stageDrive(G);
      break;
    case 'chase':
      stageChase(G);
      break;
    case 'mission':
      stageMission(G);
      break;
    case 'cover':
    default:
      stageCover(G);
      break;
  }
}
