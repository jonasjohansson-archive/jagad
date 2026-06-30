// Jagad - Chase Game
// Main entry point

const DEBUG = false; // Set to true for console logging

import * as THREE from "./lib/three/three.module.js";
import { GLTFLoader } from "./lib/three/addons/loaders/GLTFLoader.js";

import { KTX2Loader } from "./lib/three/addons/loaders/KTX2Loader.js";
import { defaultSettings, loadSettings, saveSettings, exportSettings, importSettings } from "./game/settings.js?v=17";
import { PATHS, CHASER_CONTROLS } from "./game/constants.js?v=8";
import { createBoostState, triggerBoost, updateBoosts, getBoostMultiplier, resetBoosts, addBoostGUI } from "./gui/index.js?v=1";
import { isMobileDevice, saveDesktopSettings, applyMobileOverrides, restoreDesktopSettings, initTouchInput } from "./game/mobile.js?v=4";
import { checkCollision } from "./game/collision.js?v=149";
import { getServerAddress, connectToServer, sendServerEvent, postHighScore } from "./game/server.js?v=149";
import { initAudio, playAudio, stopAudio, setAudioTrack, initSFX, playSFX, playHelicopterSound, stopHelicopterSound, unlockAudio, getAudioElement } from "./systems/audio.js?v=149";
import { initPostProcessing, updatePostProcessing } from "./rendering/postprocessing.js?v=149";
import { loadHelicopter, updateHelicopter, rebuildHelicopterCone, updateHelicopterColor, updateHelicopterScale, updateHelicopterBoundsHelper, getHelicopter, getHelicopterLightHelper, getHelicopterBoundsHelper, setHelicopterLightHelper } from "./systems/helicopter.js?v=149";
import { setupSearchlights, updateSearchlights, toggleSearchlightHelpers } from "./systems/searchlights.js?v=149";
import { updateLamps, updateCarsAudio, updateTextBPMPulse, updateAllEmissives } from "./systems/emissives.js?v=149";
import { createCaptureEffect, updateCaptureEffects, clearCaptureEffects } from "./systems/captureEffects.js?v=149";
import { setupGlassMeshes, updateGlassCanvas, updateGlassPosition, updateGlassMaterialOpacity, updateGlassColor, updateGlassBrightness, isShuffleActive, setBeforeRenderCallback, getGlassMeshes, getGlassMaterials, getGlassVideo, getGlassCanvas, isGlassVideoReady } from "./rendering/glass.js?v=149";
import { initTemplateVars, applyStartingText, applyPlayingText, applyHighScoreText, applyGameOverText } from "./game/templateVars.js?v=149";
import { initProjection, initProjectionPlane, updateProjectionForState, loadProjectionImage, updateProjectionPump, handleProjectionStateChange, applyProjectionMaterial } from "./rendering/projection.js?v=149";
import { initPathMovement, initActorOnPath, updateFugitiveMovementPath, updateChaserMovementPath } from "./game/pathMovement.js?v=149";
import { initActorWire, ActorWire, updateWireBillboards } from "./systems/actorWire.js?v=149";
import { triggerShake, updateShake } from "./systems/cameraShake.js";
import { setupLights, toneMappingOptions } from "./rendering/lights.js?v=149";
import { initRecorder, flushSnapshot } from "./systems/recorder.js?v=1";

// lil-gui loaded via script tag in index.html
const GUI = window.lil.GUI;

// Layer constants for selective pixelation
const LAYERS = {
  DEFAULT: 0,      // Effects, particles, billboards, UI
  GLB_MODELS: 1    // Pixelated: helicopter, level, cars
};

// Loading progress tracker
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
// Hide loading overlay immediately for facade mode
if (new URLSearchParams(window.location.search).has("facade") && loadingOverlay) {
  loadingOverlay.style.display = "none";
}

const loadingProgress = {
  total: 0,
  loaded: 0,
  register(count = 1) {
    this.total += count;
    this.update();
  },
  complete(count = 1) {
    this.loaded += count;
    this.update();
  },
  update() {
    if (this.total === 0) return;
    const percent = Math.round((this.loaded / this.total) * 100);
    if (loadingText) loadingText.textContent = `${percent}%`;
    if (percent < 100) {
      document.title = `Jagad ${percent}%`;
    } else {
      document.title = "Jagad";
    }
  },
  finish() {
    document.title = "Jagad";
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
      setTimeout(() => loadingOverlay.remove(), 600);
    }
  }
};

(async () => {
  // Suppress Three.js texture unit warnings
  const originalWarn = console.warn;
  console.warn = function(...args) {
    const msg = args[0];
    if (typeof msg === "string" && msg.includes("texture units")) {
      return;
    }
    originalWarn.apply(console, args);
  };

  // ============================================
  // CORE SETUP
  // ============================================

  const canvas = document.getElementById("game-canvas");

  const statusEl = {
    set textContent(val) {
      // Silent - remove console logging
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x191928);

  // ============================================
  // SERVER CONNECTION (fire-and-forget, game works offline)
  // ============================================

  const isFacadeMode = new URLSearchParams(window.location.search).has("facade");

  if (isFacadeMode) connectToServer();

  // WebGL Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * (defaultSettings.renderScale || 1));
  renderer.setClearColor(0x191928, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  // Capture: press R (or ?record) to record canvas + audio to a .webm
  initRecorder(canvas, { fps: 60 });

  // KTX2 texture loader (GPU-compressed textures in GLB)
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath("assets/js/lib/three/addons/libs/basis/");
  ktx2Loader.detectSupport(renderer);

  // Post-processing (WebGL EffectComposer)
  let composer = null;

  // ============================================
  // STATE
  // ============================================

  let buildingPlane = null;
  let camera;
  let orthoCamera;
  let perspCamera;
  const glbCameras = [];

  // Initial placeholder camera, replaced by setupCameras() after level loads
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(0, 100, 100);

  const fugitives = [];
  const chasers = [];
  let chaserLightHelpers = [];

  const settings = {
    gameStarted: false,
    ...defaultSettings,
    startGame: function() {
      if (!STATE.loaded) return;
      settings.gameStarted = true;
      STATE.gameOver = false;
      statusEl.textContent = "Game started! Escape the chasers!";
    },
    exportSettings: function() {
      exportSettings(settings);
      statusEl.textContent = "Settings exported!";
    },
    importSettings: function() {
      importSettings((imported) => {
        // Apply each setting and trigger onChange handlers
        if (guiLeft) {
          guiLeft.controllersRecursive().forEach(c => {
            const prop = c.property;
            if (prop && imported[prop] !== undefined) {
              c.setValue(imported[prop]);
            }
          });
        }
        // Also directly assign any settings not in GUI
        Object.assign(settings, imported);
        statusEl.textContent = "Settings imported!";
      });
    },
  };

  // Facade mode overrides
  if (isFacadeMode) {
    settings.exposure = 0.67;
    settings.renderScale = 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
    renderer.toneMappingExposure = settings.exposure;
  }

  const boostStates = createBoostState(4, settings);

  let guiLeft = null;

  // ============================================
  // FPS / PERFORMANCE STATS
  // ============================================

  const statsPanel = (() => {
    const el = document.createElement("div");
    el.id = "stats-panel";
    Object.assign(el.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: "9999",
      background: "rgba(0,0,0,0.7)",
      color: "#0f0",
      fontFamily: "monospace",
      fontSize: "12px",
      padding: "8px 10px",
      borderRadius: "4px",
      lineHeight: "1.5",
      pointerEvents: "none",
      minWidth: "140px",
      display: "none",
    });
    document.body.appendChild(el);

    let frames = 0;
    let lastSec = performance.now();
    let fps = 0;
    let frameTime = 0;
    let minFps = Infinity;
    let maxFps = 0;

    return {
      el,
      begin() {
        this._start = performance.now();
      },
      end() {
        const now = performance.now();
        frameTime = now - this._start;
        frames++;
        if (now - lastSec >= 1000) {
          fps = frames;
          if (fps < minFps) minFps = fps;
          if (fps > maxFps) maxFps = fps;
          frames = 0;
          lastSec = now;
          const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : "N/A";
          const calls = renderer.info.render.calls;
          const tris = renderer.info.render.triangles;
          el.innerHTML =
            `<b>${fps}</b> FPS (${frameTime.toFixed(1)} ms)` +
            `<br>min ${minFps} / max ${maxFps}` +
            `<br>draw calls: ${calls}` +
            `<br>triangles: ${(tris / 1000).toFixed(1)}k` +
            `<br>mem: ${mem}`;
        }
      },
    };
  })();

  const STATE = {
    loaded: false,
    gameOver: false,
    lastTime: 0,
    levelCenter: new THREE.Vector3(),
    horizontalSize: 100,
    levelContainer: null,
    // Game timer
    gameTimerStarted: false,
    gameTimerRemaining: 90,
    showingScore: false,
    scoreDisplayTime: 0,
    activeChaserCount: 0, // Cached count to avoid filter() every frame
    // Game states system
    gameState: "PRE_GAME", // PRE_GAME, STARTING, PLAYING, GAME_OVER
    countdownValue: 3,     // 3, 2, 1, 0 (GO)
    countdownTimer: 0,     // Time accumulator for countdown
    playerScore: 0,        // Current game score
    fugitiveValue: 250,    // Points per fugitive (decreases over time)
    // High score entry
    enteringHighScore: false,
    highScoreInitials: ["A", "A", "A"],
    highScoreInitialsTouched: [false, false, false],
    highScorePosition: 0,  // Which initial being edited (0-2)
    highScoreCharIndex: 0, // Current character A-Z, 0-9
    newHighScoreRank: -1,  // Position in high scores list (0, 1, or 2)
    firstPlayerIndex: -1,  // Index of the first player who joined
    highScoreInitialsColor: null, // Color for high score initials (first player's color)
  };

  initTemplateVars(settings, STATE, () => fugitives.length);
  initProjection(scene, settings, STATE, renderer, setGameState);
  initPathMovement(settings, STATE, chasers, fugitives, getChaserInputDirection);
  initActorWire(scene, settings, STATE, renderer);

  // Helper to get level center (avoids creating new Vector3)
  const getLevelCenter = () => STATE.levelCenter;

  // ============================================
  // INPUT
  // ============================================

  // Facade mode: remap C4 to z/x/c/v/b directly (no arrow keys)
  // Normal mode: alias z/x/c/v/b to arrow keys so both work
  if (isFacadeMode) {
    CHASER_CONTROLS[3] = { up: "z", down: "x", left: "c", right: "v", enter: "b" };
  }
  const KEY_ALIASES = isFacadeMode ? {} : { z: "arrowup", x: "arrowdown", c: "arrowleft", v: "arrowright", b: "enter" };

  const keys = new Set();
  const chaserControlKeys = CHASER_CONTROLS.flatMap(ctrl => [ctrl.up, ctrl.down, ctrl.left, ctrl.right, ctrl.enter]);

  // Character set for high score initials
  const HIGH_SCORE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Blocked words for high score initials
  let blockedWords = [];
  fetch("assets/data/blocked-words.txt")
    .then(r => r.text())
    .then(text => {
      blockedWords = text.split("\n").map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
    })
    .catch(() => {});

  function wouldFormBlockedWord(initials, position, char) {
    const test = [...initials];
    test[position] = char;
    const word = test.join("").toUpperCase();
    return blockedWords.some(blocked => word.includes(blocked));
  }

  function cycleChar(direction) {
    let attempts = 0;
    do {
      STATE.highScoreCharIndex = (STATE.highScoreCharIndex + direction + HIGH_SCORE_CHARS.length) % HIGH_SCORE_CHARS.length;
      attempts++;
    } while (
      attempts < HIGH_SCORE_CHARS.length &&
      wouldFormBlockedWord(STATE.highScoreInitials, STATE.highScorePosition, HIGH_SCORE_CHARS[STATE.highScoreCharIndex])
    );
    STATE.highScoreInitials[STATE.highScorePosition] = HIGH_SCORE_CHARS[STATE.highScoreCharIndex];
    STATE.highScoreInitialsTouched[STATE.highScorePosition] = true;
    updateHighScoreDisplay();
  }

  window.addEventListener("keydown", (e) => {
    const keyLower = KEY_ALIASES[e.key.toLowerCase()] || e.key.toLowerCase();

    // Toggle GUI + stats panel with CMD/CTRL+G
    if (keyLower === "g" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (guiLeft) {
        const show = guiLeft.domElement.style.display === "none";
        guiLeft.domElement.style.display = show ? "" : "none";
        statsPanel.el.style.display = show ? "" : "none";
      }
      return;
    }

    // High score entry mode — only first player controls the initials
    if (STATE.enteringHighScore) {
      const fpIdx = STATE.firstPlayerIndex >= 0 ? STATE.firstPlayerIndex : 0;
      const fpCtrl = CHASER_CONTROLS[fpIdx];
      e.preventDefault();
      if (keyLower === fpCtrl.up) {
        cycleChar(1);
      } else if (keyLower === fpCtrl.down) {
        cycleChar(-1);
      } else if (keyLower === fpCtrl.right) {
        // Move to next initial
        if (STATE.highScorePosition < 2) {
          STATE.highScorePosition++;
          STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
          if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
          updateHighScoreDisplay();
        }
      } else if (keyLower === fpCtrl.left) {
        // Move to previous initial
        if (STATE.highScorePosition > 0) {
          STATE.highScorePosition--;
          STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
          if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
          updateHighScoreDisplay();
        }
      } else if (keyLower === fpCtrl.enter) {
        // Confirm high score entry (first player's enter key only)
        confirmHighScoreEntry();
      }
      keys.add(keyLower);
      return;
    }

    if (chaserControlKeys.includes(keyLower)) {
      e.preventDefault();
      e.stopPropagation();
      // Track last pressed axis per chaser for diagonal prevention
      for (let i = 0; i < CHASER_CONTROLS.length; i++) {
        const ctrl = CHASER_CONTROLS[i];
        if (keyLower === ctrl.left || keyLower === ctrl.right) { lastAxis[i] = "x"; break; }
        if (keyLower === ctrl.up || keyLower === ctrl.down) { lastAxis[i] = "z"; break; }
      }
      // Return focus to canvas so GUI doesn't steal key events
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== canvas) {
        document.activeElement.blur();
        canvas.focus();
      }
      // In PRE_GAME or STARTING state, mark the chaser as ready (lights up car fully)
      if (STATE.loaded && (STATE.gameState === "PRE_GAME" || STATE.gameState === "STARTING")) {
        const chaserIndex = getChaserIndexForKey(keyLower);
        if (chaserIndex >= 0) {
          markChaserReady(chaserIndex);
        }
      }
      // Boost: trigger on player's enter key during gameplay
      if (STATE.gameState === "PLAYING") {
        for (let i = 0; i < CHASER_CONTROLS.length; i++) {
          if (keyLower === CHASER_CONTROLS[i].enter) {
            const boosted = triggerBoost(boostStates, i, settings);
            if (boosted) {
              playSFX("nitro", i);
              triggerShake(0.15, 0.15);
            } else {
              playSFX("honk", i);
            }
            break;
          }
        }
      }
    }

    // Debug capture triggers: 1-4 triggers capture of F1-F4 by C1-C4
    if (e.key >= "1" && e.key <= "4") {
      const index = parseInt(e.key) - 1;
      triggerCapture(index, index);
    }

    // Force timer to run out (use near-zero so next frame triggers GAME_OVER)
    if (e.key === "5" && STATE.gameState === "PLAYING" && STATE.gameTimerStarted) {
      STATE.gameTimerRemaining = 0.001;
    }

    // Toggle Glass-Glass GLB part opacity between current and 1 (facade mode only)
    if (e.key === "6" && isFacadeMode) {
      const glassData = glbParts.get("Glass-Glass");
      if (glassData && glassData.mesh.material) {
        const mat = glassData.mesh.material;
        if (mat.opacity < 1) {
          STATE._savedGlassPartOpacity = mat.opacity;
          mat.opacity = 1;
          mat.transparent = false;
        } else {
          mat.opacity = STATE._savedGlassPartOpacity ?? 0.5;
          mat.transparent = mat.opacity < 1;
        }
        mat.needsUpdate = true;
      }
    }

    keys.add(keyLower);
  });
  window.addEventListener("keyup", (e) => keys.delete(KEY_ALIASES[e.key.toLowerCase()] || e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // Touch input (mobile swipe controls for Chaser 1)
  initTouchInput(canvas, keys, STATE, markChaserReady, () => {
    unlockAudio(); // Unlock audio/Tone.js on first touch
  });

  function triggerCapture(fugitiveIndex, chaserIndex) {
    if (!STATE.loaded) return;
    if (STATE.gameState !== "PLAYING") return; // Only allow captures during PLAYING state
    if (fugitiveIndex >= fugitives.length) return;

    const f = fugitives[fugitiveIndex];
    if (f.captured) return;

    // Mark as captured
    f.captured = true;
    STATE.capturedCount = (STATE.capturedCount || 0) + 1;
    playSFX("capture", chaserIndex);

    // Add score based on current fugitive value
    const points = Math.max(0, Math.floor(STATE.fugitiveValue));
    STATE.playerScore += points;
    sendServerEvent({ type: "fugitiveCaught", chaserIndex, fugitiveIndex, points, score: STATE.playerScore, capturedCount: STATE.capturedCount, color: [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color][chaserIndex] });

    // Get chaser color for the effect
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const chaserColor = chaserColors[chaserIndex] || "#ffffff";

    // Get billboard before hiding
    const wire = fugitiveWires[f.index];
    const billboard = wire ? wire.billboard : null;

    // Create capture effect at fugitive position
    createCaptureEffect(f.mesh.position.clone(), chaserColor, billboard, scene, settings, STATE);

    // Hide fugitive
    f.mesh.position.y = -1000;
    if (f.light) f.light.intensity = 0;

    if (wire) {
      if (wire.billboard) wire.billboard.scale.setScalar(0);
      if (wire.billboardLight) wire.billboardLight.intensity = 0;
    }

    // Check if all captured
    if (STATE.capturedCount >= fugitives.length && !STATE.gameOver) {
      setGameState("GAME_OVER");
    }
  }

  // Track last pressed direction axis per chaser: "x" or "z"
  const lastAxis = {};

  function getChaserInputDirection(chaserIndex) {
    if (chaserIndex >= CHASER_CONTROLS.length) return { x: 0, z: 0, hasInput: false };
    const ctrl = CHASER_CONTROLS[chaserIndex];

    let dx = 0;
    let dz = 0;

    if (keys.has(ctrl.up)) dz = -1;
    if (keys.has(ctrl.down)) dz = 1;
    if (keys.has(ctrl.left)) dx = -1;
    if (keys.has(ctrl.right)) dx = 1;

    // Prevent diagonal: last pressed axis wins
    if (dx !== 0 && dz !== 0) {
      if (lastAxis[chaserIndex] === "x") dz = 0;
      else dx = 0;
    }

    const hasInput = dx !== 0 || dz !== 0;
    return { x: dx, z: dz, hasInput };
  }

  function getChaserIndexForKey(key) {
    for (let i = 0; i < CHASER_CONTROLS.length; i++) {
      const ctrl = CHASER_CONTROLS[i];
      if (key === ctrl.up || key === ctrl.down || key === ctrl.left || key === ctrl.right || key === ctrl.enter) {
        return i;
      }
    }
    return -1;
  }

  function markChaserReady(chaserIndex) {
    if (chaserIndex < 0 || chaserIndex >= chasers.length) return;
    const chaser = chasers[chaserIndex];
    if (chaser.ready) return; // Already ready

    chaser.ready = true;

    // Track first player to join
    if (STATE.firstPlayerIndex < 0) {
      STATE.firstPlayerIndex = chaserIndex;
    }

    playSFX("playerSelect", chaserIndex);
    triggerShake(0.2, 0.15);

    // Create pulse wave from chaser position in their color
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const chaserColor = chaserColors[chaserIndex] || "#ffffff";
    if (chaser.mesh) {
      createCaptureEffect(chaser.mesh.position.clone(), chaserColor, null, scene, settings, STATE);
    }

    // Light up the car fully (like when active/moving)
    if (chaser.isCarModel && chaser.mesh) {
      chaser.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          const mat = child.material;
          mat.transparent = true;
          mat.opacity = 1;
          mat.depthWrite = true;
          if (mat.emissive) {
            mat.emissiveIntensity = 0.3;
          }
          mat.needsUpdate = true;
        }
      });
    } else if (chaser.material) {
      chaser.material.transparent = true;
      chaser.material.opacity = 1;
      chaser.material.depthWrite = true;
      if (chaser.material.emissive) {
        chaser.material.emissiveIntensity = 0.3;
      }
      chaser.material.needsUpdate = true;
    }

    // Turn on headlights
    if (chaser.light) {
      chaser.light.intensity = settings.chaserLightIntensity;
    }
    if (DEBUG) console.log(`Chaser ${chaserIndex} is ready!`);
    sendServerEvent({ type: "chaserSelected", chaserIndex, color: chaserColor, playerName: `Player ${chaserIndex + 1}` });

    // Check if this is the first ready chaser - start countdown
    const readyCount = chasers.filter(c => c.ready).length;
    if (readyCount === 1) {
      setGameState("STARTING");
    }
  }

  // ============================================
  // GAME STATE MANAGEMENT
  // ============================================

  function loadHighScores() {
    return settings.highScores.slice(); // Return copy from cache
  }

  function saveHighScores(scores) {
    settings.highScores = scores;
    if (STATE.updateStateDisplay) STATE.updateStateDisplay();
  }

  // Fetch highscores from server into local cache
  function fetchServerHighScores() {
    fetch(`${getServerAddress()}/api/highscore`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          // Map server format (playerName) to local format (initials)
          settings.highScores = data.map(e => ({
            initials: (e.playerName || "???").substring(0, 3),
            score: e.score,
          }));
          if (STATE.updateStateDisplay) STATE.updateStateDisplay();
        }
      })
      .catch(() => {});
  }

  if (isFacadeMode) fetchServerHighScores();

  // Set all chasers to low or full opacity
  function setChasersOpacity(opacity) {
    const isLowOpacity = opacity < 1;
    for (const c of chasers) {
      // Respect ready state - ready chasers stay fully lit
      const effectiveOpacity = (isLowOpacity && c.ready) ? 1 : opacity;
      const effectiveEmissive = (isLowOpacity && c.ready) ? 0.3 : (isLowOpacity ? 0.05 : 0.3);
      const effectiveDepthWrite = (isLowOpacity && c.ready) ? true : !isLowOpacity;

      // Use cached materials if available (car models)
      if (c.cachedMaterials && c.cachedMaterials.length > 0) {
        for (const mat of c.cachedMaterials) {
          mat.transparent = true;
          mat.opacity = effectiveOpacity;
          mat.depthWrite = effectiveDepthWrite;
          if (mat.emissive) {
            mat.emissiveIntensity = effectiveEmissive;
          }
          mat.needsUpdate = true;
        }
      } else if (c.material) {
        c.material.transparent = true;
        c.material.opacity = effectiveOpacity;
        c.material.depthWrite = effectiveDepthWrite;
        if (c.material.emissive) {
          c.material.emissiveIntensity = effectiveEmissive;
        }
        c.material.needsUpdate = true;
      }
      if (c.light) {
        if (isLowOpacity) {
          // Respect ready state - ready chasers get full brightness, others get 10%
          c.light.intensity = c.ready
            ? settings.chaserLightIntensity
            : settings.chaserLightIntensity * 0.1;
        } else {
          c.light.intensity = settings.chaserLightIntensity;
        }
      }
    }
  }

  function setGameState(newState) {
    const oldState = STATE.gameState;
    STATE.gameState = newState;
    settings.gameState = newState;

    if (DEBUG) console.log(`Game state: ${oldState} -> ${newState}`);

    switch (newState) {
      case "PRE_GAME":
        stopHelicopterSound(); // Stop helicopter loop
        handleProjectionStateChange(newState, oldState);
        // Clear glass text in PRE_GAME (intro image replaces text)
        settings.glassTextRow1 = "";
        settings.glassTextRow2 = "";
        settings.glassTextRow3 = "";
        settings.glassTextRow4 = "";
        settings.gameStarted = false;
        STATE.gameOver = false;
        STATE.firstPlayerIndex = -1;
        // Reset all chasers to visible but dimmed
        for (const c of chasers) {
          if (c.mesh) c.mesh.visible = true;
          if (c.light) c.light.visible = true;
          c.ready = false;
          c.active = false;
        }
        setChasersOpacity(0.1);
        // Hide fugitive billboards
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            wire.hideWireAndBillboard();
          }
        }
        break;

      case "STARTING":
        sendServerEvent({ type: "gameStarted" });
        settings.gameStarted = true; // Mark as started but input blocked
        setChasersOpacity(0.1);
        // Pre-set non-ready chaser materials to transparent to avoid shader recompilation at PLAYING
        for (const c of chasers) {
          if (!c.ready) {
            if (c.isCarModel && c.mesh) {
              c.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                  child.material.transparent = true;
                  child.material.needsUpdate = true;
                }
              });
            } else if (c.material) {
              c.material.transparent = true;
              c.material.needsUpdate = true;
            }
          }
        }
        playAudio();
        handleProjectionStateChange(newState, oldState);
        break;

      case "PLAYING":
        // Frame 0: state variables only — no DOM/GPU work
        STATE.gameTimerStarted = true;
        STATE.gameTimerRemaining = 90;
        STATE.fugitiveValue = 250;
        STATE.playerScore = 0;
        STATE.capturedCount = 0;

        // Start fugitive light fade-in (just zeroing values, cheap)
        for (const f of fugitives) {
          if (f.light) f.light.intensity = 0;
        }
        STATE.fugitiveLightFadeStart = performance.now();

        // Frame 1: hide non-ready chasers (shaders pre-warmed in STARTING)
        requestAnimationFrame(() => {
          for (const c of chasers) {
            if (!c.ready) {
              if (c.light) c.light.visible = false;
              if (c.isCarModel && c.mesh) {
                c.mesh.traverse((child) => {
                  if (child.isMesh && child.material) {
                    child.material.opacity = 0;
                  }
                });
              } else if (c.material) {
                c.material.opacity = 0;
              }
            }
          }
        });
        // Frame 2: projection texture swap (pre-warmed into GPU during countdown)
        setTimeout(() => {
          updateProjectionForState("PLAYING");
        }, 32);
        // Frame 3: glass canvas text update
        setTimeout(() => {
          applyPlayingText();
          updateGlassCanvas();
        }, 64);
        // Frame 4: game start SFX
        setTimeout(() => {
          playSFX("gameStart");
        }, 100);
        // Frame 5: background audio + helicopter
        setTimeout(() => {
          playAudio();
          playHelicopterSound();
        }, 150);
        // Frame 6+: stagger billboard pop-ins
        { let popDelay = 250;
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            setTimeout(() => wire.startPopIn(), popDelay);
            popDelay += 200;
          }
        } }
        break;

      case "GAME_OVER":
        sendServerEvent({ type: "gameEnd", score: STATE.playerScore, capturedCount: STATE.capturedCount, gameTime: Math.round(90 - (STATE.gameTimerRemaining || 0)), allCaught: STATE.capturedCount >= fugitives.length });
        stopHelicopterSound(); // Stop helicopter loop
        STATE.gameOver = true;
        STATE.gameTimerStarted = false;
        setChasersOpacity(0.1);
        // Turn off fugitive lights and billboards
        for (const f of fugitives) {
          if (f.light) f.light.intensity = 0;
        }
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            wire.hideWireAndBillboard();
          }
        }
        showGameScore();
        // Play win/lose SFX
        const allCaught = STATE.capturedCount >= fugitives.length;
        const isWin = isFacadeMode ? checkHighScore(STATE.playerScore) >= 0 : allCaught;
        playSFX(isWin ? "gameWin" : "gameLose");
        // Reset to PRE_GAME after 10 seconds (unless entering high score)
        setTimeout(() => {
          if (STATE.gameState === "GAME_OVER" && !STATE.enteringHighScore) {
            setGameState("PRE_GAME");
          }
        }, 10000);
        break;
    }

    // Update the glass canvas and projection (deferred for PLAYING to avoid frame stutter)
    if (newState !== "PLAYING" && !STATE.gameAnimationPlaying) {
      updateGlassCanvas();
      updateProjectionForState(newState);
    }

    // Update GUI state display
    if (STATE.updateStateDisplay) STATE.updateStateDisplay();
  }


  function checkHighScore(score) {
    const highScores = loadHighScores();
    for (let i = 0; i < highScores.length; i++) {
      if (score > highScores[i].score) {
        return i; // Return position (0, 1, or 2)
      }
    }
    return -1; // Not a high score
  }

  function startHighScoreEntry(position) {
    STATE.enteringHighScore = true;
    STATE.highScorePosition = 0;
    STATE.highScoreInitials = ["A", "A", "A"];
    STATE.highScoreInitialsTouched = [false, false, false];
    STATE.highScoreCharIndex = 0;
    STATE.newHighScoreRank = position;
    // Set initials color to first player's color
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    STATE.highScoreInitialsColor = STATE.firstPlayerIndex >= 0 ? chaserColors[STATE.firstPlayerIndex] : null;
    updateHighScoreDisplay();

    // Auto-confirm after 30 seconds
    STATE.highScoreTimeout = setTimeout(() => {
      if (STATE.enteringHighScore) {
        confirmHighScoreEntry();
      }
    }, 30000);
  }

  function updateHighScoreDisplay() {
    // Use configured high score text with template variables
    applyHighScoreText();
    updateGlassCanvas();
  }

  function confirmHighScoreEntry() {
    // Clear auto-confirm timeout if manually confirmed
    if (STATE.highScoreTimeout) {
      clearTimeout(STATE.highScoreTimeout);
      STATE.highScoreTimeout = null;
    }
    // Ensure initials are exactly 3 characters
    const initials = STATE.highScoreInitials.join("").substring(0, 3).padEnd(3, "A");
    const score = STATE.playerScore;
    const position = STATE.newHighScoreRank;

    // Update local cache optimistically
    const highScores = loadHighScores();
    highScores.splice(position, 0, { initials, score });
    if (highScores.length > 10) highScores.length = 10;
    saveHighScores(highScores);

    // Post to server and refresh cache from response
    postHighScore({ score, playerName: initials, color: STATE.highScoreInitialsColor || null })
      .then(() => fetchServerHighScores());

    STATE.enteringHighScore = false;

    // Staggered pulse waves from each ready chaser
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const readyChasers = chasers.filter(c => c.ready && c.mesh);
    let delay = 0;
    for (const c of readyChasers) {
      const idx = chasers.indexOf(c);
      setTimeout(() => {
        createCaptureEffect(c.mesh.position.clone(), chaserColors[idx] || "#ffffff", null, scene, settings, STATE);
        playSFX("capture", idx);
      }, delay);
      delay += 300;
    }

    // Clear glass text and restart after last pulse
    setTimeout(() => {
      settings.glassTextRow1 = "";
      settings.glassTextRow2 = "";
      settings.glassTextRow3 = "";
      settings.glassTextRow4 = "";
      updateGlassCanvas();
      resetGame();
    }, delay + 2000);
  }

  function displayHighScores() {
    // Use configured high score text with template variables
    applyHighScoreText();
    updateGlassCanvas();

    // Start reset timer
    STATE.showingScore = true;
    STATE.scoreDisplayTime = 5;
  }

  // ============================================
  // LIGHTS
  // ============================================

  const { ambientLight, directionalLight } = setupLights(scene, renderer, settings);

  // ============================================
  // CAMERAS
  // ============================================

  function setupCameras(levelCenter, horizontalSize) {
    const aspect = window.innerWidth / window.innerHeight;

    // Adjust FOV on narrower viewports to prevent board clipping
    const referenceAspect = 16 / 9;
    let perspFov = settings.perspFov;
    if (aspect < referenceAspect) {
      const baseFovRad = THREE.MathUtils.degToRad(settings.perspFov);
      const adjustedFovRad = 2 * Math.atan(Math.tan(baseFovRad / 2) * referenceAspect / aspect);
      perspFov = THREE.MathUtils.radToDeg(adjustedFovRad) * 1.1;
    }
    perspCamera = new THREE.PerspectiveCamera(perspFov, aspect, settings.perspNear, settings.perspFar);
    perspCamera.position.set(settings.perspPosX + (settings.perspPanX || 0), settings.perspPosY, settings.perspPosZ + (settings.perspPanZ || 0));
    perspCamera.lookAt(levelCenter.x + (settings.perspPanX || 0), levelCenter.y, levelCenter.z + (settings.perspPanZ || 0));

    const frustumSize = horizontalSize * 1.5;
    const orthoDistance = horizontalSize * 1.2;
    const oLeft = aspect >= 1 ? frustumSize * aspect / -2 : frustumSize / -2;
    const oRight = aspect >= 1 ? frustumSize * aspect / 2 : frustumSize / 2;
    const oTop = aspect >= 1 ? frustumSize / 2 : frustumSize / aspect / 2;
    const oBottom = aspect >= 1 ? frustumSize / -2 : frustumSize / aspect / -2;
    orthoCamera = new THREE.OrthographicCamera(oLeft, oRight, oTop, oBottom, 0.1, 5000);
    orthoCamera.position.set(levelCenter.x, levelCenter.y + orthoDistance, levelCenter.z);
    orthoCamera.lookAt(levelCenter);
    orthoCamera.zoom = settings.orthoZoom;
    orthoCamera.updateProjectionMatrix();

    camera = settings.cameraType === "orthographic" ? orthoCamera : perspCamera;
  }

  function switchCamera(type) {
    settings.cameraType = type;
    if (type === "orthographic") {
      camera = orthoCamera;
    } else if (type === "perspective") {
      camera = perspCamera;
    } else {
      const glbCam = glbCameras.find(c => c.name === type);
      if (glbCam && glbCam.camera.isPerspectiveCamera) {
        // Copy GLB camera settings onto perspCamera so GUI tweaks still work
        const src = glbCam.camera;
        perspCamera.position.copy(src.getWorldPosition(new THREE.Vector3()));
        perspCamera.quaternion.copy(src.getWorldQuaternion(new THREE.Quaternion()));
        perspCamera.fov = src.fov;
        // Clamp the GLB camera's near/far to the board scale — Blender exports
        // commonly ship 0.1/1000+ which wrecks z-buffer precision here.
        const clampedNear = Math.max(src.near, 1);
        const clampedFar = Math.min(src.far, 400);
        perspCamera.near = clampedNear;
        perspCamera.far = clampedFar;
        perspCamera.aspect = window.innerWidth / window.innerHeight;
        perspCamera.updateProjectionMatrix();
        // Update settings to reflect GLB values
        settings.perspFov = src.fov;
        settings.perspNear = clampedNear;
        settings.perspFar = clampedFar;
        settings.perspPosX = perspCamera.position.x;
        settings.perspPosY = perspCamera.position.y;
        settings.perspPosZ = perspCamera.position.z;
        camera = perspCamera;
      } else if (glbCam) {
        camera = glbCam.camera;
      }
    }

    // Update selective pixel pass camera
    if (composer && composer.selectivePixelPass) {
      composer.selectivePixelPass.camera = camera;
    }
  }

  // ============================================
  // MOBILE MODE
  // ============================================

  const portraitOverlay = document.getElementById("portrait-overlay");

  // Show portrait overlay immediately on mobile if in portrait mode
  if (portraitOverlay && isMobileDevice() && window.innerHeight > window.innerWidth) {
    portraitOverlay.style.display = "flex";
  }

  function applyMobileMode(enabled) {
    if (enabled) {
      // 1. Snapshot desktop values, then apply mobile overrides
      saveDesktopSettings(settings);
      applyMobileOverrides(settings);

      // 2. Apply runtime effects that need API calls
      // Render scale
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
      if (composer) {
        composer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
        composer.setSize(window.innerWidth, window.innerHeight);
      }

      // Shadows (controlled via mobile override)
      renderer.shadowMap.enabled = settings.shadowsEnabled !== false;
      renderer.shadowMap.needsUpdate = true;

      // Post-processing (bloom, color grading)
      updatePostProcessing(composer, scene, settings);

      // Apply actor lights from override
      for (const f of fugitives) { if (f.light) f.light.visible = settings.punctualLights; }
      for (const c of chasers) { if (c.light) c.light.visible = settings.punctualLights; }

      // Apply helicopter from override
      { const heli = getHelicopter(); if (heli && heli.mesh) heli.mesh.visible = settings.helicopterEnabled; }

      // Chaser speed boost
      for (const c of chasers) c.speed = settings.chaserSpeed;

      // 3. Camera + building + portrait
      if (isFacadeMode) {
        // Facade: top-down orthographic for projection mapping
        settings.cameraType = "orthographic";
        switchCamera("orthographic");

        if (orthoCamera) {
          const aspect = window.innerWidth / window.innerHeight;
          const orthoSize = STATE.horizontalSize * 0.6 * settings.mobileOrthoZoom;
          orthoCamera.left = -orthoSize * aspect;
          orthoCamera.right = orthoSize * aspect;
          orthoCamera.top = orthoSize;
          orthoCamera.bottom = -orthoSize;
          orthoCamera.position.z = STATE.levelCenter.z + settings.mobileOrthoOffsetZ;
          orthoCamera.lookAt(new THREE.Vector3(STATE.levelCenter.x, STATE.levelCenter.y, STATE.levelCenter.z + settings.mobileOrthoOffsetZ));
          orthoCamera.updateProjectionMatrix();
        }
      }
      // Mobile/desktop without facade: keep perspective camera (GLB MainCamera)

      settings.buildingEnabled = false;
      if (buildingPlane) buildingPlane.visible = false;

      // Use device-specific intro image and scale for non-facade mode
      if (!isFacadeMode) {
        settings.preGameImage = isMobileDevice() ? "introMobile.png" : "introDesktop.png";
        settings.projectionScale = 0.32;
        loadProjectionImage("PRE_GAME", settings.preGameImage);
      }

      // Portrait check only on actual mobile/touch devices
      if (isMobileDevice()) {
        checkPortraitMode();
      }
    } else {
      // 1. Restore desktop settings
      restoreDesktopSettings(settings);

      // 2. Re-apply restored values to runtime objects
      // Render scale
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
      if (composer) {
        composer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
        composer.setSize(window.innerWidth, window.innerHeight);
      }

      // Shadows
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.needsUpdate = true;

      // Post-processing
      updatePostProcessing(composer, scene, settings);

      // Restore actor lights
      if (settings.punctualLights) {
        for (const f of fugitives) { if (f.light) f.light.visible = true; }
        for (const c of chasers) { if (c.light) c.light.visible = true; }
      }

      // Restore helicopter visibility (handled by update loop via helicopterEnabled)
      { const heli = getHelicopter(); if (heli && heli.mesh) heli.mesh.visible = settings.helicopterEnabled; }

      // Restore chaser speed
      for (const c of chasers) c.speed = settings.chaserSpeed;

      // Hide portrait overlay
      if (portraitOverlay) portraitOverlay.style.display = "none";
    }
  }

  function checkPortraitMode() {
    if (!portraitOverlay || !isMobileDevice()) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    portraitOverlay.style.display = isPortrait ? "flex" : "none";
  }

  // ============================================
  // RESIZE
  // ============================================

  function onResize() {
    const minDesktopWidth = 1400;
    const minDesktopHeight = 800;
    const mobile = isMobileDevice();
    const width = mobile ? window.innerWidth : Math.max(window.innerWidth, minDesktopWidth);
    const height = mobile ? window.innerHeight : Math.max(window.innerHeight, minDesktopHeight);
    renderer.setSize(width, height);
    // Center canvas when it exceeds viewport size
    const canvas = renderer.domElement;
    if (!mobile) {
      const offsetX = Math.min(0, (window.innerWidth - width) / 2);
      const offsetY = Math.min(0, (window.innerHeight - height) / 2);
      canvas.style.left = offsetX + "px";
      canvas.style.top = offsetY + "px";
    } else {
      canvas.style.left = "0px";
      canvas.style.top = "0px";
    }
    document.body.style.overflow = "hidden";

    if (perspCamera) {
      const aspect = width / height;
      perspCamera.aspect = aspect;
      // Adjust FOV on narrower viewports to prevent board clipping
      const referenceAspect = 16 / 9;
      if (aspect < referenceAspect) {
        const baseFovRad = THREE.MathUtils.degToRad(settings.perspFov);
        const adjustedFovRad = 2 * Math.atan(Math.tan(baseFovRad / 2) * referenceAspect / aspect);
        perspCamera.fov = THREE.MathUtils.radToDeg(adjustedFovRad) * 1.1;
      } else {
        perspCamera.fov = settings.perspFov;
      }
      perspCamera.updateProjectionMatrix();
    }

    if (orthoCamera) {
      const aspect = width / height;
      if (settings.mobileEnabled && isFacadeMode) {
        // Facade mode: use mobile ortho zoom
        const orthoSize = STATE.horizontalSize * 0.6 * settings.mobileOrthoZoom;
        orthoCamera.left = -orthoSize * aspect;
        orthoCamera.right = orthoSize * aspect;
        orthoCamera.top = orthoSize;
        orthoCamera.bottom = -orthoSize;
      } else {
        const frustumSize = STATE.horizontalSize * 1.5;
        if (aspect >= 1) {
          // Landscape: fixed vertical, expand horizontal
          orthoCamera.left = frustumSize * aspect / -2;
          orthoCamera.right = frustumSize * aspect / 2;
          orthoCamera.top = frustumSize / 2;
          orthoCamera.bottom = frustumSize / -2;
        } else {
          // Portrait/narrow: fixed horizontal, expand vertical
          orthoCamera.left = frustumSize / -2;
          orthoCamera.right = frustumSize / 2;
          orthoCamera.top = frustumSize / aspect / 2;
          orthoCamera.bottom = frustumSize / aspect / -2;
        }
      }
      orthoCamera.updateProjectionMatrix();
    }

    // Resize post-processing
    if (composer) {
      composer.setSize(width, height);
    }

    // Check portrait mode for mobile
    checkPortraitMode();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => {
    // Small delay to let orientation settle
    setTimeout(checkPortraitMode, 100);
  });

  // ============================================
  // GUI
  // ============================================

  function setupGUI() {
    // Single unified GUI
    guiLeft = new GUI({ title: "Jagad Controls" });
    guiLeft.domElement.style.position = "absolute";
    guiLeft.domElement.style.left = "10px";
    guiLeft.domElement.style.top = "0px";

    // Settings controls at the top
    guiLeft.add(settings, "exportSettings").name("💾 Export Settings");
    guiLeft.add(settings, "importSettings").name("📂 Import Settings");
    guiLeft.add({ clearCache: async function() {
      if (confirm("Clear all browser cache, storage, and reload?")) {
        try {
          // Clear Cache Storage
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
          }
          // Unregister service workers
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(reg => reg.unregister()));
          }
          // Force reload bypassing cache
          window.location.reload(true);
        } catch (e) {
          console.error("Failed to clear cache:", e);
          window.location.reload(true);
        }
      }
    }}, "clearCache").name("🔄 Clear Cache");
    // ==================== GAME ====================
    const gameFolder = guiLeft.addFolder("🎮 Game");
    gameFolder.add(settings, "fugitiveSpeed", 0.1, 4, 0.1).name("Fugitive Speed").onChange((v) => {
      for (const f of fugitives) f.speed = v;
    });
    gameFolder.add(settings, "chaserSpeed", 0.1, 4, 0.1).name("Chaser Speed").onChange((v) => {
      for (const c of chasers) c.speed = v;
    });
    gameFolder.add(settings, "fugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI");
    const difficultyFolder = gameFolder.addFolder("Multi-Player Difficulty");
    difficultyFolder.add(settings, "multiPlayerThreshold", 2, 4, 1).name("Player Threshold");
    difficultyFolder.add(settings, "multiPlayerFugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI Override");
    difficultyFolder.add(settings, "multiPlayerChaserSpeedPenalty", 0, 0.5, 0.05).name("Chaser Speed Penalty");
    difficultyFolder.close();
    addBoostGUI(gameFolder, settings);

    // ==================== MOBILE ====================
    const mobileFolder = guiLeft.addFolder("📱 Mobile");
    mobileFolder.add(settings, "mobileEnabled").name("Enable Mobile Mode").onChange((v) => {
      applyMobileMode(v);
    });
    mobileFolder.add(settings, "mobileOrthoZoom", 0.1, 1, 0.1).name("Ortho Zoom").onChange((v) => {
      if (settings.mobileEnabled && orthoCamera) {
        const aspect = window.innerWidth / window.innerHeight;
        const orthoSize = STATE.horizontalSize * 0.6 * v;
        orthoCamera.left = -orthoSize * aspect;
        orthoCamera.right = orthoSize * aspect;
        orthoCamera.top = orthoSize;
        orthoCamera.bottom = -orthoSize;
        orthoCamera.updateProjectionMatrix();
      }
    });
    mobileFolder.add(settings, "mobileOrthoOffsetZ", -10, 10, 0.1).name("View Z Offset").onChange((v) => {
      if (settings.mobileEnabled && orthoCamera) {
        orthoCamera.position.z = STATE.levelCenter.z + v;
        orthoCamera.lookAt(new THREE.Vector3(STATE.levelCenter.x, STATE.levelCenter.y, STATE.levelCenter.z + v));
      }
    });
    mobileFolder.add(settings, "mobileSvgOffset", 0, 200, 1).name("SVG Offset (px)");
    mobileFolder.add(settings, "mobileBoardScale", 0.5, 2, 0.05).name("Board Scale");

    // ---- Performance subfolder (per-feature mobile toggles) ----
    const perfFolder = mobileFolder.addFolder("Performance");

    perfFolder.add(settings, "renderScale", 0.5, 2, 0.25).name("Render Scale").listen().onChange((v) => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(dpr * v);
      if (composer) {
        composer.setPixelRatio(dpr * v);
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    perfFolder.add(settings, "bloomEnabled").name("Bloom").listen().onChange(() => {
      updatePostProcessing(composer, scene, settings);
    });

    perfFolder.add(settings, "punctualLights").name("Actor Lights").listen().onChange((v) => {
      for (const f of fugitives) { if (f.light) f.light.visible = v; }
      for (const c of chasers) { if (c.light) c.light.visible = v; }
    });

    perfFolder.add(settings, "colorGradingEnabled").name("Color Grading").listen().onChange(() => {
      updatePostProcessing(composer, scene, settings);
    });

    perfFolder.add(settings, "helicopterEnabled").name("Helicopter").listen().onChange((v) => {
      const heli = getHelicopter(); if (heli && heli.mesh) heli.mesh.visible = v;
    });

    perfFolder.add(settings, "pulseWaveParticles").name("Pulse Particles").listen();


    perfFolder.add(settings, "shadowsEnabled").name("Shadows").listen().onChange((v) => {
      renderer.shadowMap.enabled = v;
      renderer.shadowMap.needsUpdate = true;
    });

    perfFolder.add(settings, "carAudioReactive").name("Car BPM Pulse").listen();

    perfFolder.add(settings, "textBPMPulse").name("Text BPM Pulse").listen();

    perfFolder.add(settings, "chaserSpeed", 0.5, 3, 0.1).name("Chaser Speed").listen().onChange((v) => {
      for (const c of chasers) c.speed = v;
    });

    perfFolder.close();

    mobileFolder.close();

    // ==================== STATES (under Game) ====================
    const statesFolder = gameFolder.addFolder("States");

    // Current state display (read-only)
    const stateDisplay = { current: STATE.gameState };
    const stateController = statesFolder.add(stateDisplay, "current", ["PRE_GAME", "STARTING", "PLAYING", "GAME_OVER"]).name("Current State").listen();
    stateController.domElement.style.pointerEvents = "none"; // Make read-only
    statesFolder.add(settings, "countdownDuration", 1, 30, 1).name("Countdown (sec)");

    // Pre-game settings (text + image)
    const preGameFolder = statesFolder.addFolder("Pre-Game");
    const updatePreGameText = () => {
      if (STATE.gameState === "PRE_GAME") {
        settings.glassTextRow1 = settings.preGameTextRow1;
        settings.glassTextRow2 = settings.preGameTextRow2;
        settings.glassTextRow3 = settings.preGameTextRow3;
        settings.glassTextRow4 = settings.preGameTextRow4;
        updateGlassCanvas();
      }
    };
    preGameFolder.add(settings, "preGameTextRow1").name("Text Row 1").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow2").name("Text Row 2").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow3").name("Text Row 3").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow4").name("Text Row 4").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameImage").name("Image").onChange((v) => {
      loadProjectionImage("PRE_GAME", v);
    });
    preGameFolder.close();

    // Starting settings (text supports ${countdown})
    const startingFolder = statesFolder.addFolder("Starting");
    const updateStartingText = () => {
      if (STATE.gameState === "STARTING") {
        applyStartingText();
        updateGlassCanvas();
      }
    };
    startingFolder.add(settings, "startingTextRow1").name("Text Row 1").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow2").name("Text Row 2").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow3").name("Text Row 3").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow4").name("Text Row 4").onChange(updateStartingText);
    startingFolder.add(settings, "startingImage").name("Image").onChange((v) => {
      loadProjectionImage("STARTING", v);
    });
    startingFolder.close();

    // Playing settings (text + image)
    const playingFolder = statesFolder.addFolder("Playing");
    const updatePlayingText = () => {
      if (STATE.gameState === "PLAYING") {
        applyPlayingText();
        updateGlassCanvas();
      }
    };
    playingFolder.add(settings, "playingTextRow1").name("Text Row 1").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow2").name("Text Row 2").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow3").name("Text Row 3").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow4").name("Text Row 4").onChange(updatePlayingText);
    playingFolder.add(settings, "playingImage").name("Image").onChange((v) => {
      loadProjectionImage("PLAYING", v);
    });
    playingFolder.close();

    // High Score entry settings
    const highScoreFolder = statesFolder.addFolder("High Score");
    const updateHighScoreTextGUI = () => {
      if (STATE.gameState === "GAME_OVER" && STATE.enteringHighScore) {
        applyHighScoreText();
        updateGlassCanvas();
      }
    };
    highScoreFolder.add(settings, "highScoreTextRow1").name("Text Row 1").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow2").name("Text Row 2").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow3").name("Text Row 3").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow4").name("Text Row 4").onChange(updateHighScoreTextGUI);
    highScoreFolder.close();

    // Game Over settings (no high score)
    const gameOverFolder = statesFolder.addFolder("Game Over");
    const updateGameOverText = () => {
      if (STATE.gameState === "GAME_OVER" && !STATE.enteringHighScore) {
        applyGameOverText();
        updateGlassCanvas();
      }
    };
    gameOverFolder.add(settings, "gameOverTextRow1").name("Text Row 1").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow2").name("Text Row 2").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow3").name("Text Row 3").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow4").name("Text Row 4").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverImage").name("Image").onChange((v) => {
      loadProjectionImage("GAME_OVER", v);
    });
    gameOverFolder.close();

    // High scores display
    const highScoresFolder = statesFolder.addFolder("High Scores");
    const highScores = loadHighScores();
    const highScoreDisplay = {
      score1: `#1: ${highScores[0].initials} - ${highScores[0].score}`,
      score2: `#2: ${highScores[1].initials} - ${highScores[1].score}`,
      score3: `#3: ${highScores[2].initials} - ${highScores[2].score}`,
    };
    highScoresFolder.add(highScoreDisplay, "score1").name("").listen();
    highScoresFolder.add(highScoreDisplay, "score2").name("").listen();
    highScoresFolder.add(highScoreDisplay, "score3").name("").listen();
    highScoresFolder.add({ reset: function() {
      if (confirm("Reset high scores to defaults?")) {
        saveHighScores([
          { initials: "AAA", score: 999 },
          { initials: "BBB", score: 500 },
          { initials: "CCC", score: 100 }
        ]);
        const hs = loadHighScores();
        highScoreDisplay.score1 = `#1: ${hs[0].initials} - ${hs[0].score}`;
        highScoreDisplay.score2 = `#2: ${hs[1].initials} - ${hs[1].score}`;
        highScoreDisplay.score3 = `#3: ${hs[2].initials} - ${hs[2].score}`;
      }
    }}, "reset").name("Reset Scores");
    highScoresFolder.close();

    statesFolder.close();
    gameFolder.close();

    // Update state display - called when state/scores change (not on interval)
    STATE.updateStateDisplay = () => {
      stateDisplay.current = STATE.gameState;
      const hs = settings.highScores;
      highScoreDisplay.score1 = `#1: ${hs[0].initials} - ${hs[0].score}`;
      highScoreDisplay.score2 = `#2: ${hs[1].initials} - ${hs[1].score}`;
      highScoreDisplay.score3 = `#3: ${hs[2].initials} - ${hs[2].score}`;
    };
    STATE.updateStateDisplay(); // Initial update

    // ==================== PROJECTION ====================
    const projectionFolder = guiLeft.addFolder("🎥 Projection");
    projectionFolder.add(settings, "projectionOpacity", 0, 1, 0.05).name("Opacity").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionBlending", ["additive", "normal", "multiply", "subtract"]).name("Blending").onChange(() => {
      applyProjectionMaterial();
    });
    projectionFolder.add(settings, "projectionBrightness", 0, 3, 0.05).name("Brightness").onChange(() => {
      applyProjectionMaterial();
    });
    projectionFolder.addColor(settings, "projectionRedTarget").name("Red Target").onChange(() => {
      applyProjectionMaterial();
    });
    projectionFolder.add(settings, "projectionRedStrength", 0, 2, 0.05).name("Red Strength").onChange(() => {
      applyProjectionMaterial();
    });
    projectionFolder.addColor(settings, "projectionColor").name("Tint").onChange(() => {
      applyProjectionMaterial();
    });
    projectionFolder.add(settings, "projectionScale", 0.1, 5, 0.01).name("Scale").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetX", -10, 10, 0.1).name("Offset X").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetY", -1, 1, 0.01).name("Offset Y").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetZ", -10, 10, 0.1).name("Offset Z").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.close();

    // ==================== ACTORS ====================
    const actorsFolder = guiLeft.addFolder("👥 Actors");

    const fugitiveFolder = actorsFolder.addFolder("Fugitives");
    fugitiveFolder.addColor(settings, "fugitiveColor").name("Light Color").onChange(updateFugitiveLights);
    fugitiveFolder.add(settings, "fugitiveLightIntensity", 0, 50, 0.1).name("Light Intensity").onChange(updateFugitiveLights);
    fugitiveFolder.add(settings, "faceSwapDuration", 0, 120, 1).name("Face Swap (sec)");

    const billboardFolder = fugitiveFolder.addFolder("Face Billboards");
    billboardFolder.add(settings, "wireCubeSize", 0.2, 4, 0.1).name("Billboard Size").onChange(() => updateWireBillboards(fugitiveWires));
    billboardFolder.add(settings, "billboardBrightness", 0, 5, 0.1).name("Brightness").onChange((v) => {
      for (const wire of fugitiveWires) {
        if (wire.billboard && wire.billboard.material) {
          wire.billboard.material.color.setRGB(v, v, v);
        }
      }
    });
    billboardFolder.add(settings, "billboardContrast", 0.5, 3, 0.1).name("Contrast").onChange((v) => {
      for (const wire of fugitiveWires) {
        if (wire.billboard && wire.billboard.material && wire.billboard.material.userData) {
          wire.billboard.material.userData.contrast = v;
          wire.billboard.material.needsUpdate = true;
        }
      }
    });
    billboardFolder.add(settings, "billboardCenterPull", 0, 1, 0.05).name("Center Pull");
    billboardFolder.add(settings, "billboardLightIntensity", 0, 20, 0.5).name("Light Intensity");
    billboardFolder.add(settings, "billboardLightDistance", 0, 10, 0.5).name("Light Distance");
    billboardFolder.close();

    fugitiveFolder.close();

    const chaserFolder = actorsFolder.addFolder("Chasers");
    chaserFolder.addColor(settings, "chaser1Color").name("Chaser 1 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser2Color").name("Chaser 2 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser3Color").name("Chaser 3 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser4Color").name("Chaser 4 Color").onChange(updateChaserLights);
    chaserFolder.add(settings, "chaserHeightOffset", -0.5, 0.5, 0.01).name("Height Offset");
    chaserFolder.close();

    actorsFolder.close();

    // ==================== TEXT ====================
    const textFolder = guiLeft.addFolder("📝 Text");
    textFolder.addColor(settings, "glassColor").name("Glass Color").onChange(() => updateGlassColor());
    textFolder.add(settings, "glassEnabled").name("Glass Enabled").onChange((v) => {
      for (const mesh of getGlassMeshes()) mesh.visible = v;
    });
    textFolder.add(settings, "glassTextEnabled").name("Show Text").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassOpacity", 0, 1, 0.05).name("Background Opacity").onChange(() => updateGlassCanvas());
    if (settings.glassMaterialOpacity === undefined) settings.glassMaterialOpacity = 1.0;
    textFolder.add(settings, "glassMaterialOpacity", 0, 1, 0.05).name("Glass Opacity").onChange(() => updateGlassMaterialOpacity());
    textFolder.add(settings, "glassPosX", -10, 10, 0.01).name("Glass 3D X").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassPosY", -10, 10, 0.01).name("Glass 3D Y").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassPosZ", -10, 10, 0.01).name("Glass 3D Z").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassRotX", -90, 90, 1).name("Glass Rot X").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassTextFont", ["BankGothic", "BankGothic Md BT", "Bank Gothic", "Arial", "Impact", "Georgia"]).name("Font").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextFontSize", 20, 200, 5).name("Font Size").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextLineHeight", 1, 5, 0.1).name("Line Height").onChange(() => updateGlassCanvas());
    textFolder.addColor(settings, "glassTextColor").name("Color").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextBrightness", 1, 10, 0.5).name("Brightness").onChange(() => updateGlassBrightness());
    textFolder.add(settings, "glassTextAlign", ["left", "center", "right"]).name("Align").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextOffsetX", -500, 500, 0.1).name("Offset X").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextOffsetY", -500, 500, 0.1).name("Offset Y").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextLetterSpacing", -20, 50, 1).name("Letter Spacing").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextMonospace").name("Monospace").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextCharWidth", 20, 200, 1).name("Char Width").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextShuffle").name("Shuffle Effect");
    textFolder.add(settings, "glassTextShuffleSpeed", 0.1, 2, 0.1).name("Shuffle Speed");
    textFolder.add(settings, "glassTextShuffleChars").name("Shuffle Chars");
    textFolder.add(settings, "glassTextShuffleCharDelay", 0, 200, 5).name("Char Delay (ms)");
    textFolder.close();

    // ==================== ADDONS ====================
    const addonsFolder = guiLeft.addFolder("🧩 Addons");

    // Headlights (chaser spotlights)
    const headlightsFolder = addonsFolder.addFolder("Headlights");
    headlightsFolder.add(settings, "chaserLightIntensity", 0, 500, 1).name("Intensity").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightDistance", 1, 100, 1).name("Distance").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightAngle", 1, 90, 1).name("Angle (deg)").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightPenumbra", 0, 1, 0.05).name("Penumbra").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightHeight", -1, 1, 0.01).name("Height (Y)").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightOffset", -1, 1, 0.01).name("Offset (Z)").onChange(updateChaserLights);
    if (settings.chaserLightOffsetX === undefined) settings.chaserLightOffsetX = 0;
    headlightsFolder.add(settings, "chaserLightOffsetX", -1, 1, 0.01).name("Offset (X)").onChange(updateChaserLights);
    if (settings.chaserLightTargetX === undefined) settings.chaserLightTargetX = 0;
    if (settings.chaserLightTargetY === undefined) settings.chaserLightTargetY = 0;
    if (settings.chaserLightTargetZ === undefined) settings.chaserLightTargetZ = -5;
    headlightsFolder.add(settings, "chaserLightTargetX", -10, 10, 0.1).name("Aim X").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightTargetY", -10, 10, 0.1).name("Aim Y").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightTargetZ", -10, 10, 0.1).name("Aim Z").onChange(updateChaserLights);
    headlightsFolder.add({ debug: false }, "debug").name("Show Helpers").onChange((v) => {
      // Remove existing helpers
      for (const h of chaserLightHelpers) {
        scene.remove(h);
        h.dispose();
      }
      chaserLightHelpers = [];
      if (v) {
        for (const c of chasers) {
          if (c.light) {
            const helper = new THREE.SpotLightHelper(c.light);
            scene.add(helper);
            chaserLightHelpers.push(helper);
          }
        }
      }
    });
    headlightsFolder.close();

    // Glass Overlay (video background)
    const windowOverlayFolder = addonsFolder.addFolder("Glass Overlay");
    windowOverlayFolder.add(settings, "glassVideoEnabled").name("Enabled").onChange((v) => {
      const vid = getGlassVideo();
      if (vid) {
        if (v) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      }
      updateGlassCanvas();
    });
    windowOverlayFolder.add(settings, "glassVideoOpacity", 0, 1, 0.05).name("Opacity");
    windowOverlayFolder.add(settings, "glassVideoBrightness", 0, 2, 0.05).name("Brightness");
    windowOverlayFolder.close();

    // Helicopter
    const helicopterFolder = addonsFolder.addFolder("Helicopter");
    helicopterFolder.add(settings, "helicopterEnabled").name("Enabled");
    helicopterFolder.addColor(settings, "helicopterColor").name("Color").onChange(() => updateHelicopterColor(settings));
    helicopterFolder.add(settings, "helicopterBrightness", 0, 5, 0.1).name("Brightness").onChange(() => updateHelicopterColor(settings));
    helicopterFolder.add(settings, "helicopterHeight", 2, 20, 0.5).name("Fly Height");
    helicopterFolder.add(settings, "helicopterSpeed", 0.1, 2, 0.1).name("Drift Speed");
    helicopterFolder.add(settings, "helicopterRadius", 2, 15, 0.5).name("Drift Range");
    helicopterFolder.add(settings, "helicopterScale", 0.1, 2, 0.1).name("Scale").onChange(() => updateHelicopterScale(settings));
    helicopterFolder.add(settings, "helicopterLightIntensity", 0, 2000, 10).name("Spotlight Intensity");
    helicopterFolder.addColor(settings, "helicopterLightColor").name("Light Color");
    helicopterFolder.add(settings, "helicopterLightAngle", 1, 60, 1).name("Spotlight Angle");
    if (settings.helicopterLightDistance === undefined) settings.helicopterLightDistance = 50;
    helicopterFolder.add(settings, "helicopterLightDistance", 10, 200, 5).name("Spotlight Distance");
    if (settings.helicopterLightOffsetX === undefined) settings.helicopterLightOffsetX = 0;
    if (settings.helicopterLightOffsetY === undefined) settings.helicopterLightOffsetY = 0;
    if (settings.helicopterLightOffsetZ === undefined) settings.helicopterLightOffsetZ = 0;
    helicopterFolder.add(settings, "helicopterLightOffsetX", -5, 5, 0.1).name("Light X");
    helicopterFolder.add(settings, "helicopterLightOffsetY", -5, 5, 0.1).name("Light Y");
    helicopterFolder.add(settings, "helicopterLightOffsetZ", -5, 5, 0.1).name("Light Z");
    helicopterFolder.add({ debug: false }, "debug").name("Show Light Helper").onChange((v) => {
      const oldHelper = getHelicopterLightHelper();
      if (oldHelper) {
        scene.remove(oldHelper);
        oldHelper.dispose();
        setHelicopterLightHelper(null);
      }
      const heli = getHelicopter();
      if (v && heli && heli.light) {
        const newHelper = new THREE.SpotLightHelper(heli.light);
        scene.add(newHelper);
        setHelicopterLightHelper(newHelper);
      }
    });
    helicopterFolder.add(settings, "helicopterSearchlightSway", 0, 5, 0.1).name("Searchlight Sway");
    helicopterFolder.add(settings, "helicopterSearchlightSpeed", 0.1, 2, 0.1).name("Sway Speed");
    helicopterFolder.add(settings, "helicopterVolumetric").name("Show Light Cone");
    helicopterFolder.add(settings, "helicopterVolumetricOpacity", 0, 1, 0.01).name("Cone Opacity").onChange((v) => {
      const heli = getHelicopter();
      if (heli && heli.lightCone && heli.lightCone.userData.layers) {
        heli.lightCone.userData.layers.forEach((layer, i) => {
          layer.material.opacity = v * (1 - i * 0.15);
        });
      }
    });
    helicopterFolder.add(settings, "helicopterConeOffsetY", 0, 3, 0.1).name("Cone Y Offset").onChange(() => rebuildHelicopterCone(settings));
    helicopterFolder.add(settings, "helicopterConeHeight", 1, 40, 0.5).name("Cone Height").onChange(() => rebuildHelicopterCone(settings));
    helicopterFolder.add(settings, "helicopterConeTopRadius", 0, 2, 0.05).name("Cone Top Radius").onChange(() => rebuildHelicopterCone(settings));
    helicopterFolder.add(settings, "helicopterConeBottomRadius", 0.5, 10, 0.5).name("Cone Bottom Radius").onChange(() => rebuildHelicopterCone(settings));
    // Boundary limits
    const boundsFolder = helicopterFolder.addFolder("Bounds");
    boundsFolder.add(settings, "helicopterBoundsMinX", -15, 15, 0.1).name("Min X").onChange(() => updateHelicopterBoundsHelper(scene, settings));
    boundsFolder.add(settings, "helicopterBoundsMaxX", -15, 15, 0.1).name("Max X").onChange(() => updateHelicopterBoundsHelper(scene, settings));
    boundsFolder.add(settings, "helicopterBoundsMinZ", -15, 15, 0.1).name("Min Z").onChange(() => updateHelicopterBoundsHelper(scene, settings));
    boundsFolder.add(settings, "helicopterBoundsMaxZ", -15, 15, 0.1).name("Max Z").onChange(() => updateHelicopterBoundsHelper(scene, settings));
    boundsFolder.add(settings, "helicopterShowBounds").name("Show Bounds").onChange((v) => {
      if (!getHelicopterBoundsHelper()) updateHelicopterBoundsHelper(scene, settings);
      const bh = getHelicopterBoundsHelper();
      if (bh) bh.visible = v;
    });
    boundsFolder.close();
    helicopterFolder.close();

    // Searchlights
    const searchlightsFolder = addonsFolder.addFolder("Searchlights");
    searchlightsFolder.add(settings, "searchlightsEnabled").name("Enabled");
    searchlightsFolder.add(settings, "searchlightIntensity", 0, 1000, 1).name("Intensity");
    searchlightsFolder.addColor(settings, "searchlightColor").name("Color");
    searchlightsFolder.add(settings, "searchlightAngle", 5, 60, 1).name("Angle (deg)");
    searchlightsFolder.add(settings, "searchlightDistance", 5, 50, 1).name("Distance");
    searchlightsFolder.add(settings, "searchlightPenumbra", 0, 1, 0.05).name("Penumbra");
    searchlightsFolder.add(settings, "searchlightHeight", 3, 30, 0.5).name("Height");
    searchlightsFolder.add(settings, "searchlightSpeed", 0.05, 1, 0.05).name("Speed");
    searchlightsFolder.add(settings, "searchlightSway", 1, 15, 0.5).name("Sway Range");
    searchlightsFolder.add({ debug: false }, "debug").name("Show Helpers").onChange((v) => toggleSearchlightHelpers(v, scene));
    searchlightsFolder.close();

    // Pulse Wave (capture effect)
    const pulseWaveFolder = addonsFolder.addFolder("Pulse Wave");
    if (settings.pulseWaveEnabled === undefined) settings.pulseWaveEnabled = true;
    if (settings.pulseWaveSpeed === undefined) settings.pulseWaveSpeed = 3.5;
    if (settings.pulseWaveWidth === undefined) settings.pulseWaveWidth = 1.5;
    if (settings.pulseWaveDuration === undefined) settings.pulseWaveDuration = 5.0;
    if (settings.pulseWaveIntensity === undefined) settings.pulseWaveIntensity = 0.8;
    if (settings.pulseWaveTubeHeight === undefined) settings.pulseWaveTubeHeight = 0.12;
    if (settings.pulseWaveEasing === undefined) settings.pulseWaveEasing = "easeOut";
    if (settings.pulseWaveGlow === undefined) settings.pulseWaveGlow = 3.0;
    if (settings.pulseWaveParticles === undefined) settings.pulseWaveParticles = true;
    if (settings.pulseWaveFlash === undefined) settings.pulseWaveFlash = true;
    pulseWaveFolder.add(settings, "pulseWaveEnabled").name("Enabled");
    pulseWaveFolder.add(settings, "pulseWaveSpeed", 1, 20, 0.5).name("Speed");
    pulseWaveFolder.add(settings, "pulseWaveWidth", 0.5, 5, 0.1).name("Wave Width");
    pulseWaveFolder.add(settings, "pulseWaveDuration", 1, 10, 0.5).name("Duration");
    pulseWaveFolder.add(settings, "pulseWaveIntensity", 0.1, 2, 0.1).name("Intensity");
    pulseWaveFolder.add(settings, "pulseWaveTubeHeight", 0.05, 0.5, 0.01).name("Tube Height");
    pulseWaveFolder.add(settings, "pulseWaveGlow", 1, 10, 0.5).name("Glow");
    pulseWaveFolder.add(settings, "pulseWaveEasing", ["linear", "easeOut", "easeIn", "easeInOut"]).name("Easing");
    pulseWaveFolder.add(settings, "pulseWaveParticles").name("Particles");
    pulseWaveFolder.add(settings, "pulseWaveFlash").name("Flash");
    pulseWaveFolder.close();

    // Building Plane
    const buildingPlaneFolderGUI = addonsFolder.addFolder("Building Plane");
    buildingPlaneFolderGUI.add(settings, "buildingEnabled").name("Enabled").onChange((v) => {
      if (buildingPlane) buildingPlane.visible = v;
    });
    buildingPlaneFolderGUI.add(settings, "buildingOpacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
      if (buildingPlane && buildingPlane.material) {
        buildingPlane.material.opacity = v;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetX", -2, 2, 0.01).name("Offset X").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.x = STATE.levelCenter.x + settings.buildingOffsetX;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetY", -2, 2, 0.01).name("Offset Y").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.y = (STATE.streetY || 0) + settings.buildingOffsetY;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetZ", -2, 2, 0.01).name("Offset Z").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.z = STATE.levelCenter.z + settings.buildingOffsetZ;
      }
    });
    buildingPlaneFolderGUI.close();

    addonsFolder.close();

    // ==================== SCENE ====================
    const sceneFolder = guiLeft.addFolder("🌆 Scene");

    const cameraFolder = sceneFolder.addFolder("Camera");
    cameraFolder.add(settings, "cameraType", ["orthographic", "perspective"]).name("Type").onChange((v) => switchCamera(v));

    function updatePerspCameraPos() {
      if (perspCamera) {
        const panX = settings.perspPanX || 0;
        const panZ = settings.perspPanZ || 0;
        perspCamera.position.set(settings.perspPosX + panX, settings.perspPosY, settings.perspPosZ + panZ);
        perspCamera.lookAt(STATE.levelCenter.x + panX, STATE.levelCenter.y, STATE.levelCenter.z + panZ);
      }
    }
    cameraFolder.add(settings, "orthoZoom", 0.1, 3, 0.1).name("Ortho Zoom").onChange((v) => {
      if (orthoCamera) { orthoCamera.zoom = v; orthoCamera.updateProjectionMatrix(); }
    });
    cameraFolder.add(settings, "perspFov", 5, 120, 1).name("Persp FOV").onChange((v) => {
      if (perspCamera) { perspCamera.fov = v; perspCamera.updateProjectionMatrix(); }
    });
    cameraFolder.add(settings, "perspPosY", 0, 500, 0.1).name("Persp Height").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPosZ", -50, 50, 0.1).name("Persp Distance").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPanX", -5, 5, 0.01).name("Pan X").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPanZ", -5, 5, 0.01).name("Pan Y").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "renderScale", 0.5, 2, 0.25).name("Render Scale").onChange((v) => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * v);
      if (composer) {
        composer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * v);
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    });
    cameraFolder.close();

    const lightsFolder = sceneFolder.addFolder("Lighting");
    lightsFolder.add(settings, "toneMapping", Object.keys(toneMappingOptions)).name("Tone Mapping").onChange((v) => {
      renderer.toneMapping = toneMappingOptions[v];
    });
    lightsFolder.add(settings, "exposure", 0, 3, 0.01).name("Exposure").onChange((v) => {
      renderer.toneMappingExposure = v;
    });
    lightsFolder.add(settings, "ambientIntensity", 0, 10, 0.1).name("Ambient").onChange((v) => {
      ambientLight.intensity = v;
    });
    lightsFolder.add(settings, "directIntensity", 0, 50, 0.1).name("Directional").onChange((v) => {
      directionalLight.intensity = v;
    });
    lightsFolder.add(settings, "directPosX", -20, 20, 0.5).name("Dir Pos X").onChange((v) => {
      directionalLight.position.x = v;
    });
    lightsFolder.add(settings, "directPosY", 0, 30, 0.5).name("Dir Pos Y").onChange((v) => {
      directionalLight.position.y = v;
    });
    lightsFolder.add(settings, "directPosZ", -20, 20, 0.5).name("Dir Pos Z").onChange((v) => {
      directionalLight.position.z = v;
    });
    lightsFolder.add(settings, "environmentIntensity", 0, 50, 0.1).name("Environment").onChange((v) => {
      scene.environmentIntensity = v;
    });
    // Emissive controls subfolder
    const emissiveFolder = lightsFolder.addFolder("Emissive");
    if (settings.globalEmissiveMultiplier === undefined) settings.globalEmissiveMultiplier = 1.0;
    emissiveFolder.add(settings, "globalEmissiveMultiplier", 0, 5, 0.1).name("Global Multiplier").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    emissiveFolder.add(settings, "windowEmissiveIntensity", 0, 50, 0.5).name("Windows").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    emissiveFolder.add(settings, "lampEmissiveIntensity", 0, 50, 0.5).name("Lamps").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    emissiveFolder.add(settings, "roadEmissiveIntensity", 0, 50, 0.5).name("Roads").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    emissiveFolder.add(settings, "roadNormalMap").name("Road Normal Map").onChange((v) => {
      if (STATE.roadMeshes) {
        for (const mesh of STATE.roadMeshes) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (v) {
              if (mat._savedNormalMap) mat.normalMap = mat._savedNormalMap;
            } else {
              if (mat.normalMap) mat._savedNormalMap = mat.normalMap;
              mat.normalMap = null;
            }
            mat.needsUpdate = true;
          }
        }
      }
    });
    emissiveFolder.add(settings, "pathEmissiveIntensity", 0, 50, 0.5).name("Paths").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    emissiveFolder.add(settings, "otherEmissiveIntensity", 0, 50, 0.5).name("Other").onChange(() => {
      updateAllEmissives(settings, STATE);
    });
    // Audio reactive controls
    emissiveFolder.add(settings, "lampAudioReactive").name("Lamp Audio Reactive");
    emissiveFolder.add(settings, "lampAudioSensitivity", 0, 10, 0.5).name("Lamp Audio Sens.");
    emissiveFolder.add(settings, "carAudioReactive").name("Car BPM Pulse");
    emissiveFolder.add(settings, "carAudioBPM", 60, 180, 1).name("BPM");
    emissiveFolder.add(settings, "carAudioIntensity", 0, 10, 0.1).name("Car Pulse Intensity");
    emissiveFolder.add(settings, "textBPMPulse").name("Text BPM Pulse");
    emissiveFolder.add(settings, "textBPMIntensity", 0, 2, 0.1).name("Text Pulse Intensity");
    emissiveFolder.close();
    lightsFolder.add(settings, "punctualLights").name("Actor Lights").onChange((v) => {
      for (const f of fugitives) { if (f.light) f.light.visible = v; }
      for (const c of chasers) { if (c.light) c.light.visible = v; }
    });
    lightsFolder.close();

    sceneFolder.close();

    // ==================== VFX ====================
    const vfxFolder = guiLeft.addFolder("✨ VFX");

    // Environment
    const atmosphereFolder = vfxFolder.addFolder("Environment");
    atmosphereFolder.add(settings, "fogEnabled").name("Fog").onChange(() => updatePostProcessing(composer, scene, settings));
    atmosphereFolder.addColor(settings, "fogColor").name("Fog Color").onChange(() => updatePostProcessing(composer, scene, settings));
    atmosphereFolder.add(settings, "fogNear", 1, 50, 1).name("Fog Near").onChange(() => updatePostProcessing(composer, scene, settings));
    atmosphereFolder.add(settings, "fogFar", 10, 100, 1).name("Fog Far").onChange(() => updatePostProcessing(composer, scene, settings));
    atmosphereFolder.close();

    const bloomFolder = vfxFolder.addFolder("Bloom");
    bloomFolder.add(settings, "bloomEnabled").name("Enabled").onChange(() => updatePostProcessing(composer, scene, settings));
    bloomFolder.add(settings, "bloomStrength", 0, 3, 0.1).name("Strength").onChange(() => updatePostProcessing(composer, scene, settings));
    bloomFolder.add(settings, "bloomThreshold", 0, 1, 0.01).name("Threshold").onChange(() => updatePostProcessing(composer, scene, settings));
    bloomFolder.add(settings, "bloomRadius", 0, 2, 0.01).name("Radius").onChange(() => updatePostProcessing(composer, scene, settings));
    bloomFolder.close();

    const gradeFolder = vfxFolder.addFolder("Color Grading");
    gradeFolder.add(settings, "colorGradingEnabled").name("Enabled").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "vignetteEnabled").name("Vignette").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "vignetteIntensity", 0, 1, 0.05).name("Vignette Amount").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingSaturation", 0, 3, 0.05).name("Saturation").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingContrast", 0.5, 2, 0.05).name("Contrast").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingBrightness", 0, 3, 0.05).name("Brightness").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingGamma", 0.2, 3, 0.05).name("Gamma").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingGainR", 0, 2, 0.05).name("Red").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingGainG", 0, 2, 0.05).name("Green").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingGainB", 0, 2, 0.05).name("Blue").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingLiftR", -0.5, 0.5, 0.01).name("Lift R").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingLiftG", -0.5, 0.5, 0.01).name("Lift G").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.add(settings, "colorGradingLiftB", -0.5, 0.5, 0.01).name("Lift B").onChange(() => updatePostProcessing(composer, scene, settings));
    gradeFolder.close();

    const pixelFolder = vfxFolder.addFolder("Pixelation");
    pixelFolder.add(settings, "pixelationEnabled").name("Enabled").onChange(() => updatePostProcessing(composer, scene, settings));
    pixelFolder.add(settings, "pixelationSize", 1, 16, 1).name("Pixel Size").onChange(() => updatePostProcessing(composer, scene, settings));
    pixelFolder.add(settings, "pixelationNormalEdge", 0, 2, 0.05).name("Normal Edge").onChange(() => updatePostProcessing(composer, scene, settings));
    pixelFolder.add(settings, "pixelationDepthEdge", 0, 1, 0.05).name("Depth Edge").onChange(() => updatePostProcessing(composer, scene, settings));
    pixelFolder.close();

    vfxFolder.close();

    // ==================== AUDIO ====================
    const audioFolder = guiLeft.addFolder("🔊 Audio");
    const audioControls = {
      play: function() {
        const el = getAudioElement();
        if (el) {
          el.volume = settings.audioVolume;
          el.play().catch(() => {});
        }
      },
      stop: function() {
        stopAudio();
      }
    };
    audioFolder.add(audioControls, "play").name("▶ Play");
    audioFolder.add(audioControls, "stop").name("■ Stop");
    audioFolder.add(settings, "audioVolume", 0, 1, 0.05).name("Volume").onChange((v) => {
      const el = getAudioElement(); if (el) el.volume = v;
    });
    audioFolder.add(settings, "audioTrack", Object.keys(PATHS.audio)).name("Track").onChange((v) => {
      setAudioTrack(v);
    });

    // SFX display (read-only info)
    const sfxFolder = audioFolder.addFolder("Sound Effects");
    const sfxInfo = {
      capture: PATHS.sfx?.capture?.split('/').pop() || "N/A",
      helicopter: PATHS.sfx?.helicopter?.split('/').pop() || "N/A",
      countdown: PATHS.sfx?.countdown?.split('/').pop() || "N/A",
      playerSelect: PATHS.sfx?.playerSelect?.split('/').pop() || "N/A",
      gameStart: PATHS.sfx?.gameStart?.split('/').pop() || "N/A",
    };
    sfxFolder.add(sfxInfo, "capture").name("Capture").disable();
    sfxFolder.add(sfxInfo, "helicopter").name("Helicopter").disable();
    sfxFolder.add(sfxInfo, "countdown").name("Countdown").disable();
    sfxFolder.add(sfxInfo, "playerSelect").name("Player Select").disable();
    sfxFolder.add(sfxInfo, "gameStart").name("Game Start").disable();
    sfxFolder.close();

    audioFolder.close();

    // Store reference for GLB parts to add to later
    STATE.mainGUI = guiLeft;

    // Hide GUI by default (toggle with CMD/CTRL+G)
    guiLeft.domElement.style.display = "none";
  }

  // ============================================
  // GLB PARTS GUI
  // ============================================

  const glbParts = new Map();

  // Get default settings for a part based on name patterns
  function getGLBPartDefaults(name, meshDefaults) {
    const nameLower = name.toLowerCase();
    const defaults = settings.glbParts._defaults || {};
    const result = { ...meshDefaults };

    // Check each default pattern
    for (const [pattern, overrides] of Object.entries(defaults)) {
      if (nameLower.includes(pattern.toLowerCase())) {
        Object.assign(result, overrides);
      }
    }

    // Check for exact match override (e.g., "building-building")
    if (defaults[nameLower]) {
      Object.assign(result, defaults[nameLower]);
    }

    // Apply any saved per-part settings
    if (settings.glbParts[name]) {
      Object.assign(result, settings.glbParts[name]);
    }

    return result;
  }

  // Save GLB part setting to settings
  function saveGLBPartSetting(name, key, value) {
    if (!settings.glbParts[name]) {
      settings.glbParts[name] = {};
    }
    settings.glbParts[name][key] = value;
  }

  function setupGLBPartsGUI() {
    if (!STATE.levelContainer || !STATE.mainGUI) return;

    // Ensure glbParts object exists in settings
    if (!settings.glbParts) {
      settings.glbParts = { _defaults: {} };
    }

    STATE.levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.material) {
        if (glbParts.has(obj.name)) return;
        if (obj.name.match(/^(F\d|C\d|Fugitive|Chaser)/i)) return;

        const mat = obj.material;
        glbParts.set(obj.name, {
          mesh: obj,
          meshColor: mat.color ? "#" + mat.color.getHexString() : "#ffffff",
          meshOpacity: mat.opacity || 1,
          meshRoughness: mat.roughness,
          meshMetalness: mat.metalness
        });
      }
    });

    if (glbParts.size === 0) return;

    // Add GLB Parts folder to main GUI
    const glbPartsFolder = STATE.mainGUI.addFolder("GLB");

    // Display current GLB file name
    const glbFileName = PATHS.models.level.split('/').pop();
    glbPartsFolder.add({ file: glbFileName }, "file").name("Current").disable();

    // Create Nav subfolder for navigation-related parts
    const navFolder = glbPartsFolder.addFolder("Nav");

    // Helper to add part controls to a folder
    function addPartControls(parentFolder, data, name) {
      const mat = data.mesh.material;
      if (!mat) return;

      // Get defaults from settings (pattern-based + per-part overrides)
      const partDefaults = getGLBPartDefaults(name, {
        color: data.meshColor,
        opacity: data.meshOpacity,
        visible: true,
        roughness: data.meshRoughness,
        metalness: data.meshMetalness,
        wireframe: false
      });

      // Apply settings to material
      if (mat.color && partDefaults.color) {
        mat.color.set(partDefaults.color);
        if (mat.emissive) mat.emissive.set(partDefaults.color);
      }
      if (partDefaults.opacity !== undefined) {
        mat.transparent = partDefaults.opacity < 1;
        mat.opacity = partDefaults.opacity;
      }
      if (partDefaults.roughness !== undefined && mat.roughness !== undefined) {
        mat.roughness = partDefaults.roughness;
      }
      if (partDefaults.metalness !== undefined && mat.metalness !== undefined) {
        mat.metalness = partDefaults.metalness;
      }
      if (partDefaults.wireframe !== undefined && mat.wireframe !== undefined) {
        mat.wireframe = partDefaults.wireframe;
      }
      data.mesh.visible = partDefaults.visible !== false;
      mat.needsUpdate = true;

      // Create GUI controls
      const partSettings = {
        color: partDefaults.color || "#ffffff",
        opacity: partDefaults.opacity !== undefined ? partDefaults.opacity : 1,
        visible: partDefaults.visible !== false
      };

      const folder = parentFolder.addFolder(name);

      folder.addColor(partSettings, "color").name("Color").onChange((v) => {
        if (mat.color) {
          mat.color.set(v);
          if (mat.emissive) mat.emissive.set(v);
          mat.needsUpdate = true;
        }
        saveGLBPartSetting(name, "color", v);
      });

      folder.add(partSettings, "opacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
        mat.transparent = v < 1;
        mat.opacity = v;
        mat.needsUpdate = true;
        saveGLBPartSetting(name, "opacity", v);
      });

      folder.add(partSettings, "visible").name("Visible").onChange((v) => {
        data.mesh.visible = v;
        saveGLBPartSetting(name, "visible", v);
      });

      if (mat.roughness !== undefined) {
        const roughnessCtrl = { roughness: partDefaults.roughness !== undefined ? partDefaults.roughness : mat.roughness };
        folder.add(roughnessCtrl, "roughness", 0, 1, 0.01).name("Roughness").onChange((v) => {
          mat.roughness = v;
          saveGLBPartSetting(name, "roughness", v);
        });
      }

      if (mat.metalness !== undefined) {
        const metalnessCtrl = { metalness: partDefaults.metalness !== undefined ? partDefaults.metalness : mat.metalness };
        folder.add(metalnessCtrl, "metalness", 0, 1, 0.01).name("Metalness").onChange((v) => {
          mat.metalness = v;
          saveGLBPartSetting(name, "metalness", v);
        });
      }

      if (mat.wireframe !== undefined) {
        const wireframeCtrl = { wireframe: partDefaults.wireframe || false };
        folder.add(wireframeCtrl, "wireframe").name("Wireframe").onChange((v) => {
          mat.wireframe = v;
          saveGLBPartSetting(name, "wireframe", v);
        });
      }

      folder.close();
    }

    glbParts.forEach((data, name) => {
      const nameLower = name.toLowerCase();
      // Put Nav items in their own subfolder
      if (nameLower.startsWith("nav")) {
        addPartControls(navFolder, data, name);
      } else {
        addPartControls(glbPartsFolder, data, name);
      }
    });

    navFolder.close();
    glbPartsFolder.close();
  }

  // ============================================
  // ATMOSPHERE SYSTEMS
  // ============================================

  function initAtmosphere() {
    // Initialize fog
    if (settings.fogEnabled) {
      scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    }
  }

  function updateAtmosphere(dt) {
    // Update cyberpunk shader time
    if (composer && composer.cyberpunkPass) {
      composer.cyberpunkPass.uniforms['time'].value = performance.now() * 0.001;
    }
  }

  // ============================================
  // LIGHT UPDATES
  // ============================================

  function updateFugitiveLights() {
    const color = settings.fugitiveColor;
    for (const f of fugitives) {
      if (f.light) {
        f.light.color.set(color);
        f.light.intensity = settings.fugitiveLightIntensity;
      }
      if (f.mesh && f.mesh.material) {
        f.mesh.material.color.set(color);
        f.mesh.material.emissive.set(color);
        f.mesh.material.emissiveIntensity = 0.3;
      }
    }
    // Also update the billboard lights (the visible ones)
    for (const wire of fugitiveWires) {
      if (wire.billboardLight) {
        wire.billboardLight.color.set(color);
        wire.billboardLight.intensity = settings.fugitiveLightIntensity;
      }
      wire.color = color;
    }
  }

  function updateChaserLights() {
    const colors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    for (let i = 0; i < chasers.length; i++) {
      const c = chasers[i];
      const color = colors[i] || colors[0];
      if (c.light) {
        c.light.color.set(color);
        // Keep dimmed if not active
        c.light.intensity = c.active ? settings.chaserLightIntensity : settings.chaserLightIntensity * 0.1;
        c.light.distance = settings.chaserLightDistance;
        c.light.angle = (settings.chaserLightAngle * Math.PI) / 180; // Convert degrees to radians
        c.light.penumbra = settings.chaserLightPenumbra;
        c.light.shadow.camera.far = settings.chaserLightDistance || 50;
        // Account for mesh scale when setting light position
        const meshScale = c.mesh.scale.y || 1;
        c.light.position.x = (settings.chaserLightOffsetX || 0) / meshScale;
        c.light.position.y = settings.chaserLightHeight / meshScale;
        c.light.position.z = -settings.chaserLightOffset / meshScale; // Front offset (negative due to car flip)
        // Update light target direction
        if (c.lightTarget) {
          c.lightTarget.position.set(
            (settings.chaserLightTargetX || 0) / meshScale,
            (settings.chaserLightTargetY || 0) / meshScale,
            (settings.chaserLightTargetZ !== undefined ? settings.chaserLightTargetZ : -5) / meshScale
          );
        }
      }
      // Update materials (handle both box and car models)
      if (c.isCarModel) {
        c.mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.color.set(color);
            child.material.emissive.set(color);
            child.material.emissiveIntensity = c.active ? 0.3 : 0.05;
          }
        });
      } else if (c.mesh && c.mesh.material) {
        c.mesh.material.color.set(color);
        c.mesh.material.emissive.set(color);
        c.mesh.material.emissiveIntensity = c.active ? 0.3 : 0.05;
      }
    }
    // Update debug helpers
    for (const h of chaserLightHelpers) h.update();
  }


  const fugitiveWires = [];
  let lastFaceSwapTime = 0;

  // ============================================
  // GAME TIMER & RESET
  // ============================================

  function updateTimerDisplay() {
    if (STATE.showingScore) return;
    if (STATE.gameState !== "PLAYING") return;

    if (STATE.gameTimerStarted && !STATE.gameOver) {
      applyPlayingText();
      updateGlassCanvas();
    }
  }

  function showGameScore() {
    const allCaught = STATE.capturedCount >= fugitives.length;

    if (isFacadeMode) {
      // Facade mode: high score entry flow
      const highScorePosition = checkHighScore(STATE.playerScore);
      if (highScorePosition >= 0) {
        applyHighScoreText();
        updateGlassCanvas();
        setTimeout(() => {
          if (STATE.gameState === "GAME_OVER") {
            startHighScoreEntry(highScorePosition);
          }
        }, 1500);
      } else {
        applyGameOverText();
        updateGlassCanvas();
        setTimeout(() => updateGlassCanvas(), 500);
        postHighScore({ score: STATE.playerScore, playerName: "???", color: STATE.highScoreInitialsColor || null })
          .then(() => fetchServerHighScores());
        STATE.showingScore = true;
        STATE.scoreDisplayTime = 5;
      }
    } else {
      // Desktop/mobile: show result and score, no initials entry
      applyGameOverText();
      if (allCaught) settings.glassTextRow2 = " FÅNGADE!";
      updateGlassCanvas();
      setTimeout(() => updateGlassCanvas(), 500);
      postHighScore({ score: STATE.playerScore, playerName: "???", color: STATE.highScoreInitialsColor || null })
        .then(() => fetchServerHighScores());
      STATE.showingScore = true;
      STATE.scoreDisplayTime = 5;
    }
  }

  function resetGame() {
    // Reset state
    STATE.gameOver = false;
    STATE.gameTimerStarted = false;
    STATE.gameTimerRemaining = 90;
    STATE.showingScore = false;
    STATE.scoreDisplayTime = 0;
    STATE.capturedCount = 0;
    STATE.activeChaserCount = 0;
    STATE.playerScore = 0;
    STATE.fugitiveValue = 250;
    STATE.enteringHighScore = false;
    STATE.highScorePosition = 0;
    STATE.highScoreCharIndex = 0;
    STATE.highScoreInitials = ["A", "A", "A"];
    STATE.highScoreInitialsTouched = [false, false, false];
    STATE.highScoreInitialsColor = null;
    STATE.countdownValue = 3;
    STATE.countdownTimer = 0;
    settings.gameStarted = false;
    resetBoosts(boostStates, settings);

    // Clear any active capture effects
    clearCaptureEffects(scene);

    // Reset fugitives
    for (const f of fugitives) {
      f.captured = false;
      f.mesh.visible = false; // Keep cube hidden, only show wire and billboard
      if (f.light) {
        f.light.visible = true;
        f.light.intensity = settings.fugitiveLightIntensity;
      }

      // Reset to spawn position
      f.mesh.position.x = f.spawnX;
      f.mesh.position.z = f.spawnZ;
      STATE.projectYOnRoad(f.mesh.position);

      // Re-initialize on path
      initActorOnPath(f);

      // Re-show billboard and wire
      const wire = fugitiveWires[f.index];
      if (wire) {
        if (wire.billboard) wire.billboard.visible = true;
        // Intensity is managed per-frame based on billboard visibility; just ensure billboard is shown
        if (wire.billboardLight) wire.billboardLight.intensity = settings.fugitiveLightIntensity;
      }
    }

    // Reset chasers
    for (const c of chasers) {
      c.active = false;
      c.ready = false;
      c.isMoving = false;
      c.queuedDirX = 0;
      c.queuedDirZ = 0;
      c.currentEdge = null;

      // Turn off headlights
      if (c.light) {
        c.light.intensity = 0;
      }

      // Reset to spawn position and rotation
      c.mesh.position.x = c.spawnX;
      c.mesh.position.z = c.spawnZ;
      STATE.projectYOnRoad(c.mesh.position);
      c.mesh.position.y += settings.chaserHeightOffset;
      c.mesh.rotation.y = c.spawnRotationY || 0;

      // Re-initialize on path
      initActorOnPath(c);
    }

    // Set back to PRE_GAME state (this will also set chaser opacity to 0.1)
    setGameState("PRE_GAME");
  }


  // ============================================
  // GAME LOOP
  // ============================================

  function animate(timestamp) {
    requestAnimationFrame(animate);
    statsPanel.begin();
    const t = timestamp / 1000;
    const dt = STATE.lastTime ? Math.min(t - STATE.lastTime, 0.05) : 0;
    STATE.lastTime = t;

    // Handle projection pump during STARTING state
    if (STATE.loaded && STATE.gameState === "STARTING") {
      updateProjectionPump(dt);
    }

    // Fugitive light fade-in during PLAYING
    if (STATE.fugitiveLightFadeStart && STATE.gameState === "PLAYING") {
      const elapsed = (performance.now() - STATE.fugitiveLightFadeStart) / 1000;
      const fadeDuration = 3; // seconds
      const t = Math.min(elapsed / fadeDuration, 1);
      const target = settings.fugitiveLightIntensity;
      for (const f of fugitives) {
        if (f.light && f.light.visible) f.light.intensity = target * t;
      }
      if (t >= 1) STATE.fugitiveLightFadeStart = null;
    }

    // Handle gameplay during PLAYING state
    if (STATE.loaded && STATE.gameState === "PLAYING" && !STATE.gameOver) {
      // Update game timer
      if (STATE.gameTimerStarted && STATE.gameTimerRemaining > 0) {
        STATE.gameTimerRemaining -= dt;

        // Decrease fugitive value over time (250 points over ~100 seconds = 2.5/sec)
        STATE.fugitiveValue = Math.max(0, STATE.fugitiveValue - 2.5 * dt);

        updateTimerDisplay();

        // Time's up!
        if (STATE.gameTimerRemaining <= 0) {
          STATE.gameTimerRemaining = 0;
          setGameState("GAME_OVER");
        }
      }

      updateBoosts(boostStates, dt);
      updateGame(dt);
    }

    // Handle score display countdown and reset (only if not entering high score)
    if (STATE.showingScore && !STATE.enteringHighScore) {
      STATE.scoreDisplayTime -= dt;
      if (STATE.scoreDisplayTime <= 0) {
        resetGame();
      }
    }

    if (STATE.loaded) {
      for (let i = 0; i < fugitiveWires.length; i++) {
        const wire = fugitiveWires[i];
        // Skip wire updates for captured fugitives
        if (fugitives[i] && fugitives[i].captured) continue;
        wire.update(dt);
      }

      if (settings.faceSwapDuration > 0) {
        if (t - lastFaceSwapTime >= settings.faceSwapDuration) {
          lastFaceSwapTime = t;
          for (let i = 0; i < fugitiveWires.length; i++) {
            // Skip face swap for captured fugitives
            if (fugitives[i] && fugitives[i].captured) continue;
            fugitiveWires[i].swapTexture();
          }
        }
      }

      // Update helicopter, lamps, cars audio, text pulse, atmosphere and capture effects
      updateHelicopter(dt, settings, STATE);
      updateSearchlights(dt, settings, STATE);
      updateLamps(settings, STATE);
      updateCarsAudio(settings, chasers);
      updateTextBPMPulse(settings, getGlassMaterials());
      updateCaptureEffects(dt, scene);
      updateAtmosphere(dt);

      // Update glass canvas for video/marquee/shuffle animation/high score entry/game over
      if (settings.glassEnabled && getGlassCanvas() && (settings.glassTextMarquee || (settings.glassVideoEnabled && isGlassVideoReady()) || isShuffleActive() || STATE.enteringHighScore || STATE.gameOver)) {
        updateGlassCanvas(timestamp);
      }
    }

    // Update chaser light debug helpers
    for (const h of chaserLightHelpers) h.update();

    updateShake(camera, dt);

    // Render with post-processing (EffectComposer)
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }

    // Grab a still here (buffer is fresh) if P was pressed
    flushSnapshot(canvas);

    statsPanel.end();
  }

  function updateGame(dt) {
    if (!STATE.loaded) return;

    const activeChaserCount = STATE.activeChaserCount;
    const readyCount = chasers.filter(c => c.ready).length;
    let chaserSpeedBonus = 0;
    let fugitiveSpeedBonus = 0;
    let fugitiveIntelligenceOverride = null;

    if (activeChaserCount === 1) {
      chaserSpeedBonus = 0.1;
    } else if (activeChaserCount === 2) {
      chaserSpeedBonus = 0.05;
    } else if (activeChaserCount === 3) {
      fugitiveSpeedBonus = 0.1;
    } else if (activeChaserCount >= 4) {
      fugitiveSpeedBonus = 0.2;
    }

    // Multi-player difficulty scaling: when enough players, max out fugitive AI and slow chasers
    if (readyCount >= settings.multiPlayerThreshold) {
      fugitiveIntelligenceOverride = settings.multiPlayerFugitiveIntelligence;
      chaserSpeedBonus -= settings.multiPlayerChaserSpeedPenalty;
    }
    STATE.fugitiveIntelligenceOverride = fugitiveIntelligenceOverride;

    for (const f of fugitives) {
      if (f.captured) continue;
      f.speed = settings.fugitiveSpeed + fugitiveSpeedBonus;
      // Proximity speed boost when a chaser is within danger radius
      let nearestChaserDist = Infinity;
      for (const c of chasers) {
        if (!c.active) continue;
        const dx = f.mesh.position.x - c.mesh.position.x;
        const dz = f.mesh.position.z - c.mesh.position.z;
        nearestChaserDist = Math.min(nearestChaserDist, Math.sqrt(dx * dx + dz * dz));
      }
      if (nearestChaserDist < (settings.fugitiveDangerRadius || 4) && Math.random() < 0.3) {
        f.speed *= settings.fugitiveDangerSpeedMultiplier || 1.4;
      }
      if (f.currentEdge) {
        updateFugitiveMovementPath(f, dt);
      }
    }

    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];

      const inputDir = getChaserInputDirection(i);
      if (!chaser.active && inputDir.hasInput) {
        if (DEBUG) console.log(`Chaser ${i} activated by input:`, inputDir);
        chaser.active = true;
        STATE.activeChaserCount++;

        // Initialize on path when first activated
        if (!chaser.currentEdge) {
          initActorOnPath(chaser);
        }

        // Set full opacity when activated (material is already configured for transparency)
        if (chaser.light) chaser.light.visible = true;

        if (chaser.isCarModel && chaser.mesh) {
          chaser.mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.opacity = 1.0;
              child.material.depthWrite = true;
            }
          });
        } else if (chaser.material) {
          chaser.material.opacity = 1.0;
          chaser.material.depthWrite = true;
        }
        if (chaser.light) {
          chaser.light.intensity = settings.chaserLightIntensity;
        }
        // Set initial direction based on first input
        if (chaser.currentEdge) {
          const edge = chaser.currentEdge;
          const isHorizontal = Math.abs(edge.dirZ) < 0.1;
          const isVertical = Math.abs(edge.dirX) < 0.1;

          if (isVertical && inputDir.z !== 0) {
            // Vertical edge: match input Z direction
            // If input is up (z=-1) and edge goes down (dirZ=1), go backward (edgeDir=-1)
            chaser.edgeDir = (inputDir.z * edge.dirZ) > 0 ? 1 : -1;
          } else if (isHorizontal && inputDir.x !== 0) {
            // Horizontal edge: match input X direction
            chaser.edgeDir = (inputDir.x * edge.dirX) > 0 ? 1 : -1;
          }
        }
      }

      if (!chaser.active) continue;

      const boostMul = getBoostMultiplier(boostStates, i, settings);
      chaser.speed = (settings.chaserSpeed + chaserSpeedBonus) * boostMul;

      // Handle input for path-based movement
      if (inputDir.hasInput && chaser.currentEdge) {
        // Start moving when input is given
        chaser.isMoving = true;

        // Get current travel direction
        const edge = chaser.currentEdge;
        let travelDirX = (edge.x2 - edge.x1) * chaser.edgeDir;
        let travelDirZ = (edge.z2 - edge.z1) * chaser.edgeDir;
        const travelLen = Math.sqrt(travelDirX * travelDirX + travelDirZ * travelDirZ);
        if (travelLen > 0.001) {
          travelDirX /= travelLen;
          travelDirZ /= travelLen;
        }

        // Check if input is roughly opposite to travel direction (180 turn)
        const dotWithTravel = inputDir.x * travelDirX + inputDir.z * travelDirZ;
        if (dotWithTravel < -0.3) {
          // Reverse direction immediately
          chaser.edgeDir *= -1;
          chaser.queuedDirX = 0;
          chaser.queuedDirZ = 0;
        } else {
          // Queue the turn for next intersection
          chaser.queuedDirX = inputDir.x;
          chaser.queuedDirZ = inputDir.z;
        }
      }

      // Path-based movement - keep moving once started
      if (chaser.currentEdge && chaser.isMoving) {
        updateChaserMovementPath(chaser, dt, i);
      }

      for (const f of fugitives) {
        if (f.captured) continue;
        if (checkCollision(chaser.mesh, f.mesh, STATE.actorRadius || 2.5)) {
          // Mark as captured
          f.captured = true;
          STATE.capturedCount = (STATE.capturedCount || 0) + 1;
          playSFX("capture", i);

          // Add score based on current fugitive value
          const points = Math.max(0, Math.floor(STATE.fugitiveValue));
          STATE.playerScore += points;

          // Get chaser color for the effect
          const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
          const chaserColor = chaserColors[i] || "#ffffff";

          // Get billboard before hiding
          const wire = fugitiveWires[f.index];
          const billboard = wire ? wire.billboard : null;

          // Create capture effect at fugitive position
          createCaptureEffect(f.mesh.position.clone(), chaserColor, billboard, scene, settings, STATE);
          triggerShake(0.3, 0.2);

          // Hide fugitive
          f.mesh.position.y = -1000;
          if (f.light) f.light.intensity = 0;

          if (wire) {
            if (wire.billboard) wire.billboard.visible = false;
          }
          break; // One capture per chaser per frame
        }
      }
    }

    if (STATE.capturedCount >= fugitives.length && !STATE.gameOver) {
      setGameState("GAME_OVER");
    }
  }

  // ============================================
  // LOAD LEVEL
  // ============================================

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);

  // Register loading items: level, building texture, cars, helicopter
  const carPaths = PATHS.models.cars || [];
  loadingProgress.register(3 + carPaths.length);

  // Load level GLB - use ROADS mesh from within it for navmesh
  new Promise((resolve, reject) => {
    loader.load(PATHS.models.level, resolve, undefined, reject);
  }).then((levelGltf) => {
    loadingProgress.complete();
    const gltf = levelGltf;
    const root = gltf.scene;

    // Store window and lamp meshes for emissive control
    const windowMeshes = [];
    const lampMeshes = [];

    const roadMeshes = [];
    const pathMeshes = [];
    const otherEmissiveMeshes = [];

    root.traverse((obj) => {
      if (obj.isMesh) {
        const nameUpper = (obj.name || "").toUpperCase();
        // Glass meshes don't cast shadows so helicopter light shines through
        const isGlass = nameUpper.includes("GLASS");
        const isWindow = nameUpper.includes("WINDOW");
        const isLamp = nameUpper.includes("LAMP");
        const isRoad = nameUpper.includes("ROAD");
        const isPath = nameUpper.includes("PATH");
        const isLeaf = nameUpper.includes("LEAF") || nameUpper.includes("LEAVES");
        obj.castShadow = true;
        obj.receiveShadow = !isGlass;
        if (isLeaf && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            mat.side = THREE.DoubleSide;
            mat.transparent = true;
            mat.opacity = 0.95;
          }
        }

        const globalMult = settings.globalEmissiveMultiplier || 1.0;

        // Categorize emissive meshes
        if (isWindow && obj.material) {
          windowMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.windowEmissiveIntensity || 2.0) * globalMult;
          }
        } else if (isLamp && obj.material) {
          lampMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            // Resolve lamp color through full glbParts chain (defaults + per-part overrides)
            const resolved = getGLBPartDefaults(obj.name, { color: "#ffffaa" });
            mat.emissive.set(resolved.color);
            if (mat.color) mat.color.set(resolved.color);
            mat.emissiveIntensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
          }
        } else if (isRoad && obj.material) {
          roadMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.roadEmissiveIntensity || 1.0) * globalMult;
          }
          // Strip normal map at load if toggled off
          if (!settings.roadNormalMap && mat.normalMap) {
            mat._savedNormalMap = mat.normalMap;
            mat.normalMap = null;
            mat.needsUpdate = true;
          }
        } else if (isPath && obj.material) {
          pathMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.pathEmissiveIntensity || 1.0) * globalMult;
          }
        } else if (obj.material && obj.material.emissive && obj.material.emissiveIntensity > 0) {
          // Catch any other emissive meshes
          otherEmissiveMeshes.push(obj);
          obj.material.emissiveIntensity = (settings.otherEmissiveIntensity || 1.0) * globalMult;
        }
      }
      if (obj.isCamera) {
        glbCameras.push({ name: obj.name || `GLB Camera ${glbCameras.length + 1}`, camera: obj });
      }
    });

    // Also check gltf.cameras (GLTFLoader may not add cameras to the scene graph)
    if (gltf.cameras) {
      for (const cam of gltf.cameras) {
        if (!glbCameras.find(c => c.camera === cam)) {
          glbCameras.push({ name: cam.name || `GLB Camera ${glbCameras.length + 1}`, camera: cam });
        }
      }
    }

    STATE.windowMeshes = windowMeshes;
    STATE.lampMeshes = lampMeshes;
    STATE.roadMeshes = roadMeshes;
    STATE.pathMeshes = pathMeshes;
    STATE.otherEmissiveMeshes = otherEmissiveMeshes;

    if (DEBUG) console.log("Emissive meshes found - Windows:", windowMeshes.length, "Lamps:", lampMeshes.length, "Roads:", roadMeshes.length, "Paths:", pathMeshes.length, "Other:", otherEmissiveMeshes.length);

    const levelContainer = new THREE.Group();
    levelContainer.add(root);
    scene.add(levelContainer);
    STATE.levelContainer = levelContainer;

    // Assign GLB layer for selective pixelation and apply anisotropic filtering to textures
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    levelContainer.traverse(child => {
      if (child.isMesh) {
        child.layers.set(LAYERS.GLB_MODELS);
        // Apply anisotropic filtering to all textures for sharper roads/ground at angles
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (mat.map) mat.map.anisotropy = maxAnisotropy;
            if (mat.normalMap) mat.normalMap.anisotropy = maxAnisotropy;
            if (mat.roughnessMap) mat.roughnessMap.anisotropy = maxAnisotropy;
            if (mat.metalnessMap) mat.metalnessMap.anisotropy = maxAnisotropy;
          }
        }
      }
    });

    levelContainer.updateMatrixWorld(true);

    const fugitiveSpawns = [];
    const chaserSpawns = [];
    let baseActorSize = null;

    for (let i = 1; i <= 4; i++) {
      const marker = levelContainer.getObjectByName(`F${i}`);
      if (marker) {
        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);
        fugitiveSpawns.push(worldPos);

        // Get actor size from F1 marker (matches road width)
        if (i === 1 && !baseActorSize) {
          marker.traverse((child) => {
            if (child.isMesh && child.geometry) {
              child.geometry.computeBoundingBox();
              const geoBox = child.geometry.boundingBox;
              const geoSize = new THREE.Vector3();
              geoBox.getSize(geoSize);
              const childWorldScale = new THREE.Vector3();
              child.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), childWorldScale);
              const worldSize = geoSize.clone().multiply(childWorldScale);
              baseActorSize = Math.min(worldSize.x, worldSize.z);
            }
          });
        }

        marker.parent.remove(marker);
      }
    }

    for (let i = 1; i <= 4; i++) {
      const marker = levelContainer.getObjectByName(`C${i}`);
      if (marker) {
        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);
        chaserSpawns.push(worldPos);
        marker.visible = false;
        if (DEBUG) console.log(`Found chaser spawn C${i}:`, worldPos);
      } else {
        console.warn(`Missing chaser spawn marker C${i} in GLB!`);
      }
    }
    // Find ROADS mesh within level GLB (same scale as markers)
    let roadsMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.name.toUpperCase().includes("ROAD")) {
        roadsMeshes.push(obj);
      }
    });

    // Find all GLASS meshes for HTML overlay
    let foundGlassMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name) {
        if (obj.name.toUpperCase().includes("GLASS")) {
          foundGlassMeshes.push(obj);
        }
      }
    });


    if (foundGlassMeshes.length > 0) {
      setupGlassMeshes(foundGlassMeshes, settings, STATE, renderer);
      setBeforeRenderCallback(() => applyHighScoreText());
    }

    // Find Nav nodes for path grid (objects with names starting with "Nav")
    let navNodes = [];
    levelContainer.traverse((obj) => {
      if (obj.name && obj.name.toLowerCase().startsWith("nav")) {
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        navNodes.push({ name: obj.name, x: worldPos.x, z: worldPos.z });
        obj.visible = false;
      }
    });
    if (navNodes.length > 0) {
      if (DEBUG) console.log(`Found ${navNodes.length} Nav nodes for path grid`);
    } else {
      if (DEBUG) console.log("No Nav nodes found - add objects with names starting with 'Nav' in Blender");
    }

    if (roadsMeshes.length === 0) {
      statusEl.textContent = "No ROADS mesh found in level GLB!";
    }

    const roadsBbox = roadsMeshes.length > 0
      ? new THREE.Box3().setFromObject(roadsMeshes[0])
      : new THREE.Box3().setFromObject(root);

    const spawnBbox = new THREE.Box3();
    for (const sp of fugitiveSpawns) spawnBbox.expandByPoint(sp);
    for (const sp of chaserSpawns) spawnBbox.expandByPoint(sp);

    const bbox = roadsBbox.clone();
    if (!spawnBbox.isEmpty()) {
      bbox.union(spawnBbox);
    }

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const horizontalSize = Math.max(size.x, size.z);
    const levelCenter = new THREE.Vector3();
    bbox.getCenter(levelCenter);

    STATE.levelCenter.copy(levelCenter);
    STATE.horizontalSize = horizontalSize;
    STATE.levelSizeX = size.x;
    STATE.levelSizeZ = size.z;

    const streetY = roadsBbox.min.y;

    const navTriangles = [];
    for (const roadMesh of roadsMeshes) {
      const geometry = roadMesh.geometry;
      if (!geometry || !geometry.attributes || !geometry.attributes.position) continue;

      const posAttr = geometry.attributes.position;
      const index = geometry.index;
      roadMesh.updateMatrixWorld(true);
      const worldMatrix = roadMesh.matrixWorld;

      const triangleCount = index ? index.count / 3 : posAttr.count / 3;

      for (let t = 0; t < triangleCount; t++) {
        let i0, i1, i2;
        if (index) {
          i0 = index.getX(t * 3);
          i1 = index.getX(t * 3 + 1);
          i2 = index.getX(t * 3 + 2);
        } else {
          i0 = t * 3;
          i1 = t * 3 + 1;
          i2 = t * 3 + 2;
        }

        const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(worldMatrix);
        const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(worldMatrix);
        const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(worldMatrix);

        const minX = Math.min(v0.x, v1.x, v2.x);
        const maxX = Math.max(v0.x, v1.x, v2.x);
        const minZ = Math.min(v0.z, v1.z, v2.z);
        const maxZ = Math.max(v0.z, v1.z, v2.z);

        navTriangles.push({
          ax: v0.x, az: v0.z,
          bx: v1.x, bz: v1.z,
          cx: v2.x, cz: v2.z,
          minX, maxX, minZ, maxZ
        });
      }
    }

    function pointInTriangleAny(px, pz) {
      for (const tri of navTriangles) {
        if (px < tri.minX || px > tri.maxX || pz < tri.minZ || pz > tri.maxZ) continue;
        if (pointInTriangle(px, pz, tri.ax, tri.az, tri.bx, tri.bz, tri.cx, tri.cz)) return true;
      }
      return false;
    }

    function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
      const v0x = cx - ax;
      const v0z = cz - az;
      const v1x = bx - ax;
      const v1z = bz - az;
      const v2x = px - ax;
      const v2z = pz - az;

      const dot00 = v0x * v0x + v0z * v0z;
      const dot01 = v0x * v1x + v0z * v1z;
      const dot02 = v0x * v2x + v0z * v2z;
      const dot11 = v1x * v1x + v1z * v1z;
      const dot12 = v1x * v2x + v1z * v2z;

      const denom = dot00 * dot11 - dot01 * dot01;
      if (Math.abs(denom) < 0.0001) return false;

      const invDenom = 1 / denom;
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

      return (u >= 0) && (v >= 0) && (u + v <= 1);
    }

    function isOnRoad(x, z) {
      for (const tri of navTriangles) {
        if (x < tri.minX || x > tri.maxX || z < tri.minZ || z > tri.maxZ) {
          continue;
        }
        if (pointInTriangle(x, z, tri.ax, tri.az, tri.bx, tri.bz, tri.cx, tri.cz)) {
          return true;
        }
      }
      return false;
    }

    // ==================== PATH GRAPH GENERATION ====================
    // Generate a graph of nodes (intersections) and edges (path segments)
    // for Pac-Man style movement


    // Find nearest point on the path graph
    function findNearestEdgePoint(x, z, pathGraph) {
      let nearestEdge = null;
      let nearestDist = Infinity;
      let nearestPoint = { x, z };
      let nearestT = 0;

      for (const edge of pathGraph.edges) {
        // Project point onto edge line segment
        const dx = edge.x2 - edge.x1;
        const dz = edge.z2 - edge.z1;
        const len2 = dx * dx + dz * dz;

        if (len2 < 0.0001) continue;

        let t = ((x - edge.x1) * dx + (z - edge.z1) * dz) / len2;
        t = Math.max(0, Math.min(1, t));

        const projX = edge.x1 + t * dx;
        const projZ = edge.z1 + t * dz;

        const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEdge = edge;
          nearestPoint = { x: projX, z: projZ };
          nearestT = t;
        }
      }

      return { edge: nearestEdge, point: nearestPoint, t: nearestT, distance: nearestDist };
    }

    // Get available directions at a node
    function getNodeDirections(node, pathGraph) {
      const directions = [];
      for (const edgeId of node.edges) {
        const edge = pathGraph.edges[edgeId];
        let dirX, dirZ;
        if (edge.node1 === node.id) {
          dirX = Math.sign(edge.x2 - edge.x1) || edge.dirX;
          dirZ = Math.sign(edge.z2 - edge.z1) || edge.dirZ;
        } else {
          dirX = Math.sign(edge.x1 - edge.x2) || -edge.dirX;
          dirZ = Math.sign(edge.z1 - edge.z2) || -edge.dirZ;
        }
        directions.push({ edgeId, dirX, dirZ });
      }
      return directions;
    }

    // Use F1 marker size (matches road width) for Pac-Man style movement
    let actorSize = baseActorSize || 1;
    if (!baseActorSize) {
      const baseUnit = horizontalSize || 100;
      actorSize = baseUnit / 150;
    }
    actorSize *= settings.actorScale;

    // Path graph will be loaded/generated after setup
    let pathGraph = { nodes: [], edges: [], gridStep: actorSize };

    // Build path graph from spawn points - creates a simple Pac-Man grid
    function buildPathGraphFromSpawns() {
      const nodes = [];
      const edges = [];
      const nodeMap = new Map();

      // Get all spawn positions to determine the grid bounds
      const allSpawns = [...fugitiveSpawns, ...chaserSpawns];
      if (allSpawns.length === 0) return null;

      // Find grid bounds from spawns
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const sp of allSpawns) {
        minX = Math.min(minX, sp.x);
        maxX = Math.max(maxX, sp.x);
        minZ = Math.min(minZ, sp.z);
        maxZ = Math.max(maxZ, sp.z);
      }

      // Use spawn positions to create nodes
      const gridStep = actorSize * 1.2; // Spacing between grid lines

      function getOrCreateNode(x, z) {
        // Snap to grid
        const sx = Math.round(x / gridStep) * gridStep;
        const sz = Math.round(z / gridStep) * gridStep;
        const key = `${sx.toFixed(2)},${sz.toFixed(2)}`;

        if (nodeMap.has(key)) return nodeMap.get(key);

        const idx = nodes.length;
        nodes.push({ id: idx, x: sx, z: sz, edges: [] });
        nodeMap.set(key, idx);
        return idx;
      }

      function addEdge(n1Idx, n2Idx) {
        if (n1Idx === n2Idx) return;

        // Check if edge exists
        for (const eid of nodes[n1Idx].edges) {
          const e = edges[eid];
          if ((e.node1 === n1Idx && e.node2 === n2Idx) ||
              (e.node1 === n2Idx && e.node2 === n1Idx)) return;
        }

        const n1 = nodes[n1Idx];
        const n2 = nodes[n2Idx];
        const dx = n2.x - n1.x;
        const dz = n2.z - n1.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        const edge = {
          id: edges.length,
          node1: n1Idx,
          node2: n2Idx,
          x1: n1.x, z1: n1.z,
          x2: n2.x, z2: n2.z,
          length,
          dirX: Math.sign(dx),
          dirZ: Math.sign(dz)
        };
        edges.push(edge);
        n1.edges.push(edge.id);
        n2.edges.push(edge.id);
      }

      // Create nodes at each spawn point
      for (const sp of allSpawns) {
        getOrCreateNode(sp.x, sp.z);
      }

      // Connect nodes that are aligned horizontally or vertically
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = Math.abs(n2.x - n1.x);
          const dz = Math.abs(n2.z - n1.z);

          // Only connect if aligned (H or V) and reasonably close
          const isHorizontal = dz < gridStep * 0.5;
          const isVertical = dx < gridStep * 0.5;

          if ((isHorizontal || isVertical) && (dx + dz) < gridStep * 8) {
            addEdge(i, j);
          }
        }
      }

      if (DEBUG) console.log(`Spawn-based path: ${nodes.length} nodes, ${edges.length} edges`);
      return { nodes, edges, gridStep, source: 'spawns' };
    }

    // Build grid from Nav nodes placed in Blender
    function buildGridFromNavNodes() {
      if (!navNodes || navNodes.length < 2) {
        return null;
      }

      const nodes = navNodes.map((n, idx) => ({
        id: idx,
        x: n.x,
        z: n.z,
        edges: []
      }));

      const edges = [];
      const maxEdgeDist = actorSize * 15; // Max distance for an edge
      const checkStep = actorSize * 0.5; // Step size for obstacle checking

      // Check if path between two points is clear (no obstacles)
      function isPathClear(x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.ceil(dist / checkStep);

        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const testX = x1 + dx * t;
          const testZ = z1 + dz * t;
          if (!isOnRoad(testX, testZ)) {
            return false;
          }
        }
        return true;
      }

      function addEdge(n1, n2) {
        if (n1 === n2) return;
        // Check duplicate
        for (const eid of nodes[n1].edges) {
          const e = edges[eid];
          if ((e.node1 === n1 && e.node2 === n2) || (e.node1 === n2 && e.node2 === n1)) return;
        }

        const node1 = nodes[n1];
        const node2 = nodes[n2];
        const dx = node2.x - node1.x;
        const dz = node2.z - node1.z;

        // Only cardinal directions (H or V, not diagonal)
        const isHorizontal = Math.abs(dz) < actorSize * 0.5;
        const isVertical = Math.abs(dx) < actorSize * 0.5;
        if (!isHorizontal && !isVertical) return;

        const length = Math.sqrt(dx * dx + dz * dz);
        const eid = edges.length;
        edges.push({
          id: eid,
          node1: n1,
          node2: n2,
          x1: node1.x,
          z1: node1.z,
          x2: node2.x,
          z2: node2.z,
          length: length,
          dirX: isHorizontal ? Math.sign(dx) : 0,
          dirZ: isVertical ? Math.sign(dz) : 0
        });
        nodes[n1].edges.push(eid);
        nodes[n2].edges.push(eid);
      }

      // Connect each node to its nearest aligned neighbors
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        let nearestRight = null, nearestRightDist = Infinity;
        let nearestLeft = null, nearestLeftDist = Infinity;
        let nearestDown = null, nearestDownDist = Infinity;
        let nearestUp = null, nearestUpDist = Infinity;

        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const other = nodes[j];
          const dx = other.x - node.x;
          const dz = other.z - node.z;

          // Horizontal alignment
          if (Math.abs(dz) < actorSize * 0.5 && Math.abs(dx) < maxEdgeDist) {
            // Check if path is clear before considering this neighbor
            if (isPathClear(node.x, node.z, other.x, other.z)) {
              if (dx > 0 && dx < nearestRightDist) {
                nearestRight = j;
                nearestRightDist = dx;
              } else if (dx < 0 && -dx < nearestLeftDist) {
                nearestLeft = j;
                nearestLeftDist = -dx;
              }
            }
          }

          // Vertical alignment
          if (Math.abs(dx) < actorSize * 0.5 && Math.abs(dz) < maxEdgeDist) {
            // Check if path is clear before considering this neighbor
            if (isPathClear(node.x, node.z, other.x, other.z)) {
              if (dz > 0 && dz < nearestDownDist) {
                nearestDown = j;
                nearestDownDist = dz;
              } else if (dz < 0 && -dz < nearestUpDist) {
                nearestUp = j;
                nearestUpDist = -dz;
              }
            }
          }
        }

        if (nearestRight !== null) addEdge(i, nearestRight);
        if (nearestLeft !== null) addEdge(i, nearestLeft);
        if (nearestDown !== null) addEdge(i, nearestDown);
        if (nearestUp !== null) addEdge(i, nearestUp);
      }

      if (DEBUG) console.log(`Nav grid: ${nodes.length} nodes, ${edges.length} edges`);
      return { nodes, edges, gridStep: actorSize, source: 'nav' };
    }

    // Function to load path graph
    function loadPathGraph() {
      // Use Nav nodes from Blender
      const navGraph = buildGridFromNavNodes();
      if (navGraph && navGraph.edges.length >= 1) {
        return navGraph;
      }

      console.warn("No Nav nodes found in model - add Nav parent with child objects in Blender");
      return { nodes: [], edges: [], gridStep: actorSize, source: 'empty' };
    }

    // Function to rebuild path graph and update visualization
    function rebuildPathGraph() {
      pathGraph = loadPathGraph();
      STATE.pathGraph = pathGraph;

      // Update debug visualization
      const oldDebug = scene.getObjectByName("PathGraphDebug");
      if (oldDebug) {
        oldDebug.parent.remove(oldDebug);
      }

      const pathGraphDebug = new THREE.Group();
      pathGraphDebug.name = "PathGraphDebug";

      // Different colors for different sources
      // GLB: green, SVG: cyan, Generated: yellow
      const source = pathGraph.source || 'generated';
      let edgeColor, nodeColor;
      if (source === 'glb') {
        edgeColor = 0x00ff00; // Green for GLB
        nodeColor = 0x00ff88;
      } else if (source === 'svg') {
        edgeColor = 0x00ffff; // Cyan for SVG
        nodeColor = 0xff00ff;
      } else {
        edgeColor = 0xffff00; // Yellow for generated
        nodeColor = 0xff0000;
      }

      // Create tube geometry for edges (more visible than lines)
      const edgeMat = new THREE.MeshBasicMaterial({ color: edgeColor });
      const tubeRadius = actorSize * 0.08;

      for (const edge of pathGraph.edges) {
        const start = new THREE.Vector3(edge.x1, STATE.streetY + 0.3, edge.z1);
        const end = new THREE.Vector3(edge.x2, STATE.streetY + 0.3, edge.z2);
        const dir = new THREE.Vector3().subVectors(end, start);
        const length = dir.length();

        if (length > 0.01) {
          const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, length, 6);
          const tube = new THREE.Mesh(tubeGeo, edgeMat);

          // Position at midpoint
          tube.position.copy(start).add(end).multiplyScalar(0.5);

          // Rotate to align with edge direction
          tube.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.normalize()
          );

          pathGraphDebug.add(tube);
        }
      }

      // Bigger spheres for nodes
      const nodeMat = new THREE.MeshBasicMaterial({ color: nodeColor });
      const nodeGeo = new THREE.SphereGeometry(actorSize * 0.3, 12, 12);
      for (const node of pathGraph.nodes) {
        const sphere = new THREE.Mesh(nodeGeo, nodeMat);
        sphere.position.set(node.x, STATE.streetY + 0.3, node.z);
        pathGraphDebug.add(sphere);
      }

      if (DEBUG) console.log(`Path visualization: ${source.toUpperCase()} - ${pathGraph.edges.length} edges, ${pathGraph.nodes.length} nodes`);

      scene.add(pathGraphDebug);
      pathGraphDebug.visible = settings.showNavmesh;

      // Re-initialize actors on new path graph
      for (const f of fugitives) {
        initActorOnPath(f);
      }
      // Only re-initialize active chasers
      for (const c of chasers) {
        if (c.active) {
          initActorOnPath(c);
        }
      }

      if (DEBUG) console.log(`Path graph updated: ${pathGraph.nodes.length} nodes, ${pathGraph.edges.length} edges`);
    }

    // Store rebuild function in STATE for GUI access
    STATE.rebuildPathGraph = rebuildPathGraph;

    function findNearestRoadPoint(x, z) {
      if (isOnRoad(x, z)) {
        return { x, z };
      }

      for (let radius = 0.2; radius < 150; radius += 0.3) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
          const testX = x + Math.cos(angle) * radius;
          const testZ = z + Math.sin(angle) * radius;
          if (isOnRoad(testX, testZ)) {
            return { x: testX, z: testZ };
          }
        }
      }

      console.warn(`Could not find road point near (${x.toFixed(2)}, ${z.toFixed(2)})`);
      return { x, z };
    }

    function projectYOnRoad(pos) {
      pos.y = streetY + actorSize * 0.5;
    }

    setupCameras(levelCenter, horizontalSize);

    // If GLB contains cameras, add them to the GUI dropdown and use MainCamera if found
    if (glbCameras.length > 0) {
      const cameraOptions = ["orthographic", "perspective", ...glbCameras.map(c => c.name)];
      // Update GUI dropdown if it exists
      if (guiLeft) {
        const ctrl = guiLeft.controllersRecursive().find(c => c.property === "cameraType");
        if (ctrl) {
          ctrl._values = cameraOptions;
          ctrl.options(cameraOptions);
        }
      }
      // Default to MainCamera if available
      const mainCam = glbCameras.find(c => c.name.toUpperCase() === "MAINCAMERA");
      if (mainCam) {
        switchCamera(mainCam.name);
      }
    }

    onResize();

    STATE.streetY = streetY;

    const sizeX = horizontalSize * settings.buildingScaleX;
    const sizeY = horizontalSize * settings.buildingScaleY;
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY);

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x333366,
      transparent: true,
      opacity: settings.buildingOpacity,
      side: THREE.DoubleSide
    });
    buildingPlane = new THREE.Mesh(planeGeo, planeMat);
    buildingPlane.rotation.x = -Math.PI / 2;
    buildingPlane.position.set(
      levelCenter.x + settings.buildingOffsetX,
      streetY + settings.buildingOffsetY,
      levelCenter.z + settings.buildingOffsetZ
    );
    buildingPlane.visible = settings.buildingEnabled;
    scene.add(buildingPlane);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(PATHS.images.building,
      (texture) => {
        loadingProgress.complete();
        buildingPlane.material.map = texture;
        buildingPlane.material.color.set(0xffffff);
        buildingPlane.material.needsUpdate = true;
      },
      undefined,
      (error) => {
        loadingProgress.complete();
        console.error("Failed to load building.png:", error);
      }
    );

    const fugitiveGeo = new THREE.BoxGeometry(actorSize, actorSize, actorSize);
    const fugitiveColor = settings.fugitiveColor;

    for (let i = 0; i < fugitiveSpawns.length; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: fugitiveColor,
        emissive: fugitiveColor,
        emissiveIntensity: 0.3
      });
      const mesh = new THREE.Mesh(fugitiveGeo, material);
      mesh.visible = false; // Hide the cube, only show wire and billboard
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const light = null; // Fugitive lights disabled for performance

      const spawnPos = fugitiveSpawns[i];
      const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

      mesh.position.set(roadPoint.x, 0, roadPoint.z);
      projectYOnRoad(mesh.position);
      scene.add(mesh);

      const cardinalDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      const randomCardinal = cardinalDirs[Math.floor(Math.random() * 4)];
      fugitives.push({
        mesh,
        light,
        speed: settings.fugitiveSpeed,
        dirX: randomCardinal[0],
        dirZ: randomCardinal[1],
        captured: false,
        index: i,
        lastIntersectionX: roadPoint.x,
        lastIntersectionZ: roadPoint.z,
        spawnX: roadPoint.x,
        spawnZ: roadPoint.z,
      });

      const wire = new ActorWire(fugitives[fugitives.length - 1], actorSize, fugitiveColor, false, i);
      fugitiveWires.push(wire);
    }

    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];

    // Load car models for chasers
    const carPaths = PATHS.models.cars || [];
    if (DEBUG) console.log("Car paths to load:", carPaths);
    const carPromises = carPaths.map(path =>
      new Promise((resolve) => {
        loader.load(path,
          (gltf) => {
            loadingProgress.complete();
            if (DEBUG) console.log("Loaded car:", path);
            resolve(gltf.scene);
          },
          undefined,
          (err) => {
            loadingProgress.complete();
            console.error("Failed to load car:", path, err);
            resolve(null);
          }
        );
      })
    );

    Promise.all(carPromises).then((carModels) => {
      if (DEBUG) console.log("Car models loaded:", carModels.filter(m => m !== null).length, "of", carModels.length);

      for (let i = 0; i < chaserSpawns.length; i++) {
        const color = chaserColors[i] || chaserColors[0];

        let mesh;
        // Use a different car model for each chaser, cycling if fewer models than chasers
        const carModel = carModels.length > 0 ? carModels[i % carModels.length] : null;

        if (carModel) {
          mesh = carModel.clone();
          // Scale car to fit actor size
          const box = new THREE.Box3().setFromObject(mesh);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = (actorSize * 2) / maxDim; // Make car 2x actor size for visibility
          mesh.scale.setScalar(scale);
          if (DEBUG) console.log(`Chaser ${i}: using car model, scale=${scale.toFixed(3)}, size=${maxDim.toFixed(2)}`);

          // Apply color to all meshes in the car
          mesh.traverse((child) => {
            child.visible = true;
            if (child.isMesh) {
              child.castShadow = false; // Don't cast shadows so lights pass through other chasers
              child.receiveShadow = true;
              // Assign GLB layer for selective pixelation
              child.layers.set(LAYERS.GLB_MODELS);
              // Store original material for reference
              child.userData.originalMaterial = child.material;
              child.material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.05,
                transparent: true,
                opacity: 0.1,
                depthWrite: false,
              });
            }
          });
          mesh.visible = true;
        } else {
          // Fallback to box if car model failed to load
          const chaserGeo = new THREE.BoxGeometry(actorSize, actorSize, actorSize);
          const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.05,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(chaserGeo, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Assign GLB layer for selective pixelation
          mesh.layers.set(LAYERS.GLB_MODELS);
        }

        // Create spotlight as headlight at the front of the car
        const angleRad = (settings.chaserLightAngle * Math.PI) / 180;
        const light = new THREE.SpotLight(color, 0, settings.chaserLightDistance, angleRad, settings.chaserLightPenumbra, 1);
        const meshScale = mesh.scale.y || 1;
        // Position at front of car (local Z-) and at set height (negative due to car flip)
        light.position.set((settings.chaserLightOffsetX || 0) / meshScale, settings.chaserLightHeight / meshScale, -settings.chaserLightOffset / meshScale);
        light.castShadow = true;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = settings.chaserLightDistance || 50;
        light.shadow.bias = -0.002;
        light.shadow.normalBias = 0.05;

        // Create target for spotlight - point forward from the car (negative Z due to car flip)
        const lightTarget = new THREE.Object3D();
        lightTarget.position.set(
          (settings.chaserLightTargetX || 0) / meshScale,
          (settings.chaserLightTargetY || 0) / meshScale,
          (settings.chaserLightTargetZ !== undefined ? settings.chaserLightTargetZ : -5) / meshScale
        );
        mesh.add(lightTarget);
        light.target = lightTarget;
        mesh.add(light);

        const spawnPos = chaserSpawns[i];
        const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

        mesh.position.set(roadPoint.x, 0, roadPoint.z);
        projectYOnRoad(mesh.position);
        mesh.position.y += settings.chaserHeightOffset;
        // Set initial facing direction: C1, C3 face left; C2, C4 face right
        mesh.rotation.y = (i === 0 || i === 2) ? Math.PI / 2 : -Math.PI / 2;
        mesh.visible = true;

        // Cache materials for efficient per-frame updates
        const cachedMaterials = [];
        mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            cachedMaterials.push(child.material);
          }
        });

        const chaserObj = {
          mesh,
          light,
          lightTarget,
          material: null, // Materials are on child meshes now
          cachedMaterials, // Cached for efficient per-frame updates
          speed: settings.chaserSpeed,
          dirX: 0,
          dirZ: 0,
          queuedDirX: 0,
          queuedDirZ: 0,
          active: false,
          ready: false, // Player has pressed keys to indicate they're ready
          isMoving: false,
          isCarModel: !!carModel,
          spawnX: roadPoint.x,
          spawnZ: roadPoint.z,
          spawnRotationY: mesh.rotation.y,
        };
        scene.add(mesh);
        chasers.push(chaserObj);
      }

      // Set initial low opacity for all chasers (PRE_GAME state)
      setChasersOpacity(0.1);
    });

    STATE.findNearestRoadPoint = findNearestRoadPoint;
    STATE.projectYOnRoad = projectYOnRoad;
    STATE.pathGraph = pathGraph;
    STATE.findNearestEdgePoint = findNearestEdgePoint;
    STATE.getNodeDirections = getNodeDirections;
    STATE.actorSize = actorSize;
    STATE.actorRadius = actorSize * 0.5;
    STATE.roadsMeshes = roadsMeshes;
    STATE.loaded = true;
    loadingProgress.finish();

    setupGUI();
    composer = initPostProcessing(renderer, scene, camera, settings, LAYERS);
    initAtmosphere();
    initAudio(settings);
    initSFX();
    loadHelicopter(scene, settings, STATE, LAYERS, ktx2Loader, loadingProgress, DEBUG);
    updateHelicopterBoundsHelper(scene, settings);
    setupSearchlights(scene, settings, STATE);


    // Load path graph from GLB and initialize actors
    rebuildPathGraph();
    if (DEBUG) console.log("Path graph ready");
    setupGLBPartsGUI();

    // Ensure glass text is always enabled and static (no marquee)
    settings.glassEnabled = true;
    settings.glassTextMarquee = false;
    settings.glassTextShuffle = true; // Enable shuffle effect when text changes
    for (const mesh of getGlassMeshes()) {
      mesh.visible = true;
    }

    // Initialize projection plane
    initProjectionPlane();

    // Pre-warm shaders: temporarily render all billboards to force GPU compilation
    // This avoids lag spikes when fugitives first appear during gameplay
    for (const wire of fugitiveWires) {
      if (wire.billboard) wire.billboard.scale.setScalar(0.001);
    }
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    for (const wire of fugitiveWires) {
      if (wire.billboard) wire.billboard.scale.setScalar(0);
    }

    // Initialize game state to PRE_GAME
    setGameState("PRE_GAME");

    // Apply performance overrides and mobile overlay when not in facade mode
    if (!isFacadeMode) {
      applyMobileMode(true);
    }

    // Ensure text renders after fonts are loaded (slight delay for safety)
    setTimeout(() => {
      if (STATE.gameState === "PRE_GAME") {
        setGameState("PRE_GAME"); // Re-apply to ensure text is visible
      }
    }, 100);

    statusEl.textContent = "Ready! Press any movement key to start.";
  }).catch((err) => {
    console.error("Error loading GLB files", err);
    statusEl.textContent = "Failed to load GLB files (see console).";
  });

  animate(0);
})();
