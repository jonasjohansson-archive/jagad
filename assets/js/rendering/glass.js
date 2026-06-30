// Glass Overlay — canvas texture, text rendering, shuffle effect, video background
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { PATHS } from "../game/constants.js?v=8";

let glassMeshes = [];
let glassMaterials = [];
let glassCanvas = null;
let glassContext = null;
let glassTexture = null;
let marqueeOffset = 0;
let lastMarqueeTime = 0;
let glassVideo = null;
let glassVideoReady = false;

// Stored references (set during setupGlassMeshes)
let _settings = null;
let _STATE = null;
let _beforeRenderCallback = null;

// Text shuffle effect - similar to domedreaming.com
const textShuffleState = {
  rows: [{}, {}, {}, {}],
  lastTexts: ["", "", "", ""],
  lastFlickerTime: 0,
  flickerChars: {},
  activeCount: 0,
};

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function isLetter(char) {
  return char >= "A" && char <= "Z";
}

function initShuffleRow(rowIndex, targetText, previousText) {
  const state = textShuffleState.rows[rowIndex];
  state.target = targetText;
  state.chars = [];

  const now = performance.now();
  const duration = _settings.glassTextShuffleCharDelay || 500;
  const stagger = 30;

  for (let i = 0; i < targetText.length; i++) {
    const oldChar = (previousText || "")[i] || "";
    const newChar = targetText[i] || "";
    const isChanged = oldChar !== newChar && isLetter(newChar);

    state.chars.push({
      active: isChanged,
      startTime: now + (i * stagger),
      duration: duration,
    });
    if (isChanged) textShuffleState.activeCount++;
  }
}

function triggerRandomScramble(rowIndex) {
  const state = textShuffleState.rows[rowIndex];
  if (!state.target || !state.chars) return;

  const now = performance.now();
  const duration = _settings.glassTextShuffleCharDelay || 500;

  const availableIndices = [];
  for (let i = 0; i < state.target.length; i++) {
    const char = state.target[i];
    const charState = state.chars[i];
    if (isLetter(char) && charState && !charState.active) {
      availableIndices.push(i);
    }
  }

  if (availableIndices.length > 0) {
    const randomIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    state.chars[randomIdx].active = true;
    state.chars[randomIdx].startTime = now;
    state.chars[randomIdx].duration = duration;
    textShuffleState.activeCount++;
  }
}

function getShuffledText(rowIndex, targetText, dt) {
  if (!_settings.glassTextShuffle || _STATE.enteringHighScore || _STATE.gameState === "GAME_OVER") {
    textShuffleState.lastTexts[rowIndex] = targetText;
    return targetText;
  }

  if (textShuffleState.lastTexts[rowIndex] !== targetText) {
    const previousText = textShuffleState.lastTexts[rowIndex];
    textShuffleState.lastTexts[rowIndex] = targetText;
    initShuffleRow(rowIndex, targetText, previousText);
  }

  const state = textShuffleState.rows[rowIndex];
  if (!state.target || !state.chars) return targetText;

  const now = performance.now();

  const flickerInterval = 150;
  if (now - textShuffleState.lastFlickerTime >= flickerInterval) {
    textShuffleState.lastFlickerTime = now;

    for (let r = 0; r < 4; r++) {
      if (Math.random() < 0.05) {
        triggerRandomScramble(r);
      }
    }

    for (let r = 0; r < 4; r++) {
      textShuffleState.flickerChars[r] = {};
      const rowState = textShuffleState.rows[r];
      if (rowState.target) {
        for (let i = 0; i < rowState.target.length; i++) {
          textShuffleState.flickerChars[r][i] = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }
    }
  }

  let result = "";

  for (let i = 0; i < state.target.length; i++) {
    const char = state.target[i];
    const charState = state.chars[i];

    if (!charState || !charState.active) {
      result += char;
    } else {
      const elapsed = now - charState.startTime;
      if (elapsed >= charState.duration) {
        charState.active = false;
        textShuffleState.activeCount--;
        result += char;
      } else if (elapsed < 0) {
        result += " ";
      } else {
        result += textShuffleState.flickerChars[rowIndex]?.[i] || char;
      }
    }
  }

  return result;
}

export function isShuffleActive() {
  if (!_settings || !_settings.glassTextShuffle) return false;
  return textShuffleState.activeCount > 0;
}

async function preloadFonts() {
  const fonts = [
    { family: "BankGothic", weight: "bold" },
    { family: "BankGothic Md BT", weight: "500" },
    { family: "Bank Gothic", weight: "300" },
  ];

  for (const font of fonts) {
    try {
      await document.fonts.load(`${font.weight} 48px "${font.family}"`);
    } catch (e) {
      console.warn(`Could not load font: ${font.family}`);
    }
  }
}

function initGlassCanvas(renderer) {
  glassCanvas = document.createElement("canvas");
  glassCanvas.width = 1024;
  glassCanvas.height = 1024;
  glassContext = glassCanvas.getContext("2d");
  glassTexture = new THREE.CanvasTexture(glassCanvas);
  // Mipmaps + anisotropy: the 1024² canvas (power-of-two) on a large glass quad
  // was using plain LinearFilter (no mipmaps), so marquee/video shimmered when
  // minified or viewed at an angle.
  glassTexture.minFilter = THREE.LinearMipmapLinearFilter;
  glassTexture.magFilter = THREE.LinearFilter;
  glassTexture.generateMipmaps = true;
  if (renderer) glassTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  if (PATHS.video && PATHS.video.windowAmbience) {
    glassVideo = document.createElement("video");
    glassVideo.src = PATHS.video.windowAmbience;
    glassVideo.loop = true;
    glassVideo.muted = true;
    glassVideo.playsInline = true;
    glassVideo.crossOrigin = "anonymous";
    glassVideo.addEventListener("canplaythrough", () => {
      glassVideoReady = true;
      glassVideo.play().catch(() => {});
    });
    glassVideo.load();
  }

  preloadFonts().then(() => {
    updateGlassCanvas();
  });
}

export function updateGlassCanvas(timestamp = 0) {
  if (!glassContext) return;

  // Re-apply high score text each frame during high score entry for blinking initials
  if (_STATE.enteringHighScore && _beforeRenderCallback) {
    _beforeRenderCallback();
  }

  const ctx = glassContext;
  const w = glassCanvas.width;
  const h = glassCanvas.height;

  // Clear canvas
  ctx.clearRect(0, 0, w, h);

  // Flip vertically to correct upside-down text
  ctx.save();
  ctx.translate(0, h);
  ctx.scale(1, -1);

  // Compensation factor for text brightness
  const textBrightness = _settings.glassTextBrightness || 1;
  const bgCompensation = textBrightness > 1 ? 1 - (1 / textBrightness) : 0;

  // Draw video background if available and enabled, otherwise solid color
  if (_settings.glassVideoEnabled && glassVideo && glassVideoReady && glassVideo.readyState >= 2) {
    const vw = glassVideo.videoWidth;
    const vh = glassVideo.videoHeight;
    if (vw && vh) {
      const scale = Math.max(w / vw, h / vh);
      const sw = vw * scale;
      const sh = vh * scale;
      const sx = (w - sw) / 2;
      const sy = (h - sh) / 2;

      ctx.globalAlpha = _settings.glassVideoOpacity;
      ctx.drawImage(glassVideo, sx, sy, sw, sh);
      ctx.globalAlpha = 1.0;

      const brightness = _settings.glassVideoBrightness;
      if (brightness < 1) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - brightness})`;
        ctx.fillRect(0, 0, w, h);
      } else if (brightness > 1) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(brightness - 1) * 0.5})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.fillStyle = `rgba(0, 0, 0, ${_settings.glassOpacity * 0.5})`;
    ctx.fillRect(0, 0, w, h);

    if (bgCompensation > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${bgCompensation})`;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    if (_settings.glassOpacity > 0) {
      const combinedOpacity = Math.min(1, _settings.glassOpacity + bgCompensation);
      ctx.fillStyle = `rgba(0, 0, 0, ${combinedOpacity})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Calculate dt for shuffle effect
  const shuffleDt = timestamp - lastMarqueeTime > 0 && timestamp - lastMarqueeTime < 100
    ? (timestamp - lastMarqueeTime) / 1000
    : 0.016;

  // Skip text rendering if disabled
  if (!_settings.glassTextEnabled) {
    ctx.restore();
    if (glassTexture) {
      glassTexture.needsUpdate = true;
    }
    return;
  }

  // Get text rows with shuffle effect applied
  const rawRows = [
    _settings.glassTextRow1,
    _settings.glassTextRow2,
    _settings.glassTextRow3,
    _settings.glassTextRow4,
  ];
  const rows = rawRows.map((row, i) => row && row.trim() !== "" ? getShuffledText(i, row, shuffleDt) : "");

  const hasContent = rows.some(row => row !== "");
  if (!hasContent) {
    ctx.restore();
    if (glassTexture) glassTexture.needsUpdate = true;
    return;
  }

  // Setup text style
  const fontSize = _settings.glassTextFontSize;
  const lineHeight = fontSize * _settings.glassTextLineHeight;
  const fontFamily = _settings.glassTextFont || "BankGothic";
  ctx.fillStyle = _settings.glassTextColor;
  ctx.font = `bold ${fontSize}px "${fontFamily}", Arial, sans-serif`;
  ctx.textBaseline = "middle";

  const totalHeight = 4 * lineHeight;
  const startY = (h - totalHeight) / 2 + lineHeight / 2 + (_settings.glassTextOffsetY || 0);
  const letterSpacing = _settings.glassTextLetterSpacing || 0;

  const monospace = _settings.glassTextMonospace || false;
  const charWidth = _settings.glassTextCharWidth || 50;

  function drawTextWithSpacing(text, x, y, align = "left") {
    if (monospace) {
      ctx.textAlign = "center";
      const totalWidth = text.length * charWidth;
      let startX = x;

      if (align === "center") {
        startX = x - totalWidth / 2 + charWidth / 2;
      } else if (align === "right") {
        startX = x - totalWidth + charWidth / 2;
      } else {
        startX = x + charWidth / 2;
      }

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charX = startX + i * charWidth;
        ctx.fillText(char, charX, y);
      }
      return;
    }

    if (letterSpacing === 0) {
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
      return;
    }

    ctx.textAlign = "left";
    let currentX = x;

    if (align === "center" || align === "right") {
      let totalWidth = 0;
      for (const char of text) {
        totalWidth += ctx.measureText(char).width + letterSpacing;
      }
      totalWidth -= letterSpacing;
      if (align === "center") currentX = x - totalWidth / 2;
      else if (align === "right") currentX = x - totalWidth;
    }

    for (const char of text) {
      ctx.fillText(char, currentX, y);
      currentX += ctx.measureText(char).width + letterSpacing;
    }
  }

  function measureTextWithSpacing(text) {
    if (monospace) {
      return text.length * charWidth;
    }
    if (letterSpacing === 0) return ctx.measureText(text).width;
    let totalWidth = 0;
    for (const char of text) {
      totalWidth += ctx.measureText(char).width + letterSpacing;
    }
    return totalWidth - letterSpacing;
  }

  // Handle marquee animation
  if (_settings.glassTextMarquee) {
    const dt = timestamp - lastMarqueeTime;
    lastMarqueeTime = timestamp;
    if (dt > 0 && dt < 100) {
      marqueeOffset += (_settings.glassTextMarqueeSpeed * dt) / 1000;
    }

    let maxTextWidth = 0;
    for (const text of rows) {
      maxTextWidth = Math.max(maxTextWidth, measureTextWithSpacing(text));
    }
    const totalScrollDistance = w + maxTextWidth + (rows.length - 1) * _settings.glassTextRowDelay;

    if (marqueeOffset > totalScrollDistance) {
      marqueeOffset = 0;
    }

    for (let i = 0; i < rows.length; i++) {
      const text = rows[i];
      if (!text) continue;
      const y = startY + i * lineHeight;
      const textWidth = measureTextWithSpacing(text);
      const rowOffset = marqueeOffset - (i * _settings.glassTextRowDelay);

      const x = w - rowOffset;

      if (x > -textWidth && x < w) {
        drawTextWithSpacing(text, x, y, "left");
      }
    }
  } else {
    // Static text
    let xPos;
    const offsetX = _settings.glassTextOffsetX || 0;
    switch (_settings.glassTextAlign) {
      case "left": xPos = 50 + offsetX; break;
      case "right": xPos = w - 50 + offsetX; break;
      default: xPos = w / 2 + offsetX; break;
    }

    for (let i = 0; i < rows.length; i++) {
      const text = rows[i];
      if (!text) continue;
      const y = startY + i * lineHeight;
      // Initials row: white text with colored glow during high score entry
      if (_STATE.enteringHighScore && _STATE.highScoreInitialsColor && i === 1) {
        ctx.save();
        ctx.shadowColor = _STATE.highScoreInitialsColor;
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = "#ffffff";
        drawTextWithSpacing(text, xPos, y, _settings.glassTextAlign);
        drawTextWithSpacing(text, xPos, y, _settings.glassTextAlign);
        ctx.restore();
        ctx.fillStyle = _settings.glassTextColor;
      } else {
        drawTextWithSpacing(text, xPos, y, _settings.glassTextAlign);
      }
    }
  }

  // Restore canvas state (undo the flip)
  ctx.restore();

  // Update texture
  if (glassTexture) {
    glassTexture.needsUpdate = true;
  }
}

export function setupGlassMeshes(meshes, settings, STATE, renderer) {
  _settings = settings;
  _STATE = STATE;
  glassMeshes = meshes;
  initGlassCanvas(renderer);

  // Pick up GLB material color as default glass tint (skip black/very dark)
  for (const mesh of meshes) {
    if (mesh.material && mesh.material.color) {
      const c = mesh.material.color;
      if ((c.r + c.g + c.b) > 0.1 && (c.r !== 1 || c.g !== 1 || c.b !== 1)) {
        settings.glassColor = "#" + c.getHexString();
        break;
      }
    }
  }

  glassMaterials = [];
  const brightness = settings.glassTextBrightness || 1;
  const tint = new THREE.Color(settings.glassColor);
  for (const mesh of glassMeshes) {
    mesh.userData.originalX = mesh.position.x;
    mesh.userData.originalY = mesh.position.y;
    mesh.userData.originalZ = mesh.position.z;
    mesh.userData.originalRotX = mesh.rotation.x;

    const glassMaterial = new THREE.MeshBasicMaterial({
      map: glassTexture,
      color: tint.clone().multiplyScalar(brightness),
      transparent: true,
      opacity: settings.glassMaterialOpacity ?? 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });

    mesh.material = glassMaterial;
    mesh.castShadow = false;
    mesh.renderOrder = 999;
    glassMaterials.push(glassMaterial);
  }

  updateGlassPosition();

  // Register public APIs on window
  window.setGlassContent = function(row1 = "", row2 = "", row3 = "", row4 = "") {
    _settings.glassTextRow1 = row1;
    _settings.glassTextRow2 = row2;
    _settings.glassTextRow3 = row3;
    _settings.glassTextRow4 = row4;
    updateGlassCanvas();
  };

  window.setGlassRow = function(rowNum, text) {
    if (rowNum >= 1 && rowNum <= 4) {
      _settings[`glassTextRow${rowNum}`] = text;
      updateGlassCanvas();
    }
  };

  window.drawOnGlass = function(callback) {
    if (glassContext) {
      callback(glassContext, glassCanvas.width, glassCanvas.height);
      if (glassTexture) {
        glassTexture.needsUpdate = true;
      }
    }
  };
}

export function updateGlassPosition() {
  for (const mesh of glassMeshes) {
    if (mesh.userData.originalX !== undefined) {
      mesh.position.x = mesh.userData.originalX + (_settings.glassPosX || 0);
    }
    if (mesh.userData.originalY !== undefined) {
      mesh.position.y = mesh.userData.originalY + (_settings.glassPosY || 0);
    }
    if (mesh.userData.originalZ !== undefined) {
      mesh.position.z = mesh.userData.originalZ + (_settings.glassPosZ || 0);
    }
    if (mesh.userData.originalRotX !== undefined) {
      mesh.rotation.x = mesh.userData.originalRotX + (_settings.glassRotX || 0) * Math.PI / 180;
    }
  }
}

export function updateGlassMaterialOpacity() {
  const opacity = _settings.glassMaterialOpacity ?? 1.0;
  for (const mat of glassMaterials) {
    mat.opacity = opacity;
  }
}

export function updateGlassColor() {
  const brightness = _settings.glassTextBrightness || 1;
  const tint = new THREE.Color(_settings.glassColor);
  for (const mat of glassMaterials) {
    mat.color.copy(tint).multiplyScalar(brightness);
  }
  updateGlassCanvas();
}

export function updateGlassBrightness() {
  updateGlassColor();
}

export function setBeforeRenderCallback(fn) {
  _beforeRenderCallback = fn;
}

export function getGlassMeshes() { return glassMeshes; }
export function getGlassMaterials() { return glassMaterials; }
export function getGlassVideo() { return glassVideo; }
export function getGlassCanvas() { return glassCanvas; }
export function isGlassVideoReady() { return glassVideoReady; }
