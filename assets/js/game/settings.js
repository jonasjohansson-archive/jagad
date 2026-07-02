// Game settings configuration

export const STORAGE_KEY = "jagadSettings";

// Keys excluded from localStorage — always use defaults
const noSaveKeys = new Set([
  "projectionOpacity", "projectionBlending", "projectionBrightness", "projectionRedTarget", "projectionRedStrength",
  "projectionColor", "projectionScale",
  "projectionOffsetX", "projectionOffsetY", "projectionOffsetZ",
  "preGameImage", "startingImage", "playingImage", "gameOverImage",
]);

export const defaultSettings = {
  fugitiveSpeed: 1,
  chaserSpeed: 1.2,
  actorScale: 1,
  fugitiveIntelligence: 1.0,
  fugitiveDangerRadius: 4,
  fugitiveDangerSpeedMultiplier: 1.4,
  fugitiveJukeChance: 0.15,
  fugitiveMidEdgeJukeChance: 0.03,
  fugitiveColor: "#ffffff",
  fugitiveLightIntensity: 5,
  faceSwapDuration: 30,
  faceSwapFade: false,
  faceSwapFadeDuration: 1,
  chaser1Color: "#FF2FD4",
  chaser2Color: "#FF7A00",
  chaser3Color: "#216BFF",
  chaser4Color: "#FDFF4A",
  chaserLightIntensity: 500,
  chaserLightHeight: 0,
  chaserLightDistance: 3,
  chaserLightAngle: 19,
  chaserLightPenumbra: 1,
  chaserLightOffset: 0.05,
  chaserLightOffsetX: 0,
  chaserLightTargetX: 0,
  chaserLightTargetY: -0.5,
  chaserLightTargetZ: -5,
  chaserHeightOffset: -0.03,
  cameraType: "perspective",
  orthoZoom: 1,
  perspFov: 13,
  // Tight near/far for the board scale (camera ~33u up, level fits within ~80u).
  // 1:400 keeps z-buffer precision high vs the old 0.1:5000 (50000:1), which
  // caused z-fighting on coplanar road/ground geometry.
  perspNear: 1,
  perspFar: 400,
  renderScale: 1,
  perspPosX: 0.04,
  perspPosY: 33,
  perspPosZ: 10,
  perspPanX: 0,
  perspPanZ: 0.5,
  // Lighting
  toneMapping: "Neutral",
  exposure: 0.67,
  environmentIntensity: 0,
  punctualLights: true,
  ambientIntensity: 0,
  ambientColor: "#ffffff",
  directIntensity: 7.1,
  directColor: "#ffffff",
  directPosX: -5,
  directPosY: 11,
  directPosZ: 4,
  wireCubeSize: 2,
  billboardBrightness: 1.2,
  billboardContrast: 1.1,
  billboardCenterPull: 0.01,
  billboardMaxDistance: 0,
  billboardLightIntensity: 20,
  billboardLightDistance: 10,
  showNavmesh: false,
  buildingEnabled: false,
  buildingScaleX: 1.15,
  buildingScaleY: 1.12,
  buildingOffsetX: 0.11,
  buildingOffsetY: -0.01,
  buildingOffsetZ: 0.65,
  buildingOpacity: 1,
  bloomEnabled: true,
  // Softer, wider neon glow. radius 0 gave an almost-invisible halo; threshold 1
  // let only the brightest emissives (windows) bloom. Lower threshold brings
  // roads/paths into a soft glow; radius spreads it. All tunable in the GUI.
  bloomThreshold: 0.85,
  bloomStrength: 0.5,
  bloomRadius: 0.4,
  // Pixelation
  pixelationEnabled: false,
  pixelationSize: 4,
  pixelationNormalEdge: 0.3,
  pixelationDepthEdge: 0.4,
  // Cyberpunk VFX
  vignetteEnabled: false,
  vignetteIntensity: 1,
  colorGradingEnabled: true,
  // Grading now runs after tone mapping (display-referred sRGB), where saturation
  // reads stronger, so this is dialled back from 1.75.
  colorGradingSaturation: 1.3,
  colorGradingContrast: 1,
  colorGradingBrightness: 1,
  colorGradingGainR: 1,
  colorGradingGainG: 1,
  colorGradingGainB: 1,
  colorGradingLiftR: 0,
  colorGradingLiftG: 0,
  colorGradingLiftB: 0,
  colorGradingGamma: 1,
  // Atmosphere
  fogEnabled: false,
  fogColor: "#1a0a2e",
  fogNear: 15,
  fogFar: 60,
  dustEnabled: false,
  dustCount: 200,
  dustOpacity: 0.4,
  // Rain
  rainEnabled: false,
  rainCount: 1000,
  rainSpeed: 15,
  rainOpacity: 0.4,
  // Motion trails
  motionTrailsEnabled: false,
  motionTrailsLength: 5,
  motionTrailsOpacity: 0.3,
  motionTrailsSize: 0.15,
  windowEmissiveIntensity: 22.5,
  lampEmissiveIntensity: 0,
  roadNormalMap: false,
  roadEmissiveIntensity: 4,
  pathEmissiveIntensity: 7,
  otherEmissiveIntensity: 0,
  globalEmissiveMultiplier: 0.1,
  lampAudioReactive: false,
  lampAudioSensitivity: 3,
  carAudioReactive: true,
  carAudioBPM: 95,
  carAudioIntensity: 2.5,
  textBPMPulse: true,
  textBPMIntensity: 0.5,
  glassColor: "#ffffff",
  glassEnabled: true,
  glassOpacity: 0,
  glassMaterialOpacity: 1,
  glassPosX: 0,
  glassPosY: 0,
  glassPosZ: 0,
  glassRotX: 0,
  glassVideoEnabled: false,
  glassVideoOpacity: 0.2,
  glassVideoBrightness: 1,
  // Glass text builder
  glassTextEnabled: true,
  glassTextRow1: "AAA236",
  glassTextRow2: "AAA999",
  glassTextRow3: "BBB500",
  glassTextRow4: "CCC100",
  glassTextFontSize: 45,
  glassTextLineHeight: 3.3,
  glassTextFont: "BankGothic",
  glassTextColor: "#ffffff",
  glassTextBrightness: 2,
  glassTextAlign: "center",
  glassTextOffsetX: -47,
  glassTextOffsetY: -254.1,
  glassTextLetterSpacing: 0,
  glassTextMonospace: true,
  glassTextCharWidth: 90,
  glassTextMarquee: false,
  glassTextMarqueeSpeed: 10,
  glassTextRowDelay: 200,
  glassTextShuffle: true,
  glassTextShuffleSpeed: 1.5,
  glassTextShuffleChars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*!?",
  glassTextShuffleCharDelay: 500,
  // Audio
  audioVolume: 0.5,
  audioTrack: "triumphHill",
  // Helicopter
  helicopterEnabled: true,
  helicopterColor: "#ff9a57",
  helicopterBrightness: 1.0,
  helicopterHeight: 2,
  helicopterSpeed: 0.8,
  helicopterRadius: 9,
  helicopterScale: 0.5,
  helicopterLightIntensity: 120,
  helicopterLightColor: "#ffffff",
  helicopterLightAngle: 22,
  helicopterLightDistance: 10,
  helicopterVolumetric: true,
  helicopterVolumetricOpacity: 0.16,
  helicopterConeOffsetY: 0.5,
  helicopterConeHeight: 26.5,
  helicopterConeTopRadius: 0.1,
  helicopterConeBottomRadius: 10,
  helicopterSearchlightSway: 3.6,
  helicopterSearchlightSpeed: 0.7,
  // Helicopter boundary limits
  helicopterBoundsMinX: -4.6,
  helicopterBoundsMaxX: 5,
  helicopterBoundsMinZ: -2,
  helicopterBoundsMaxZ: 2.8,
  helicopterShowBounds: false,

  // Searchlights
  searchlightsEnabled: true,
  searchlightIntensity: 1000,
  searchlightColor: "#495e88",
  searchlightAngle: 12,
  searchlightDistance: 30,
  searchlightPenumbra: 0.5,
  searchlightHeight: 10,
  searchlightSpeed: 0.75,
  searchlightSway: 9.5,

  // Pulse Wave (capture effect)
  pulseWaveEnabled: true,
  pulseWaveSpeed: 3.5,
  pulseWaveWidth: 1.5,
  pulseWaveDuration: 5,
  pulseWaveIntensity: 0.8,
  pulseWaveTubeHeight: 0.12,
  pulseWaveEasing: "easeOut",
  pulseWaveGlow: 3,
  pulseWaveParticles: true,
  pulseWaveFlash: true,

  // Mobile
  shadowsEnabled: true,
  mobileEnabled: false,
  mobileOrthoZoom: 0.5,
  mobileOrthoOffsetZ: 0.6,
  mobileSvgOffset: 20,
  mobileBoardScale: 1.3,

  // Difficulty scaling (3-4 players)
  multiPlayerFugitiveIntelligence: 1.0, // Fugitive AI when 3-4 players (max skill)
  multiPlayerChaserSpeedPenalty: 0.15, // Chasers slower by this amount when 3-4 players
  multiPlayerThreshold: 3, // Player count at which difficulty scaling kicks in

  // Boost
  boostMultiplier: 2.5,
  boostDuration: 1.5,
  boostMaxCount: 1,

  // Game States
  gameState: "GAME_OVER", // PRE_GAME, STARTING, PLAYING, GAME_OVER
  countdownDuration: 3, // Seconds for countdown before game starts

  // Pre-game state text
  preGameTextRow1: "",
  preGameTextRow2: "",
  preGameTextRow3: "",
  preGameTextRow4: "",

  // Starting state text (supports ${countdown} for 3, 2, 1, GO!)
  startingTextRow1: "",
  startingTextRow2: "${countdown}",
  startingTextRow3: "",
  startingTextRow4: "",

  // Playing state text (supports ${score}, ${time}, ${caught}, ${total}, ${status})
  playingTextRow1: "",
  playingTextRow2: "TIME:${time}",
  playingTextRow3: "SCORE:${score}",
  playingTextRow4: "",

  // High score entry text (supports ${score}, ${time}, ${caught}, ${total}, ${status}, ${initials}, ${s1}, ${s2}, ${s3}, ${hs1i}, ${hs1s}, ${hs2i}, ${hs2s}, ${hs3i}, ${hs3s})
  highScoreTextRow1: "",
  highScoreTextRow2: "${initials}",
  highScoreTextRow3: "${score}",
  highScoreTextRow4: "",

  // Game Over text - no high score (same template variables available)
  gameOverTextRow1: "",
  gameOverTextRow2: " GAMEOVER",
  gameOverTextRow3: "SCORE:${score}",
  gameOverTextRow4: "",

  // State projection images
  preGameImage: "intro.png",
  startingImage: "",
  playingImage: "",
  gameOverImage: "",
  projectionOpacity: 1,
  projectionBlending: "normal",
  projectionBrightness: 0.05,
  projectionRedTarget: "#ca072e",
  projectionRedStrength: 2,
  projectionColor: "#ffffff",
  projectionScale: 0.25,
  projectionOffsetX: 0,
  projectionOffsetY: 0.75,
  projectionOffsetZ: 0.8,

  // GLB Parts - per-mesh material overrides (partName -> settings)
  // Only non-default values need to be stored
  glbParts: {
    // Default overrides for specific part types
    _defaults: {
      lamp: { color: "#111111", metalness: 0.54 },
      window: { metalness: 0 },
      path: { metalness: 0 },
      road: { metalness: 0, roughness: 0.84 },
      glass: { opacity: 0.5 },
      "building-building": { opacity: 0 },
      "pavement-paths": { opacity: 0 },
    },
    Lamps: { color: "#7a7a7a", roughness: 0.82 },
    "Windows-Windows": { roughness: 0.86 },
    "Trees-Leaves03": { color: "#c56a20", opacity: 0.95, roughness: 1, metalness: 1 },
    "Trees-Leaves02": { color: "#a3452e", opacity: 0.95, roughness: 1, metalness: 1 },
    "Trees-Leaves01": { color: "#dba100", opacity: 0.9, roughness: 1 },
  },

  // High Scores (array of {initials: "AAA", score: 0})
  highScores: [
    { initials: "AAA", score: 999 },
    { initials: "BBB", score: 500 },
    { initials: "CCC", score: 100 },
  ],
};

export function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Don't let saved empty strings override non-empty defaults
      for (const key of Object.keys(parsed)) {
        if (noSaveKeys.has(key) || (parsed[key] === "" && defaultSettings[key] !== "")) {
          delete parsed[key];
        }
      }
      // Deep merge glbParts to preserve _defaults while adding saved per-part settings
      const result = { ...defaultSettings, ...parsed };
      if (parsed.glbParts) {
        result.glbParts = {
          _defaults: { ...defaultSettings.glbParts._defaults },
          ...parsed.glbParts,
        };
      }
      return result;
    }
  } catch (e) {
    console.warn("Failed to load settings:", e);
  }
  return { ...defaultSettings };
}

export function saveSettings(settings) {
  const toSave = {};
  for (const key of Object.keys(defaultSettings)) {
    if (noSaveKeys.has(key)) continue;
    toSave[key] = settings[key];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch (e) {
    console.error("Failed to save settings:", e);
    return false;
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    console.error("Failed to clear settings:", e);
    return false;
  }
}

export function exportSettings(settings) {
  const toExport = {};
  for (const key of Object.keys(defaultSettings)) {
    toExport[key] = settings[key];
  }
  const json = JSON.stringify(toExport, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jagad-settings.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importSettings(callback) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        const merged = { ...defaultSettings, ...imported };
        // Deep merge glbParts to preserve _defaults
        if (imported.glbParts) {
          merged.glbParts = {
            _defaults: { ...defaultSettings.glbParts._defaults },
            ...imported.glbParts,
          };
        }
        callback(merged);
      } catch (err) {
        console.error("Failed to import settings:", err);
        alert("Failed to import settings: Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
