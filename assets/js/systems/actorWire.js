// Actor Wire (Billboard) System — billboards above actors with rope physics
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { FACE_TEXTURES, PATHS } from "../game/constants.js?v=8";

let _scene = null;
let _settings = null;
let _STATE = null;
let _renderer = null;
let _faceCamera = null; // when set, head billboards turn to face this camera (FPS/orbit capture)

// In capture views the heads otherwise sit flat on the ground (edge-on/invisible
// from a first-person angle). Pass a camera to billboard them toward it; null
// restores the flat-on-facade orientation used for the top-down projection.
export function setBillboardFaceCamera(camera) {
  _faceCamera = camera || null;
}

export function initActorWire(scene, settings, STATE, renderer) {
  _scene = scene;
  _settings = settings;
  _STATE = STATE;
  _renderer = renderer;
}

// Verlet rope physics (inline — uses THREE.Vector3)
class RopePoint {
  constructor(x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
    this.oldPos = new THREE.Vector3(x, y, z);
    this.pinned = false;
  }

  update(gravity, friction) {
    if (this.pinned) return;

    const vx = (this.pos.x - this.oldPos.x) * friction;
    const vy = (this.pos.y - this.oldPos.y) * friction;
    const vz = (this.pos.z - this.oldPos.z) * friction;

    this.oldPos.copy(this.pos);

    this.pos.x += vx;
    this.pos.y += vy - gravity;
    this.pos.z += vz;
  }

  setPos(x, y, z) {
    this.pos.set(x, y, z);
    this.oldPos.set(x, y, z);
  }
}

class RopeStick {
  constructor(p1, p2, length) {
    this.p1 = p1;
    this.p2 = p2;
    this.length = length;
  }

  update() {
    const dx = this.p2.pos.x - this.p1.pos.x;
    const dy = this.p2.pos.y - this.p1.pos.y;
    const dz = this.p2.pos.z - this.p1.pos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance === 0) return;

    const diff = (this.length - distance) / distance / 2;
    const offsetX = dx * diff;
    const offsetY = dy * diff;
    const offsetZ = dz * diff;

    if (!this.p1.pinned) {
      this.p1.pos.x -= offsetX;
      this.p1.pos.y -= offsetY;
      this.p1.pos.z -= offsetZ;
    }
    if (!this.p2.pinned) {
      this.p2.pos.x += offsetX;
      this.p2.pos.y += offsetY;
      this.p2.pos.z += offsetZ;
    }
  }
}

export class ActorWire {
  constructor(actor, actorSize, color, isChaser = true, index = 0) {
    this.actor = actor;
    this.actorSize = actorSize;
    this.color = color;
    this.isChaser = isChaser;
    this.index = index;
    this.points = [];
    this.sticks = [];
    this.line = null;
    this.cube = null;
    this.cubeLight = null;

    // Fade state
    this.isFading = false;
    this.fadeProgress = 1.0;
    this.fadeDirection = 0;
    this.pendingTextureSwap = false;

    // Pop-in animation state
    this.isPopping = false;
    this.popProgress = 0;
    this.popDuration = 0.6; // seconds
    this.popScale = 0;
    this.showWireAndBillboard = false; // Only show when game is playing

    this.initWire();
  }

  initWire() {
    const segmentCount = 12; // Fixed value since wire is removed
    const totalHeight = 3.2 * this.actorSize; // Fixed height for billboard positioning
    const segmentLength = totalHeight / segmentCount;

    const actorPos = this.actor.mesh.position;

    this.points = [];
    this.sticks = [];

    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      const y = actorPos.y + t * totalHeight;
      const p = new RopePoint(actorPos.x, y, actorPos.z);
      this.points.push(p);

      if (i > 0) {
        this.sticks.push(new RopeStick(this.points[i - 1], this.points[i], segmentLength));
      }
    }

    this.points[0].pinned = true;
    this.points[this.points.length - 1].pinned = true;

    const billboardSize = _settings.wireCubeSize * this.actorSize * 2;
    const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
    const brightness = _settings.billboardBrightness;
    const billboardMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(brightness, brightness, brightness),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true, // Enable depth test so billboards render behind helicopter
    });

    // Add contrast adjustment via shader modification
    billboardMat.userData.contrast = _settings.billboardContrast;
    billboardMat.onBeforeCompile = (shader) => {
      shader.uniforms.contrast = { value: _settings.billboardContrast };
      billboardMat.userData.shader = shader;

      // Inject contrast uniform
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'uniform float contrast;\nvoid main() {'
      );

      // Apply contrast to the final color
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
          #include <dithering_fragment>`
      );
    };

    // Update contrast uniform when material needs update
    const originalOnBeforeRender = billboardMat.onBeforeRender;
    billboardMat.onBeforeRender = function() {
      if (this.userData.shader) {
        this.userData.shader.uniforms.contrast.value = _settings.billboardContrast;
      }
      if (originalOnBeforeRender) originalOnBeforeRender.apply(this, arguments);
    };
    this.billboard = new THREE.Mesh(billboardGeo, billboardMat);
    this.billboard.rotation.x = -Math.PI / 2;
    this.billboard.castShadow = false;
    this.billboard.renderOrder = 100; // Render above wire but respect depth
    _scene.add(this.billboard);

    // Add point light for billboard emission (chasers only, fugitive lights disabled for performance)
    if (this.isChaser) {
      this.billboardLight = new THREE.PointLight(
        this.color,
        _settings.billboardLightIntensity,
        _settings.billboardLightDistance
      );
      this.billboardLight.castShadow = false;
      _scene.add(this.billboardLight);
    } else {
      this.billboardLight = null;
    }

    if (!this.isChaser) {
      const textureLoader = new THREE.TextureLoader();
      const pair = FACE_TEXTURES[this.index] || FACE_TEXTURES[0];
      this.textures = [null, null];
      this.currentTextureIndex = 0;

      const facePath = PATHS.images.faces;
      // Faces are color maps viewed on a flat plane at grazing angles: tag as
      // sRGB (else they render gamma-wrong) and enable anisotropy (else they
      // smear/shimmer with distance). Set before GPU upload.
      const prepFace = (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = _renderer.capabilities.getMaxAnisotropy();
      };
      textureLoader.load(facePath + pair[0],
        (texture) => {
          prepFace(texture);
          this.textures[0] = texture;
          this.billboard.material.map = texture;
          this.billboard.material.needsUpdate = true;
          // Pre-upload texture to GPU to avoid stall on first render
          _renderer.initTexture(texture);
        },
        undefined,
        () => this.billboard.material.color.set(this.color)
      );
      textureLoader.load(facePath + pair[1],
        (texture) => {
          prepFace(texture);
          this.textures[1] = texture;
          _renderer.initTexture(texture);
        }
      );
    } else {
      this.billboard.material.color.set(this.color);
    }
  }

  swapTexture() {
    if (this.isChaser || !this.textures) return;

    if (_settings.faceSwapFade && _settings.faceSwapFadeDuration > 0) {
      // Start fade out
      this.isFading = true;
      this.fadeDirection = -1; // -1 = fading out, 1 = fading in
      this.fadeProgress = 1.0;
      this.pendingTextureSwap = true;
    } else {
      // Instant swap
      this.currentTextureIndex = 1 - this.currentTextureIndex;
      const newTexture = this.textures[this.currentTextureIndex];
      if (newTexture) {
        this.billboard.material.map = newTexture;
        this.billboard.material.needsUpdate = true;
      }
    }
  }

  updateFade(dt) {
    if (!this.isFading || !this.billboard) return;
    // Skip fade updates for captured fugitives
    if (!this.isChaser && this.actor.captured) {
      this.isFading = false;
      return;
    }

    const fadeSpeed = 1.0 / _settings.faceSwapFadeDuration;
    this.fadeProgress += this.fadeDirection * fadeSpeed * dt;

    if (this.fadeDirection === -1 && this.fadeProgress <= 0) {
      // Fully faded out - swap texture and start fading in
      this.fadeProgress = 0;
      if (this.pendingTextureSwap) {
        this.currentTextureIndex = 1 - this.currentTextureIndex;
        const newTexture = this.textures[this.currentTextureIndex];
        if (newTexture && this.billboard.material) {
          this.billboard.material.map = newTexture;
          this.billboard.material.needsUpdate = true;
        }
        this.pendingTextureSwap = false;
      }
      this.fadeDirection = 1; // Start fading in
    } else if (this.fadeDirection === 1 && this.fadeProgress >= 1) {
      // Fully faded in - done
      this.fadeProgress = 1;
      this.isFading = false;
    }

    // Apply opacity
    if (this.billboard.material) {
      this.billboard.material.opacity = this.fadeProgress;
      this.billboard.material.needsUpdate = true;
    }
  }

  isVisible() {
    if (this.isChaser) {
      return this.actor.active;
    } else {
      // Fugitive billboards only show when game is playing and showWireAndBillboard is true
      return !this.actor.captured && this.showWireAndBillboard;
    }
  }

  startPopIn() {
    this.isPopping = true;
    this.popProgress = 0;
    this.popScale = 0;
    this.showWireAndBillboard = true;
  }

  hideWireAndBillboard() {
    this.showWireAndBillboard = false;
    this.isPopping = false;
    this.popScale = 0;
    if (this.billboard) this.billboard.scale.setScalar(0);
  }

  // Elastic easing function (overshoot and settle)
  elasticOut(t) {
    const p = 0.3;
    return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
  }

  update(dt = 0.016) {
    // Update fade animation
    this.updateFade(dt);

    // Update pop-in animation
    if (this.isPopping) {
      this.popProgress += dt / this.popDuration;
      if (this.popProgress >= 1) {
        this.popProgress = 1;
        this.isPopping = false;
      }
      this.popScale = this.elasticOut(this.popProgress);
    }

    if (!this.isVisible()) {
      // Keep visible at scale 0 to avoid shader recompilation on show
      if (this.billboard) this.billboard.scale.setScalar(0);
      return;
    }

    if (this.billboard) {
      // Apply pop scale
      this.billboard.scale.setScalar(this.popScale);
    }

    const actorPos = this.actor.mesh.position;
    const totalHeight = 3.2 * this.actorSize; // Hardcoded (wire removed)

    this.points[0].setPos(actorPos.x, actorPos.y, actorPos.z);

    const topPoint = this.points[this.points.length - 1];
    const time = performance.now() * 0.001;
    const swayX = Math.sin(time * 1.5 + this.actorSize * 10) * 0.3 * this.actorSize;
    const swayZ = Math.cos(time * 1.2 + this.actorSize * 5) * 0.3 * this.actorSize;

    // Pull billboard toward center of level
    const center = _STATE.levelCenter || { x: 0, z: 0 };
    const centerPull = _settings.billboardCenterPull;
    let targetX = actorPos.x + (center.x - actorPos.x) * centerPull + swayX;
    let targetZ = actorPos.z + (center.z - actorPos.z) * centerPull + swayZ;

    // Limit distance from actor
    const maxDist = _settings.billboardMaxDistance;
    let dx = targetX - actorPos.x;
    let dz = targetZ - actorPos.z;
    let dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > maxDist) {
      const scale = maxDist / dist;
      targetX = actorPos.x + dx * scale;
      targetZ = actorPos.z + dz * scale;
    }

    topPoint.setPos(targetX, actorPos.y + totalHeight, targetZ);

    const gravity = 0.15 * this.actorSize; // Hardcoded (wire removed)
    const friction = 0.92; // Hardcoded (wire removed)

    for (const p of this.points) {
      if (!p.pinned) {
        const windX = (Math.random() - 0.5) * 0.02 * this.actorSize;
        const windZ = (Math.random() - 0.5) * 0.02 * this.actorSize;
        p.pos.x += windX;
        p.pos.z += windZ;
      }
      p.update(gravity, friction);
    }

    for (let i = 0; i < 3; i++) { // Hardcoded iterations (wire removed)
      for (const stick of this.sticks) {
        stick.update();
      }
    }

    // Wire line removed - only billboard remains

    // Billboard position: pull toward center based on centerPull setting
    const toCenterX = center.x - actorPos.x;
    const toCenterZ = center.z - actorPos.z;
    let billboardX = actorPos.x + toCenterX * centerPull;
    let billboardZ = actorPos.z + toCenterZ * centerPull;

    // Optionally limit distance from actor if maxDist > 0
    if (maxDist > 0) {
      const dx = billboardX - actorPos.x;
      const dz = billboardZ - actorPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxDist) {
        const scale = maxDist / dist;
        billboardX = actorPos.x + dx * scale;
        billboardZ = actorPos.z + dz * scale;
      }
    }

    this.billboard.position.set(billboardX, actorPos.y + totalHeight, billboardZ);

    // Orientation: face the capture camera (so faces read in first-person /
    // orbit views), else lie flat for the top-down facade projection.
    if (_faceCamera) {
      this.billboard.lookAt(_faceCamera.position);
    } else {
      this.billboard.rotation.set(-Math.PI / 2, 0, 0);
    }

    // Update billboard light position and settings
    // Use intensity=0 instead of visible=false to avoid shader recompilation
    if (this.billboardLight) {
      this.billboardLight.position.copy(this.billboard.position);
      const baseIntensity = this.isChaser ? _settings.billboardLightIntensity : _settings.fugitiveLightIntensity;
      this.billboardLight.intensity = this.showWireAndBillboard ? baseIntensity : 0;
      this.billboardLight.distance = _settings.billboardLightDistance;
    }
  }

  dispose() {
    if (this.line) {
      _scene.remove(this.line);
      this.line.geometry.dispose();
      this.line.material.dispose();
    }
    if (this.billboard) {
      _scene.remove(this.billboard);
      this.billboard.geometry.dispose();
      this.billboard.material.dispose();
    }
    if (this.billboardLight) {
      _scene.remove(this.billboardLight);
    }
  }
}

export function updateWireBillboards(fugitiveWires) {
  for (const wire of fugitiveWires) {
    if (wire.billboard) {
      const billboardSize = _settings.wireCubeSize * wire.actorSize * 2;
      wire.billboard.geometry.dispose();
      wire.billboard.geometry = new THREE.PlaneGeometry(billboardSize, billboardSize);
    }
  }
}
