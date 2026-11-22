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

// recolorCarPaint(car, hex): repaint only the car's paint. The body
// shell is the first mesh makeCarMesh adds and its material belongs
// to this car alone; clone it onto every mesh that shares it, so the
// glass, trim and lights keep their own materials.
function recolorCarPaint(car, hex) {
  const body = car.mesh.children[0];
  if (!body || !body.material || !body.material.color) return;
  const original = body.material;
  const paint = original.clone();
  paint.color.setHex(hex);
  car.mesh.traverse((child) => {
    if (child.material === original) child.material = paint;
  });
}

function stageCover(G) {
  G.mode = 'play';
  const start = G.world.playerStart;
  const car = nearestCar(G, start.x, start.z, ['sport']) || nearestCar(G, start.x, start.z);
  if (car) {
    setCarPose(car, -18.5, 352.5, 0.35, 0);
    recolorCarPaint(car, 0xff5a4e);
  }
  // Hero pose: the player at the driver's door, facing the lens, the
  // coral car beside them, the avenue and palms in the midground and
  // the pastel skyline behind — the city is the backdrop. The camera
  // sits low and close so car and driver fill the centre third, with
  // the avenue running diagonally out of the frame.
  setPlayerOnFoot(G, -16.2, 353.8, headingToward(-16.2, 353.8, -25.5, 358.8));
  // Set dressing: two more cars rest on the avenue in the
  // mid-background (parked, so nothing drifts) and two locals idle on
  // the sidewalk behind the hero — a living beachfront, not a diorama.
  const setCars = G.cars.filter((c) => c !== car && c.state === 'traffic').slice(0, 2);
  const carSpots = [
    { x: 34, z: 354.5, h: Math.PI / 2 },
    { x: -72, z: 365.5, h: -Math.PI / 2 },
  ];
  setCars.forEach((c, i) => {
    if (!carSpots[i]) return;
    setCarPose(c, carSpots[i].x, carSpots[i].z, carSpots[i].h, 0);
    c.state = 'parked';
  });
  const pedSpots = [
    { x: -26, z: 347.5 },
    { x: -22, z: 350 },
  ];
  G.peds.slice(0, pedSpots.length).forEach((ped, i) => {
    if (!ped || !ped.mesh) return;
    ped.mesh.position.set(pedSpots[i].x, 0, pedSpots[i].z);
    ped.state = 'stand';
    ped.heading = headingToward(pedSpots[i].x, pedSpots[i].z, -25.5, 358.8);
    ped.mesh.rotation.y = ped.heading;
  });
  G.wanted = 0;
  setCamera(G, -25.5, 1.9, 358.8, -16.8, 1.15, 352.2);
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
  // Tight chase cam: nine metres behind the hero car (it runs +x at
  // heading PI/2) and low, looking eight metres past its nose, so
  // the car fills the lower frame against the downtown towers.
  setCamera(G, 81, 3.2, -180, 98, 1, -180);
}

// The chase frame: five stars on the beachfront avenue, police in the
// mirrors, a helicopter overhead and a blockade waiting down the road.
function stageChase(G) {
  G.mode = 'play';
  const hero = nearestCar(G, 0, 360, ['sport']) || nearestCar(G, 0, 360);
  if (hero) putPlayerInCar(G, hero, 0, 360, Math.PI / 2, 30);
  G.cameraYaw = Math.PI / 2;

  // 200 points = exactly five stars. Stepping the real police system
  // spawns genuine pursuit cars and the helicopter. The stepping is
  // defensive: one bad step must never abort the staging, and two in
  // a row end the loop — the dressing pass below poses the frame
  // either way, and the camera is always set at the end.
  addWanted(G, 200);
  let failures = 0;
  for (let step = 0; step < 40 && failures < 2; step++) {
    try {
      updatePolice(G, 0.1);
    } catch (err) {
      failures++;
    }
    if (G.cops.length >= 2 && G.heli) break;
  }

  // Dressing pass: wherever the simulation scattered them, the frame
  // needs the hero eastbound on the avenue with patrol cars in its
  // mirrors — re-pose the hero, then herd the nearest cops in close
  // behind it, 13 + (i % 3) * 5 metres back, one per avenue lane.
  if (hero) putPlayerInCar(G, hero, 0, 360, Math.PI / 2, 30);
  const dressLanes = [356.8, 363.5, 357.5];
  G.cops.slice(0, dressLanes.length).forEach((cop, i) => {
    if (!cop || !cop.mesh) return;
    const behind = 13 + (i % 3) * 5;
    cop.mesh.position.set(-behind, 0, dressLanes[i]);
    cop.heading = Math.PI / 2;
    cop.mesh.rotation.y = Math.PI / 2;
    cop.speed = 28;
  });

  // Helicopter: police.js keeps it as a record ({ mesh, angle }), so
  // pose the mesh — above the pursuit, rotor spun for the frame.
  if (G.heli && G.heli.mesh) {
    G.heli.mesh.position.set(-12, 13.5, 353);
    G.heli.mesh.rotation.y = Math.PI / 2;
    const rotor = G.heli.mesh.userData.rotor;
    if (rotor) rotor.rotation.y += 0.9;
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

  // From the beach, looking back along the avenue: hero in front,
  // patrol cars close behind it, the helicopter fully inside the
  // upper third of the frame, skyline beyond.
  setCamera(G, 20, 5.5, 338, -2, 1.2, 359.5);
}

// The mission frame: the player meets Lucia at her beach kiosk,
// story mission 1 about to begin, objective and subtitle on screen.
// In shot mode the mission system never ticks, so the staging does
// updateIdle's placement itself: Lucia (found by her hot-pink shirt;
// she is not one of G.peds) and her gold beacon (found by its gold
// pillar) are moved to the first story marker, her beach kiosk at
// (-60, 398), and the objective line is published for the HUD.
function stageMission(G) {
  G.mode = 'play';
  G.storyIndex = 0;
  // The true marker is (-60, 398), but a beach kiosk stands at
  // (-60, 402) and hides Lucia completely from any southern camera,
  // so the meeting is staged a few steps east of the kiosk — close
  // enough that the kiosk still dresses the frame's edge.
  const place = { x: -51, z: 397 };
  const pedMeshes = new Set(G.peds.map((p) => p.mesh));
  let lucia = null;
  let beacon = null;
  G.scene.traverse((obj) => {
    if (!lucia && !pedMeshes.has(obj) && obj.userData && obj.userData.torso
        && obj.userData.torso.material && obj.userData.torso.material.color
        && obj.userData.torso.material.color.getHex() === 0xff2e88) {
      lucia = obj;
    }
    if (!beacon && obj.geometry && obj.geometry.type === 'CylinderGeometry'
        && obj.material && obj.material.color
        && obj.material.color.getHex() === 0xf7c948) {
      beacon = obj.parent;
    }
  });
  if (lucia) {
    lucia.visible = true;
    lucia.position.set(place.x, 0, place.z);
    lucia.rotation.y = headingToward(place.x, place.z, -47, 391);
  }
  if (beacon) {
    beacon.visible = true;
    beacon.position.set(place.x, 0, place.z);
  }
  G.missionMarker = { x: place.x, z: place.z, kind: 'story' };
  G.objectiveText = 'Meet Lucia Ferrer — "First Wheels"';
  setPlayerOnFoot(G, -47, 391, headingToward(-47, 391, place.x, place.z));
  if (G.say) {
    G.say(['Lucia Ferrer: You came. Good — Solana rewards the bold.']);
  }
  // From the sand, closer in and low, looking north past the
  // meeting: Lucia, her beacon and the player sit large in the
  // centre against the avenue and the skyline, the kiosk held at
  // the frame's edge and little empty sand below.
  setCamera(G, -47.5, 1.7, 402.0, -50.3, 1.1, 396.6);
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
