// Capture camera — free orbit + saved view presets, for framing footage.
// Active only in capture mode so it never affects normal play. Binds
// OrbitControls to the perspective camera; views (position/target/fov) persist
// in localStorage so you can recall favourite angles.

import { OrbitControls } from "../lib/three/addons/controls/OrbitControls.js";

const VIEWS_KEY = "jagadCaptureViews";

let _controls = null;
let _camera = null;
let _getCenter = null;
let _enabled = false;

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
