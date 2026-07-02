// Self-play AI — drives the chasers to hunt fugitives so the game plays itself
// for footage capture. It feeds the existing chaser-input seam
// (getChaserInputDirection), so activation, movement, turning and reversal all
// flow through the normal pipeline — no engine changes.
//
// Steering: greedy cardinal pursuit on the road grid. Each chaser targets a
// fugitive and, each frame, requests the cardinal direction (±x or ±z) that
// most reduces distance to it. Axis hysteresis avoids dithering at junctions.
// Tuned for cinematic chases: chasers spread across targets and boost to close
// mid-range gaps.

let _ctx = null;
let _enabled = false;
let _manual = -1;    // chaser index the human drives (AI leaves it alone), -1 = none
const _axis = {};    // chaserIndex -> "x" | "z" (current pursuit axis)
const _target = {};  // chaserIndex -> fugitive index
const _boostCd = {}; // chaserIndex -> seconds until next boost allowed

// Hand one chaser to the player; the AI drives the rest. -1 / null = AI drives all.
export function setManualChaser(index) {
  _manual = (index == null) ? -1 : index;
}
export function getManualChaser() { return _manual; }

export function initAutoplay(ctx) {
  _ctx = ctx; // { STATE, settings, chasers, fugitives, boostStates, triggerBoost, playSFX }
}

export function setAutoplayEnabled(on) {
  _enabled = !!on;
  if (!_enabled) resetAutoplay();
}

export function isAutoplayEnabled() {
  return _enabled;
}

export function resetAutoplay() {
  for (const k in _axis) delete _axis[k];
  for (const k in _target) delete _target[k];
  for (const k in _boostCd) delete _boostCd[k];
}

function liveFugitives() {
  return _ctx.fugitives.filter((f) => f && !f.captured && f.mesh);
}

// Pick (and remember) a target fugitive for a chaser. Prefer a live fugitive not
// already targeted by another chaser, so the four chasers spread out; fall back
// to the nearest live one.
function pickTarget(chaserIndex, chaser) {
  const { fugitives } = _ctx;
  const cur = _target[chaserIndex];
  if (cur != null && fugitives[cur] && !fugitives[cur].captured) return fugitives[cur];

  const live = liveFugitives();
  if (!live.length) return null;

  const taken = new Set(Object.values(_target));
  let pool = live.filter((f) => !taken.has(f.index));
  if (!pool.length) pool = live;

  let best = null, bestDist = Infinity;
  for (const f of pool) {
    const dx = f.mesh.position.x - chaser.mesh.position.x;
    const dz = f.mesh.position.z - chaser.mesh.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) { bestDist = d; best = f; }
  }
  if (best) _target[chaserIndex] = best.index;
  return best;
}

// The AI's answer to getChaserInputDirection(i): a cardinal step toward the
// chaser's target. Returns null when AI is off / not playing so the keyboard
// path takes over.
export function getAutoplayDirection(chaserIndex) {
  if (!_enabled || !_ctx) return null;
  const { STATE, chasers } = _ctx;
  if (STATE.gameState !== "PLAYING") return null;

  if (chaserIndex === _manual) return null; // human drives this one

  const chaser = chasers[chaserIndex];
  if (!chaser || !chaser.mesh) return null;

  const target = pickTarget(chaserIndex, chaser);
  if (!target) return null;

  const dx = target.mesh.position.x - chaser.mesh.position.x;
  const dz = target.mesh.position.z - chaser.mesh.position.z;
  const adx = Math.abs(dx), adz = Math.abs(dz);

  // Axis hysteresis: keep the current pursuit axis unless the other is clearly
  // (1.3x) more in need of correction — prevents flip-flopping at junctions.
  let axis = _axis[chaserIndex];
  if (axis === "x" && adz > adx * 1.3) axis = "z";
  else if (axis === "z" && adx > adz * 1.3) axis = "x";
  else if (axis !== "x" && axis !== "z") axis = adx >= adz ? "x" : "z";
  _axis[chaserIndex] = axis;

  const EPS = 0.25;
  if (axis === "x" && adx > EPS) return { x: Math.sign(dx), z: 0, hasInput: true };
  if (axis === "z" && adz > EPS) return { x: 0, z: Math.sign(dz), hasInput: true };
  // Aligned on the chosen axis — step on the other to keep closing in.
  if (adx > EPS) return { x: Math.sign(dx), z: 0, hasInput: true };
  if (adz > EPS) return { x: 0, z: Math.sign(dz), hasInput: true };
  return null;
}

// Per-frame: trigger boosts to close mid-range gaps (cinematic), on a cooldown.
export function updateAutoplay(dt) {
  if (!_enabled || !_ctx) return;
  const { STATE, chasers, fugitives, boostStates, settings, triggerBoost, playSFX } = _ctx;
  if (STATE.gameState !== "PLAYING") return;

  for (let i = 0; i < chasers.length; i++) {
    if (i === _manual) continue; // player handles their own boost
    const chaser = chasers[i];
    if (!chaser || !chaser.active) continue;
    _boostCd[i] = (_boostCd[i] || 0) - dt;

    const tIdx = _target[i];
    const t = tIdx != null ? fugitives[tIdx] : null;
    if (!t || t.captured || _boostCd[i] > 0) continue;

    const dx = t.mesh.position.x - chaser.mesh.position.x;
    const dz = t.mesh.position.z - chaser.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 6 && dist < 30) {
      if (triggerBoost && triggerBoost(boostStates, i, settings)) {
        if (playSFX) playSFX("nitro", i);
        _boostCd[i] = 2.5 + Math.random() * 2.5;
      }
    }
  }
}
