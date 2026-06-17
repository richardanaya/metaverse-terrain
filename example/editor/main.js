import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainRegion, bindTerrainPainting, bindTextureDrop, loadPBRTextureSet } from 'metaverse-terrain';
import { setupPBREnvironment } from '../shared/environment.js';
import { TEXTURE_URLS, PBR_TEXTURE_URLS } from '../shared/textures.js';

const canvas = document.querySelector('#scene');
const heightStats = document.querySelector('#height-stats');
const heightmapPreview = document.querySelector('#heightmap-preview');
const regionSizeInput = document.querySelector('#region-size');
const brushSizeInput = document.querySelector('#brush-size');
const brushStrengthInput = document.querySelector('#brush-strength');
const waterEnabledInput = document.querySelector('#water-enabled');
const refractionEnabledInput = document.querySelector('#refraction-enabled');
const layerSlider = document.querySelector('#layer-slider');
const layerGradient = layerSlider.querySelector('.layer-slider-gradient');
const layerHandles = [...layerSlider.querySelectorAll('.layer-handle')];
const textureDensityInput = document.querySelector('#texture-density');
const hexTileRateInput = document.querySelector('#hex-tile-rate');
const hexTileContrastInput = document.querySelector('#hex-tile-contrast');
const regionSizeValue = document.querySelector('#region-size-value');
const brushSizeValue = document.querySelector('#brush-size-value');
const brushStrengthValue = document.querySelector('#brush-strength-value');
const waterLevelValue = document.querySelector('#water-level-value');
const waterLayerValue = document.querySelector('#water-layer-value');
const textureDensityValue = document.querySelector('#texture-density-value');
const hexTileRateValue = document.querySelector('#hex-tile-rate-value');
const hexTileContrastValue = document.querySelector('#hex-tile-contrast-value');
const terrainAOIntensityInput = document.querySelector('#terrain-ao-intensity');
const terrainAOIntensityValue = document.querySelector('#terrain-ao-intensity-value');
const grassStartValue = document.querySelector('#grass-start-value');
const rockStartValue = document.querySelector('#rock-start-value');
const snowStartValue = document.querySelector('#snow-start-value');
const sunAzimuthInput = document.querySelector('#sun-azimuth');
const sunElevationInput = document.querySelector('#sun-elevation');
const sunAzimuthValue = document.querySelector('#sun-azimuth-value');
const sunElevationValue = document.querySelector('#sun-elevation-value');
const windDirectionInput = document.querySelector('#wind-direction');
const windSpeedInput = document.querySelector('#wind-speed');
const windDirectionValue = document.querySelector('#wind-direction-value');
const windSpeedValue = document.querySelector('#wind-speed-value');
const modeButtons = [...document.querySelectorAll('[data-mode]')];

const LAYER_ORDER = ['water', 'grass', 'rock', 'snow'];
const LAYER_GAP = 1;
const layerRange = {
  min: Number(layerSlider.dataset.min),
  max: Number(layerSlider.dataset.max),
};
const layerHeights = {
  water: Number(layerSlider.dataset.water),
  grass: Number(layerSlider.dataset.grass),
  rock: Number(layerSlider.dataset.rock),
  snow: Number(layerSlider.dataset.snow),
};

const activeKeys = new Set();
const avatarControls = {
  moveSpeed: 38,
  verticalSpeed: 26,
  turnSpeed: 1.9,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7d5);
scene.fog = new THREE.Fog(0xb8c4d8, 360, 720);

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

const environmentReady = setupPBREnvironment(scene, renderer, { shadows: true });

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

let terrain, painting, sunLight;

async function init() {
  // Load and pack PBR textures while the HDRI environment initializes.
  const [pbrTextures, envResult] = await Promise.all([
    loadPBRTextureSet(PBR_TEXTURE_URLS),
    environmentReady,
  ]);
  sunLight = envResult.sunLight;
  
  terrain = new TerrainRegion({
    seed: 29,
    regionSize: Number(regionSizeInput.value),
    waterLevel: layerHeights.water,
    terrainAOIntensity: Number(terrainAOIntensityInput.value),
    textureDensity: Number(textureDensityInput.value),
    textureHeights: getTextureHeightsFromLayerSlider(),
    textures: TEXTURE_URLS,
    pbrTextures,
    normalStrength: 1.0,
    environment: envResult.envMap,
    onHeightmapChange: refreshHeightmapPreview,
  });
  scene.add(terrain.group);

  painting = bindTerrainPainting(terrain, {
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
}

init().catch(console.error);

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

  refractionEnabledInput.addEventListener('change', () => {
    terrain.setRefractionEnabled(refractionEnabledInput.checked);
  });

  bindLayerSlider();
  syncLayerSlider();
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

  bindRange(terrainAOIntensityInput, terrainAOIntensityValue, (value) => {
    terrain.setTerrainAOIntensity(value);
    return `${Math.round(value * 100)}%`;
  });

  bindRange(sunAzimuthInput, sunAzimuthValue, (value) => {
    updateSunPosition(value, Number(sunElevationInput.value));
    return `${value}°`;
  });

  bindRange(sunElevationInput, sunElevationValue, (value) => {
    updateSunPosition(Number(sunAzimuthInput.value), value);
    return `${value}°`;
  });

  updateSunPosition(Number(sunAzimuthInput.value), Number(sunElevationInput.value));

  bindRange(windDirectionInput, windDirectionValue, (value) => {
    const rad = THREE.MathUtils.degToRad(value);
    terrain.setWindDirection([Math.cos(rad), Math.sin(rad)]);
    return `${value}°`;
  });

  bindRange(windSpeedInput, windSpeedValue, (value) => {
    terrain.setWindSpeed(value);
    return value.toFixed(1);
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
  waterEnabledInput.closest('.water-controls')?.classList.toggle('is-disabled', !enabled);
  layerSlider.classList.toggle('water-disabled', !enabled);
  refractionEnabledInput.disabled = !enabled;
}

function updateSunPosition(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  const direction = new THREE.Vector3(
    cosEl * Math.cos(az),
    Math.sin(el),
    cosEl * Math.sin(az),
  );

  if (sunLight) {
    sunLight.position.copy(direction).multiplyScalar(200);
  }

  terrain.setSunDirection(direction);
}

function getTextureHeightsFromLayerSlider() {
  return {
    sandMax: layerHeights.grass,
    grassStart: layerHeights.grass,
    grassEnd: layerHeights.rock,
    rockStart: layerHeights.rock,
    snowStart: layerHeights.snow,
  };
}

function heightToPercent(value) {
  return ((value - layerRange.min) / (layerRange.max - layerRange.min)) * 100;
}

function heightFromPointer(clientX) {
  const rect = layerSlider.querySelector('.layer-slider-track').getBoundingClientRect();
  const t = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
  const raw = layerRange.min + t * (layerRange.max - layerRange.min);
  return Math.round(raw * 2) / 2;
}

function clampLayerHeight(layer, value) {
  const index = LAYER_ORDER.indexOf(layer);
  const previous = LAYER_ORDER[index - 1];
  const next = LAYER_ORDER[index + 1];
  const min = previous ? layerHeights[previous] + LAYER_GAP : layerRange.min;
  const max = next ? layerHeights[next] - LAYER_GAP : layerRange.max;
  return THREE.MathUtils.clamp(value, min, max);
}

function applyLayerHeights() {
  terrain.setWaterLevel(layerHeights.water);
  terrain.setTextureHeights(getTextureHeightsFromLayerSlider());
  syncLayerSlider();
}

function syncLayerSlider() {
  for (const handle of layerHandles) {
    const layer = handle.dataset.layer;
    const value = layerHeights[layer];
    handle.style.left = `${heightToPercent(value)}%`;
    handle.setAttribute('aria-valuemin', String(layerRange.min));
    handle.setAttribute('aria-valuemax', String(layerRange.max));
    handle.setAttribute('aria-valuenow', value.toFixed(1));
  }

  const waterPct = heightToPercent(layerHeights.water);
  const grassPct = heightToPercent(layerHeights.grass);
  const rockPct = heightToPercent(layerHeights.rock);
  const snowPct = heightToPercent(layerHeights.snow);
  layerGradient.style.background = `linear-gradient(90deg,
    #1f8aa5 0%, #1f8aa5 ${waterPct}%,
    #d8c995 ${waterPct}%, #d8c995 ${grassPct}%,
    #6d8b35 ${grassPct}%, #6d8b35 ${rockPct}%,
    #8c928f ${rockPct}%, #8c928f ${snowPct}%,
    #f2f5f4 ${snowPct}%, #f2f5f4 100%)`;

  waterLevelValue.textContent = `${layerHeights.water.toFixed(1)}m`;
  waterLayerValue.textContent = `${layerHeights.water.toFixed(1)}m`;
  grassStartValue.textContent = `${layerHeights.grass.toFixed(1)}m`;
  rockStartValue.textContent = `${layerHeights.rock.toFixed(1)}m`;
  snowStartValue.textContent = `${layerHeights.snow.toFixed(1)}m`;
}

function bindLayerSlider() {
  const moveLayer = (layer, clientX) => {
    layerHeights[layer] = clampLayerHeight(layer, heightFromPointer(clientX));
    applyLayerHeights();
  };

  for (const handle of layerHandles) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      moveLayer(handle.dataset.layer, event.clientX);
    });

    handle.addEventListener('pointermove', (event) => {
      if (handle.hasPointerCapture(event.pointerId)) {
        moveLayer(handle.dataset.layer, event.clientX);
      }
    });

    handle.addEventListener('keydown', (event) => {
      const layer = handle.dataset.layer;
      const step = event.shiftKey ? 2 : 0.5;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        layerHeights[layer] = clampLayerHeight(layer, layerHeights[layer] - step);
        applyLayerHeights();
        event.preventDefault();
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        layerHeights[layer] = clampLayerHeight(layer, layerHeights[layer] + step);
        applyLayerHeights();
        event.preventDefault();
      }
    });
  }
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