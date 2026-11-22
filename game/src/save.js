// save.js — localStorage persistence for Costa Solana. The save is a
// single small JSON record: money, story progress, ammunition and the
// player's last position. Everything is wrapped in try/catch because
// localStorage can be unavailable (private windows, file quotas) and a
// failed save must never break the game.

// The storage key; the -v1 suffix versions the record's shape.
export const SAVE_KEY = 'costa-solana-save-v1';

// Writes the current run's progress. Called by main.js on an autosave
// timer and at story beats by the mission system.
export function saveGame(G) {
  try {
    const player = G.player;
    const record = {
      cash: Math.round(G.cash || 0),
      storyIndex: G.storyIndex || 0,
      storyDone: !!G.storyDone,
      ammo: G.ammo ? { pistol: G.ammo.pistol | 0, smg: G.ammo.smg | 0 } : { pistol: 0, smg: 0 },
      weaponIndex: G.weaponIndex || 0,
      player: player && player.mesh
        ? {
            x: player.mesh.position.x,
            z: player.mesh.position.z,
            heading: player.heading || 0,
          }
        : null,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(record));
  } catch (err) {
    // Storage full or blocked: the run simply continues unsaved.
  }
}

// Reads the save back into G. Returns true when a usable record was
// found. main.js calls this BEFORE the mission system is created, so
// Lucia, the story marker and the HUD all start from the saved index.
// A corrupt or partial record is ignored field by field.
export function loadGame(G) {
  let record = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    record = JSON.parse(raw);
  } catch (err) {
    return false;
  }
  if (!record || typeof record !== 'object') return false;

  if (typeof record.cash === 'number') G.cash = record.cash;
  if (typeof record.storyIndex === 'number') G.storyIndex = record.storyIndex;
  if (typeof record.storyDone === 'boolean') G.storyDone = record.storyDone;

  if (record.ammo && G.ammo) {
    if (typeof record.ammo.pistol === 'number') G.ammo.pistol = record.ammo.pistol;
    if (typeof record.ammo.smg === 'number') G.ammo.smg = record.ammo.smg;
  }
  if (typeof record.weaponIndex === 'number' && G.ammo) {
    G.weaponIndex = Math.max(0, Math.min(2, record.weaponIndex));
  }

  const p = record.player;
  if (p && G.player && G.player.mesh &&
      typeof p.x === 'number' && typeof p.z === 'number') {
    G.player.mesh.position.x = p.x;
    G.player.mesh.position.z = p.z;
    if (typeof p.heading === 'number') {
      G.player.heading = p.heading;
      G.player.mesh.rotation.y = p.heading;
    }
  }
  return true;
}

// True when any save record exists (used to decide the title-screen
// "continue" hint and whether loadGame is worth calling).
export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch (err) {
    return false;
  }
}

// Removes the save entirely (new-game flows and debugging).
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    // Nothing to clear if storage itself is unavailable.
  }
}
