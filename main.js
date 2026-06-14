import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainRegion, bindTerrainPainting, bindTextureDrop } from 'metaverse-terrain';

const canvas = document.querySelector('#scene');
const heightStats = document.querySelector('#height-stats');
const heightmapPreview = document.querySelector('#heightmap-preview');
const regionSizeInput = document.querySelector('#region-size');
const brushSizeInput = document.querySelector('#brush-size');
const brushStrengthInput = document.querySelector('#brush-strength');
const waterEnabledInput = document.querySelector('#water-enabled');
const waterLevelInput = document.querySelector('#water-level');
const textureDensityInput = document.querySelector('#texture-density');
const hexTileRateInput = document.querySelector('#hex-tile-rate');
const hexTileContrastInput = document.querySelector('#hex-tile-contrast');
const sandMaxInput = document.querySelector('#sand-max');
const grassStartInput = document.querySelector('#grass-start');
const grassEndInput = document.querySelector('#grass-end');
const rockStartInput = document.querySelector('#rock-start');
const snowStartInput = document.querySelector('#snow-start');
const regionSizeValue = document.querySelector('#region-size-value');
const brushSizeValue = document.querySelector('#brush-size-value');
const brushStrengthValue = document.querySelector('#brush-strength-value');
const waterLevelValue = document.querySelector('#water-level-value');
const textureDensityValue = document.querySelector('#texture-density-value');
const hexTileRateValue = document.querySelector('#hex-tile-rate-value');
const hexTileContrastValue = document.querySelector('#hex-tile-contrast-value');
const sandMaxValue = document.querySelector('#sand-max-value');
const grassStartValue = document.querySelector('#grass-start-value');
const grassEndValue = document.querySelector('#grass-end-value');
const rockStartValue = document.querySelector('#rock-start-value');
const snowStartValue = document.querySelector('#snow-start-value');
const modeButtons = [...document.querySelectorAll('[data-mode]')];

const activeKeys = new Set();
const avatarControls = {
  moveSpeed: 38,
  verticalSpeed: 26,
  turnSpeed: 1.9,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7d5);
scene.fog = new THREE.Fog(0x9fb7d5, 260, 520);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
camera.position.set(132, 108, 168);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.maxDistance = 390;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.update();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const upAxis = new THREE.Vector3(0, 1, 0);
const movementForward = new THREE.Vector3();
const movementDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();

const terrain = new TerrainRegion({
  seed: 29,
  regionSize: Number(regionSizeInput.value),
  textureDensity: Number(textureDensityInput.value),
  onHeightmapChange: refreshHeightmapPreview,
});
scene.add(terrain.group);

const painting = bindTerrainPainting(terrain, {
  domElement: renderer.domElement,
  camera,
  raycaster,
  pointer,
  setControlsEnabled: (enabled) => {
    controls.enabled = enabled;
  },
});

bindPanel();
bindTextureDrop(terrain);
refreshHeightmapPreview();
resize();
renderer.setAnimationLoop(animate);

function bindPanel() {
  window.addEventListener('resize', resize);

  bindRange(regionSizeInput, regionSizeValue, (value) => {
    terrain.setRegionSize(value);
    return `${terrain.regionSize}m`;
  });

  bindRange(brushSizeInput, brushSizeValue, (value) => {
    terrain.setBrushRadius(value);
    return `${terrain.brush.radius}m`;
  });

  bindRange(brushStrengthInput, brushStrengthValue, (value) => {
    terrain.setBrushStrength(value);
    return `${terrain.brush.strength}`;
  });

  waterEnabledInput.addEventListener('change', () => {
    terrain.setWaterEnabled(waterEnabledInput.checked);
    syncWaterControls();
  });

  bindRange(waterLevelInput, waterLevelValue, (value) => {
    terrain.setWaterLevel(value);
    return `${terrain.waterLevel.toFixed(1)}m`;
  });

  syncWaterControls();

  bindRange(textureDensityInput, textureDensityValue, (value) => {
    terrain.setTextureDensity(value);
    return `${terrain.textureDensity}x`;
  });

  bindRange(hexTileRateInput, hexTileRateValue, (value) => {
    terrain.setHexTileRate(value);
    return `${terrain.hexTileRate.toFixed(2)}x`;
  });

  bindRange(hexTileContrastInput, hexTileContrastValue, (value) => {
    terrain.setHexTileContrast(value);
    return terrain.hexTileContrast.toFixed(2);
  });

  bindRange(sandMaxInput, sandMaxValue, (value) => {
    terrain.setTextureHeights({ sandMax: value });
    return `${value.toFixed(1)}m`;
  });

  bindRange(grassStartInput, grassStartValue, (value) => {
    terrain.setTextureHeights({ grassStart: value });
    return `${value.toFixed(1)}m`;
  });

  bindRange(grassEndInput, grassEndValue, (value) => {
    terrain.setTextureHeights({ grassEnd: value });
    return `${value.toFixed(1)}m`;
  });

  bindRange(rockStartInput, rockStartValue, (value) => {
    terrain.setTextureHeights({ rockStart: value });
    return `${value.toFixed(1)}m`;
  });

  bindRange(snowStartInput, snowStartValue, (value) => {
    terrain.setTextureHeights({ snowStart: value });
    return `${value.toFixed(1)}m`;
  });

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => setBrushMode(button.dataset.mode));
  });

  document.querySelector('#randomize').addEventListener('click', () => terrain.randomize());
  document.querySelector('#level').addEventListener('click', () => terrain.level(8));
  document.querySelector('#export-heightmap').addEventListener('click', () => terrain.downloadHeightmap());

  window.addEventListener('keydown', (event) => {
    if (isFormControl(event.target)) return;

    if (event.key === '1') setBrushMode('raise');
    if (event.key === '2') setBrushMode('lower');
    if (event.key === '3') setBrushMode('flatten');
    if (event.key === '[') syncBrushRadius(terrain.brush.radius - 1);
    if (event.key === ']') syncBrushRadius(terrain.brush.radius + 1);

    if (isMovementKey(event.code)) {
      activeKeys.add(event.code);
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    activeKeys.delete(event.code);
  });

  window.addEventListener('blur', () => {
    activeKeys.clear();
  });
}

function syncWaterControls() {
  const enabled = terrain.waterEnabled;
  waterLevelInput.disabled = !enabled;
  waterLevelInput.closest('.water-controls')?.classList.toggle('is-disabled', !enabled);
}

function bindRange(input, label, onInput) {
  input.addEventListener('input', () => {
    label.textContent = onInput(Number(input.value));
  });
}

function setBrushMode(mode) {
  terrain.setBrushMode(mode);
  modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
}

function syncBrushRadius(radius) {
  const value = terrain.clampBrushRadius(
    radius,
    Number(brushSizeInput.min),
    Number(brushSizeInput.max),
  );
  brushSizeInput.value = String(value);
  brushSizeValue.textContent = `${value}m`;
}

function refreshHeightmapPreview() {
  heightStats.textContent = terrain.drawHeightmapPreview(heightmapPreview);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  terrain.update(clock.elapsedTime);
  updateAvatarMovement(delta);
  controls.update();
  renderer.render(scene, camera);
}

function updateAvatarMovement(delta) {
  if (activeKeys.size === 0 || painting.isPainting) return;

  const forwardInput = getKeyAxis('KeyW', 'ArrowUp') - getKeyAxis('KeyS', 'ArrowDown');
  const turnInput = getKeyAxis('KeyA', 'ArrowLeft') - getKeyAxis('KeyD', 'ArrowRight');
  const verticalInput = getKeyAxis('KeyE', 'PageUp') - getKeyAxis('KeyQ', 'PageDown');

  if (turnInput !== 0) {
    cameraOffset.copy(controls.target).sub(camera.position);
    cameraOffset.applyAxisAngle(upAxis, turnInput * avatarControls.turnSpeed * delta);
    controls.target.copy(camera.position).add(cameraOffset);
  }

  movementDelta.set(0, 0, 0);

  if (forwardInput !== 0) {
    movementForward.copy(controls.target).sub(camera.position);
    movementForward.y = 0;

    if (movementForward.lengthSq() > 0.0001) {
      movementForward.normalize();
      movementDelta.addScaledVector(movementForward, forwardInput * avatarControls.moveSpeed * delta);
    }
  }

  if (verticalInput !== 0) {
    movementDelta.y += verticalInput * avatarControls.verticalSpeed * delta;
  }

  if (movementDelta.lengthSq() > 0) {
    camera.position.add(movementDelta);
    controls.target.add(movementDelta);
  }
}

function getKeyAxis(primaryCode, secondaryCode) {
  return activeKeys.has(primaryCode) || activeKeys.has(secondaryCode) ? 1 : 0;
}

function isMovementKey(code) {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'PageUp', 'PageDown'].includes(code);
}

function isFormControl(target) {
  return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
}