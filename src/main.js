import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const REGION_SIZE = 256;
const SAMPLES = 256;
const HALF_REGION = REGION_SIZE / 2;
const MIN_HEIGHT = -12;
const MAX_HEIGHT = 52;
const DEFAULT_WATER_LEVEL = 2.5;

const canvas = document.querySelector('#scene');
const heightStats = document.querySelector('#height-stats');
const heightmapPreview = document.querySelector('#heightmap-preview');
const brushSizeInput = document.querySelector('#brush-size');
const brushStrengthInput = document.querySelector('#brush-strength');
const waterLevelInput = document.querySelector('#water-level');
const textureDensityInput = document.querySelector('#texture-density');
const brushSizeValue = document.querySelector('#brush-size-value');
const brushStrengthValue = document.querySelector('#brush-strength-value');
const waterLevelValue = document.querySelector('#water-level-value');
const textureDensityValue = document.querySelector('#texture-density-value');
const modeButtons = [...document.querySelectorAll('[data-mode]')];

const heightMap = new Float32Array(SAMPLES * SAMPLES);
const brush = {
  mode: 'raise',
  radius: Number(brushSizeInput.value),
  strength: Number(brushStrengthInput.value),
  flattenHeight: null,
};
let textureDensity = Number(textureDensityInput.value);
const activeKeys = new Set();
const avatarControls = {
  moveSpeed: 38,
  verticalSpeed: 26,
  turnSpeed: 1.9,
};

let isPainting = false;
let waterLevel = DEFAULT_WATER_LEVEL;
let terrainMesh;
let waterMesh;
let boundaryFrame;
let brushCursor;

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
const textureLoader = new THREE.TextureLoader();
const sunDirection = new THREE.Vector3(0.45, 0.86, 0.24).normalize();
const clock = new THREE.Clock();
const upAxis = new THREE.Vector3(0, 1, 0);
const movementForward = new THREE.Vector3();
const movementDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();

initialize();

function initialize() {
  generateHeightMap(29);
  terrainMesh = createTerrainMesh();
  scene.add(terrainMesh);

  waterMesh = createWaterPlane();
  scene.add(waterMesh);
  boundaryFrame = createBoundaryFrame();
  scene.add(boundaryFrame);
  brushCursor = createBrushCursor();
  scene.add(brushCursor);

  bindUi();
  updateHeightmapPreview();
  resize();
  renderer.setAnimationLoop(animate);
}

function generateHeightMap(seed) {
  const noise = createValueNoise(seed);

  for (let z = 0; z < SAMPLES; z += 1) {
    for (let x = 0; x < SAMPLES; x += 1) {
      const nx = x / (SAMPLES - 1) - 0.5;
      const nz = z / (SAMPLES - 1) - 0.5;
      const distanceFromCenter = Math.sqrt(nx * nx + nz * nz) / 0.707;
      const edgeDrop = smoothstep(0.7, 1, distanceFromCenter) * 12;
      const broad = noise.fbm(x * 0.012, z * 0.012, 5);
      const ridges = Math.abs(noise.fbm(x * 0.032 + 41, z * 0.032 - 17, 4) - 0.5) * 2;
      const detail = noise.fbm(x * 0.09 - 22, z * 0.09 + 13, 3);
      const height = 9 + broad * 28 + ridges * 9 + detail * 3 - edgeDrop;

      heightMap[indexFor(x, z)] = clamp(height, MIN_HEIGHT, MAX_HEIGHT);
    }
  }
}

function createTerrainMesh() {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = SAMPLES * SAMPLES;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((SAMPLES - 1) * (SAMPLES - 1) * 6);
  const step = REGION_SIZE / (SAMPLES - 1);

  for (let z = 0; z < SAMPLES; z += 1) {
    for (let x = 0; x < SAMPLES; x += 1) {
      const index = indexFor(x, z);
      const positionIndex = index * 3;
      const uvIndex = index * 2;

      positions[positionIndex] = x * step - HALF_REGION;
      positions[positionIndex + 1] = heightMap[index];
      positions[positionIndex + 2] = z * step - HALF_REGION;
      uvs[uvIndex] = x / (SAMPLES - 1);
      uvs[uvIndex + 1] = z / (SAMPLES - 1);
    }
  }

  let indexPointer = 0;
  for (let z = 0; z < SAMPLES - 1; z += 1) {
    for (let x = 0; x < SAMPLES - 1; x += 1) {
      const a = indexFor(x, z);
      const b = indexFor(x + 1, z);
      const c = indexFor(x, z + 1);
      const d = indexFor(x + 1, z + 1);

      indices[indexPointer] = a;
      indices[indexPointer + 1] = c;
      indices[indexPointer + 2] = b;
      indices[indexPointer + 3] = b;
      indices[indexPointer + 4] = c;
      indices[indexPointer + 5] = d;
      indexPointer += 6;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, createTerrainMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function createTerrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSand: { value: loadTerrainTexture('/textures/terrain-sand.png') },
      uGrass: { value: loadTerrainTexture('/textures/terrain-grass.png') },
      uRock: { value: loadTerrainTexture('/textures/terrain-rock.png') },
      uSnow: { value: loadTerrainTexture('/textures/terrain-snow.png') },
      uMinHeight: { value: MIN_HEIGHT },
      uMaxHeight: { value: MAX_HEIGHT },
      uTextureScale: { value: textureDensity },
      uSunDirection: { value: sunDirection },
      uWaterLevel: { value: waterLevel },
    },
    vertexShader: `
      varying vec2 vUv;
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vHeight = position.y;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uSand;
      uniform sampler2D uGrass;
      uniform sampler2D uRock;
      uniform sampler2D uSnow;
      uniform float uMinHeight;
      uniform float uMaxHeight;
      uniform float uTextureScale;
      uniform vec3 uSunDirection;
      uniform float uWaterLevel;

      varying vec2 vUv;
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float remapHeight(float height) {
        return clamp((height - uMinHeight) / (uMaxHeight - uMinHeight), 0.0, 1.0);
      }

      void main() {
        vec2 tiledUv = vUv * uTextureScale;
        vec3 normal = normalize(vNormal);
        float height = remapHeight(vHeight);
        float slope = clamp((1.0 - normal.y) * 2.4, 0.0, 1.0);
        float wetEdge = 1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, vHeight);

        float sandWeight = (1.0 - smoothstep(0.12, 0.29, height)) + wetEdge * 0.9;
        float grassWeight = smoothstep(0.16, 0.34, height) * (1.0 - smoothstep(0.52, 0.73, height));
        float rockWeight = smoothstep(0.43, 0.68, height) + slope * 1.5;
        float snowWeight = smoothstep(0.72, 0.94, height) * (1.0 - slope * 0.25);

        grassWeight *= 1.0 - slope * 0.58;
        sandWeight *= 1.0 - slope * 0.35;
        vec4 weights = max(vec4(sandWeight, grassWeight, rockWeight, snowWeight), vec4(0.001));
        weights /= weights.x + weights.y + weights.z + weights.w;

        vec3 sand = texture2D(uSand, tiledUv * 1.15).rgb;
        vec3 grass = texture2D(uGrass, tiledUv).rgb;
        vec3 rock = texture2D(uRock, tiledUv * 0.82).rgb;
        vec3 snow = texture2D(uSnow, tiledUv * 0.66).rgb;
        vec3 color = sand * weights.x + grass * weights.y + rock * weights.z + snow * weights.w;

        float diffuse = clamp(dot(normal, normalize(uSunDirection)), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(normal, normalize(cameraPosition - vWorldPosition)), 0.0, 1.0), 2.0);
        color *= 0.48 + diffuse * 0.58;
        color += vec3(0.10, 0.14, 0.18) * rim;

        float distanceToCamera = length(cameraPosition - vWorldPosition);
        float fogAmount = smoothstep(260.0, 520.0, distanceToCamera) * 0.45;
        color = mix(color, vec3(0.62, 0.72, 0.84), fogAmount);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function loadTerrainTexture(path) {
  const texture = textureLoader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWaterPlane() {
  const geometry = new THREE.PlaneGeometry(REGION_SIZE, REGION_SIZE, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x4b9bd0,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  const water = new THREE.Mesh(geometry, material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterLevel;
  return water;
}

function createBoundaryFrame() {
  const points = [
    new THREE.Vector3(-HALF_REGION, 0, -HALF_REGION),
    new THREE.Vector3(HALF_REGION, 0, -HALF_REGION),
    new THREE.Vector3(HALF_REGION, 0, HALF_REGION),
    new THREE.Vector3(-HALF_REGION, 0, HALF_REGION),
    new THREE.Vector3(-HALF_REGION, 0, -HALF_REGION),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.56 });
  const frame = new THREE.Line(geometry, material);
  frame.position.y = waterLevel + 0.08;
  return frame;
}

function createBrushCursor() {
  const geometry = new THREE.TorusGeometry(1, 0.035, 8, 96);
  const material = new THREE.MeshBasicMaterial({
    color: 0x58ff9a,
    transparent: true,
    opacity: 0.88,
    depthTest: false,
  });
  const cursor = new THREE.Mesh(geometry, material);
  cursor.rotation.x = Math.PI / 2;
  cursor.renderOrder = 20;
  cursor.visible = false;
  return cursor;
}

function bindUi() {
  window.addEventListener('resize', resize);
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointerup', stopPainting);
  renderer.domElement.addEventListener('pointercancel', stopPainting);
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

  brushSizeInput.addEventListener('input', () => {
    brush.radius = Number(brushSizeInput.value);
    brushSizeValue.textContent = `${brush.radius}m`;
    updateBrushCursorScale();
  });

  brushStrengthInput.addEventListener('input', () => {
    brush.strength = Number(brushStrengthInput.value);
    brushStrengthValue.textContent = `${brush.strength}`;
  });

  waterLevelInput.addEventListener('input', () => {
    setWaterLevel(Number(waterLevelInput.value));
  });

  textureDensityInput.addEventListener('input', () => {
    setTextureDensity(Number(textureDensityInput.value));
  });

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => setBrushMode(button.dataset.mode));
  });

  document.querySelector('#randomize').addEventListener('click', () => {
    generateHeightMap(Math.floor(Math.random() * 100000));
    syncHeightMapToGeometry();
    updateHeightmapPreview();
  });

  document.querySelector('#level').addEventListener('click', () => {
    heightMap.fill(8);
    syncHeightMapToGeometry();
    updateHeightmapPreview();
  });

  document.querySelector('#export-heightmap').addEventListener('click', downloadHeightmap);

  window.addEventListener('keydown', (event) => {
    if (isFormControl(event.target)) return;

    if (event.key === '1') setBrushMode('raise');
    if (event.key === '2') setBrushMode('lower');
    if (event.key === '3') setBrushMode('flatten');
    if (event.key === '[') setBrushRadius(brush.radius - 1);
    if (event.key === ']') setBrushRadius(brush.radius + 1);

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

function setWaterLevel(level) {
  waterLevel = level;
  waterLevelValue.textContent = `${waterLevel.toFixed(1)}m`;

  if (waterMesh) {
    waterMesh.position.y = waterLevel;
  }

  if (boundaryFrame) {
    boundaryFrame.position.y = waterLevel + 0.08;
  }

  if (terrainMesh?.material?.uniforms?.uWaterLevel) {
    terrainMesh.material.uniforms.uWaterLevel.value = waterLevel;
  }
}

function setTextureDensity(density) {
  textureDensity = density;
  textureDensityValue.textContent = `${textureDensity}x`;

  if (terrainMesh?.material?.uniforms?.uTextureScale) {
    terrainMesh.material.uniforms.uTextureScale.value = textureDensity;
  }
}

function setBrushMode(mode) {
  brush.mode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  updateBrushCursorColor(mode);
}

function setBrushRadius(radius) {
  brush.radius = clamp(radius, Number(brushSizeInput.min), Number(brushSizeInput.max));
  brushSizeInput.value = String(brush.radius);
  brushSizeValue.textContent = `${brush.radius}m`;
  updateBrushCursorScale();
}

function handlePointerDown(event) {
  if (event.button !== 0) return;

  const hit = getTerrainHit(event);
  if (!hit) return;

  isPainting = true;
  brush.flattenHeight = null;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  applyBrush(hit.point, event.shiftKey);
  updateBrushCursor(hit.point, event.shiftKey ? 'lower' : brush.mode);
}

function handlePointerMove(event) {
  const hit = getTerrainHit(event);
  if (!hit) {
    brushCursor.visible = false;
    return;
  }

  const previewMode = event.shiftKey ? 'lower' : brush.mode;
  updateBrushCursor(hit.point, previewMode);

  if (isPainting) {
    applyBrush(hit.point, event.shiftKey);
  }
}

function stopPainting(event) {
  if (!isPainting) return;
  isPainting = false;
  brush.flattenHeight = null;
  controls.enabled = true;

  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
}

function handlePointerLeave() {
  if (!isPainting) {
    brushCursor.visible = false;
  }
}

function applyBrush(worldPoint, temporaryLower) {
  const effectiveMode = temporaryLower ? 'lower' : brush.mode;
  const centerX = ((worldPoint.x + HALF_REGION) / REGION_SIZE) * (SAMPLES - 1);
  const centerZ = ((worldPoint.z + HALF_REGION) / REGION_SIZE) * (SAMPLES - 1);
  const radiusInSamples = (brush.radius / REGION_SIZE) * (SAMPLES - 1);
  const minX = Math.max(0, Math.floor(centerX - radiusInSamples));
  const maxX = Math.min(SAMPLES - 1, Math.ceil(centerX + radiusInSamples));
  const minZ = Math.max(0, Math.floor(centerZ - radiusInSamples));
  const maxZ = Math.min(SAMPLES - 1, Math.ceil(centerZ + radiusInSamples));
  const sign = effectiveMode === 'lower' ? -1 : 1;
  const step = REGION_SIZE / (SAMPLES - 1);
  const delta = brush.strength * 0.035 * sign;
  const flattenBlend = Math.min(1, brush.strength * 0.018);

  if (effectiveMode === 'flatten' && brush.flattenHeight === null) {
    brush.flattenHeight = worldPoint.y;
  }

  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const worldX = x * step - HALF_REGION;
      const worldZ = z * step - HALF_REGION;
      const distance = Math.hypot(worldX - worldPoint.x, worldZ - worldPoint.z);

      if (distance > brush.radius) continue;

      const normalizedDistance = distance / brush.radius;
      const falloff = 0.5 + Math.cos(normalizedDistance * Math.PI) * 0.5;
      const index = indexFor(x, z);

      if (effectiveMode === 'flatten') {
        heightMap[index] = clamp(
          lerp(heightMap[index], brush.flattenHeight, flattenBlend * falloff),
          MIN_HEIGHT,
          MAX_HEIGHT,
        );
      } else {
        heightMap[index] = clamp(heightMap[index] + delta * falloff, MIN_HEIGHT, MAX_HEIGHT);
      }
    }
  }

  syncHeightMapToGeometry();
  updateHeightmapPreview();
}

function syncHeightMapToGeometry() {
  const position = terrainMesh.geometry.attributes.position;

  for (let index = 0; index < heightMap.length; index += 1) {
    position.array[index * 3 + 1] = heightMap[index];
  }

  position.needsUpdate = true;
  terrainMesh.geometry.computeVertexNormals();
  terrainMesh.geometry.attributes.normal.needsUpdate = true;
  terrainMesh.geometry.computeBoundingSphere();
}

function updateBrushCursor(point, mode = brush.mode) {
  brushCursor.visible = true;
  brushCursor.position.set(point.x, point.y + 0.22, point.z);
  updateBrushCursorScale();
  updateBrushCursorColor(mode);
}

function updateBrushCursorScale() {
  if (!brushCursor) return;
  brushCursor.scale.setScalar(brush.radius);
}

function updateBrushCursorColor(mode) {
  if (!brushCursor) return;
  const color = mode === 'lower' ? 0xff766c : mode === 'flatten' ? 0xffd35a : 0x58ff9a;
  brushCursor.material.color.set(color);
}

function getTerrainHit(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(terrainMesh, false)[0] ?? null;
}

function updateHeightmapPreview() {
  const ctx = heightmapPreview.getContext('2d');
  const image = ctx.createImageData(SAMPLES, SAMPLES);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < heightMap.length; i += 1) {
    min = Math.min(min, heightMap[i]);
    max = Math.max(max, heightMap[i]);
  }

  const range = Math.max(1, max - min);
  for (let i = 0; i < heightMap.length; i += 1) {
    const normalized = (heightMap[i] - min) / range;
    const shade = Math.round(normalized * 255);
    const pixel = i * 4;
    image.data[pixel] = shade;
    image.data[pixel + 1] = shade;
    image.data[pixel + 2] = shade;
    image.data[pixel + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  heightStats.textContent = `${SAMPLES} x ${SAMPLES} samples, ${min.toFixed(1)}m to ${max.toFixed(1)}m`;
}

function downloadHeightmap() {
  const link = document.createElement('a');
  link.download = 'terrain-heightmap-256.png';
  link.href = heightmapPreview.toDataURL('image/png');
  link.click();
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
  updateAvatarMovement(delta);
  controls.update();
  renderer.render(scene, camera);
}

function updateAvatarMovement(delta) {
  if (activeKeys.size === 0 || isPainting) return;

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

function createValueNoise(seed) {
  const random = mulberry32(seed);
  const tableSize = 512;
  const table = new Float32Array(tableSize * tableSize);

  for (let i = 0; i < table.length; i += 1) {
    table[i] = random();
  }

  function sample(x, y) {
    const xi = Math.floor(x) & (tableSize - 1);
    const yi = Math.floor(y) & (tableSize - 1);
    return table[yi * tableSize + xi];
  }

  function noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = sample(x0, y0);
    const b = sample(x0 + 1, y0);
    const c = sample(x0, y0 + 1);
    const d = sample(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }

  return {
    fbm(x, y, octaves) {
      let value = 0;
      let amplitude = 0.5;
      let frequency = 1;
      let totalAmplitude = 0;

      for (let octave = 0; octave < octaves; octave += 1) {
        value += noise(x * frequency, y * frequency) * amplitude;
        totalAmplitude += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }

      return value / totalAmplitude;
    },
  };
}

function indexFor(x, z) {
  return z * SAMPLES + x;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
