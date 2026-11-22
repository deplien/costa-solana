// weapons.js — hands, hardware and consequences: the player's three
// ways to start an argument in Costa Solana.
//
// One job: weapons. Fists for the personal touch, a pistol for
// deliberate work, and the Solana SMG for volume. Shots are resolved
// against the camera's aim with a simple cone test — no physics
// engine, just dot products — and every bang is loud: G.danger marks
// the spot for fleeing crowds, the police hear about it in wanted
// points, and the camera kicks.

import { forwardOf, dist2D } from './vehicles.js';

// The arsenal. damage is per hit; range in world units; cooldown in
// seconds between shots; auto weapons keep firing while held.
// ammoKey names the G.ammo pool the weapon drinks from (null = the
// weapon is its own ammunition, i.e. fists).
export const WEAPONS = [
  { id: 'fists', name: 'Fists', damage: 12, range: 2.3, cooldown: 0.38, auto: false, ammoKey: null },
  { id: 'pistol', name: 'Pistol', damage: 34, range: 90, cooldown: 0.26, auto: false, ammoKey: 'pistol' },
  { id: 'smg', name: 'Solana SMG', damage: 20, range: 75, cooldown: 0.09, auto: true, ammoKey: 'smg' },
];

const START_AMMO = { pistol: 60, smg: 160 };
const TRACER_COUNT = 6; // pooled tracer lines, recycled per shot

// initWeapons(G): set up the player's weapon state — selection,
// ammunition, cooldown bookkeeping — and build the gun model that
// rides in the player's right hand whenever a firearm is selected.
// The muzzle flash and tracer pool are created here too, hidden.
export function initWeapons(G) {
  G.weaponIndex = 0;
  G.ammo = { ...START_AMMO };
  G._fireCooldown = 0;
  G._firePrev = false;
  G._weaponKeysPrev = {};

  const gun = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x22262a });
  const grip = new THREE.MeshLambertMaterial({ color: 0x4a3220 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.52), metal);
  body.position.set(0, 0.02, 0.14);
  gun.add(body);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), grip);
  handle.position.set(0, -0.1, -0.05);
  gun.add(handle);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.09), metal);
  mag.position.set(0, -0.12, 0.16);
  gun.add(mag);
  gun.position.set(0.37, 1.02, 0.18);
  gun.visible = false;
  G.player.mesh.add(gun);
  G.gunMesh = gun;

  // Muzzle flash: a small additive star at the barrel tip, shown for
  // a few hundredths of a second per shot.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({
      color: 0xffc44d, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0, 0.04, 0.48);
  flash.visible = false;
  gun.add(flash);
  G._muzzle = { mesh: flash, until: 0 };

  // Tracer pool: thin lines from muzzle to impact, gone in a blink.
  G._tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geom = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(), new THREE.Vector3()],
    );
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.85,
    }));
    line.visible = false;
    line.frustumCulled = false;
    G.scene.add(line);
    G._tracers.push({ line, until: 0 });
  }
  G._tracerIdx = 0;
}

/* ------------------------------------------------------------------ */
/* Selection: number keys jump, Q cycles, empty guns holster themselves. */
/* ------------------------------------------------------------------ */

// keyEdge(G, code): true only on the frame this key went down.
function keyEdge(G, code) {
  const held = G.input.keys.has(code);
  const prev = !!G._weaponKeysPrev[code];
  G._weaponKeysPrev[code] = held;
  return held && !prev;
}

// selectWeapon(G, idx): draw the chosen weapon; the gun model shows
// for firearms and hides for fists.
function selectWeapon(G, idx) {
  G.weaponIndex = THREE.MathUtils.clamp(idx, 0, WEAPONS.length - 1);
  if (G.gunMesh) G.gunMesh.visible = G.weaponIndex > 0;
}

// updateSelection(G): Digit1/2/3 pick directly, Q walks the wheel.
function updateSelection(G) {
  if (keyEdge(G, 'Digit1')) selectWeapon(G, 0);
  if (keyEdge(G, 'Digit2')) selectWeapon(G, 1);
  if (keyEdge(G, 'Digit3')) selectWeapon(G, 2);
  if (keyEdge(G, 'KeyQ')) selectWeapon(G, (G.weaponIndex + 1) % WEAPONS.length);
}

/* ------------------------------------------------------------------ */
/* Target picking: a narrow cone along the camera's aim.               */
/* ------------------------------------------------------------------ */

// allTargetCars(G): every shootable car record — traffic, parked,
// patrol and roadblock cars alike.
function allTargetCars(G) {
  let cars = G.cars.concat(G.cops || []);
  if (G.blockades) {
    for (const block of G.blockades) cars = cars.concat(block.cars);
  }
  return cars;
}

// coneTest(origin, dir, tx, ty, tz, range, radius) -> the distance
// along the ray if the target centre passes within radius of it,
// else -1. The whole hit model of the game in one dot product.
function coneTest(origin, dir, tx, ty, tz, range, radius) {
  const dx = tx - origin.x;
  const dy = ty - origin.y;
  const dz = tz - origin.z;
  const along = dx * dir.x + dy * dir.y + dz * dir.z;
  if (along < 0.5 || along > range) return -1;
  const px = dx - dir.x * along;
  const py = dy - dir.y * along;
  const pz = dz - dir.z * along;
  const perp = Math.sqrt(px * px + py * py + pz * pz);
  return perp <= radius ? along : -1;
}

// pickTarget(G, origin, dir, range) -> the nearest thing the shot
// connects with: { kind: 'ped'|'car'|'copcar', ref, along } or null.
function pickTarget(G, origin, dir, range) {
  let best = null;
  const consider = (kind, ref, tx, ty, tz, radius, isCop) => {
    const along = coneTest(origin, dir, tx, ty, tz, range, radius);
    if (along > 0 && (!best || along < best.along)) {
      best = { kind, ref, along, isCop };
    }
  };
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.state === 'dead') continue;
    const p = ped.mesh.position;
    consider('ped', ped, p.x, p.y + 1.15, p.z, 0.85, !!ped.isCop);
  }
  for (const car of allTargetCars(G)) {
    const p = car.mesh.position;
    const isCop = car.state === 'chase' || car.state === 'block';
    consider(isCop ? 'copcar' : 'car', car, p.x, p.y + 0.7, p.z, 2.3, isCop);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Firing: noise, light, and paperwork (wanted points).                */
/* ------------------------------------------------------------------ */

// fireMelee(G, weapon): a swing at whoever is in front of the
// player's fists. Cheap, quiet-ish, still very much a crime.
function fireMelee(G, weapon) {
  const pp = G.player.mesh.position;
  const fwd = forwardOf(G.player.heading);
  let hit = null;
  let hitDist = weapon.range;
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.state === 'dead') continue;
    const p = ped.mesh.position;
    const d = dist2D(pp.x, pp.z, p.x, p.z);
    if (d > weapon.range) continue;
    const dot = ((p.x - pp.x) * fwd.x + (p.z - pp.z) * fwd.z) / (d || 1);
    if (dot > 0.25 && d < hitDist) {
      hit = ped;
      hitDist = d;
    }
  }
  G.danger = { x: pp.x, z: pp.z, until: G.time + 2 };
  if (hit) {
    hit.health -= weapon.damage;
    hit.state = 'down';
    hit.downTimer = 4;
    G.addWanted(20);
    G.shake = Math.max(G.shake || 0, 0.18);
  }
}

// fireGun(G, weapon): one bullet along the camera's aim. Applies
// damage to the nearest target in the cone, draws the tracer and
// flash, and reports the noise to everyone in earshot (the police).
function fireGun(G, weapon) {
  const pp = G.player.mesh.position;
  const origin = { x: pp.x, y: pp.y + 1.45, z: pp.z };
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  // Face the shot: the body turns to the camera's aim as it fires.
  G.player.heading = Math.atan2(dir.x, dir.z);
  G.player.mesh.rotation.y = G.player.heading;

  const hit = pickTarget(G, origin, dir, weapon.range);
  const endDist = hit ? hit.along : weapon.range;
  const end = {
    x: origin.x + dir.x * endDist,
    y: origin.y + dir.y * endDist,
    z: origin.z + dir.z * endDist,
  };

  if (hit) {
    const ref = hit.ref;
    if (hit.kind === 'ped') {
      ref.health -= weapon.damage;
      ref.state = ref.health <= 0 ? 'dead' : 'down';
      ref.downTimer = 4;
      if (ref.state === 'dead') {
        ref.mesh.rotation.x = -Math.PI / 2;
        ref.mesh.position.y = 0.25;
      }
      G.addWanted(hit.isCop ? 60 : 45);
    } else {
      ref.health = Math.max(0, ref.health - weapon.damage);
      G.addWanted(hit.isCop ? 25 : 10);
    }
  }

  // Muzzle flash and a tracer from the gun tip to the impact point.
  const tip = G.gunMesh
    ? G.gunMesh.localToWorld(new THREE.Vector3(0, 0.04, 0.5))
    : new THREE.Vector3(origin.x, origin.y, origin.z);
  if (G._muzzle) {
    G._muzzle.mesh.visible = true;
    G._muzzle.until = G.time + 0.045;
  }
  const tracer = G._tracers[G._tracerIdx++ % G._tracers.length];
  const attr = tracer.line.geometry.attributes.position;
  attr.setXYZ(0, tip.x, tip.y, tip.z);
  attr.setXYZ(1, end.x, end.y, end.z);
  attr.needsUpdate = true;
  tracer.line.visible = true;
  tracer.until = G.time + 0.06;

  G.danger = { x: pp.x, z: pp.z, until: G.time + 2.5 };
  G.shake = Math.max(G.shake || 0, 0.22);
  G.ammo[weapon.ammoKey] -= 1;
  if (G.ammo[weapon.ammoKey] <= 0) selectWeapon(G, 0); // click: fists
}

// updateWeapons(G, dt): selection keys, trigger discipline (semi
// weapons need a fresh press, the SMG does not), cooldowns, and
// retiring last frame's flashes and tracers. On foot only — Costa
// Solana has not legalised drive-bys.
export function updateWeapons(G, dt) {
  if (G.mode !== 'play' || G.paused) return;

  // Effects retire on schedule even with no weapon drawn.
  if (G._muzzle && G.time > G._muzzle.until) G._muzzle.mesh.visible = false;
  if (G._tracers) {
    for (const tracer of G._tracers) {
      if (tracer.line.visible && G.time > tracer.until) tracer.line.visible = false;
    }
  }

  updateSelection(G);
  G._fireCooldown = Math.max(0, (G._fireCooldown || 0) - dt);
  if (G.player.car) {
    G._firePrev = !!G.input.fireHeld;
    return;
  }

  const weapon = WEAPONS[G.weaponIndex];
  const held = !!G.input.fireHeld;
  const trigger = weapon.auto ? held : held && !G._firePrev;
  G._firePrev = held;
  if (!trigger || G._fireCooldown > 0) return;
  if (weapon.ammoKey && G.ammo[weapon.ammoKey] <= 0) {
    selectWeapon(G, 0);
    return;
  }
  G._fireCooldown = weapon.cooldown;
  if (weapon.ammoKey) fireGun(G, weapon);
  else fireMelee(G, weapon);
}
