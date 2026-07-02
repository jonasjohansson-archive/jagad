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

// --- Follow cams: ride a chaser (car) or the helicopter ---------------------
let _viewMode = "top"; // "top" | "car" | "heli"
let _carMode = "onboard"; // "onboard" (FPS) | "chase"
let _followInit = false;
let _savedNear = null;
let _topSaved = null; // camera snapshot to restore when jumping back to Top
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
  if (on) setCameraView("top"); // follow cams yield to free orbit
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

// Jump between the three views: "top" (the game's normal framing, restored
// from a snapshot), "car" (ride a chaser) and "heli" (hang off the helicopter).
export function setCameraView(mode) {
  if (!_camera) return;
  const m = mode === "car" || mode === "heli" ? mode : "top";
  if (m === _viewMode) return;
  if (_viewMode === "top") {
    // Leaving top: remember exactly where the game camera was
    _topSaved = {
      p: _camera.position.clone(),
      q: _camera.quaternion.clone(),
      near: _camera.near,
      fov: _camera.fov,
    };
  }
  _viewMode = m;
  _followInit = false;
  if (m === "top") {
    if (_topSaved) {
      _camera.position.copy(_topSaved.p);
      _camera.quaternion.copy(_topSaved.q);
      _camera.near = _topSaved.near;
      _camera.fov = _topSaved.fov;
      _camera.updateProjectionMatrix();
    }
    _savedNear = null;
  } else {
    if (_controls) _controls.enabled = false;
    _enabled = false; // orbit yields to follow cams
    // Drop the near plane so close geometry (streets/buildings right in
    // front) isn't clipped in first-person.
    if (_savedNear == null) _savedNear = _camera.near;
    _camera.near = 0.05;
    _camera.updateProjectionMatrix();
  }
}

export function getCameraView() { return _viewMode; }
export function setCarCam(on) { setCameraView(on ? "car" : "top"); }
export function setCarMode(mode) { _carMode = mode === "chase" ? "chase" : "onboard"; }
export function isCarCamEnabled() { return _viewMode === "car"; }
export function isHeliCamEnabled() { return _viewMode === "heli"; }

// Onboard camera height as a fraction of scene scale — adjustable live so you
// can sit lower ("in the car") or a touch higher.
let _onboardUp = 0.02;
export function nudgeCarHeight(delta) {
  _onboardUp = Math.max(0.004, Math.min(0.12, _onboardUp + delta));
  return _onboardUp;
}

// Shared smoothing for the follow cams
function applyFollow(posLerp, lookLerp) {
  if (!_followInit) {
    _camPos.copy(_tmpPos);
    _lookPos.copy(_tmpLook);
    _followInit = true;
  } else {
    _camPos.lerp(_tmpPos, posLerp);
    _lookPos.lerp(_tmpLook, lookLerp);
  }
  _camera.position.copy(_camPos);
  _camera.lookAt(_lookPos);
}

// Drive the camera from a car's position + forward (normalised travel dir).
// scale ~ the level's horizontalSize so offsets fit whatever the board scale is.
export function updateCarCam(pos, fwdX, fwdZ, scale) {
  if (_viewMode !== "car" || !_camera) return;
  const s = scale > 0.01 ? scale : 6;
  const chase = _carMode === "chase";
  const up = s * (chase ? 0.12 : _onboardUp);
  const back = s * (chase ? 0.18 : 0.006);
  const ahead = s * (chase ? 0.15 : 0.30);

  _tmpPos.set(pos.x - fwdX * back, pos.y + up, pos.z - fwdZ * back);
  _tmpLook.set(pos.x + fwdX * ahead, pos.y + up * 0.4, pos.z + fwdZ * ahead);
  applyFollow(0.15, 0.20);
}

// Hang the camera just under the helicopter's nose, looking ahead and down at
// the streets — the surveillance view of the chase.
export function updateHeliCam(pos, fwdX, fwdZ, scale, groundY = 0) {
  if (_viewMode !== "heli" || !_camera) return;
  const s = scale > 0.01 ? scale : 6;
  const ahead = s * 0.22;

  _tmpPos.set(pos.x + fwdX * s * 0.02, pos.y - s * 0.012, pos.z + fwdZ * s * 0.02);
  _tmpLook.set(pos.x + fwdX * ahead, groundY, pos.z + fwdZ * ahead);
  // Heli drifts smoothly already; softer lerps keep the sway cinematic
  applyFollow(0.10, 0.08);
}
