// Capture camera — free orbit + saved view presets, for framing footage.
// Active only in capture mode so it never affects normal play. Binds
// OrbitControls to the perspective camera; views (position/target/fov) persist
// in localStorage so you can recall favourite angles.

import * as THREE from "../lib/three/three.module.js";
import { OrbitControls } from "../lib/three/addons/controls/OrbitControls.js";

const VIEWS_KEY = "jagadCaptureViews";

let _controls = null;
let _camera = null;
let _getCenter = null;
let _enabled = false;

// --- Car cam: ride a chaser, look along its direction of travel -------------
let _carCam = false;
let _carMode = "onboard"; // "onboard" (FPS) | "chase"
let _carCamInit = false;
let _savedNear = null;
const _camPos = new THREE.Vector3();
const _lookPos = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _tmpLook = new THREE.Vector3();

export function initCaptureCamera({ camera, renderer, getLevelCenter }) {
  _camera = camera;
  _getCenter = getLevelCenter;
  _controls = new OrbitControls(camera, renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.rotateSpeed = 0.7;
  _controls.zoomSpeed = 0.9;
  _controls.enablePan = true;
  _controls.enabled = false;
  const c = _getCenter && _getCenter();
  if (c) _controls.target.set(c.x, c.y, c.z);
  _controls.update();
}

export function setOrbitEnabled(on) {
  if (!_controls) return;
  _enabled = !!on;
  _controls.enabled = _enabled;
  if (_enabled) {
    if (!_pointAtTargetDone) {
      const c = _getCenter && _getCenter();
      if (c) _controls.target.set(c.x, c.y, c.z);
      _pointAtTargetDone = true;
    }
    _controls.update();
  }
}
let _pointAtTargetDone = false;

export function isOrbitEnabled() {
  return _enabled;
}

export function updateCaptureCamera() {
  if (_enabled && _controls) _controls.update();
}

export function listViews() {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); }
  catch (e) { return []; }
}

export function saveView() {
  if (!_camera || !_controls) return 0;
  const views = listViews();
  views.push({
    p: _camera.position.toArray(),
    t: _controls.target.toArray(),
    fov: _camera.fov,
  });
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  return views.length;
}

export function recallView(index) {
  const views = listViews();
  const v = views[index];
  if (!v || !_camera || !_controls) return false;
  _camera.position.fromArray(v.p);
  _controls.target.fromArray(v.t);
  if (v.fov) { _camera.fov = v.fov; _camera.updateProjectionMatrix(); }
  _controls.update();
  return true;
}

export function deleteView(index) {
  const views = listViews();
  if (index < 0 || index >= views.length) return;
  views.splice(index, 1);
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

export function setCarCam(on) {
  _carCam = !!on;
  if (!_camera) return;
  if (_carCam) {
    if (_controls) _controls.enabled = false;
    _enabled = false; // orbit yields to car cam
    // Drop the near plane so close geometry (the street/buildings right in
    // front) isn't clipped in the first-person view.
    if (_savedNear == null) _savedNear = _camera.near;
    _camera.near = 0.05;
    _camera.updateProjectionMatrix();
    _carCamInit = false;
  } else if (_savedNear != null) {
    _camera.near = _savedNear;
    _camera.updateProjectionMatrix();
    _savedNear = null;
  }
}

export function setCarMode(mode) { _carMode = mode === "chase" ? "chase" : "onboard"; }
export function isCarCamEnabled() { return _carCam; }

// Drive the camera from a car's position + forward (normalised travel dir).
// scale ~ the level's horizontalSize so offsets fit whatever the board scale is.
export function updateCarCam(pos, fwdX, fwdZ, scale) {
  if (!_carCam || !_camera) return;
  const s = scale > 0.01 ? scale : 6;
  const up = s * (_carMode === "chase" ? 0.12 : 0.045);
  const back = s * (_carMode === "chase" ? 0.18 : 0.03);
  const ahead = s * (_carMode === "chase" ? 0.15 : 0.30);

  _tmpPos.set(pos.x - fwdX * back, pos.y + up, pos.z - fwdZ * back);
  _tmpLook.set(pos.x + fwdX * ahead, pos.y + up * 0.4, pos.z + fwdZ * ahead);

  if (!_carCamInit) {
    _camPos.copy(_tmpPos);
    _lookPos.copy(_tmpLook);
    _carCamInit = true;
  } else {
    _camPos.lerp(_tmpPos, 0.15);   // smooth position
    _lookPos.lerp(_tmpLook, 0.20); // smooth aim through turns
  }
  _camera.position.copy(_camPos);
  _camera.lookAt(_lookPos);
}
