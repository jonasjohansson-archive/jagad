// Post-processing — EffectComposer setup and updates
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { EffectComposer } from "../lib/three/addons/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "../lib/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../lib/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "../lib/three/addons/postprocessing/ShaderPass.js";
import { SelectivePixelPass } from "../lib/three/addons/postprocessing/SelectivePixelPass.js";
import { FXAAPass } from "../lib/three/addons/postprocessing/FXAAPass.js";
import { CyberpunkShader } from "./shader.js";

export function initPostProcessing(renderer, scene, camera, settings, LAYERS) {
  // Antialiasing via a single cheap FXAA post pass (added below) rather than
  // hardware MSAA on the HalfFloat composer target — 4x MSAA on a retina-sized
  // float buffer was far too expensive and tanked the framerate.
  const composer = new EffectComposer(renderer);

  // Selective pixel pass - renders GLB models with pixelation, other elements normally
  const selectivePixelPass = new SelectivePixelPass(
    settings.pixelationSize || 4,
    scene,
    camera,
    {
      normalEdgeStrength: settings.pixelationNormalEdge || 0.3,
      depthEdgeStrength: settings.pixelationDepthEdge || 0.4,
      glbLayer: LAYERS.GLB_MODELS,
      pixelationEnabled: settings.pixelationEnabled
    }
  );
  composer.addPass(selectivePixelPass);

  // Bloom pass
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    settings.bloomStrength,
    settings.bloomRadius,
    settings.bloomThreshold
  );
  bloomPass.enabled = settings.bloomEnabled;
  composer.addPass(bloomPass);

  // Cyberpunk shader pass (vignette, chromatic aberration, color grading)
  const cyberpunkPass = new ShaderPass(CyberpunkShader);
  cyberpunkPass.uniforms['vignetteIntensity'].value = settings.vignetteEnabled ? settings.vignetteIntensity : 0;
  cyberpunkPass.uniforms['chromaticAberration'].value = 0;
  cyberpunkPass.uniforms['tintColor'].value.set("#ffffff");
  cyberpunkPass.uniforms['tintIntensity'].value = 0;
  cyberpunkPass.uniforms['saturation'].value = settings.colorGradingEnabled ? settings.colorGradingSaturation : 1.0;
  cyberpunkPass.uniforms['contrast'].value = settings.colorGradingEnabled ? settings.colorGradingContrast : 1.0;
  cyberpunkPass.uniforms['brightness'].value = settings.colorGradingEnabled ? settings.colorGradingBrightness : 1.0;
  cyberpunkPass.uniforms['gain'].value.set(
    settings.colorGradingEnabled ? settings.colorGradingGainR : 1,
    settings.colorGradingEnabled ? settings.colorGradingGainG : 1,
    settings.colorGradingEnabled ? settings.colorGradingGainB : 1
  );
  cyberpunkPass.uniforms['lift'].value.set(
    settings.colorGradingEnabled ? settings.colorGradingLiftR : 0,
    settings.colorGradingEnabled ? settings.colorGradingLiftG : 0,
    settings.colorGradingEnabled ? settings.colorGradingLiftB : 0
  );
  cyberpunkPass.uniforms['gamma'].value = settings.colorGradingEnabled ? settings.colorGradingGamma : 1.0;

  // Output pass: tone mapping + sRGB encode. Must run BEFORE the grading pass so
  // that vignette / contrast (0.5 pivot) / Rec.709 saturation operate on
  // display-referred [0,1] sRGB data rather than linear HDR (where that math is
  // invalid and over-saturates / clips).
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Cyberpunk grading pass, on tone-mapped sRGB pixels.
  composer.addPass(cyberpunkPass);

  // FXAA last — needs sRGB input (so after OutputPass) and antialiases the final
  // composited image. Cheap single pass; disabled when pixelation is on so it
  // doesn't soften the pixel-art look.
  const fxaaPass = new FXAAPass();
  fxaaPass.enabled = !settings.pixelationEnabled;
  composer.addPass(fxaaPass);

  // Store references for updates
  composer.bloomPass = bloomPass;
  composer.cyberpunkPass = cyberpunkPass;
  composer.selectivePixelPass = selectivePixelPass;
  composer.fxaaPass = fxaaPass;

  return composer;
}

export function updatePostProcessing(composer, scene, settings) {
  if (!composer) return;

  if (composer.bloomPass) {
    composer.bloomPass.enabled = settings.bloomEnabled;
    composer.bloomPass.threshold = settings.bloomThreshold;
    composer.bloomPass.strength = settings.bloomStrength;
    composer.bloomPass.radius = settings.bloomRadius;
  }

  if (composer.cyberpunkPass) {
    composer.cyberpunkPass.uniforms['vignetteIntensity'].value = settings.vignetteEnabled ? settings.vignetteIntensity : 0;
    composer.cyberpunkPass.uniforms['chromaticAberration'].value = 0;
    composer.cyberpunkPass.uniforms['tintColor'].value.set("#ffffff");
    composer.cyberpunkPass.uniforms['tintIntensity'].value = 0;
    composer.cyberpunkPass.uniforms['saturation'].value = settings.colorGradingEnabled ? settings.colorGradingSaturation : 1.0;
    composer.cyberpunkPass.uniforms['contrast'].value = settings.colorGradingEnabled ? settings.colorGradingContrast : 1.0;
    composer.cyberpunkPass.uniforms['brightness'].value = settings.colorGradingEnabled ? settings.colorGradingBrightness : 1.0;
    const en = settings.colorGradingEnabled;
    composer.cyberpunkPass.uniforms['gain'].value.set(
      en ? settings.colorGradingGainR : 1, en ? settings.colorGradingGainG : 1, en ? settings.colorGradingGainB : 1
    );
    composer.cyberpunkPass.uniforms['lift'].value.set(
      en ? settings.colorGradingLiftR : 0, en ? settings.colorGradingLiftG : 0, en ? settings.colorGradingLiftB : 0
    );
    composer.cyberpunkPass.uniforms['gamma'].value = en ? settings.colorGradingGamma : 1.0;
  }

  // FXAA off when pixelation is on (keep hard pixel edges)
  if (composer.fxaaPass) {
    composer.fxaaPass.enabled = !settings.pixelationEnabled;
  }

  // Update selective pixelation
  if (composer.selectivePixelPass) {
    composer.selectivePixelPass.pixelationEnabled = settings.pixelationEnabled;
    composer.selectivePixelPass.setPixelSize(settings.pixelationSize || 4);
    composer.selectivePixelPass.normalEdgeStrength = settings.pixelationNormalEdge || 0.3;
    composer.selectivePixelPass.depthEdgeStrength = settings.pixelationDepthEdge || 0.4;
  }

  // Update fog
  if (settings.fogEnabled) {
    if (!scene.fog) {
      scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    }
    scene.fog.color.set(settings.fogColor);
    scene.fog.near = settings.fogNear;
    scene.fog.far = settings.fogFar;
  } else {
    scene.fog = null;
  }
}
