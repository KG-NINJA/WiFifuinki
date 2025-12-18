/* KEHAI Indicator – Prototype
   - No sensing; pure ambient visualization
   - Driven by a single state variable: kehaiState
*/

/** @type {"calm" | "active" | "surge"} */
let kehaiState = "calm";

const canvas = document.getElementById("c");
/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext("2d", { alpha: false });

const TAU = Math.PI * 2;

function createSoundEngine() {
  /** @type {AudioContext | null} */
  let ac = null;
  /** @type {GainNode | null} */
  let master = null;
  /** @type {DynamicsCompressorNode | null} */
  let comp = null;
  /** @type {BiquadFilterNode | null} */
  let tilt = null;
  /** @type {GainNode | null} */
  let padGain = null;
  /** @type {GainNode | null} */
  let noiseGain = null;
  /** @type {DelayNode | null} */
  let delay = null;
  /** @type {GainNode | null} */
  let feedback = null;
  /** @type {BiquadFilterNode | null} */
  let delayFilter = null;
  /** @type {GainNode | null} */
  let delaySend = null;

  /** @type {{ osc: OscillatorNode, gain: GainNode, filter: BiquadFilterNode, lfo: OscillatorNode, lfoGain: GainNode }[] | null} */
  let voices = null;

  /** @type {AudioBufferSourceNode | null} */
  let noiseSrc = null;
  /** @type {BiquadFilterNode | null} */
  let noiseFilter = null;

  let started = false;

  const chord = {
    calm: [110, 165, 220],
    active: [110, 165, 220, 330],
    surge: [110, 165, 220, 330, 440],
  };

  function now() {
    return ac ? ac.currentTime : 0;
  }

  function softSet(param, value, timeConstant = 0.12) {
    if (!ac) return;
    const t = now();
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, timeConstant);
  }

  function makeNoiseBuffer(context) {
    const seconds = 2.0;
    const frames = Math.floor(context.sampleRate * seconds);
    const buf = context.createBuffer(1, frames, context.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const x = (Math.random() * 2 - 1) * 0.9;
      ch[i] = x;
    }
    return buf;
  }

  function start() {
    if (started) return;
    started = true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ac = new AudioCtx();

    master = ac.createGain();
    master.gain.value = 0.0;

    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 26;
    comp.ratio.value = 3.0;
    comp.attack.value = 0.012;
    comp.release.value = 0.24;

    tilt = ac.createBiquadFilter();
    tilt.type = "lowpass";
    tilt.frequency.value = 12000;
    tilt.Q.value = 0.35;

    padGain = ac.createGain();
    padGain.gain.value = 0.55;

    noiseGain = ac.createGain();
    noiseGain.gain.value = 0.0;

    delay = ac.createDelay(2.0);
    delay.delayTime.value = 0.33;
    feedback = ac.createGain();
    feedback.gain.value = 0.25;
    delayFilter = ac.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 3200;
    delayFilter.Q.value = 0.7;
    delaySend = ac.createGain();
    delaySend.gain.value = 0.18;

    // Graph:
    // pad/noise -> (master path) -> tilt -> comp -> destination
    //                  \-> delaySend -> delay -> delayFilter -> feedback -> delay -> (back) + -> master path
    padGain.connect(master);
    noiseGain.connect(master);
    master.connect(tilt);
    tilt.connect(comp);
    comp.connect(ac.destination);

    master.connect(delaySend);
    delaySend.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(feedback);
    feedback.connect(delay);
    delayFilter.connect(master);

    // Voices: slow evolving pad with gentle detune and moving bandpass filters.
    voices = [];
    const base = chord.calm;
    const detunes = [-7, 5, 0];

    for (let i = 0; i < 3; i++) {
      const osc = ac.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = base[i];
      osc.detune.value = detunes[i];

      const filter = ac.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 420 + i * 220;
      filter.Q.value = 1.2 + i * 0.35;

      const gain = ac.createGain();
      gain.gain.value = 0.0;

      const lfo = ac.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.035 + i * 0.018;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 180 + i * 110;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(padGain);

      osc.start();
      lfo.start();

      voices.push({ osc, gain, filter, lfo, lfoGain });
    }

    // Filtered noise shimmer
    noiseSrc = ac.createBufferSource();
    noiseSrc.buffer = makeNoiseBuffer(ac);
    noiseSrc.loop = true;
    noiseFilter = ac.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.6;
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseSrc.start();

    // Fade in gently once resumed
    const t0 = now();
    master.gain.setValueAtTime(0.0, t0);
    master.gain.linearRampToValueAtTime(0.8, t0 + 1.6);
  }

  function update({ t, state, params: p }) {
    if (!ac || !master || !padGain || !noiseGain || !tilt || !delay || !feedback || !delayFilter || !delaySend || !voices) return;
    if (ac.state === "suspended") return;

    const target = stateTargets[state] || stateTargets.calm;
    const speed = target.speed;
    const glow = target.glow;
    const burst = target.burst;

    // Sync to the same breathing logic driving the core.
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.62 * speed);
    const breathe2 = 0.5 + 0.5 * Math.sin(t * 0.37 * speed + 1.7);
    const pulse = 0.65 + 0.35 * Math.sin(t * (0.9 + target.drift * 0.7));

    // Harmony shifts are subtle: more overtones appear as state rises.
    const notes = chord[state] || chord.calm;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      const f = notes[Math.min(i, notes.length - 1)];
      softSet(v.osc.frequency, f * (1 + 0.0025 * Math.sin(t * (0.07 + i * 0.03) + i)));
      const vGain = (0.07 + i * 0.03) * (0.75 + 0.35 * glow) * (0.85 + 0.25 * breathe);
      softSet(v.gain.gain, vGain, 0.2);
      softSet(v.filter.frequency, (320 + i * 180) + (420 + 520 * glow) * (0.35 + 0.65 * breathe2), 0.22);
      softSet(v.lfo.frequency, (0.03 + i * 0.02) * (0.7 + 0.55 * speed), 0.25);
      softSet(v.lfoGain.gain, (120 + i * 95) * (0.7 + 0.75 * glow), 0.25);
    }

    // Noise shimmer grows with activity, stays very low in calm.
    const shimmer = (state === "calm" ? 0.012 : state === "active" ? 0.03 : 0.055) * (0.7 + 0.5 * burst);
    softSet(noiseGain.gain, shimmer * (0.75 + 0.25 * pulse), 0.25);
    if (noiseFilter) softSet(noiseFilter.frequency, 700 + 1400 * glow * (0.5 + 0.5 * breathe2), 0.3);

    // Overall color: darker in calm, slightly brighter with glow.
    softSet(tilt.frequency, 5200 + 5200 * glow, 0.35);

    // Echo field: deeper and slightly faster with state.
    softSet(delay.delayTime, 0.42 - 0.1 * Math.min(1, (speed - 0.55) / 1.0), 0.25);
    softSet(feedback.gain, 0.18 + 0.14 * glow + 0.1 * burst, 0.35);
    softSet(delayFilter.frequency, 1800 + 2200 * glow, 0.35);
    softSet(delaySend.gain, 0.08 + 0.14 * glow, 0.35);

    // Gentle master breathing (keeps it musical and synced, not reactive "alert").
    const base = 0.55 + 0.22 * glow;
    const mod = 0.06 * (0.35 + 0.65 * burst) * (breathe * 0.6 + breathe2 * 0.4);
    softSet(master.gain, Math.min(0.95, base + mod), 0.35);

    // Use animation params as an additional, subtle constraint (prevents mismatch if tuned).
    if (p) {
      const extra = clamp01((p.glow - 0.65) / 1.0);
      softSet(padGain.gain, 0.5 + 0.18 * extra, 0.35);
    }
  }

  function suspendOnHidden() {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {});
    else ac.resume().catch(() => {});
  }

  document.addEventListener("visibilitychange", suspendOnHidden, { passive: true });

  return {
    get started() {
      return started;
    },
    start() {
      start();
      if (ac && ac.state === "suspended") ac.resume().catch(() => {});
    },
    update,
  };
}

const sound = createSoundEngine();
function armSound() {
  sound.start();
  window.removeEventListener("pointerdown", armSound);
  window.removeEventListener("keydown", armSoundKey);
}
function armSoundKey(e) {
  if (e.key === " " || e.key === "Enter") armSound();
}
window.addEventListener("pointerdown", armSound, { passive: true });
window.addEventListener("keydown", armSoundKey);

const stateTargets = {
  calm: { speed: 0.55, glow: 0.7, drift: 0.55, burst: 0.25 },
  active: { speed: 1.0, glow: 1.05, drift: 1.0, burst: 0.55 },
  surge: { speed: 1.55, glow: 1.5, drift: 1.65, burst: 0.95 },
};

let dpr = 1;
let w = 0;
let h = 0;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep01(t) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

function resize() {
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  w = Math.max(1, Math.floor(window.innerWidth));
  h = Math.max(1, Math.floor(window.innerHeight));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize, { passive: true });
resize();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x6b656861); // "keha" seed-ish

function randRange(a, b) {
  return a + (b - a) * rand();
}

function pickHue() {
  // cyan -> blue -> purple only
  return randRange(185, 275);
}

function hsla(h, s, l, a) {
  return `hsla(${h} ${s}% ${l}% / ${a})`;
}

function vignette() {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, "#05060a");
  g.addColorStop(0.35, "#040513");
  g.addColorStop(0.72, "#02030a");
  g.addColorStop(1, "#000108");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function backgroundMist(t, intensity) {
  // A few large, slow gradients; keeps it calm and peripheral-friendly.
  const cx = w * 0.5;
  const cy = h * 0.5;
  const r0 = Math.max(w, h) * 0.75;
  const drift = 0.06 * intensity;

  for (let i = 0; i < 3; i++) {
    const a = t * (0.07 + i * 0.015) + i * 1.7;
    const ox = Math.cos(a) * r0 * drift * (0.7 + i * 0.25);
    const oy = Math.sin(a * 1.13) * r0 * drift * (0.7 + i * 0.25);
    const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r0 * (0.55 + i * 0.18));
    const hue = 195 + i * 25;
    g.addColorStop(0, hsla(hue, 85, 10, 0.22 * intensity));
    g.addColorStop(0.35, hsla(hue + 10, 90, 9, 0.12 * intensity));
    g.addColorStop(1, hsla(hue + 20, 90, 7, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function flowAngle(x, y, t, energy) {
  // Pseudo curl-ish flow from layered sin/cos (no external noise lib).
  const nx = (x - w * 0.5) / Math.max(w, h);
  const ny = (y - h * 0.5) / Math.max(w, h);
  const k1 = 1.9;
  const k2 = 3.4;
  const k3 = 5.7;
  const a =
    Math.sin((nx * k1 + ny * 0.7) * TAU + t * 0.8) +
    Math.cos((ny * k2 - nx * 1.1) * TAU - t * 0.6) +
    Math.sin((nx * k3 + ny * 1.6) * TAU + t * 0.35);
  return a * 1.25 * energy;
}

const particles = [];
const maxParticles = 650;

function spawnParticle(bias) {
  // Spawn on a ring around the core for a pavilion-like halo.
  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);

  const ring = minDim * (0.11 + rand() * 0.1);
  const ang = rand() * TAU;
  const jitter = ring * (0.12 + 0.35 * rand());
  const x = cx + Math.cos(ang) * ring + (rand() - 0.5) * jitter;
  const y = cy + Math.sin(ang) * ring + (rand() - 0.5) * jitter;

  const hue = pickHue();
  const size = randRange(0.6, 2.2) * (0.85 + bias * 0.7);
  const life = randRange(2.5, 7.5) / (0.85 + bias);
  const phase = rand() * TAU;
  const s = randRange(0.22, 0.9) * (0.7 + bias * 1.1);

  particles.push({
    x,
    y,
    vx: (rand() - 0.5) * s,
    vy: (rand() - 0.5) * s,
    hue,
    size,
    life,
    age: 0,
    phase,
  });
}

function ensureParticles(bias) {
  const target = Math.floor(lerp(260, maxParticles, smoothstep01(bias)));
  while (particles.length < target) spawnParticle(bias);
}

function stepParticles(dt, t, params) {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);
  const pullR = minDim * 0.26;

  const energy = params.drift;
  const speed = params.speed;
  const glow = params.glow;

  const fadeEdge = minDim * 0.62;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age > p.life) {
      particles.splice(i, 1);
      continue;
    }

    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy) + 1e-6;
    const nxd = dx / dist;
    const nyd = dy / dist;

    const swirl = flowAngle(p.x, p.y, t * 0.55, energy);
    const tx = -nyd;
    const ty = nxd;

    const pull = smoothstep01(1 - dist / pullR) * 0.055 * energy;
    const tang = 0.09 * energy;

    const ax = tx * swirl * tang - nxd * pull;
    const ay = ty * swirl * tang - nyd * pull;

    p.vx = lerp(p.vx, p.vx + ax, 0.35);
    p.vy = lerp(p.vy, p.vy + ay, 0.35);

    const maxV = 1.45 * speed * (0.75 + energy * 0.7);
    const v = Math.hypot(p.vx, p.vy);
    if (v > maxV) {
      p.vx = (p.vx / v) * maxV;
      p.vy = (p.vy / v) * maxV;
    }

    p.x += p.vx * dt * 60 * (0.55 + speed * 0.65);
    p.y += p.vy * dt * 60 * (0.55 + speed * 0.65);

    const edge = Math.hypot(p.x - cx, p.y - cy);
    if (edge > fadeEdge) {
      const k = (edge - fadeEdge) / (minDim * 0.25);
      p.age += dt * 1.8 * clamp01(k);
    }

    // soft wrap to keep the field continuous
    if (p.x < -60) p.x = w + 60;
    if (p.x > w + 60) p.x = -60;
    if (p.y < -60) p.y = h + 60;
    if (p.y > h + 60) p.y = -60;

    const a = 1 - p.age / p.life;
    const pulse = 0.65 + 0.35 * Math.sin(t * (0.9 + energy * 0.7) + p.phase);
    const alpha = 0.06 + 0.28 * a * a * glow * pulse;
    const size = p.size * (0.8 + 0.55 * (1 - a)) * (0.9 + 0.2 * glow);

    ctx.fillStyle = hsla(p.hue, 90, 60, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, TAU);
    ctx.fill();
  }
}

function drawCore(t, params) {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);

  const speed = params.speed;
  const glow = params.glow;
  const burst = params.burst;

  const breathe = 0.5 + 0.5 * Math.sin(t * 0.62 * speed);
  const breathe2 = 0.5 + 0.5 * Math.sin(t * 0.37 * speed + 1.7);
  const rBase = minDim * 0.06;
  const r = rBase * (0.86 + 0.22 * breathe + 0.08 * breathe2);
  const aura = rBase * (3.4 + 1.35 * glow + 0.6 * burst);

  // soft bloom aura
  const g1 = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, aura);
  g1.addColorStop(0, hsla(205, 92, 62, 0.26 * glow));
  g1.addColorStop(0.22, hsla(220, 95, 55, 0.18 * glow));
  g1.addColorStop(0.55, hsla(255, 95, 55, 0.12 * glow));
  g1.addColorStop(1, hsla(270, 95, 55, 0));
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(cx, cy, aura, 0, TAU);
  ctx.fill();

  // inner core
  const g2 = ctx.createRadialGradient(cx - r * 0.12, cy - r * 0.1, 0, cx, cy, r * 1.35);
  g2.addColorStop(0, hsla(195, 90, 68, 0.95));
  g2.addColorStop(0.35, hsla(215, 92, 60, 0.78));
  g2.addColorStop(0.75, hsla(255, 90, 58, 0.42));
  g2.addColorStop(1, hsla(275, 90, 55, 0.06));
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();

  // subtle ring — no hard edges
  ctx.globalCompositeOperation = "screen";
  const ringA = 0.05 + 0.09 * glow + 0.08 * burst;
  ctx.strokeStyle = hsla(210, 95, 62, ringA);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (1.6 + 0.6 * breathe2), 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

const params = { speed: 0.55, glow: 0.7, drift: 0.55, burst: 0.25 };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const target = stateTargets[kehaiState] || stateTargets.calm;
  const follow = 1 - Math.pow(0.001, dt);
  params.speed = lerp(params.speed, target.speed, follow);
  params.glow = lerp(params.glow, target.glow, follow);
  params.drift = lerp(params.drift, target.drift, follow);
  params.burst = lerp(params.burst, target.burst, follow);

  const t = now / 1000;
  vignette();
  backgroundMist(t, 0.9 * params.glow);

  const bias = smoothstep01((params.glow - 0.65) / 1.0);
  ensureParticles(bias);

  // rare micro-bursts in surge; still calm.
  if (kehaiState === "surge" && rand() < 0.02) {
    const extra = 10 + Math.floor(rand() * 18);
    for (let i = 0; i < extra; i++) spawnParticle(1);
  }

  // energy field layering (screen blend for gentle luminescence)
  ctx.globalCompositeOperation = "screen";
  stepParticles(dt, t, params);
  ctx.globalCompositeOperation = "source-over";

  drawCore(t, params);

  sound.update({ t, state: kehaiState, params });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function normalizeState(state) {
  if (state === "calm" || state === "active" || state === "surge") return state;
  return null;
}

// Future interface: external AI unit calls this with { state: "calm" | "active" | "surge" }.
function updateFromAI(result) {
  const next = normalizeState(result?.state);
  if (!next) return;
  kehaiState = next;
}

// Expose minimal hooks for future wiring (no network calls here).
window.KEHAI = {
  get state() {
    return kehaiState;
  },
  setState(next) {
    const s = normalizeState(next);
    if (s) kehaiState = s;
  },
  updateFromAI,
};

window.KEHAI = {
  updateFromAI
};
