// Capture Effects — pulse wave, particles, flash on fugitive capture
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";

const captureEffects = [];

// Pre-built tube geometry cache — built once when path graph is ready
let _tubeCache = null;

function buildTubeCache(STATE, settings) {
  if (!STATE.pathGraph || !STATE.pathGraph.edges) return null;
  const tubeHeight = settings.pulseWaveTubeHeight || 0.15;
  const tubeRadius = tubeHeight * 0.4;
  const glowScale = settings.pulseWaveGlow || 3.0;
  const edges = STATE.pathGraph.edges;
  const segs = 6;

  const templateCore = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, segs, 1, true);
  const templateGlow = new THREE.CylinderGeometry(tubeRadius * glowScale, tubeRadius * glowScale, 1, segs, 1, true);
  templateCore.rotateX(Math.PI / 2);
  templateGlow.rotateX(Math.PI / 2);

  const vertsPerTube = templateCore.attributes.position.count;

  // Pre-calculate per-edge geometry data
  const edgeCenters = []; // {x, z} per edge
  const corePositions = [];
  const glowPositions = [];

  for (const edge of edges) {
    const dx = edge.x2 - edge.x1;
    const dz = edge.z2 - edge.z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);
    const centerX = (edge.x1 + edge.x2) / 2;
    const centerZ = (edge.z1 + edge.z2) / 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    edgeCenters.push({ x: centerX, z: centerZ });

    for (let v = 0; v < vertsPerTube; v++) {
      let lx = templateCore.attributes.position.getX(v);
      let ly = templateCore.attributes.position.getY(v);
      let lz = templateCore.attributes.position.getZ(v) * length;
      const rx = lx * cosA + lz * sinA;
      const rz = -lx * sinA + lz * cosA;
      corePositions.push(rx + centerX, ly + tubeHeight / 2, rz + centerZ);

      lx = templateGlow.attributes.position.getX(v);
      ly = templateGlow.attributes.position.getY(v);
      lz = templateGlow.attributes.position.getZ(v) * length;
      const grx = lx * cosA + lz * sinA;
      const grz = -lx * sinA + lz * cosA;
      glowPositions.push(grx + centerX, ly + tubeHeight / 2, grz + centerZ);
    }
  }

  // Build shared index buffer
  const templateIndex = templateCore.index.array;
  const indices = [];
  for (let e = 0; e < edges.length; e++) {
    const offset = e * vertsPerTube;
    for (let j = 0; j < templateIndex.length; j++) {
      indices.push(templateIndex[j] + offset);
    }
  }

  templateCore.dispose();
  templateGlow.dispose();

  return {
    corePositions: new Float32Array(corePositions),
    glowPositions: new Float32Array(glowPositions),
    indices,
    edgeCenters,
    vertsPerTube,
    edgeCount: edges.length
  };
}

function getTubeCache(STATE, settings) {
  if (!_tubeCache) _tubeCache = buildTubeCache(STATE, settings);
  return _tubeCache;
}

// Shared flash + particle geometry (created once, reused)
let _sharedFlashGeo = null;

// Soft radial-gradient sprite shared by all particle bursts — turns the default
// hard-edged PointsMaterial squares into soft additive sparks. Built once.
let _particleSprite = null;
function getParticleSprite() {
  if (_particleSprite) return _particleSprite;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _particleSprite = new THREE.CanvasTexture(c);
  return _particleSprite;
}

export function createCaptureEffect(position, chaserColor, billboard, scene, settings, STATE) {
  if (!settings.pulseWaveEnabled) return;

  const color = new THREE.Color(chaserColor);
  const originX = position.x;
  const originZ = position.z;

  let coreMesh = null, glowMesh = null;
  let coreGeo = null, glowGeo = null;
  let coreMat = null, glowMat = null;
  let edgeDistances = [];
  let vertsPerTube = 0;

  const cache = getTubeCache(STATE, settings);
  if (cache) {
    // Compute per-edge distances from this capture origin
    for (let e = 0; e < cache.edgeCount; e++) {
      const ec = cache.edgeCenters[e];
      edgeDistances.push(Math.sqrt((ec.x - originX) ** 2 + (ec.z - originZ) ** 2));
    }
    vertsPerTube = cache.vertsPerTube;

    // Reuse shared position/index data, only create fresh alpha attributes
    const totalVerts = cache.edgeCount * vertsPerTube;

    coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.Float32BufferAttribute(cache.corePositions, 3));
    coreGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(totalVerts), 1));
    coreGeo.setIndex(cache.indices);

    glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(cache.glowPositions, 3));
    glowGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(totalVerts), 1));
    glowGeo.setIndex(cache.indices);

    const shaderVert = `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const shaderFrag = `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uOpacity);
      }
    `;

    coreMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 1.0 } },
      vertexShader: shaderVert, fragmentShader: shaderFrag,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    glowMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 1.0 } },
      vertexShader: shaderVert, fragmentShader: shaderFrag,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    glowMesh = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glowMesh);
  }

  // Create particle burst from billboard position
  const particleCount = settings.pulseWaveParticles ? 60 : 0;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleVelocities = [];
  const particleColors = new Float32Array(particleCount * 3);

  // Keep the burst hugging the road: spawn right at the actor (cars are only
  // ~0.2 units tall on this board) instead of floating 0.3 above it.
  const billboardPos = position.clone();
  billboardPos.y = position.y + 0.05;

  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = billboardPos.x + (Math.random() - 0.5) * 0.3;
    particlePositions[i * 3 + 1] = billboardPos.y + (Math.random() - 0.5) * 0.1;
    particlePositions[i * 3 + 2] = billboardPos.z + (Math.random() - 0.5) * 0.3;

    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 1.5 + 0.5;
    // Low pop, not a fountain — sparks spread along the street rather than
    // climbing to rooftop height
    const upSpeed = Math.random() * 0.7 + 0.2;
    particleVelocities.push({
      x: Math.cos(angle) * speed,
      y: upSpeed,
      z: Math.sin(angle) * speed
    });

    const t = Math.random();
    const brightness = 1 + Math.random() * 0.5;
    particleColors[i * 3] = Math.min(1, brightness * (1 * (1 - t) + color.r * t));
    particleColors[i * 3 + 1] = Math.min(1, brightness * (1 * (1 - t) + color.g * t));
    particleColors[i * 3 + 2] = Math.min(1, brightness * (1 * (1 - t) + color.b * t));
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 0.25, vertexColors: true, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    map: getParticleSprite()
  });

  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Flash at capture point (reuse shared geometry)
  let flash = null;
  let flashMat = null;
  if (settings.pulseWaveFlash !== false) {
    if (!_sharedFlashGeo) _sharedFlashGeo = new THREE.SphereGeometry(0.5, 16, 16);
    flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    flash = new THREE.Mesh(_sharedFlashGeo, flashMat);
    flash.position.copy(billboardPos);
    scene.add(flash);
  }

  captureEffects.push({
    coreMesh, glowMesh, coreGeo, glowGeo, coreMat, glowMat,
    edgeDistances, vertsPerTube,
    particles, particleMat, particleVelocities,
    flash, flashMat,
    originX, originZ,
    time: 0,
    duration: settings.pulseWaveDuration || 5.0,
    pulseSpeed: settings.pulseWaveSpeed || 3.5,
    pulseWidth: settings.pulseWaveWidth || 1.5,
    intensity: settings.pulseWaveIntensity || 0.8,
    easing: settings.pulseWaveEasing || "easeOut"
  });
}

// Easing functions for pulse wave
function applyEasing(t, easing) {
  switch (easing) {
    case "easeOut":
      return 1 - Math.pow(1 - t, 3); // Cubic ease out - starts fast, slows down
    case "easeIn":
      return Math.pow(t, 3); // Cubic ease in - starts slow, speeds up
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "linear":
    default:
      return t;
  }
}

export function updateCaptureEffects(dt, scene) {
  for (let i = captureEffects.length - 1; i >= 0; i--) {
    const effect = captureEffects[i];
    effect.time += dt;
    const t = effect.time / effect.duration;

    if (t >= 1) {
      // Remove effect — positions are cached, only dispose alpha + materials
      if (effect.coreMesh) { scene.remove(effect.coreMesh); effect.coreMat.dispose(); }
      if (effect.glowMesh) { scene.remove(effect.glowMesh); effect.glowMat.dispose(); }
      if (effect.coreGeo) { effect.coreGeo.deleteAttribute('alpha'); effect.coreGeo.dispose(); }
      if (effect.glowGeo) { effect.glowGeo.deleteAttribute('alpha'); effect.glowGeo.dispose(); }
      scene.remove(effect.particles);
      effect.particles.geometry.dispose();
      effect.particleMat.dispose();
      if (effect.flash) {
        scene.remove(effect.flash);
        effect.flashMat.dispose();
      }
      captureEffects.splice(i, 1);
      continue;
    }

    // Apply easing to the animation progress
    const easedT = applyEasing(t, effect.easing);
    const maxRadius = effect.pulseSpeed * effect.duration;
    const pulseRadius = easedT * maxRadius;
    const fadeOut = t > 0.7 ? (t - 0.7) / 0.3 : 0;

    // Update per-vertex alpha on the batched meshes
    if (effect.coreGeo && effect.edgeDistances.length > 0) {
      const coreAlphas = effect.coreGeo.attributes.alpha.array;
      const glowAlphas = effect.glowGeo.attributes.alpha.array;
      const vpte = effect.vertsPerTube;

      for (let e = 0; e < effect.edgeDistances.length; e++) {
        const distFromPulse = Math.abs(effect.edgeDistances[e] - pulseRadius);
        let coreA = 0, glowA = 0;
        if (distFromPulse < effect.pulseWidth) {
          const normalizedDist = distFromPulse / effect.pulseWidth;
          const smoothFalloff = Math.exp(-normalizedDist * normalizedDist * 4);
          const opacity = smoothFalloff * effect.intensity * (1 - fadeOut);
          coreA = Math.min(1, opacity);
          glowA = Math.min(0.4, opacity * 0.4);
        }
        const base = e * vpte;
        for (let v = 0; v < vpte; v++) {
          coreAlphas[base + v] = coreA;
          glowAlphas[base + v] = glowA;
        }
      }
      effect.coreGeo.attributes.alpha.needsUpdate = true;
      effect.glowGeo.attributes.alpha.needsUpdate = true;
    }

    // Animate particles with physics
    const positions = effect.particles.geometry.attributes.position.array;
    for (let j = 0; j < effect.particleVelocities.length; j++) {
      const vel = effect.particleVelocities[j];
      positions[j * 3] += vel.x * dt;
      positions[j * 3 + 1] += vel.y * dt;
      positions[j * 3 + 2] += vel.z * dt;
      // Light gravity
      vel.y -= 3 * dt;
      // Strong air resistance to keep particles close
      vel.x *= 0.95;
      vel.y *= 0.97;
      vel.z *= 0.95;
    }
    effect.particles.geometry.attributes.position.needsUpdate = true;
    effect.particleMat.opacity = Math.max(0, 1 - t * 1.2);
    effect.particleMat.size = 0.25 * (1 - t * 0.3);

    // Animate flash - quick bright flash that fades. Squashed vertically so it
    // reads as a burst on the road, not a ball floating above it.
    if (effect.flash) {
      const flashT = Math.min(1, effect.time * 5);
      effect.flashMat.opacity = Math.max(0, 1 - flashT);
      const fs = 1 + flashT * 2;
      effect.flash.scale.set(fs, fs * 0.35, fs);
    }
  }
}

export function clearCaptureEffects(scene) {
  for (const effect of captureEffects) {
    if (effect.coreMesh) { scene.remove(effect.coreMesh); effect.coreMat.dispose(); }
    if (effect.glowMesh) { scene.remove(effect.glowMesh); effect.glowMat.dispose(); }
    if (effect.coreGeo) { effect.coreGeo.deleteAttribute('alpha'); effect.coreGeo.dispose(); }
    if (effect.glowGeo) { effect.glowGeo.deleteAttribute('alpha'); effect.glowGeo.dispose(); }
    scene.remove(effect.particles);
    effect.particles.geometry.dispose();
    effect.particleMat.dispose();
    if (effect.flash) {
      scene.remove(effect.flash);
      // Don't dispose flash geometry — it's shared (_sharedFlashGeo)
      effect.flashMat.dispose();
    }
  }
  captureEffects.length = 0;
}

export function resetTubeCache() {
  _tubeCache = null;
}
