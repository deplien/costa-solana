// main.js — the integrator for Costa Solana. It owns the renderer,
// the shared game-state object G, all input, the screen flow (title,
// pause, busted, wasted, ending) and the main loop. Every other module
// is a specialist that reads and writes G; this file wires them
// together in build order and keeps them running at frame rate.

import { CFG } from './config.js';
import { makeRng } from './random.js';
import { buildCity } from './city.js';
import { spawnTraffic, updateTraffic, updateCarVisuals } from './vehicles.js';
import { spawnPeds, updatePeds, knockDownPed } from './pedestrians.js';
import { createPlayer, updatePlayer, updateCamera } from './player.js';
import { addWanted, syncStars, updatePolice } from './police.js';
import { initWeapons, updateWeapons } from './weapons.js';
import { createMissionSystem } from './missions.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { createAudio } from './audio.js';
import { saveGame, loadGame, hasSave } from './save.js';
import { applyShot } from './shots.js';

// --- URL parameters --------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const seedParam = parseInt(params.get('seed') || '1', 10);
const shotName = params.get('shot');

// --- DOM handles -----------------------------------------------------------
const containerEl = document.getElementById('game');
const hudEl = document.getElementById('hud');
const titleScreenEl = document.getElementById('title-screen');
const pauseScreenEl = document.getElementById('pause-screen');
const endScreenEl = document.getElementById('end-screen');
const endTitleEl = document.getElementById('end-title');
const endSubEl = document.getElementById('end-sub');
const statusEl = document.getElementById('status');

// --- Module-scope state ------------------------------------------------------
// G is the one shared state object every module works on. The system
// handles stay null until boot() builds them.
let G = null;
let hud = null;
let minimap = null;
let audioSys = null;
let missions = null;
let saveTimer = 0;
let prevMode = 'title';

// --- Boot --------------------------------------------------------------------
// Builds the renderer, the state object, the city and every actor
// system, in the order the contract fixes: world first, then the
// player, traffic and crowds, weapons, the saved game (before the
// mission system reads the story index), HUD, minimap, audio, and
// finally missions. A ?shot= staging, when requested, poses the
// finished scene for the dossier cameras.
function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding; // three r147 colour space
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  containerEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 6000
  );
  const rng = makeRng(Number.isFinite(seedParam) ? seedParam : 1);

  G = {
    scene,
    camera,
    renderer,
    rng,
    time: 0,
    mode: shotName ? 'play' : 'title',
    paused: false,
    shotMode: !!shotName,
    cash: 250,
    health: 100,
    wanted: 0,
    wantedPoints: 0,
    lastCrimeAt: -99,
    bustedMeter: 0,
    shake: 0,
    hurtAt: -9,
    danger: null,
    storyIndex: 0,
    storyDone: false,
    endingReady: false,
    input: {
      keys: new Set(),
      fireHeld: false,
      mouseDX: 0,
      mouseDY: 0,
      interactPressed: false,
    },
    cars: [],
    peds: [],
    cops: [],
    blockades: [],
    heli: null,
    cfg: CFG,
  };

  // Cross-module hooks other systems call through G.
  G.addWanted = (points) => addWanted(G, points);
  G.damagePlayer = (amount) => {
    if (G.mode !== 'play') return;
    G.health = Math.max(0, G.health - amount);
    G.hurtAt = G.time;
    if (G.health <= 0) {
      G.mode = 'wasted';
      if (G.audioSfx) G.audioSfx.wasted();
      showEnd('WASTED', 'The Solana sun sets on you. Press R to wake up at Clínica del Mar — $150.', true);
    }
  };
  G.hitPed = (ped, car) => {
    knockDownPed(ped, 4);
    ped.health -= 30;
  };

  // Build order.
  G.world = buildCity(scene, rng);
  createPlayer(G);
  spawnTraffic(G, 26, 14);
  spawnPeds(G, 42);
  initWeapons(G);
  if (!shotName && hasSave()) loadGame(G);
  hud = createHud(G);
  minimap = createMinimap(G);
  audioSys = createAudio(G);
  G.audio = audioSys;
  missions = createMissionSystem(G);
  if (shotName) {
    applyShot(G, shotName);
    // A staged frame must show the game the staging posed, not the
    // title card that covers a fresh page: match the overlays to the
    // mode the staging chose (every dossier shot plays, one idles on
    // the title vista).
    if (G.mode !== 'title') titleScreenEl.classList.add('hidden');
    if (G.mode === 'play' && hudEl) hudEl.classList.remove('hidden');
  }

  attachSurfaceInput(renderer.domElement);
  prevMode = G.mode;
}

// --- Screen flow -------------------------------------------------------------

function showEnd(title, sub, isWasted) {
  endTitleEl.textContent = title;
  endSubEl.textContent = sub;
  endScreenEl.classList.toggle('wasted', !!isWasted);
  endScreenEl.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function hideEnd() {
  endScreenEl.classList.add('hidden');
}

// Title screen -> live game: wake the audio, hide the title, lock the
// pointer and point the player at Lucia.
function startGame() {
  if (!G || G.mode !== 'title') return;
  if (audioSys) audioSys.resume();
  titleScreenEl.classList.add('hidden');
  G.mode = 'play';
  G.renderer.domElement.requestPointerLock();
  G.showBanner('COSTA SOLANA', 'Lucia is waiting at the beachfront kiosk.');
  G.say(['Lucia Ferrer: Welcome to Solana. Try not to scratch the paint.']);
}

// Shared recovery for the busted / wasted / ending screens (R key or
// click). Busted costs $200, wasted costs $150, and the ending simply
// hands the city back for free roam.
function respawn() {
  if (!G) return;
  if (G.mode === 'ending') {
    G.endingReady = false;
    hideEnd();
    G.mode = 'play';
    return;
  }
  if (G.mode !== 'busted' && G.mode !== 'wasted') return;
  const wasWasted = G.mode === 'wasted';
  G.cash = Math.max(0, G.cash - (wasWasted ? 150 : 200));
  if (G.player.car) {
    G.player.car.state = 'parked';
    G.player.car.speed = 0;
    G.player.car = null;
    G.player.mesh.visible = true;
  }
  G.health = 100;
  G.wantedPoints = 0;
  syncStars(G);
  G.bustedMeter = 0;
  const dest = wasWasted ? { x: 90, z: 90 } : G.world.playerStart;
  G.player.mesh.position.set(dest.x, 0, dest.z);
  G.player.heading = wasWasted ? 0 : Math.PI;
  G.player.mesh.rotation.y = G.player.heading;
  hideEnd();
  G.mode = 'play';
  saveGame(G);
}

// --- Input -------------------------------------------------------------------
// Keyboard state lives in G.input.keys (a Set of KeyboardEvent codes)
// for the movement modules; discrete actions (interact, pause, radio,
// respawn) are handled here. Mouse look and firing ride on pointer
// lock: movement accumulates into mouseDX/mouseDY, which the frame
// loop zeroes after every frame.

const PREVENTED_CODES = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function setPaused(next) {
  if (!G || G.mode !== 'play') return;
  G.paused = next;
  pauseScreenEl.classList.toggle('hidden', !next);
  if (next && document.pointerLockElement) document.exitPointerLock();
}

// Click behaviour shared by the canvas and the overlay screens that
// sit on top of it: start from the title, recover from an end screen,
// resume from pause, otherwise (re)claim pointer lock for play.
function attachSurfaceInput(canvas) {
  const onClick = () => {
    if (!G) return;
    if (G.mode === 'title') {
      startGame();
    } else if (G.mode === 'busted' || G.mode === 'wasted' || G.mode === 'ending') {
      respawn();
    } else if (G.paused) {
      setPaused(false);
      canvas.requestPointerLock();
    } else if (G.mode === 'play') {
      canvas.requestPointerLock();
    }
  };
  canvas.addEventListener('click', onClick);
  titleScreenEl.addEventListener('click', onClick);
  endScreenEl.addEventListener('click', onClick);
  pauseScreenEl.addEventListener('click', onClick);

  document.addEventListener('mousemove', (e) => {
    if (!G || document.pointerLockElement !== canvas) return;
    G.input.mouseDX += e.movementX || 0;
    G.input.mouseDY += e.movementY || 0;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!G || document.pointerLockElement !== canvas) return;
    if (e.button === 0) G.input.fireHeld = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (!G) return;
    if (e.button === 0) G.input.fireHeld = false;
  });
  // Losing pointer lock mid-play (Esc, alt-tab) pauses the game; the
  // guard keeps an intentional pause from toggling twice.
  document.addEventListener('pointerlockchange', () => {
    if (!G || G.shotMode) return;
    if (!document.pointerLockElement && G.mode === 'play' && !G.paused) {
      setPaused(true);
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (!G) return;
  if (PREVENTED_CODES.has(e.code)) e.preventDefault();
  G.input.keys.add(e.code);
  if (e.code === 'KeyF' && !e.repeat) G.input.interactPressed = true;
  if ((e.code === 'KeyP' || e.code === 'Escape') && G.mode === 'play') {
    setPaused(!G.paused);
  }
  if (e.code === 'KeyN' && !e.repeat && G.player && G.player.car && audioSys) {
    audioSys.nextStation();
  }
  if (e.code === 'KeyR' &&
      (G.mode === 'busted' || G.mode === 'wasted' || G.mode === 'ending')) {
    respawn();
  }
});
window.addEventListener('keyup', (e) => {
  if (!G) return;
  G.input.keys.delete(e.code);
});
window.addEventListener('blur', () => {
  if (!G) return;
  G.input.keys.clear();
  G.input.fireHeld = false;
});

// --- Main loop -----------------------------------------------------------------
// Shot mode renders the staged frame with live HUD/minimap overlays
// and no simulation. Title mode drifts a slow orbit over the
// beachfront. Play mode steps every system in contract order, and the
// busted/wasted/ending/paused states render the frozen scene.

const clock = new THREE.Clock();
let titleAngle = 0;

function resetFrameInputs() {
  G.input.mouseDX = 0;
  G.input.mouseDY = 0;
  G.input.interactPressed = false;
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!G) return;

  if (G.shotMode) {
    G.world.update(dt, G.time);
    hud.update(dt);
    minimap.update(dt);
    G.renderer.render(G.scene, G.camera);
    resetFrameInputs();
    return;
  }

  if (G.mode === 'title') {
    G.time += dt;
    titleAngle += dt * 0.045;
    const cx = -20 + Math.sin(titleAngle) * 150;
    const cz = 300 + Math.cos(titleAngle) * 110;
    G.camera.position.set(cx, 26, cz);
    G.camera.lookAt(0, 8, 300);
    G.world.update(dt, G.time);
  } else if (G.mode === 'play' && !G.paused) {
    G.time += dt;
    updatePlayer(G, dt);
    updateTraffic(G, dt);
    for (const car of G.cars) updateCarVisuals(car, dt);
    updatePeds(G, dt);
    updatePolice(G, dt);
    updateWeapons(G, dt);
    missions.update(dt);
    G.world.update(dt, G.time);
    updateCamera(G, dt);
    if (audioSys) audioSys.update(dt);
    hud.update(dt);
    minimap.update(dt);

    saveTimer += dt;
    if (saveTimer >= 20) {
      saveTimer = 0;
      saveGame(G);
    }
    // The mission system raises endingReady when the story closes.
    if (G.endingReady && G.mode === 'play') {
      G.endingReady = false;
      G.mode = 'ending';
      if (G.audioSfx) G.audioSfx.sting();
      showEnd('SOLANA NIGHTS', "Story complete — Lucia's city is yours. Free roam continues: press R to keep playing.", false);
    }
  } else {
    // Paused, busted, wasted, ending: hold the frame, keep HUD honest.
    G.world.update(dt, G.time);
    hud.update(dt);
  }

  // The police system flips the mode itself when the busted meter
  // fills; main owns the screen and the sound for that transition.
  if (G.mode === 'busted' && prevMode !== 'busted') {
    if (G.audioSfx) G.audioSfx.busted();
    showEnd('BUSTED', 'The SCPD empties your pockets — $200. Press R to walk free.', false);
  }
  prevMode = G.mode;

  G.renderer.render(G.scene, G.camera);
  resetFrameInputs();
}

window.addEventListener('resize', () => {
  if (!G) return;
  G.camera.aspect = window.innerWidth / window.innerHeight;
  G.camera.updateProjectionMatrix();
  G.renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Go ------------------------------------------------------------------------
try {
  boot();
  if (statusEl) {
    statusEl.textContent = shotName
      ? `Costa Solana — staged shot "${shotName}".`
      : 'Costa Solana — click to play.';
  }
  requestAnimationFrame(tick);
} catch (err) {
  if (statusEl) statusEl.textContent = `Costa Solana failed to start: ${err.message}`;
  console.error(err);
}
