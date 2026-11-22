// missions.js — the content heart of Costa Solana: Lucia Ferrer's
// seven-mission story, the street races, and the taxi fares that keep
// the island moving between crimes.
//
// One job: content and its state machines. The story is data (STORY
// below); this module runs it — a gold beacon marks the current goal,
// steps complete by proximity, fights spawn their own crews, races
// run a rival coupe over checkpoint circuits, and idle drivers get
// offered taxi fares. Everything the HUD and minimap need is published
// on G each frame: G.objectiveText, G.objectiveDist, G.missionMarker,
// G.raceCheckpoint, G.taxiBlip, G.raceRivalPos, G.hostileBlips.

import { CFG, DISTRICTS } from './config.js';
import { makePedMesh, knockDownPed } from './pedestrians.js';
import {
  makeCarMesh, forwardOf, dist2D, collideCircle, steerToward,
} from './vehicles.js';
import { syncStars } from './police.js';

/* ------------------------------------------------------------------ */
/* The story: Lucia Ferrer pulls the player into the underworld.       */
/* ------------------------------------------------------------------ */

// Step kinds: 'goto' (reach a place), 'deliver' (reach it, sometimes
// in a specific car), 'escape' (reach it while hot; clearWanted cools
// the heat on arrival), 'fight' (down a crew, then usually a deliver),
// 'checkpoints' (a timed ring run), 'race' (win the named race).
// Optional step fields: radius, timeLimit, needCar, requireVan,
// addWantedOnArrive, addWantedOnStart, sayAfter, clearWanted.
export const STORY = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    giver: 'Lucia Ferrer',
    place: { x: -60, z: 398 }, // her Playa Dorada beach kiosk
    rideAlong: true,
    intro: [
      "Lucia Ferrer: You made it to Costa Solana. Good — I need a driver, not a tourist.",
      "Lucia Ferrer: Take me to the Puerto Azul marina. The boat people owe me a conversation.",
    ],
    steps: [
      {
        kind: 'deliver', x: 360, z: 452, radius: 9, needCar: true,
        text: 'Drive Lucia to the Puerto Azul marina',
      },
    ],
    reward: 150,
  },
  {
    id: 'salt-run',
    title: 'Salt Run',
    giver: 'Lucia Ferrer',
    place: { x: 360, z: 452 }, // the marina dock entrance
    intro: [
      "Lucia Ferrer: The dock crew left a package for me at Muelle Industrial.",
      "Lucia Ferrer: Pick it up and bring it to the Casco Viejo plaza. Heads down — the CSPD watches that pier.",
    ],
    steps: [
      {
        kind: 'goto', x: -360, z: -360, radius: 8,
        text: 'Pick up the package at the Muelle Industrial docks',
        addWantedOnArrive: 40,
        sayAfter: [
          "Lucia Ferrer (phone): That's the one. The police just clocked you — move, but don't lose it.",
        ],
      },
      {
        kind: 'deliver', x: 45, z: 45, radius: 9,
        text: 'Deliver the package to the Casco Viejo plaza',
      },
    ],
    reward: 300,
  },
  {
    id: 'harbor-heat',
    title: 'Harbor Heat',
    giver: 'Lucia Ferrer',
    place: { x: 45, z: 45 }, // the old town plaza
    startWantedPoints: 80, // two stars the moment the job starts
    intro: [
      "Lucia Ferrer: That package bought us heat. Two stars' worth, by the sound of the sirens.",
      "Lucia Ferrer: Lose them and reach my Las Palmas safehouse. Don't stop for anything.",
    ],
    steps: [
      {
        kind: 'escape', x: -270, z: 90, radius: 10, clearWanted: true,
        text: 'Escape to the Las Palmas safehouse',
      },
    ],
    reward: 250,
  },
  {
    id: 'palm-grand-prix',
    title: 'Palm Grand Prix',
    giver: 'Lucia Ferrer',
    place: { x: -270, z: 90 }, // the Las Palmas safehouse corner
    intro: [
      "Lucia Ferrer: The Palm Grand Prix runs tonight. Winner takes the pot — and my respect.",
      "Lucia Ferrer: Beat the magenta coupe. No excuses, no second place.",
    ],
    steps: [
      { kind: 'race', race: 'Palm Grand Prix', text: 'Win the Palm Grand Prix' },
    ],
    reward: 800,
  },
  {
    id: 'bad-cargo',
    title: 'Bad Cargo',
    giver: 'Lucia Ferrer',
    place: { x: 45, z: 45 },
    intro: [
      "Lucia Ferrer: A rival crew is sitting on my cargo van at the industrial docks.",
      "Lucia Ferrer: Four of them, and none of them reasonable. Put them down, then bring my van back to me here.",
    ],
    steps: [
      {
        kind: 'fight', x: -360, z: -360, count: 4,
        vanAt: { x: -350, z: -350, heading: 0.8 },
        text: 'Clear the crew guarding the van at the docks',
      },
      {
        kind: 'deliver', x: 45, z: 45, radius: 10, requireVan: true,
        text: "Bring the cargo van back to Lucia at the plaza",
      },
    ],
    reward: 650,
  },
  {
    id: 'neon-regatta',
    title: 'Neon Regatta',
    giver: 'Lucia Ferrer',
    place: { x: 360, z: 452 },
    intro: [
      "Lucia Ferrer: Regatta weekend. The sponsors strung checkpoints from the marina to downtown.",
      "Lucia Ferrer: Hit all six before the clock dies. The police will love it — give them a show.",
    ],
    steps: [
      {
        kind: 'checkpoints', timeLimit: 150, addWantedOnStart: 40,
        text: 'Run the Neon Regatta checkpoints',
        points: [
          { x: 270, z: 360 }, { x: 270, z: 180 }, { x: 180, z: 0 },
          { x: 270, z: -90 }, { x: 180, z: -180 }, { x: 270, z: -270 },
        ],
      },
    ],
    reward: 700,
  },
  {
    id: 'solana-nights',
    title: 'Solana Nights',
    giver: 'Lucia Ferrer',
    place: { x: 270, z: -270 }, // a downtown Marina Alta corner
    rideAlong: true,
    finale: true,
    startWantedPoints: 160, // four stars: the whole city is coming
    intro: [
      "Lucia Ferrer: One last run, and we're ghosts. Get us to the lighthouse.",
      "Lucia Ferrer: Every badge in the city will be behind us. Drive like the island is sinking.",
    ],
    steps: [
      {
        kind: 'escape', x: 450, z: 450, radius: 11, clearWanted: true,
        text: 'Escape with Lucia to the lighthouse',
      },
    ],
    reward: 1500,
  },
];

/* ------------------------------------------------------------------ */
/* The races: checkpoint circuits on real road intersections.          */
/* ------------------------------------------------------------------ */

// A race starts at `start` (line up there, in a car); checkpoints are
// driven in order and the last one is the finish line. The Palm Grand
// Prix loops the old town blocks; the Marina Mile runs the whole
// beachfront avenue and turns into the marina.
export const RACES = [
  {
    name: 'Palm Grand Prix',
    prize: 900,
    start: { x: -270, z: 90 },
    checkpoints: [
      { x: -90, z: 90 }, { x: 90, z: 90 }, { x: 270, z: 90 }, { x: 270, z: -90 },
      { x: 90, z: -90 }, { x: -90, z: -90 }, { x: -270, z: -90 }, { x: -270, z: 90 },
    ],
  },
  {
    name: 'Marina Mile',
    prize: 450,
    start: { x: -405, z: 360 },
    checkpoints: [
      { x: -270, z: 360 }, { x: -90, z: 360 }, { x: 90, z: 360 },
      { x: 270, z: 360 }, { x: 360, z: 360 }, { x: 360, z: 452 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Small shared helpers.                                               */
/* ------------------------------------------------------------------ */

// districtNameAt(x, z) -> the name of the district governing a point,
// for flavour text like taxi destinations. Mirrors districtAt's
// first-match rule over the DISTRICTS table.
function districtNameAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d.name;
  }
  return 'Casco Viejo';
}

// blockCornersAround(x, z) -> the four sidewalk corners of the block
// containing a point. Ped records need real corners so that
// pedestrians.updatePeds can settle a panicked ped back onto a ring
// instead of chasing an undefined target. Block centres sit at
// 45 mod BLOCK on both axes (see city.js).
function blockCornersAround(x, z) {
  const snap = (v) => Math.round((v - 45) / CFG.BLOCK) * CFG.BLOCK + 45;
  const cx = snap(x);
  const cz = snap(z);
  return [
    { x: cx - 34, z: cz - 34 },
    { x: cx + 34, z: cz - 34 },
    { x: cx + 34, z: cz + 34 },
    { x: cx - 34, z: cz + 34 },
  ];
}

// fmtTime(seconds) -> "m:ss" for countdowns in the objective line.
function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// swingLimbs(ped, dt, speed): the pendulum walk cycle for peds this
// module moves itself (Lucia's crew) — pedestrians.animateWalk is not
// exported, so hostile peds get the same gait from here.
function swingLimbs(ped, dt, speed) {
  const u = ped.mesh.userData;
  ped.phase += dt * speed * 3.4;
  const swing = Math.sin(ped.phase) * Math.min(0.65, 0.3 + speed * 0.09);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing * 0.7;
  u.armR.rotation.x = swing * 0.7;
  ped.mesh.position.y = Math.abs(Math.cos(ped.phase)) * 0.05;
}

// makeBeacon(colorHex) -> { group, ring }: a pillar of light with a
// compact bobbing halo ring at head height — gold for story goals,
// teal for races. The ring stays person-sized on purpose: a wide
// flat torus reads as a floating bar from low camera angles.
// The pillar stays a soft shaft, never a blown-out column: normal
// blending at low opacity, front faces only. (Additive blending
// stacks the shaft's light onto an already bright golden-hour sky
// and saturates to white no matter how low the opacity goes;
// tinting toward the beacon colour keeps the shaft visibly gold.)
function makeBeacon(colorHex) {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.7, 26, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.38,
      blending: THREE.NormalBlending, depthWrite: false,
      side: THREE.FrontSide, fog: false,
    }),
  );
  pillar.position.y = 13;
  group.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.06, 8, 28),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, fog: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2;
  group.add(ring);
  return { group, ring };
}

// makeCheckpointRing() -> a big teal hoop to drive through, shared by
// the race circuits and the Regatta checkpoint run.
function makeCheckpointRing() {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.5, 0.4, 10, 32),
    new THREE.MeshBasicMaterial({
      color: 0x17e6c8, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  ring.visible = false;
  return ring;
}

/* ------------------------------------------------------------------ */
/* The mission system proper.                                          */
/* ------------------------------------------------------------------ */

// createMissionSystem(G) -> { update(dt) }. Builds the beacons, the
// checkpoint ring and Lucia herself, then drives story, races and
// taxi fares one frame at a time.
export function createMissionSystem(G) {
  // Story progress can arrive pre-set from a save (see save.js), so
  // whatever is already on G is kept rather than reset.
  G.storyIndex = G.storyIndex || 0;
  G.storyDone = !!G.storyDone;
  G.endingReady = !!G.endingReady;

  // World props owned by this module.
  const goldBeacon = makeBeacon(0xf7c948);
  G.scene.add(goldBeacon.group);
  const raceBeacons = RACES.map((def) => {
    const beacon = makeBeacon(0x17e6c8);
    beacon.group.position.set(def.start.x, 0, def.start.z);
    G.scene.add(beacon.group);
    return beacon;
  });
  const ring = makeCheckpointRing();
  G.scene.add(ring);

  // Lucia Ferrer: a ped mesh in a hot-pink shirt, repositioned to
  // each mission's start marker. She is NOT in G.peds — missions own
  // her, so traffic and gunfire bookkeeping never sweep her up.
  const luciaMesh = makePedMesh(G.rng);
  luciaMesh.userData.torso.material = new THREE.MeshLambertMaterial({ color: 0xff2e88 });
  G.scene.add(luciaMesh);

  // Mutable run state.
  let active = null; // { def, stepIdx, timeLeft, hostiles, van, cpIdx, hostilesSpawned }
  let race = null; // { def, forMission, phase, t, lastCount, time, playerIdx, rivalIdx, playerDone, rivalDone, rival }
  let taxi = null; // { phase: 'pickup'|'deliver', ped, pickup, dest, fare, timeLeft }
  let taxiTimer = 25; // seconds of driving before the first fare offer

  const playerPos = () => G.player.mesh.position;
  const currentStep = () => (active ? active.def.steps[active.stepIdx] : null);

  /* ------------------------- mission flow ------------------------- */

  // startMission(def): take the job — heat if the story demands it,
  // Lucia's briefing in subtitles, her name on the banner.
  function startMission(def) {
    active = {
      def, stepIdx: 0, timeLeft: null,
      hostiles: [], van: null, cpIdx: 0, hostilesSpawned: false,
    };
    if (def.startWantedPoints) {
      G.wantedPoints = Math.max(G.wantedPoints || 0, def.startWantedPoints);
      G.lastCrimeAt = G.time;
      syncStars(G);
    }
    cancelTaxi();
    G.say(def.intro);
    G.showBanner(def.title.toUpperCase(), 'A job from Lucia Ferrer');
    activateStep();
  }

  // activateStep(): per-step setup the moment a step becomes current:
  // timers, starting heat, and the Bad Cargo crew + van.
  function activateStep() {
    const step = currentStep();
    if (!step) return;
    active.cpIdx = 0;
    active.timeLeft = step.timeLimit || null;
    if (step.addWantedOnStart) G.addWanted(step.addWantedOnStart);
    if (step.kind === 'fight' && !active.hostilesSpawned) spawnCrew(step);
  }

  // completeStep(): arrival side-effects (heat, phone calls, cooling
  // off), then advance — or finish the mission on the last step.
  function completeStep() {
    const step = currentStep();
    if (step.addWantedOnArrive) G.addWanted(step.addWantedOnArrive);
    if (step.sayAfter) G.say(step.sayAfter);
    if (step.clearWanted) {
      G.wantedPoints = 0;
      syncStars(G);
    }
    active.stepIdx += 1;
    if (active.stepIdx >= active.def.steps.length) completeMission();
    else activateStep();
  }

  // completeMission(): pay out, banner, sting, save hook — and for
  // the finale, raise the flags main.js turns into the ending screen.
  function completeMission() {
    const def = active.def;
    G.cash = (G.cash || 0) + def.reward;
    G.showBanner('MISSION COMPLETE', `${def.title} · +$${def.reward}`);
    if (G.audioSfx && G.audioSfx.sting) G.audioSfx.sting();
    if (def.finale) {
      G.storyDone = true;
      G.endingReady = true;
    }
    G.storyIndex += 1;
    if (G.storyIndex >= STORY.length) G.storyDone = true;
    active = null;
    if (typeof G.onMissionComplete === 'function') G.onMissionComplete();
  }

  // failMission(): a blown timer ends the job with no pay; Lucia
  // waits at the same marker to run it again. Standing crew are
  // swept away; the fallen stay where they fell.
  function failMission() {
    if (!active) return;
    G.showBanner('MISSION FAILED', active.def.title);
    G.say(["Lucia Ferrer: That went sideways. Come back to me and we run it again."]);
    for (const hostile of active.hostiles) {
      if (hostile.state === 'stand') {
        G.scene.remove(hostile.mesh);
        const idx = G.peds.indexOf(hostile);
        if (idx >= 0) G.peds.splice(idx, 1);
      }
    }
    active = null;
  }

  /* --------------------- the Bad Cargo crew ----------------------- */

  // spawnCrew(step): the rival crew and their cargo van appear at the
  // docks. The hostiles are ordinary ped records (state 'stand', so
  // updatePeds leaves them be) flagged isHostile; this module walks
  // them at the player itself. The van is an ordinary parked car
  // record in G.cars, so the player can steal it like any other.
  function spawnCrew(step) {
    active.hostilesSpawned = true;
    const vanMesh = makeCarMesh(0x9aa0a6, 'van');
    vanMesh.position.set(step.vanAt.x, 0, step.vanAt.z);
    vanMesh.rotation.y = step.vanAt.heading;
    G.scene.add(vanMesh);
    const van = {
      mesh: vanMesh, kind: 'van', color: 0x9aa0a6,
      heading: step.vanAt.heading, speed: 0, targetSpeed: 0,
      state: 'parked', axis: 'x', line: step.vanAt.z, dir: 1,
      health: 100, driver: null, decideAt: null, turn: null,
      spin: 0, steerVis: 0, smoke: null, knockCooldown: 0,
    };
    G.cars.push(van);
    active.van = van;

    const offsets = [[-7, -5], [7, -5], [-7, 6], [7, 6]];
    for (let i = 0; i < (step.count || 4); i++) {
      const [ox, oz] = offsets[i % offsets.length];
      const x = step.x + ox;
      const z = step.z + oz;
      const mesh = makePedMesh(G.rng);
      mesh.position.set(x, 0, z);
      G.scene.add(mesh);
      const hostile = {
        mesh,
        heading: G.rng() * Math.PI * 2,
        speed: 3.4,
        state: 'stand',
        target: { x, z },
        corners: blockCornersAround(x, z),
        cornerIdx: 0,
        panic: 0,
        downTimer: 0,
        health: 100,
        phase: G.rng() * Math.PI * 2,
        isHostile: true,
        meleeAt: 0,
        bumpAt: 0,
      };
      mesh.rotation.y = hostile.heading;
      G.peds.push(hostile);
      active.hostiles.push(hostile);
    }
  }

  // updateCrew(dt): the fight itself. Standing hostiles close on the
  // player inside 40 units and swing once a second inside arm's
  // reach; a slow car bump floors one the way knockDownPed intends
  // (fast rams are vehicles.runOverPeds' department). Downed and dead
  // hostiles belong to updatePeds and the completion count.
  function updateCrew(dt) {
    const pp = playerPos();
    for (const hostile of active.hostiles) {
      if (hostile.state !== 'stand') continue;
      const hp = hostile.mesh.position;
      const d = dist2D(hp.x, hp.z, pp.x, pp.z);
      if (d <= 1.6) {
        hostile.mesh.rotation.y = Math.atan2(pp.x - hp.x, pp.z - hp.z);
        if (G.time - hostile.meleeAt >= 1) {
          hostile.meleeAt = G.time;
          G.damagePlayer(6);
        }
      } else if (d < 40) {
        const desired = Math.atan2(pp.x - hp.x, pp.z - hp.z);
        hostile.heading = steerToward(hostile.heading, desired, 6 * dt);
        const fwd = forwardOf(hostile.heading);
        hp.x += fwd.x * 3.4 * dt;
        hp.z += fwd.z * 3.4 * dt;
        collideCircle(G.world.colliders, hp, 0.5);
        hostile.mesh.rotation.y = hostile.heading;
        swingLimbs(hostile, dt, 3.4);
      }
      // A nudge from the player's car at crawling speed still puts a
      // guard on the pavement — with real damage, not a free pass.
      if (G.player.car && G.time - hostile.bumpAt > 0.5) {
        const cp = G.player.car.mesh.position;
        const cd = dist2D(hp.x, hp.z, cp.x, cp.z);
        const speed = Math.abs(G.player.car.speed);
        if (cd < 2.7 && speed > 1 && speed < 3.5) {
          hostile.bumpAt = G.time;
          hostile.health -= 40;
          knockDownPed(hostile, 3);
        }
      }
    }
  }

  /* --------------------------- races ------------------------------ */

  // startRace(def, forMission): the magenta coupe lines up beside the
  // player at the start beacon and the countdown begins. A mission
  // race pays the mission reward instead of the street prize.
  function startRace(def, forMission) {
    const first = def.checkpoints[0];
    const heading0 = Math.atan2(first.x - def.start.x, first.z - def.start.z);
    const rivalMesh = makeCarMesh(0xff2fd6, 'sport');
    const rx = -Math.cos(heading0); // right of the first leg
    const rz = Math.sin(heading0);
    rivalMesh.position.set(def.start.x + rx * 4.5, 0, def.start.z + rz * 4.5);
    rivalMesh.rotation.y = heading0;
    G.scene.add(rivalMesh);
    cancelTaxi();
    race = {
      def, forMission,
      phase: 'countdown', t: 0, lastCount: 4, time: 0,
      playerIdx: 0, rivalIdx: 0, playerDone: false, rivalDone: false,
      rival: { mesh: rivalMesh, heading: heading0, speed: 34 },
    };
    G.showBanner(def.name.toUpperCase(), forMission ? 'Beat the magenta coupe' : `Winner takes $${def.prize}`);
  }

  // endRace(won): settle up and strike the rival. A lost mission race
  // is not a failed mission — the step stays live for another run.
  function endRace(won) {
    const def = race.def;
    const forMission = race.forMission;
    G.scene.remove(race.rival.mesh);
    race = null;
    if (forMission) {
      if (won) {
        completeStep();
      } else {
        G.showBanner('OUTRUN', 'The magenta coupe took the Grand Prix — line up and try again.');
        G.say(["Lucia Ferrer: Second place is just first loser. Run it again."]);
      }
    } else if (won) {
      G.cash = (G.cash || 0) + def.prize;
      G.showBanner('RACE WON', `${def.name} · +$${def.prize}`);
      if (G.audioSfx && G.audioSfx.cash) G.audioSfx.cash();
    } else {
      G.showBanner('OUTRUN', `${def.name} — the magenta coupe was faster.`);
    }
  }

  // racePosition(): 'P1' while the player leads — more checkpoints
  // banked wins; on a tie, whoever is closer to the next one leads.
  function racePosition() {
    if (race.playerIdx !== race.rivalIdx) return race.playerIdx > race.rivalIdx ? 'P1' : 'P2';
    const pp = playerPos();
    const cp = race.def.checkpoints[race.playerIdx];
    if (!cp) return 'P1';
    const rp = race.rival.mesh.position;
    return dist2D(pp.x, pp.z, cp.x, cp.z) <= dist2D(rp.x, rp.z, cp.x, cp.z) ? 'P1' : 'P2';
  }

  // updateRace(dt): countdown, then the run — rival steering, player
  // progress (in a car only), and the finish-line verdicts.
  function updateRace(dt) {
    const def = race.def;
    const pp = playerPos();
    G.raceRivalPos = { x: race.rival.mesh.position.x, z: race.rival.mesh.position.z };

    if (race.phase === 'countdown') {
      race.t += dt;
      const count = Math.ceil(3 - race.t);
      if (count >= 1 && count !== race.lastCount) {
        race.lastCount = count;
        G.showBanner(String(count), def.name);
      }
      G.objectiveText = `${def.name} — get ready…`;
      G.objectiveDist = null;
      G.raceCheckpoint = def.checkpoints[0];
      if (race.t >= 3) {
        race.phase = 'run';
        race.time = 0;
        G.showBanner('GO!', def.name);
      }
      return;
    }

    race.time += dt;

    // The rival: steer at its next checkpoint at a flat 34 units/s —
    // fast enough to respect, slow enough for a sportscar to beat.
    const rival = race.rival;
    const rcp = def.checkpoints[race.rivalIdx];
    if (rcp && !race.rivalDone) {
      const rp = rival.mesh.position;
      const desired = Math.atan2(rcp.x - rp.x, rcp.z - rp.z);
      rival.heading = steerToward(rival.heading, desired, 1.9 * dt);
      const fwd = forwardOf(rival.heading);
      rp.x += fwd.x * rival.speed * dt;
      rp.z += fwd.z * rival.speed * dt;
      collideCircle(G.world.colliders, rp, 2.1);
      rival.mesh.rotation.y = rival.heading;
      if (dist2D(rp.x, rp.z, rcp.x, rcp.z) < 11) {
        race.rivalIdx += 1;
        if (race.rivalIdx >= def.checkpoints.length) race.rivalDone = true;
      }
    }

    // Player progress through the same rings, car required.
    const pcp = def.checkpoints[race.playerIdx];
    if (pcp) {
      G.raceCheckpoint = pcp;
      if (G.player.car && dist2D(pp.x, pp.z, pcp.x, pcp.z) < 12) {
        race.playerIdx += 1;
        if (race.playerIdx >= def.checkpoints.length) {
          race.playerDone = true;
          endRace(!race.rivalDone);
          return;
        }
      }
    }

    // The coupe finished first: the race is lost on the spot.
    if (race.rivalDone && !race.playerDone) {
      endRace(false);
      return;
    }

    G.objectiveText = `${def.name} — checkpoint ${Math.min(race.playerIdx + 1, def.checkpoints.length)}/${def.checkpoints.length} · ${racePosition()}`;
    G.objectiveDist = pcp ? dist2D(pp.x, pp.z, pcp.x, pcp.z) : null;
  }

  // tryStartRaces(): show the start beacons that are currently on
  // offer (both in free roam; only the mission's own race during its
  // race step) and start one when a driver lines up inside it.
  function tryStartRaces() {
    const pp = playerPos();
    const step = currentStep();
    const missionRace = step && step.kind === 'race' ? step.race : null;
    RACES.forEach((def, i) => {
      const offered = !active || missionRace === def.name;
      raceBeacons[i].group.visible = offered;
      if (offered && G.player.car
        && dist2D(pp.x, pp.z, def.start.x, def.start.z) < 9) {
        startRace(def, missionRace === def.name);
      }
    });
  }

  /* --------------------------- taxi ------------------------------- */

  // spawnFare(): a pedestrian in an orange shirt starts waiting at a
  // sidewalk point 60–150 units away. The orange blip is theirs.
  function spawnFare() {
    const pp = playerPos();
    const candidates = G.world.pedSpawnPoints.filter((p) => {
      const d = dist2D(pp.x, pp.z, p.x, p.z);
      return d >= 60 && d <= 150;
    });
    if (!candidates.length) return;
    const point = candidates[Math.floor(G.rng() * candidates.length)];
    const mesh = makePedMesh(G.rng);
    mesh.userData.torso.material = new THREE.MeshLambertMaterial({ color: 0xff9f43 });
    mesh.position.set(point.x, 0, point.z);
    G.scene.add(mesh);
    const ped = {
      mesh,
      heading: G.rng() * Math.PI * 2,
      speed: 1.6,
      state: 'stand',
      target: { x: point.x, z: point.z },
      corners: blockCornersAround(point.x, point.z),
      cornerIdx: 0,
      panic: 0,
      downTimer: 0,
      health: 100,
      phase: G.rng() * Math.PI * 2,
    };
    mesh.rotation.y = ped.heading;
    G.peds.push(ped);
    taxi = {
      phase: 'pickup', ped,
      pickup: { x: point.x, z: point.z },
      dest: null, fare: 0, timeLeft: 0,
    };
    G.notify('Taxi fare waiting nearby — check the orange blip.');
  }

  // cancelTaxi(): a mission or a race always outranks a fare. A
  // waiting passenger is removed; one already aboard just gets out
  // of the story (their ped record is already gone).
  function cancelTaxi() {
    if (taxi && taxi.phase === 'pickup' && taxi.ped) {
      G.scene.remove(taxi.ped.mesh);
      const idx = G.peds.indexOf(taxi.ped);
      if (idx >= 0) G.peds.splice(idx, 1);
    }
    taxi = null;
    taxiTimer = 25;
  }

  // updateTaxi(dt): the fare state machine — wait, board, ride, pay.
  // Runs only in free roam: missions and races cancel fares on sight.
  function updateTaxi(dt) {
    const pp = playerPos();
    if (!taxi) {
      // Offers only arrive for a driver at the wheel, roughly every
      // 25 seconds of cruising.
      if (G.player.car) {
        taxiTimer -= dt;
        if (taxiTimer <= 0) {
          spawnFare();
          taxiTimer = taxi ? 25 : 6; // no kerb nearby: ask again soon
        }
      }
      return;
    }

    if (taxi.phase === 'pickup') {
      G.objectiveText = 'Taxi fare waiting — pick them up';
      G.objectiveDist = dist2D(pp.x, pp.z, taxi.pickup.x, taxi.pickup.z);
      if (G.player.car && G.objectiveDist < 6) {
        // Aboard: the passenger leaves the street and the meter runs.
        G.scene.remove(taxi.ped.mesh);
        const idx = G.peds.indexOf(taxi.ped);
        if (idx >= 0) G.peds.splice(idx, 1);
        taxi.ped = null;
        const dests = G.world.carSpawnPoints.filter((p) => {
          const d = dist2D(pp.x, pp.z, p.x, p.z);
          return d >= 200 && d <= 500;
        });
        const dest = dests.length
          ? dests[Math.floor(G.rng() * dests.length)]
          : G.world.carSpawnPoints[0];
        taxi.dest = { x: dest.x, z: dest.z };
        const trip = dist2D(pp.x, pp.z, taxi.dest.x, taxi.dest.z);
        taxi.fare = 40 + Math.round(trip / 4);
        taxi.timeLeft = (trip / 14) * 1.6; // a generous estimate
        taxi.phase = 'deliver';
        G.notify(`Fare aboard — ${districtNameAt(taxi.dest.x, taxi.dest.z)}. $${taxi.fare} on the meter.`);
      }
      return;
    }

    // Deliver phase: the tip survives only while the estimate does;
    // the base fare is paid whenever the passenger arrives.
    if (taxi.timeLeft > 0) taxi.timeLeft -= dt;
    G.objectiveText = `Taxi fare to ${districtNameAt(taxi.dest.x, taxi.dest.z)} — $${taxi.fare}`;
    G.objectiveDist = dist2D(pp.x, pp.z, taxi.dest.x, taxi.dest.z);
    if (G.objectiveDist < 8) {
      const tip = taxi.timeLeft > 0 ? Math.round(taxi.fare * 0.25) : 0;
      G.cash = (G.cash || 0) + taxi.fare + tip;
      G.showBanner('FARE PAID', tip ? `$${taxi.fare} + $${tip} tip` : `$${taxi.fare}`);
      if (G.audioSfx && G.audioSfx.cash) G.audioSfx.cash();
      taxi = null;
      taxiTimer = 20 + G.rng() * 10;
    }
  }

  /* --------------------- per-frame step logic --------------------- */

  // updateMission(dt): timers, arrival checks and the objective line
  // for whichever step is current.
  function updateMission(dt) {
    const def = active.def;
    const step = currentStep();
    const pp = playerPos();

    // Lucia waits at the start marker unless this is a ride-along
    // job, in which case she is in the passenger seat of the story.
    luciaMesh.visible = !def.rideAlong;
    if (!def.rideAlong) {
      luciaMesh.position.set(def.place.x, 0, def.place.z);
      faceLucia(pp);
    }

    // A blown step timer fails the whole mission.
    if (active.timeLeft !== null) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) {
        failMission();
        return;
      }
    }

    if (step.kind === 'goto' || step.kind === 'deliver' || step.kind === 'escape') {
      G.missionMarker = { x: step.x, z: step.z, kind: 'story' };
      goldBeacon.group.visible = true;
      goldBeacon.group.position.set(step.x, 0, step.z);
      const d = dist2D(pp.x, pp.z, step.x, step.z);
      G.objectiveDist = d;
      G.objectiveText = step.text;
      if (d < (step.radius || 8)) {
        if (step.requireVan && G.player.car !== active.van) {
          G.objectiveText = "Wrong wheels — this delivery needs the crew's cargo van.";
        } else if (step.needCar && !G.player.car) {
          G.objectiveText = 'Grab a car — Lucia is not walking to the marina.';
        } else {
          completeStep();
        }
      }
      return;
    }

    if (step.kind === 'fight') {
      updateCrew(dt);
      G.missionMarker = { x: step.x, z: step.z, kind: 'story' };
      goldBeacon.group.visible = true;
      goldBeacon.group.position.set(step.x, 0, step.z);
      G.hostileBlips = active.hostiles
        .filter((h) => h.state !== 'dead')
        .map((h) => ({ x: h.mesh.position.x, z: h.mesh.position.z }));
      const standing = active.hostiles
        .filter((h) => h.state !== 'down' && h.state !== 'dead').length;
      G.objectiveText = standing > 0
        ? `${step.text} — ${standing} still standing`
        : step.text;
      G.objectiveDist = dist2D(pp.x, pp.z, step.x, step.z);
      if (standing === 0) completeStep();
      return;
    }

    if (step.kind === 'checkpoints') {
      const points = step.points;
      const cp = points[active.cpIdx];
      if (!cp) {
        completeStep();
        return;
      }
      G.raceCheckpoint = cp;
      ring.visible = true;
      ring.position.set(cp.x, 3, cp.z);
      const next = points[active.cpIdx + 1] || cp;
      ring.rotation.y = Math.atan2(next.x - cp.x, next.z - cp.z);
      G.objectiveText = `${step.text} — ${active.cpIdx}/${points.length} · ${fmtTime(active.timeLeft || 0)}`;
      G.objectiveDist = dist2D(pp.x, pp.z, cp.x, cp.z);
      if (G.player.car && G.objectiveDist < 12) {
        active.cpIdx += 1;
        if (active.cpIdx >= points.length) completeStep();
      }
      return;
    }

    if (step.kind === 'race') {
      if (race) return; // updateRace owns the objective mid-race
      const raceDef = RACES.find((r) => r.name === step.race);
      G.missionMarker = { x: raceDef.start.x, z: raceDef.start.z, kind: 'story' };
      G.objectiveText = `${step.text} — line up at the teal beacon, in a car`;
      G.objectiveDist = dist2D(pp.x, pp.z, raceDef.start.x, raceDef.start.z);
    }
  }

  // updateIdle(dt): no job on — Lucia waits at the next start marker
  // and the walk-up trigger (on foot, within 3.5) takes the job.
  function updateIdle(dt) {
    const pp = playerPos();
    if (G.storyIndex >= STORY.length) {
      luciaMesh.visible = false;
      G.objectiveText = 'Solana is yours — the races and the taxi rank still pay.';
      G.objectiveDist = null;
      return;
    }
    const def = STORY[G.storyIndex];
    luciaMesh.visible = true;
    luciaMesh.position.set(def.place.x, 0, def.place.z);
    faceLucia(pp);
    goldBeacon.group.visible = true;
    goldBeacon.group.position.set(def.place.x, 0, def.place.z);
    G.missionMarker = { x: def.place.x, z: def.place.z, kind: 'story' };
    G.objectiveText = `Meet Lucia Ferrer — "${def.title}"`;
    G.objectiveDist = dist2D(pp.x, pp.z, def.place.x, def.place.z);
    if (!G.player.car && G.objectiveDist < 3.5) startMission(def);
  }

  // faceLucia(pp): Lucia turns to face a nearby player and bobs
  // gently — alive, waiting, impatient.
  function faceLucia(pp) {
    const lp = luciaMesh.position;
    if (dist2D(lp.x, lp.z, pp.x, pp.z) < 14) {
      luciaMesh.rotation.y = Math.atan2(pp.x - lp.x, pp.z - lp.z);
    }
    luciaMesh.position.y = Math.abs(Math.sin(G.time * 2.2)) * 0.04;
  }

  /* ------------------------- the update --------------------------- */

  // update(dt): publish this frame's blips and objective, run the
  // active system (race > mission > idle), offer fares in free roam,
  // and keep every beacon breathing.
  function update(dt) {
    const pp = playerPos();

    // Defaults: branches below turn on what they own.
    G.missionMarker = null;
    G.raceCheckpoint = null;
    G.taxiBlip = taxi
      ? (taxi.phase === 'pickup' ? taxi.pickup : taxi.dest)
      : null;
    G.hostileBlips = [];
    G.raceRivalPos = null;
    goldBeacon.group.visible = false;
    ring.visible = false;
    if (race) for (const beacon of raceBeacons) beacon.group.visible = false;

    if (race) updateRace(dt);
    if (active) updateMission(dt);
    else if (!race) updateIdle(dt);
    if (!active && !race) updateTaxi(dt);
    if (!race) tryStartRaces();

    // Beacons breathe: rings bob and spin while they are shown.
    const bob = Math.sin(G.time * 2) * 0.35;
    goldBeacon.ring.position.y = 2 + bob;
    goldBeacon.ring.rotation.z += dt * 1.5;
    for (const beacon of raceBeacons) {
      beacon.ring.position.y = 2 + bob;
      beacon.ring.rotation.z += dt * 1.5;
    }
    if (ring.visible) {
      const pulse = 1 + Math.sin(G.time * 4) * 0.05;
      ring.scale.set(pulse, pulse, pulse);
    }

    // Lucia idles even through ride-along missions (she is hidden,
    // but her bob keeps the pose warm for her next appearance).
    if (luciaMesh.visible) faceLucia(pp);
  }

  return { update };
}
