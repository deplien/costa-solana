// random.js — deterministic seeded randomness for Costa Solana.
//
// Every placement decision in the city (buildings, palms, props, spawns)
// flows through one of these generators, so a given seed always rebuilds
// the exact same island. That is what makes the screenshot scenes and
// the demo replays repeatable: ?seed=1 must never drift.

// makeRng(seed) -> rng() returning floats in [0, 1).
// mulberry32: a tiny, fast, well-distributed 32-bit generator.
export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rngRange(rng, min, max) -> float in [min, max).
export function rngRange(rng, min, max) {
  return min + rng() * (max - min);
}

// rngInt(rng, min, max) -> integer in [min, max], both ends included.
export function rngInt(rng, min, max) {
  return Math.floor(rngRange(rng, min, max + 1));
}

// rngPick(rng, arr) -> one element of arr, uniformly.
export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// rngChance(rng, p) -> true with probability p.
export function rngChance(rng, p) {
  return rng() < p;
}

// rngSign(rng) -> -1 or +1, coin flip.
export function rngSign(rng) {
  return rng() < 0.5 ? -1 : 1;
}
