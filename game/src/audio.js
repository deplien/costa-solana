// audio.js — every sound in Costa Solana is synthesized live with the
// Web Audio API: three radio stations, the player's engine, police
// sirens and one-shot effects. There are no audio assets to download.
//
// The context is created lazily and only resumed from a user gesture
// (main.js calls resume() on the first click), which keeps the game
// inside the browser's autoplay rules. Every public function guards
// against a missing context, so callers never need to check.

const STATION_COUNT = 3; // matches the stations array built in createAudio

// Chord helpers: frequencies for the notes the stations use.
function noteFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// --- Station definitions -------------------------------------------------
// Each station is a tiny lookahead step sequencer: scheduleStep(step,
// time, out) is called for every 8th-note step a little ahead of the
// audio clock and writes oscillators into the radio bus.

// Solana FM — mellow synthwave pad: Am–F–C–G, soft saws through a
// lowpass, one chord per bar, plus a slow sub pulse on the offbeats.
function makeSolanaFm() {
  const chords = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C (voiced low)
    [55, 59, 62], // G
  ];
  return {
    name: 'Solana FM',
    bpm: 84,
    scheduleStep(ctx, step, time, out) {
      const bar = Math.floor(step / 8) % chords.length;
      if (step % 8 === 0) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 720;
        filter.Q.value = 0.6;
        filter.connect(out);
        for (const midi of chords[bar]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = noteFreq(midi);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, time);
          g.gain.linearRampToValueAtTime(0.05, time + 0.4);
          g.gain.setValueAtTime(0.05, time + 1.7);
          g.gain.linearRampToValueAtTime(0, time + 2.2);
          osc.connect(g).connect(filter);
          osc.start(time);
          osc.stop(time + 2.3);
        }
      }
      if (step % 4 === 2) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = noteFreq(chords[bar][0] - 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.09, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
        osc.connect(g).connect(out);
        osc.start(time);
        osc.stop(time + 0.55);
      }
    },
  };
}

// Radio Marea — latin pluck melody: triangle-oscillator montuno over
// I–vi–IV–V in C with an offbeat bass. Notes are [midi, stepOffset]
// pairs inside a two-bar loop.
function makeRadioMarea() {
  const roots = [36, 33, 29, 31]; // C2 A1 F1 G1
  const montuno = [72, 76, 79, 76, 74, 76, 79, 81, 79, 76, 74, 72, 74, 71, 74, 76];
  return {
    name: 'Radio Marea',
    bpm: 96,
    scheduleStep(ctx, step, time, out) {
      const bar = Math.floor(step / 8) % roots.length;
      const inBar = step % 8;
      // Offbeat bass: steps 2 and 6 of each bar.
      if (inBar === 2 || inBar === 6) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = noteFreq(roots[bar] + 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.16, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
        osc.connect(g).connect(out);
        osc.start(time);
        osc.stop(time + 0.3);
      }
      // Plucked melody, one note per 8th, from the two-bar pattern.
      const midi = montuno[step % montuno.length];
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = noteFreq(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      osc.connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.25);
    },
  };
}

// Onda Costa — reggae: offbeat chord skanks (steps 2 and 6 of each
// bar) over a deep, lazy bassline walking I–IV–V–vi in G.
function makeOndaCosta() {
  const chords = [
    [55, 59, 62], // G
    [60, 64, 67], // C
    [62, 66, 69], // D
    [57, 60, 64], // Am
  ];
  const bassWalk = [31, 31, 38, 36, 36, 36, 43, 41, 38, 38, 45, 43, 33, 33, 40, 38];
  return {
    name: 'Onda Costa',
    bpm: 72,
    scheduleStep(ctx, step, time, out) {
      const bar = Math.floor(step / 8) % chords.length;
      const inBar = step % 8;
      if (inBar === 2 || inBar === 6) {
        for (const midi of chords[bar]) {
          const osc = ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = noteFreq(midi + 12);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.028, time);
          g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
          osc.connect(g).connect(out);
          osc.start(time);
          osc.stop(time + 0.18);
        }
      }
      if (step % 2 === 0) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = noteFreq(bassWalk[step % bassWalk.length]);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
        osc.connect(g).connect(out);
        osc.start(time);
        osc.stop(time + 0.55);
      }
    },
  };
}

// --- createAudio ---------------------------------------------------------
// Builds the whole audio graph and returns the per-frame interface
// main.js drives. Also installs G.audioSfx with the one-shot effects
// the gameplay modules call.

export function createAudio(G) {
  let ctx = null;
  let radioBus = null;   // gain -> destination, faded by car presence
  let engineOscA = null; // sawtooth voice
  let engineOscB = null; // square voice, detuned
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenFlipAt = 0;
  let sirenHigh = false;

  const stations = [makeSolanaFm(), makeRadioMarea(), makeOndaCosta()];
  let stationIndex = 0;
  let seqStep = 0;       // next 8th-note step to schedule
  let seqNextTime = 0;   // audio-clock time of that step

  G.radioStationName = stations[0].name;

  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    radioBus = ctx.createGain();
    radioBus.gain.value = 0;
    radioBus.connect(ctx.destination);

    // Engine: two detuned oscillators through one lowpass.
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOscA = ctx.createOscillator();
    engineOscA.type = 'sawtooth';
    engineOscB = ctx.createOscillator();
    engineOscB.type = 'square';
    engineOscB.detune.value = 1205; // an octave-ish growl above A
    engineOscA.connect(engineFilter);
    engineOscB.connect(engineFilter);
    engineFilter.connect(engineGain).connect(ctx.destination);
    engineOscA.start();
    engineOscB.start();

    // Siren: a single square voice whose frequency flips in update().
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 650;
    sirenOsc.connect(sirenGain).connect(ctx.destination);
    sirenOsc.start();

    seqStep = 0;
    seqNextTime = ctx.currentTime + 0.1;
    return true;
  }

  function resume() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function nextStation() {
    stationIndex = (stationIndex + 1) % STATION_COUNT;
    G.radioStationName = stations[stationIndex].name;
    // Restart the pattern cleanly on the new station.
    seqStep = 0;
    if (ctx) seqNextTime = ctx.currentTime + 0.06;
  }

  function stationName() {
    return stations[stationIndex].name;
  }

  // Schedule every step that falls inside the lookahead window.
  function runSequencer(inCar) {
    const station = stations[stationIndex];
    const stepDur = 60 / station.bpm / 2; // 8th notes
    while (seqNextTime < ctx.currentTime + 0.18) {
      if (inCar) station.scheduleStep(ctx, seqStep, seqNextTime, radioBus);
      seqStep += 1;
      seqNextTime += stepDur;
    }
  }

  function update(dt) {
    if (!ctx) return;
    const player = G.player;
    const car = player && player.car ? player.car : null;
    const inCar = !!car && G.mode === 'play';

    // Radio fades in only while the player sits in a car.
    const radioTarget = inCar ? 0.9 : 0;
    radioBus.gain.setTargetAtTime(radioTarget, ctx.currentTime, 0.25);
    runSequencer(inCar);

    // Engine pitch follows the player's road speed.
    if (inCar) {
      const speed = Math.abs(car.speed || 0);
      const freq = 55 + speed * 4.2;
      engineOscA.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
      engineOscB.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
      engineGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.1);
    } else {
      engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    }

    // Sirens: volume from the nearest police car within 90 units.
    let nearest = Infinity;
    if (player && player.mesh && Array.isArray(G.cops)) {
      const px = player.mesh.position.x;
      const pz = player.mesh.position.z;
      for (const cop of G.cops) {
        if (!cop || !cop.mesh) continue;
        const dx = cop.mesh.position.x - px;
        const dz = cop.mesh.position.z - pz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearest) nearest = d;
      }
    }
    if (nearest < 90 && G.mode === 'play') {
      const closeness = 1 - nearest / 90;
      sirenGain.gain.setTargetAtTime(0.12 * closeness, ctx.currentTime, 0.1);
      if (ctx.currentTime >= sirenFlipAt) {
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setValueAtTime(sirenHigh ? 950 : 650, ctx.currentTime);
        sirenFlipAt = ctx.currentTime + 0.38;
      }
    } else {
      sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
  }

  // --- One-shot effects --------------------------------------------------
  // Shared noise buffer, built once on first use.
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function blip(type, freq, time, dur, gain) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function noiseHit(time, dur, gain, filterFreq) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  G.audioSfx = {
    shot() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseHit(t, 0.09, 0.22, 3800);
      blip('square', 220, t, 0.07, 0.12);
    },
    cash() {
      if (!ctx) return;
      const t = ctx.currentTime;
      blip('sine', 1320, t, 0.12, 0.12);
      blip('sine', 1760, t + 0.09, 0.18, 0.12);
    },
    sting() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => blip('triangle', f, t + i * 0.07, 0.16, 0.11));
    },
    busted() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [392, 370, 349, 311].forEach((f, i) => blip('sawtooth', f, t + i * 0.16, 0.22, 0.08));
    },
    wasted() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.15);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    },
    crash(strength) {
      if (!ctx) return;
      const s = Math.max(0.1, Math.min(1, strength || 0.4));
      noiseHit(ctx.currentTime, 0.22, 0.3 * s, 500 + 900 * s);
    },
  };

  return { update, resume, nextStation, stationName };
}
