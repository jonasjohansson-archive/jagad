// Projection system — state-based images, countdown video, pump effect
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { PATHS } from "../game/constants.js?v=8";
import { applyStartingText } from "../game/templateVars.js?v=149";
import { updateGlassCanvas } from "./glass.js?v=149";

const BLENDING_MODES = {
  additive: THREE.AdditiveBlending,
  normal: THREE.NormalBlending,
  multiply: THREE.MultiplyBlending,
  subtract: THREE.SubtractiveBlending,
};

let projectionPlane = null;
let projectionTextures = {};
let projectionVideo = null;
let projectionVideoTexture = null;
let gameAnimationVideo = null;
let gameAnimationVideoTexture = null;
let _projectionShader = null;
let _effectsEnabled = 1.0;

// Projection pump effect
let projectionPumpTime = 0;
const PROJECTION_PUMP_DURATION = 0.3;
const PROJECTION_PUMP_STRENGTH = 0.15;

// Stored references
let _scene = null;
let _settings = null;
let _STATE = null;
let _renderer = null;
let _setGameStateFn = null;

export function initProjection(scene, settings, STATE, renderer, setGameStateFn) {
  _scene = scene;
  _settings = settings;
  _STATE = STATE;
  _renderer = renderer;
  _setGameStateFn = setGameStateFn;
}

export function initProjectionPlane() {
  if (projectionPlane) return;

  const size = _STATE.horizontalSize * 2 || 30;
  const geometry = new THREE.PlaneGeometry(size, size);
  const blendMode = BLENDING_MODES[_settings.projectionBlending] ?? THREE.NormalBlending;

  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: _settings.projectionOpacity,
    color: new THREE.Color(_settings.projectionColor),
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    blending: blendMode,
  });

  // Inject red-preserving brightness boost + red target color into the shader
  // brightness=0 → original PNG colors; brightness>0 → boosts non-red pixels
  // redTarget: red-dominant pixels get remapped toward this color
  // redStrength: how aggressively to remap (0 = off, 1 = full remap)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.brightness = { value: _settings.projectionBrightness };
    const rt = new THREE.Color(_settings.projectionRedTarget || "#E1143C");
    shader.uniforms.redTarget = { value: rt };
    shader.uniforms.redStrength = { value: _settings.projectionRedStrength ?? 1.0 };
    shader.uniforms.effectsEnabled = { value: _effectsEnabled };
    shader.fragmentShader = "uniform float brightness;\nuniform vec3 redTarget;\nuniform float redStrength;\nuniform float effectsEnabled;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      if (effectsEnabled > 0.5) {
        float redDom = clamp(diffuseColor.r - max(diffuseColor.g, diffuseColor.b), 0.0, 1.0);
        float boost = 1.0 + brightness * (1.0 - redDom);
        diffuseColor.rgb = min(diffuseColor.rgb * boost, vec3(1.5));
        float remap = clamp(redDom * redStrength * 2.0, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, redTarget, remap);
      }`
    );
    _projectionShader = shader;
  };

  projectionPlane = new THREE.Mesh(geometry, material);
  projectionPlane.rotation.x = -Math.PI / 2;
  projectionPlane.position.set(
    _STATE.levelCenter.x + _settings.projectionOffsetX,
    _STATE.levelCenter.y + _settings.projectionOffsetY,
    _STATE.levelCenter.z + _settings.projectionOffsetZ
  );
  projectionPlane.renderOrder = 10;
  projectionPlane.visible = true;
  projectionPlane.material.opacity = 0;

  _scene.add(projectionPlane);

  preloadProjectionTextures();

  // Create countdown intro video for projection
  if (PATHS.video && PATHS.video.countdownIntro) {
    projectionVideo = document.createElement("video");
    projectionVideo.src = PATHS.video.countdownIntro;
    projectionVideo.loop = false;
    projectionVideo.muted = true;
    projectionVideo.playsInline = true;
    projectionVideo.crossOrigin = "anonymous";
    projectionVideo.addEventListener("canplaythrough", () => {
      if (!projectionVideoTexture) {
        projectionVideoTexture = new THREE.VideoTexture(projectionVideo);
        projectionVideoTexture.colorSpace = THREE.SRGBColorSpace;
      }
    }, { once: true });
    // When video ends, transition to PLAYING
    projectionVideo.addEventListener("timeupdate", () => {
      if (_STATE.gameState === "STARTING" && projectionVideo.duration - projectionVideo.currentTime < 0.1) {
        _setGameStateFn("PLAYING");
      }
    });
    projectionVideo.addEventListener("ended", () => {
      if (_STATE.gameState === "STARTING") {
        _setGameStateFn("PLAYING");
      }
    });
    projectionVideo.load();
  }

  // Create game animation video (plays when returning to PRE_GAME after a game)
  if (PATHS.video && PATHS.video.gameAnimation) {
    gameAnimationVideo = document.createElement("video");
    gameAnimationVideo.src = PATHS.video.gameAnimation;
    gameAnimationVideo.loop = false;
    gameAnimationVideo.muted = true;
    gameAnimationVideo.playsInline = true;
    gameAnimationVideo.crossOrigin = "anonymous";
    gameAnimationVideo.addEventListener("canplaythrough", () => {
      if (!gameAnimationVideoTexture) {
        gameAnimationVideoTexture = new THREE.VideoTexture(gameAnimationVideo);
        gameAnimationVideoTexture.colorSpace = THREE.SRGBColorSpace;
      }
    }, { once: true });
    gameAnimationVideo.load();
  }
}

function preloadProjectionTextures() {
  const textureLoader = new THREE.TextureLoader();
  const imagePath = "assets/images/";

  const stateImages = {
    PRE_GAME: _settings.preGameImage,
    STARTING: _settings.startingImage || _settings.preGameImage,
    PLAYING: _settings.playingImage,
    GAME_OVER: _settings.gameOverImage,
  };

  for (const [state, imageName] of Object.entries(stateImages)) {
    if (imageName && imageName.trim() !== "") {
      textureLoader.load(
        imagePath + imageName,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          // Flat plane viewed at a grazing angle — anisotropy stops the
          // projected image smearing toward the far edge.
          if (_renderer) texture.anisotropy = _renderer.capabilities.getMaxAnisotropy();
          projectionTextures[state] = texture;
          if (_STATE.gameState === state) {
            updateProjectionForState(state);
          }
        },
        undefined,
        (err) => {
          console.warn(`Failed to load projection image for ${state}:`, imageName, err);
        }
      );
    }
  }
}

export function updateProjectionForState(state) {
  if (!projectionPlane) {
    return;
  }

  // Use video for STARTING state (intro plays until video ends)
  const useVideo = state === "STARTING" && projectionVideoTexture;

  if (useVideo) {
    if (projectionPlane.material.map !== projectionVideoTexture) {
      projectionPlane.material.map = projectionVideoTexture;
      projectionPlane.material.needsUpdate = true;
    }
    projectionPlane.material.blending = THREE.AdditiveBlending;
    projectionPlane.material.opacity = _settings.projectionOpacity;
    _effectsEnabled = 0.0;
    if (_projectionShader) _projectionShader.uniforms.effectsEnabled.value = 0.0;
    projectionVideo.play().catch(() => {});

    const vw = projectionVideo.videoWidth;
    const vh = projectionVideo.videoHeight;
    const aspect = (vw && vh) ? vw / vh : 1;
    projectionPlane.scale.set(
      _settings.projectionScale * aspect,
      _settings.projectionScale,
      1
    );
  } else {
    if (projectionVideo) {
      projectionVideo.pause();
    }
    _effectsEnabled = 1.0;
    if (_projectionShader) _projectionShader.uniforms.effectsEnabled.value = 1.0;
    projectionPlane.material.blending = BLENDING_MODES[_settings.projectionBlending] ?? THREE.NormalBlending;

    const stateImageSettings = {
      PRE_GAME: _settings.preGameImage,
      STARTING: _settings.startingImage || _settings.preGameImage,
      PLAYING: _settings.playingImage,
      GAME_OVER: _settings.gameOverImage,
    };

    const imageName = stateImageSettings[state];
    let texture = projectionTextures[state];
    if (!texture && state === "STARTING") {
      texture = projectionTextures["PRE_GAME"];
    }

    if (texture) {
      if (projectionPlane.material.map !== texture) {
        projectionPlane.material.map = texture;
        projectionPlane.material.needsUpdate = true;
      }
      projectionPlane.material.opacity = _settings.projectionOpacity;

      const img = texture.image;
      if (img && img.width && img.height) {
        const aspect = img.width / img.height;
        projectionPlane.scale.set(
          _settings.projectionScale * aspect,
          _settings.projectionScale,
          1
        );
      } else {
        projectionPlane.scale.setScalar(_settings.projectionScale);
      }
    } else {
      projectionPlane.material.opacity = 0;
    }
  }

  projectionPlane.position.x = _STATE.levelCenter.x + _settings.projectionOffsetX;
  projectionPlane.position.y = _STATE.levelCenter.y + _settings.projectionOffsetY;
  projectionPlane.position.z = _STATE.levelCenter.z + _settings.projectionOffsetZ;
}

export function loadProjectionImage(state, imageName) {
  if (!imageName || imageName.trim() === "") {
    projectionTextures[state] = null;
    if (_STATE.gameState === state) {
      updateProjectionForState(state);
    }
    return;
  }

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    "assets/images/" + imageName,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      if (_renderer) texture.anisotropy = _renderer.capabilities.getMaxAnisotropy();
      projectionTextures[state] = texture;
      if (_STATE.gameState === state) {
        updateProjectionForState(state);
      }
    },
    undefined,
    (err) => {
      console.warn(`Failed to load projection image for ${state}:`, imageName);
    }
  );
}

export function triggerProjectionPump() {
  projectionPumpTime = PROJECTION_PUMP_DURATION;
}

export function updateProjectionPump(dt) {
  if (projectionPumpTime <= 0 || !projectionPlane || !projectionPlane.visible) return;

  projectionPumpTime = Math.max(0, projectionPumpTime - dt);
  const t = projectionPumpTime / PROJECTION_PUMP_DURATION;
  const ease = t * t;
  const boost = 1 + PROJECTION_PUMP_STRENGTH * ease;

  const baseScale = _settings.projectionScale;
  const texture = projectionPlane.material.map;
  const img = texture && texture.image;
  const aspect = (img && img.width && img.height) ? img.width / img.height : 1;

  projectionPlane.scale.set(
    baseScale * aspect * boost,
    baseScale * boost,
    1
  );
}

export function updateCountdown(dt) {
  if (_STATE.gameState !== "STARTING") return;

  _STATE.countdownTimer += dt;

  if (_STATE.countdownTimer >= 1.0) {
    _STATE.countdownTimer -= 1.0;
    _STATE.countdownValue--;

    if (_STATE.countdownValue >= 0) {
      applyStartingText();
      updateGlassCanvas();
      triggerProjectionPump();
      // Pre-warm PLAYING projection texture into GPU on "GO!" beat
      if (_STATE.countdownValue === 0) {
        const playingTex = projectionTextures["PLAYING"];
        if (playingTex) _renderer.initTexture(playingTex);
      }
    } else {
      _setGameStateFn("PLAYING");
    }
  }
}

// Handle projection-specific parts of game state transitions
export function handleProjectionStateChange(newState, oldState) {
  if (newState === "PRE_GAME") {
    // Play game animation video when restarting (coming from GAME_OVER)
    if (oldState === "GAME_OVER" && gameAnimationVideo && gameAnimationVideoTexture) {
      _STATE.gameAnimationPlaying = true;
      gameAnimationVideo.currentTime = 0;
      gameAnimationVideo.play().catch(() => {});
      if (projectionPlane && projectionPlane.material) {
        projectionPlane.material.map = gameAnimationVideoTexture;
        projectionPlane.material.blending = THREE.AdditiveBlending;
        projectionPlane.material.opacity = _settings.projectionOpacity;
        projectionPlane.material.needsUpdate = true;
        _effectsEnabled = 0.0;
        if (_projectionShader) _projectionShader.uniforms.effectsEnabled.value = 0.0;
      }
      const hideProjection = () => {
        _STATE.gameAnimationPlaying = false;
        if (projectionPlane) {
          projectionPlane.material.opacity = 0;
          projectionPlane.material.blending = BLENDING_MODES[_settings.projectionBlending] ?? THREE.NormalBlending;
        }
        gameAnimationVideo.removeEventListener("ended", hideProjection);
      };
      gameAnimationVideo.addEventListener("ended", hideProjection);
    }
  } else if (newState === "STARTING") {
    // Start intro video from beginning — game starts on video end
    if (projectionVideo) {
      projectionVideo.muted = false;
      projectionVideo.currentTime = 0;
      projectionVideo.play().catch(() => {});
      // Disable shader effects for video
      _effectsEnabled = 0.0;
      if (_projectionShader) _projectionShader.uniforms.effectsEnabled.value = 0.0;
    }
  }
}

export function applyProjectionMaterial() {
  if (!projectionPlane) return;
  const mat = projectionPlane.material;
  mat.blending = BLENDING_MODES[_settings.projectionBlending] ?? THREE.NormalBlending;
  mat.color.set(_settings.projectionColor);
  if (_projectionShader) {
    _projectionShader.uniforms.brightness.value = _settings.projectionBrightness;
    _projectionShader.uniforms.redTarget.value.set(_settings.projectionRedTarget || "#E1143C");
    _projectionShader.uniforms.redStrength.value = _settings.projectionRedStrength ?? 1.0;
  }
}

export function getProjectionTextures() { return projectionTextures; }
