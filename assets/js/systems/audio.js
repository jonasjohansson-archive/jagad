// Audio system — background music, analyser, SFX, Tone.js modulated SFX
// Extracted from main.js

import { PATHS } from "../game/constants.js";

let audioElement = null;
let audioContext = null;
let audioAnalyser = null;
let audioSource = null;
let audioFrequencyData = null;
let helicopterAudio = null;
let recordDest = null; // MediaStreamDestination tap for the recorder
const preloadedSFX = {};

// Tone.js modulated SFX: per-player pitch variation
const MODULATED_SFX = ["playerSelect", "honk", "capture", "nitro"]; // SFX that get pitch modulation
const PLAYER_PITCH_OFFSETS = [-5, 0, 4, 7]; // lower 4th, root, major 3rd, 5th (semitones)
const tonePlayers = {}; // "sfxName_playerIndex" -> pre-created Tone.Player

export function initAudio(settings) {
  const trackPath = PATHS.audio[settings.audioTrack];
  if (trackPath) {
    audioElement = new Audio(trackPath);
    audioElement.loop = true;
    audioElement.volume = settings.audioVolume;
    audioElement.crossOrigin = "anonymous";
  }
}

function setupAudioAnalyser() {
  if (audioAnalyser || !audioContext || !audioElement) return;
  if (audioContext.state !== "running") return;
  try {
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioAnalyser.smoothingTimeConstant = 0.8;
    audioSource = audioContext.createMediaElementSource(audioElement);
    audioSource.connect(audioAnalyser);
    audioAnalyser.connect(audioContext.destination);
    // Also feed the music into the recorder tap so captures include the soundtrack
    if (recordDest) audioAnalyser.connect(recordDest);
    audioFrequencyData = new Uint8Array(audioAnalyser.frequencyBinCount);
  } catch (e) {
    console.warn("Failed to setup audio analyser:", e);
  }
}

// Lazily create (once) a MediaStreamDestination on the music context and
// return its stream. The recorder calls this to mix game audio into the file.
export function getRecordingAudioStream() {
  if (!audioContext) return null;
  if (!recordDest) {
    try {
      recordDest = audioContext.createMediaStreamDestination();
      // Wire up sources that already exist
      if (audioAnalyser) audioAnalyser.connect(recordDest);
      for (const key in tonePlayers) {
        try { tonePlayers[key].connect(recordDest); } catch (e) {}
      }
    } catch (e) {
      console.warn("Failed to create recording tap:", e);
      return null;
    }
  }
  return recordDest.stream;
}

export function getAudioFrequency(bandIndex, numBands) {
  if (!audioAnalyser || !audioFrequencyData) return 0;
  audioAnalyser.getByteFrequencyData(audioFrequencyData);
  const binCount = audioFrequencyData.length;
  const bandSize = Math.floor(binCount / numBands);
  const start = bandIndex * bandSize;
  const end = Math.min(start + bandSize, binCount);
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += audioFrequencyData[i];
  }
  return sum / (end - start) / 255; // Normalize to 0-1
}

export function playAudio() {
  if (!audioElement) return;
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().then(() => audioElement.play().catch(() => {}));
  } else {
    audioElement.play().catch(() => {});
  }
}

export function stopAudio() {
  if (audioElement) {
    audioElement.pause();
  }
}

export function setAudioTrack(trackName) {
  const trackPath = PATHS.audio[trackName];
  if (trackPath && audioElement) {
    const wasPlaying = !audioElement.paused;
    audioElement.src = trackPath;
    if (wasPlaying) {
      audioElement.play().catch(() => {});
    }
  }
}

export function initSFX() {
  // Preload all SFX for immediate playback
  if (PATHS.sfx) {
    for (const [name, path] of Object.entries(PATHS.sfx)) {
      if (name === "helicopter") {
        // Helicopter is looping, handle separately
        helicopterAudio = new Audio(path);
        helicopterAudio.loop = true;
        helicopterAudio.volume = 0.3;
      } else {
        // Preload other SFX
        const audio = new Audio(path);
        audio.volume = 0.5;
        audio.preload = "auto";
        preloadedSFX[name] = audio;
      }
    }
  }
}

function initToneSFX() {
  if (typeof Tone === "undefined") return;
  // Pre-create a player for each SFX + player combination
  for (const name of MODULATED_SFX) {
    const path = PATHS.sfx[name];
    if (!path) continue;
    for (let i = 0; i < 4; i++) {
      const semitones = PLAYER_PITCH_OFFSETS[i % PLAYER_PITCH_OFFSETS.length] || 0;
      const rate = Math.pow(2, semitones / 12);
      const player = new Tone.Player(path).toDestination();
      player.playbackRate = rate;
      player.volume.value = -6;
      // Also feed the recorder tap so captured audio includes SFX
      if (recordDest) {
        try { player.connect(recordDest); } catch (e) {}
      }
      tonePlayers[`${name}_${i}`] = player;
    }
  }
}

export function playSFX(sfxName, playerIndex) {
  // Try Tone.js player first (pitch-modulated), only if context is running
  if (playerIndex != null && typeof Tone !== "undefined" && Tone.context.state === "running") {
    const player = tonePlayers[`${sfxName}_${playerIndex}`];
    if (player && player.loaded) {
      try {
        player.stop();
        player.start();
        return;
      } catch (e) {
        // Fall through to standard playback
      }
    }
  }
  // Standard HTML Audio playback (works in user gesture even before Tone is ready)
  if (!preloadedSFX[sfxName]) return;
  const sfx = preloadedSFX[sfxName];
  sfx.currentTime = 0;
  sfx.play().catch(() => {});
}

export function playHelicopterSound() {
  if (helicopterAudio && helicopterAudio.paused) {
    helicopterAudio.play().catch(() => {});
  }
}

export function stopHelicopterSound() {
  if (helicopterAudio) {
    helicopterAudio.pause();
    helicopterAudio.currentTime = 0;
  }
}

// Unlock audio on first user interaction (required by mobile browsers)
let audioUnlocked = false;
export function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  // Create AudioContext during user gesture, then wire up analyser once running
  if (!audioContext && audioElement) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Failed to create AudioContext:", e);
    }
  }
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().then(() => setupAudioAnalyser());
  } else {
    setupAudioAnalyser();
  }
  // Load Tone.js dynamically on first gesture (avoids AudioContext warning at page load)
  if (typeof Tone === "undefined") {
    const script = document.createElement("script");
    script.src = "./assets/js/lib/Tone.js";
    script.onload = () => {
      shareToneContext();
      Tone.start().then(() => initToneSFX()).catch(() => {});
    };
    document.head.appendChild(script);
  } else {
    shareToneContext();
    Tone.start().then(() => initToneSFX()).catch(() => {});
  }
}

// Put Tone.js on the same AudioContext as the music so SFX flow through the
// same graph (and the recorder tap can capture them in a single stream).
function shareToneContext() {
  if (typeof Tone === "undefined" || !audioContext) return;
  try {
    if (Tone.getContext().rawContext !== audioContext) {
      Tone.setContext(audioContext);
    }
  } catch (e) {
    console.warn("Failed to share Tone context:", e);
  }
}
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

// Accessors for external code (GUI, updateLamps)
export function getAudioElement() { return audioElement; }
export function isAnalyserReady() { return !!audioAnalyser; }
