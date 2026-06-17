/**
 * metaverse-terrain — TerrainRegion library
 *
 * Peer dependency: the host app must resolve the bare specifier `three`:
 *
 *   npm install metaverse-terrain three
 *   import * as THREE from 'three';
 *
 * CDN import map example:
 *   "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js",
 *   "metaverse-terrain": "https://cdn.jsdelivr.net/npm/metaverse-terrain/index.js"
 */

import * as THREE from 'three';

// --- constants ---

export const DEFAULT_REGION_SIZE = 256;
export const MIN_REGION_SIZE = 64;
export const MAX_REGION_SIZE = 512;
export const DEFAULT_SAMPLE_SPACING = 1;
export const DEFAULT_SAMPLES = DEFAULT_REGION_SIZE / DEFAULT_SAMPLE_SPACING + 1;
export const DEFAULT_MIN_HEIGHT = -12;
export const DEFAULT_MAX_HEIGHT = 52;
export const DEFAULT_WATER_LEVEL = 21.5;
export const DEFAULT_TEXTURE_DENSITY = 20;
export const DEFAULT_HEX_TILE_RATE = 0.5;
export const DEFAULT_HEX_TILE_CONTRAST = 0.75;
export const DEFAULT_SUN_DIRECTION = [0.45, 0.86, 0.24];

export const TERRAIN_TEXTURE_LAYERS = ['sand', 'grass', 'rock', 'snow', 'water'];
export const PBR_CHANNELS = ['metal', 'roughness', 'normal', 'ao'];

export const DEFAULT_TEXTURE_HEIGHTS = {
  sandMax: 22.5,
  grassStart: 22.5,
  grassEnd: 30,
  rockStart: 30,
  snowStart: 36,
};

export const DEFAULT_TEXTURE_BLEND_WIDTH = 4;

// --- math ---

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function indexFor(x, z, samples) {
  return z * samples + x;
}

function samplesForRegionSize(regionSize, sampleSpacing = DEFAULT_SAMPLE_SPACING) {
  return Math.round(regionSize / sampleSpacing) + 1;
}

function inferSamplesFromHeightMap(heightMap) {
  const samples = Math.sqrt(heightMap.length);
  if (!Number.isInteger(samples)) {
    throw new Error('metaverse-terrain: heightMap length must be a square number');
  }
  return samples;
}

// --- noise ---

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

// --- textures ---

function requireTextures(textures) {
  if (!textures) {
    throw new Error('metaverse-terrain: `textures` is required (sand, grass, rock, snow, water)');
  }

  for (const layer of TERRAIN_TEXTURE_LAYERS) {
    if (textures[layer] == null) {
      throw new Error(`metaverse-terrain: textures.${layer} is required`);
    }
  }

  return textures;
}

function configureTerrainTexture(texture, srgb = true) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  return texture;
}

function loadTerrainTexture(textureLoader, source, srgb = true) {
  if (source?.isTexture) {
    return source;
  }

  return configureTerrainTexture(textureLoader.load(source), srgb);
}

function createSolidTerrainTexture(r, g, b, a = 255, srgb = false) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function loadTerrainTextureFromSource(textureLoader, source) {
  if (source?.isTexture) {
    return source;
  }

  if (source instanceof File || source instanceof Blob) {
    const objectUrl = URL.createObjectURL(source);
    const texture = configureTerrainTexture(textureLoader.load(objectUrl));
    texture.userData.objectUrl = objectUrl;
    return texture;
  }

  return loadTerrainTexture(textureLoader, source);
}

function disposeTerrainTexture(texture) {
  if (!texture?.isTexture) return;

  if (texture.userData?.objectUrl) {
    URL.revokeObjectURL(texture.userData.objectUrl);
    delete texture.userData.objectUrl;
  }

  texture.dispose();
}

// --- PBR texture packing ---

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function packMRAO(imageLoader, metal, roughness, ao) {
  const [metalImg, roughnessImg, aoImg] = await Promise.all([
    loadImage(metal),
    loadImage(roughness),
    loadImage(ao),
  ]);

  const w = metalImg.width;
  const h = metalImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const metalCanvas = document.createElement('canvas');
  metalCanvas.width = w;
  metalCanvas.height = h;
  const metalCtx = metalCanvas.getContext('2d');
  metalCtx.drawImage(metalImg, 0, 0);
  const metalData = metalCtx.getImageData(0, 0, w, h);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const roughCtx = roughCanvas.getContext('2d');
  roughCtx.drawImage(roughnessImg, 0, 0);
  const roughData = roughCtx.getImageData(0, 0, w, h);

  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = w;
  aoCanvas.height = h;
  const aoCtx = aoCanvas.getContext('2d');
  aoCtx.drawImage(aoImg, 0, 0);
  const aoData = aoCtx.getImageData(0, 0, w, h);

  const packed = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const idx = i * 4;
    packed[idx] = metalData.data[idx];       // R = metal
    packed[idx + 1] = roughData.data[idx];   // G = roughness
    packed[idx + 2] = aoData.data[idx];      // B = AO
    packed[idx + 3] = 255;                   // A = 1
  }

  const texture = new THREE.DataTexture(packed, w, h, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function loadPBRTexture(textureLoader, source) {
  if (source?.isTexture) return source;
  return configureTerrainTexture(textureLoader.load(source), false);
}

// --- geometry ---

function createTerrainGeometry(heightMap, options) {
  const { regionSize, samples } = options;
  const halfRegion = regionSize / 2;
  const geometry = new THREE.BufferGeometry();
  const vertexCount = samples * samples;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((samples - 1) * (samples - 1) * 6);
  const step = regionSize / (samples - 1);

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const index = indexFor(x, z, samples);
      const positionIndex = index * 3;
      const uvIndex = index * 2;

      positions[positionIndex] = x * step - halfRegion;
      positions[positionIndex + 1] = heightMap[index];
      positions[positionIndex + 2] = z * step - halfRegion;
      uvs[uvIndex] = (x * step) / DEFAULT_REGION_SIZE;
      uvs[uvIndex + 1] = (z * step) / DEFAULT_REGION_SIZE;
    }
  }

  let indexPointer = 0;
  for (let z = 0; z < samples - 1; z += 1) {
    for (let x = 0; x < samples - 1; x += 1) {
      const a = indexFor(x, z, samples);
      const b = indexFor(x + 1, z, samples);
      const c = indexFor(x, z + 1, samples);
      const d = indexFor(x + 1, z + 1, samples);

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
  return geometry;
}

function createWaterGeometry(heightMap, options) {
  const { regionSize, samples, waterLevel } = options;
  const halfRegion = regionSize / 2;
  const geometry = new THREE.BufferGeometry();
  const vertexCount = samples * samples;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const waterDepth = new Float32Array(vertexCount);
  const indices = new Uint32Array((samples - 1) * (samples - 1) * 6);
  const step = regionSize / (samples - 1);

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const index = indexFor(x, z, samples);
      const positionIndex = index * 3;
      const uvIndex = index * 2;

      positions[positionIndex] = x * step - halfRegion;
      positions[positionIndex + 1] = 0;
      positions[positionIndex + 2] = z * step - halfRegion;
      uvs[uvIndex] = (x * step) / DEFAULT_REGION_SIZE;
      uvs[uvIndex + 1] = (z * step) / DEFAULT_REGION_SIZE;
      waterDepth[index] = waterLevel - heightMap[index];
    }
  }

  let indexPointer = 0;
  for (let z = 0; z < samples - 1; z += 1) {
    for (let x = 0; x < samples - 1; x += 1) {
      const a = indexFor(x, z, samples);
      const b = indexFor(x + 1, z, samples);
      const c = indexFor(x, z + 1, samples);
      const d = indexFor(x + 1, z + 1, samples);

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
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepth, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// --- heightmap ---

function generateHeightMap(heightMap, options) {
  const {
    samples,
    regionSize,
    minHeight,
    maxHeight,
    seed,
  } = options;
  const noise = createValueNoise(seed);
  const halfRegion = regionSize / 2;
  const step = regionSize / (samples - 1);
  const halfDiagonal = Math.hypot(halfRegion, halfRegion);

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const worldX = x * step - halfRegion;
      const worldZ = z * step - halfRegion;
      const distanceFromCenter = Math.hypot(worldX, worldZ) / halfDiagonal;
      const edgeDrop = smoothstep(0.82, 1, distanceFromCenter) * 10;
      const broad = noise.fbm(worldX * 0.012, worldZ * 0.012, 5);
      const ridges = Math.abs(noise.fbm(worldX * 0.032 + 41, worldZ * 0.032 - 17, 4) - 0.5) * 2;
      const detail = noise.fbm(worldX * 0.09 - 22, worldZ * 0.09 + 13, 3);
      const height = 9 + broad * 28 + ridges * 9 + detail * 3 - edgeDrop;

      heightMap[indexFor(x, z, samples)] = clamp(height, minHeight, maxHeight);
    }
  }
}

function updateWaterDepthData(heightMap, waterMesh, waterLevel) {
  const depthAttribute = waterMesh?.geometry?.attributes?.waterDepth;
  if (!depthAttribute) return;

  for (let index = 0; index < heightMap.length; index += 1) {
    depthAttribute.array[index] = waterLevel - heightMap[index];
  }

  depthAttribute.needsUpdate = true;
}

function syncHeightMapToGeometry(heightMap, terrainMesh, waterMesh, waterLevel) {
  const position = terrainMesh.geometry.attributes.position;

  for (let index = 0; index < heightMap.length; index += 1) {
    position.array[index * 3 + 1] = heightMap[index];
  }

  position.needsUpdate = true;
  terrainMesh.geometry.computeVertexNormals();
  terrainMesh.geometry.attributes.normal.needsUpdate = true;
  terrainMesh.geometry.computeBoundingSphere();
  updateWaterDepthData(heightMap, waterMesh, waterLevel);
}

function getHeightmapStats(heightMap) {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < heightMap.length; i += 1) {
    min = Math.min(min, heightMap[i]);
    max = Math.max(max, heightMap[i]);
  }

  return { min, max };
}

function heightmapToImageData(heightMap) {
  const samples = Math.round(Math.sqrt(heightMap.length));
  const { min, max } = getHeightmapStats(heightMap);
  const range = Math.max(1, max - min);
  const image = new ImageData(samples, samples);

  for (let i = 0; i < heightMap.length; i += 1) {
    const normalized = (heightMap[i] - min) / range;
    const shade = Math.round(normalized * 255);
    const pixel = i * 4;
    image.data[pixel] = shade;
    image.data[pixel + 1] = shade;
    image.data[pixel + 2] = shade;
    image.data[pixel + 3] = 255;
  }

  return image;
}

function heightmapToDataURL(heightMap) {
  const image = heightmapToImageData(heightMap);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

// --- brush ---

function applyBrush(heightMap, worldPoint, brush, options) {
  const {
    regionSize,
    samples,
    minHeight,
    maxHeight,
  } = options;
  const halfRegion = regionSize / 2;
  const effectiveMode = brush.temporaryLower ? 'lower' : brush.mode;
  const centerX = ((worldPoint.x + halfRegion) / regionSize) * (samples - 1);
  const centerZ = ((worldPoint.z + halfRegion) / regionSize) * (samples - 1);
  const radiusInSamples = (brush.radius / regionSize) * (samples - 1);
  const minX = Math.max(0, Math.floor(centerX - radiusInSamples));
  const maxX = Math.min(samples - 1, Math.ceil(centerX + radiusInSamples));
  const minZ = Math.max(0, Math.floor(centerZ - radiusInSamples));
  const maxZ = Math.min(samples - 1, Math.ceil(centerZ + radiusInSamples));
  const sign = effectiveMode === 'lower' ? -1 : 1;
  const step = regionSize / (samples - 1);
  const delta = brush.strength * 0.035 * sign;
  const flattenBlend = Math.min(1, brush.strength * 0.018);

  if (effectiveMode === 'flatten' && brush.flattenHeight === null) {
    brush.flattenHeight = worldPoint.y;
  }

  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const worldX = x * step - halfRegion;
      const worldZ = z * step - halfRegion;
      const distance = Math.hypot(worldX - worldPoint.x, worldZ - worldPoint.z);

      if (distance > brush.radius) continue;

      const normalizedDistance = distance / brush.radius;
      const falloff = 0.5 + Math.cos(normalizedDistance * Math.PI) * 0.5;
      const index = indexFor(x, z, samples);

      if (effectiveMode === 'flatten') {
        heightMap[index] = clamp(
          lerp(heightMap[index], brush.flattenHeight, flattenBlend * falloff),
          minHeight,
          maxHeight,
        );
      } else {
        heightMap[index] = clamp(heightMap[index] + delta * falloff, minHeight, maxHeight);
      }
    }
  }
}

// --- helpers ---

function createBoundaryFrame(regionSize, waterLevel) {
  const halfRegion = regionSize / 2;
  const points = [
    new THREE.Vector3(-halfRegion, 0, -halfRegion),
    new THREE.Vector3(halfRegion, 0, -halfRegion),
    new THREE.Vector3(halfRegion, 0, halfRegion),
    new THREE.Vector3(-halfRegion, 0, halfRegion),
    new THREE.Vector3(-halfRegion, 0, -halfRegion),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.24 });
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

function getBrushCursorColor(mode) {
  if (mode === 'lower') return 0xff766c;
  if (mode === 'flatten') return 0xffd35a;
  return 0x58ff9a;
}

// --- Hex-tiling GLSL (injected into MeshStandardMaterial) ---

const hexTilingGLSL = `
  const float HEX_FALL_OFF_CONTRAST = 0.6;
  const float HEX_BLEND_EXP_MIN = 2.0;
  const float HEX_BLEND_EXP_MAX = 12.0;
  const float HEX_ROT_STRENGTH = 1.0;
  const vec3 HEX_LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);

  struct HexTriangleGrid {
    float w1;
    float w2;
    float w3;
    ivec2 vertex1;
    ivec2 vertex2;
    ivec2 vertex3;
  };

  vec2 hexHash(vec2 p) {
    vec2 r = mat2(127.1, 269.5, 311.7, 183.3) * p;
    return fract(sin(r) * 43758.5453);
  }

  vec2 makeCenST(ivec2 vertex) {
    mat2 invSkewMat = mat2(1.0, 0.0, 0.5, 1.0 / 1.15470054);
    return invSkewMat * vec2(vertex) / (2.0 * sqrt(3.0));
  }

  mat2 loadRot2x2(ivec2 idx, float rotStrength) {
    float angle = float(abs(idx.x * idx.y) + abs(idx.x + idx.y)) + 3.14159265;
    angle = mod(angle, 6.2831853);
    if (angle > 3.14159265) angle -= 6.2831853;
    angle *= rotStrength;
    float cs = cos(angle);
    float si = sin(angle);
    return mat2(cs, si, -si, cs);
  }

  vec3 gain3(vec3 x, float r) {
    float k = log(1.0 - r) / log(0.5);
    vec3 s = 2.0 * step(0.5, x);
    vec3 m = 2.0 * (1.0 - s);
    vec3 res = 0.5 * s + 0.25 * m * pow(max(vec3(0.0), s + x * m), vec3(k));
    return res / (res.x + res.y + res.z);
  }

  HexTriangleGrid triangleGrid(vec2 st) {
    st *= 2.0 * sqrt(3.0);
    mat2 gridToSkewedGrid = mat2(1.0, 0.0, -0.57735027, 1.15470054);
    vec2 skewedCoord = gridToSkewedGrid * st;
    ivec2 baseId = ivec2(floor(skewedCoord));
    vec3 temp = vec3(fract(skewedCoord), 0.0);
    temp.z = 1.0 - temp.x - temp.y;
    float s = step(0.0, -temp.z);
    float s2 = 2.0 * s - 1.0;
    HexTriangleGrid grid;
    grid.w1 = -temp.z * s2;
    grid.w2 = s - temp.y * s2;
    grid.w3 = s - temp.x * s2;
    grid.vertex1 = baseId + ivec2(int(s), int(s));
    grid.vertex2 = baseId + ivec2(int(s), 1 - int(s));
    grid.vertex3 = baseId + ivec2(1 - int(s), int(s));
    return grid;
  }

  vec3 hexTileColor(sampler2D tex, vec2 st, float hexTileRate, float hexContrastR) {
    st *= hexTileRate;
    HexTriangleGrid grid = triangleGrid(st);
    mat2 rot1 = loadRot2x2(grid.vertex1, HEX_ROT_STRENGTH);
    mat2 rot2 = loadRot2x2(grid.vertex2, HEX_ROT_STRENGTH);
    mat2 rot3 = loadRot2x2(grid.vertex3, HEX_ROT_STRENGTH);
    vec2 cen1 = makeCenST(grid.vertex1);
    vec2 cen2 = makeCenST(grid.vertex2);
    vec2 cen3 = makeCenST(grid.vertex3);
    vec2 st1 = rot1 * (st - cen1) + cen1 + hexHash(vec2(grid.vertex1));
    vec2 st2 = rot2 * (st - cen2) + cen2 + hexHash(vec2(grid.vertex2));
    vec2 st3 = rot3 * (st - cen3) + cen3 + hexHash(vec2(grid.vertex3));
    vec3 c1 = texture2D(tex, st1).rgb;
    vec3 c2 = texture2D(tex, st2).rgb;
    vec3 c3 = texture2D(tex, st3).rgb;
    vec3 Dw = vec3(dot(c1, HEX_LUMA_WEIGHTS), dot(c2, HEX_LUMA_WEIGHTS), dot(c3, HEX_LUMA_WEIGHTS));
    Dw = mix(vec3(1.0), Dw, HEX_FALL_OFF_CONTRAST);
    vec3 bw = vec3(grid.w1, grid.w2, grid.w3);
    float hexExponent = mix(HEX_BLEND_EXP_MIN, HEX_BLEND_EXP_MAX, clamp((hexContrastR - 0.5) / 0.45, 0.0, 1.0));
    if (abs(hexContrastR - 0.5) > 0.001) bw = gain3(bw, hexContrastR);
    vec3 W = Dw * pow(bw, vec3(hexExponent));
    W /= W.x + W.y + W.z;
    return W.x * c1 + W.y * c2 + W.z * c3;
  }
`;

// --- Terrain material (MeshStandardMaterial + onBeforeCompile) ---

function createTerrainMaterial(textureLoader, options) {
  const {
    textures,
    textureDensity,
    hexTileRate,
    hexTileContrast,
    waterLevel,
    waterEnabled = 1,
    textureHeights,
    textureBlendWidth,
    pbrTextures,
    normalStrength = 1.0,
    terrainAOIntensity = 1.0,
  } = options;

  const sandTex = loadTerrainTexture(textureLoader, textures.sand);
  const grassTex = loadTerrainTexture(textureLoader, textures.grass);
  const rockTex = loadTerrainTexture(textureLoader, textures.rock);
  const snowTex = loadTerrainTexture(textureLoader, textures.snow);

  // Load PBR normal/mrao textures for blending (optional). Defaults keep shader samplers valid.
  const layers = ['sand', 'grass', 'rock', 'snow'];
  const pbrNormals = {};
  const pbrMrao = {};
  const defaultNormal = createSolidTerrainTexture(128, 128, 255, 255, false);
  const defaultMRAO = createSolidTerrainTexture(0, 204, 255, 255, false); // metal=0, roughness≈0.8, ao=1
  const hasPBR = !!pbrTextures;

  for (const layer of layers) {
    pbrNormals[layer] = pbrTextures?.[layer]?.normal
      ? loadTerrainTexture(textureLoader, pbrTextures[layer].normal, false)
      : defaultNormal;
    pbrMrao[layer] = pbrTextures?.[layer]?.mrao
      ? loadTerrainTexture(textureLoader, pbrTextures[layer].mrao, false)
      : defaultMRAO;
  }

  const material = new THREE.MeshStandardMaterial({
    roughness: 1.0,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    // Store reference for runtime uniform updates
    material.userData.shader = shader;

    // Add custom uniforms
    shader.uniforms.uSand = { value: sandTex };
    shader.uniforms.uGrass = { value: grassTex };
    shader.uniforms.uRock = { value: rockTex };
    shader.uniforms.uSnow = { value: snowTex };
    shader.uniforms.uTextureScale = { value: textureDensity };
    shader.uniforms.uHexTileRate = { value: hexTileRate };
    shader.uniforms.uHexContrastR = { value: hexTileContrast };
    shader.uniforms.uSandMax = { value: textureHeights.sandMax };
    shader.uniforms.uGrassStart = { value: textureHeights.grassStart };
    shader.uniforms.uGrassEnd = { value: textureHeights.grassEnd };
    shader.uniforms.uRockStart = { value: textureHeights.rockStart };
    shader.uniforms.uSnowStart = { value: textureHeights.snowStart };
    shader.uniforms.uBlendWidth = { value: textureBlendWidth };
    shader.uniforms.uWaterLevel = { value: waterLevel };
    shader.uniforms.uWaterEnabled = { value: waterEnabled ? 1 : 0 };
    shader.uniforms.uTerrainAOIntensity = { value: terrainAOIntensity };

    // Add PBR texture uniforms if available
    if (hasPBR) {
      for (const layer of layers) {
        const cap = layer.charAt(0).toUpperCase() + layer.slice(1);
        shader.uniforms[`u${cap}Normal`] = { value: pbrNormals[layer] };
        shader.uniforms[`u${cap}MRAO`] = { value: pbrMrao[layer] };
      }
      shader.uniforms.uNormalStrength = { value: normalStrength };
    }

    // Inject hex-tiling functions and varyings at top of shaders
    const varyings = `
      varying float vTerrainHeight;
      varying vec3 vTerrainWorldNormal;
      varying vec2 vTerrainUv;
    `;

    const uniformDeclarations = `
      uniform sampler2D uSand;
      uniform sampler2D uGrass;
      uniform sampler2D uRock;
      uniform sampler2D uSnow;
      uniform float uTextureScale;
      uniform float uHexTileRate;
      uniform float uHexContrastR;
      uniform float uSandMax;
      uniform float uGrassStart;
      uniform float uGrassEnd;
      uniform float uRockStart;
      uniform float uSnowStart;
      uniform float uBlendWidth;
      uniform float uWaterLevel;
      uniform float uWaterEnabled;
      uniform float uTerrainAOIntensity;
      uniform sampler2D uSandNormal;
      uniform sampler2D uGrassNormal;
      uniform sampler2D uRockNormal;
      uniform sampler2D uSnowNormal;
      uniform sampler2D uSandMRAO;
      uniform sampler2D uGrassMRAO;
      uniform sampler2D uRockMRAO;
      uniform sampler2D uSnowMRAO;
      uniform float uNormalStrength;
    `;

    const terrainBlendGLSL = `
      vec4 terrainLayerWeights(float terrainHeight, vec3 terrainWorldNormal) {
        vec3 geomNormal = normalize(terrainWorldNormal);
        float slope = clamp((1.0 - geomNormal.y) * 2.4, 0.0, 1.0);
        float wetEdge = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, terrainHeight)) * uWaterEnabled;

        float sandWeight = 1.0 - smoothstep(uSandMax - uBlendWidth, uSandMax, terrainHeight);
        float grassWeight = smoothstep(uGrassStart - uBlendWidth, uGrassStart + uBlendWidth, terrainHeight)
          * (1.0 - smoothstep(uGrassEnd - uBlendWidth, uGrassEnd + uBlendWidth, terrainHeight));
        float rockWeight = smoothstep(uRockStart - uBlendWidth, uRockStart + uBlendWidth, terrainHeight) + slope * 0.35;
        float snowWeight = smoothstep(uSnowStart - uBlendWidth, uSnowStart + uBlendWidth, terrainHeight) * (1.0 - slope * 0.25);

        sandWeight += wetEdge * 0.9;
        grassWeight *= 1.0 + slope * 0.75;
        sandWeight *= 1.0 - slope * 0.25;

        vec4 weights = max(vec4(sandWeight, grassWeight, rockWeight, snowWeight), vec4(0.001));
        return weights / (weights.x + weights.y + weights.z + weights.w);
      }

      mat3 terrainTangentFrame(vec3 worldNormal) {
        // Terrain UVs are aligned to world X/Z, so build a stable TBN from
        // world axes instead of screen-space derivatives. This avoids
        // camera-dependent triangular lighting artifacts on heightfield faces.
        vec3 nW = normalize(worldNormal);
        vec3 tW = vec3(1.0, 0.0, 0.0) - nW * dot(vec3(1.0, 0.0, 0.0), nW);

        if (dot(tW, tW) < 1e-6) {
          tW = vec3(0.0, 0.0, 1.0) - nW * dot(vec3(0.0, 0.0, 1.0), nW);
        }

        tW = normalize(tW);
        vec3 bW = normalize(cross(tW, nW));

        vec3 tV = normalize((viewMatrix * vec4(tW, 0.0)).xyz);
        vec3 bV = normalize((viewMatrix * vec4(bW, 0.0)).xyz);
        vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        return mat3(tV, bV, nV);
      }

      vec3 terrainSampleNormal(vec4 weights) {
        vec3 n = vec3(0.0);
        n += (texture2D(uSandNormal, vTerrainUv * uTextureScale * 1.15).xyz * 2.0 - 1.0) * weights.x;
        n += (texture2D(uGrassNormal, vTerrainUv * uTextureScale).xyz * 2.0 - 1.0) * weights.y;
        n += (texture2D(uRockNormal, vTerrainUv * uTextureScale * 0.82).xyz * 2.0 - 1.0) * weights.z;
        n += (texture2D(uSnowNormal, vTerrainUv * uTextureScale * 0.66).xyz * 2.0 - 1.0) * weights.w;
        n = normalize(n);
        n.xy *= uNormalStrength;
        return normalize(vec3(n.xy, max(n.z, 0.001)));
      }

      vec4 terrainSampleMRAO(vec4 weights) {
        vec4 mrao = vec4(0.0);
        mrao.rgb += texture2D(uSandMRAO, vTerrainUv * uTextureScale * 1.15).rgb * weights.x;
        mrao.rgb += texture2D(uGrassMRAO, vTerrainUv * uTextureScale).rgb * weights.y;
        mrao.rgb += texture2D(uRockMRAO, vTerrainUv * uTextureScale * 0.82).rgb * weights.z;
        mrao.rgb += texture2D(uSnowMRAO, vTerrainUv * uTextureScale * 0.66).rgb * weights.w;
        mrao.a = weights.x + weights.y + weights.z + weights.w;
        return mrao;
      }
    `;

    shader.vertexShader = uniformDeclarations + varyings + shader.vertexShader;
    shader.fragmentShader = uniformDeclarations + varyings + hexTilingGLSL + terrainBlendGLSL + shader.fragmentShader;

    // Pass height and world normal from vertex to fragment
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vTerrainHeight = transformed.y;
      vTerrainWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vTerrainUv = uv;`
    );


    // Replace color_fragment with hex-tiled multi-layer blending
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `// --- Hex-tiled multi-layer terrain blending ---
      vec2 terrainTiledUv = vTerrainUv * uTextureScale;
      vec3 geomNormal = normalize(vTerrainWorldNormal);
      float slope = clamp((1.0 - geomNormal.y) * 2.4, 0.0, 1.0);
      float wetEdge = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, vTerrainHeight)) * uWaterEnabled;

      vec4 terrainWeights = terrainLayerWeights(vTerrainHeight, vTerrainWorldNormal);

      // Hex-tiled albedo sampling
      vec3 sandColor = hexTileColor(uSand, terrainTiledUv * 1.15, uHexTileRate, uHexContrastR);
      vec3 grassColor = hexTileColor(uGrass, terrainTiledUv, uHexTileRate, uHexContrastR);
      vec3 rockColor = hexTileColor(uRock, terrainTiledUv * 0.82, uHexTileRate, uHexContrastR);
      vec3 snowColor = hexTileColor(uSnow, terrainTiledUv * 0.66, uHexTileRate, uHexContrastR);

      vec3 terrainAlbedo = sandColor * terrainWeights.x + grassColor * terrainWeights.y + rockColor * terrainWeights.z + snowColor * terrainWeights.w;

      // Set diffuse color for Three.js PBR pipeline
      diffuseColor = vec4(terrainAlbedo, diffuseColor.a);
`
    );

    // Inject terrain roughness after Three declares roughnessFactor.
    if (hasPBR) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          vec4 mraoForRoughness = terrainSampleMRAO(terrainWeights);
          roughnessFactor = clamp(mraoForRoughness.g, 0.04, 1.0);
        }`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = 0.0;`
      );
    }

    // Inject terrain normal maps and AO into Three.js standard PBR pipeline.
    if (hasPBR) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>

        // Blend layer normal maps and transform them into Three.js view-space normal.
        {
          vec3 terrainTangentNormal = terrainSampleNormal(terrainWeights);
          mat3 terrainTBN = terrainTangentFrame(vTerrainWorldNormal);
          normal = normalize(terrainTBN * terrainTangentNormal);
        }`
      );

      // Inject AO blending after aomap_fragment
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>

        // Blend terrain PBR AO
        {
          vec4 mrao = terrainSampleMRAO(terrainWeights);
          float terrainAO = mix(1.0, clamp(mrao.b, 0.0, 1.0), clamp(uTerrainAOIntensity, 0.0, 2.0));
          reflectedLight.indirectDiffuse *= terrainAO;
        }`
      );
    }

    // Add fog support
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
        float fogDepth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep(260.0, 520.0, fogDepth) * 0.45;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.72, 0.84), fogFactor);
      #endif`
    );
  };

  // Store textures for runtime updates
  material.userData.textures = { sand: sandTex, grass: grassTex, rock: rockTex, snow: snowTex };
  material.userData.pbrTextures = { normals: pbrNormals, mrao: pbrMrao };

  return material;
}

// --- WaterMaterial ---

const waterVertexShader = `
  attribute float waterDepth;

  uniform float uTime;

  varying vec2 vUv;
  varying float vTerrainDepth;
  varying vec3 vWaveNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vTerrainDepth = waterDepth;

    float waveMask = smoothstep(0.12, 3.0, waterDepth);
    float phaseA = position.x * 0.18 + position.z * 0.07 + uTime * 0.82;
    float phaseB = position.x * 0.11 - position.z * 0.16 + uTime * 1.28;
    float phaseC = -position.x * 0.06 + position.z * 0.20 + uTime * 0.54;
    float waveHeight = sin(phaseA) * 0.13 + sin(phaseB) * 0.08 + sin(phaseC) * 0.05;

    float dx = cos(phaseA) * 0.18 * 0.13 + cos(phaseB) * 0.11 * 0.08 - cos(phaseC) * 0.06 * 0.05;
    float dz = cos(phaseA) * 0.07 * 0.13 - cos(phaseB) * 0.16 * 0.08 + cos(phaseC) * 0.20 * 0.05;

    vec3 transformed = position;
    transformed.y += waveHeight * waveMask;
    vWaveNormal = normalize(vec3(-dx * waveMask, 1.0, -dz * waveMask));

    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const waterFragmentShader = `
  uniform sampler2D uWaterMap;
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uFoamColor;
  uniform vec3 uFogColor;
  uniform float uWaterAlphaShallow;
  uniform float uWaterAlphaDeep;
  uniform float uWaterAlphaMax;

  // PBR water uniforms
  uniform sampler2D uWaterNormal;
  uniform sampler2D uWaterMRAO;
  uniform float uPBREnabled;
  uniform float uWaterIOR;

  varying vec2 vUv;
  varying float vTerrainDepth;
  varying vec3 vWaveNormal;
  varying vec3 vWorldPosition;

  const float PI = 3.14159265359;

  float getWaterLuma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  mat2 waterRotation(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  vec3 sampleWaterPattern(vec2 worldXZ, float time) {
    vec2 baseUv = worldXZ * 0.012;
    float warpA = getWaterLuma(texture2D(uWaterMap, baseUv * 0.42 + vec2(time * 0.006, -time * 0.004)).rgb) - 0.5;
    float warpB = getWaterLuma(texture2D(uWaterMap, waterRotation(1.7) * baseUv * 0.31 + vec2(-time * 0.003, time * 0.005)).rgb) - 0.5;
    vec2 warp = vec2(warpA, warpB) * 0.18;

    vec3 a = texture2D(uWaterMap, waterRotation(0.36) * (baseUv * 2.15 + warp) + vec2(time * 0.012, -time * 0.007)).rgb;
    vec3 b = texture2D(uWaterMap, waterRotation(-0.92) * (baseUv * 3.70 - warp * 0.65) + vec2(-time * 0.006, time * 0.010)).rgb;
    vec3 c = texture2D(uWaterMap, waterRotation(2.21) * (baseUv * 6.40 + warp * 0.35) + vec2(time * 0.003, time * 0.004)).rgb;

    return a * 0.48 + b * 0.34 + c * 0.18;
  }

  float sampleWaterPatternLuma(vec2 worldXZ, float time) {
    return getWaterLuma(sampleWaterPattern(worldXZ, time));
  }

  float waterRippleSignal(vec2 worldXZ, float time) {
    float w1 = sin(dot(worldXZ, vec2(0.87, 0.39)) * 0.58 + time * 1.70);
    float w2 = sin(dot(worldXZ, vec2(-0.34, 0.94)) * 0.73 + time * 1.13);
    float w3 = sin(dot(worldXZ + vec2(w1, w2) * 0.7, vec2(0.62, -0.78)) * 1.05 + time * 2.05);
    float w4 = sin(dot(worldXZ, vec2(0.14, 0.99)) * 0.31 - time * 0.82);
    return w1 * 0.34 + w2 * 0.27 + w3 * 0.25 + w4 * 0.14;
  }

  // Trowbridge-Reitz GGX
  float D_GGX_water(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
  }

  float G_SchlickGGX_water(float NdotV, float roughness) {
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
  }

  float G_Smith_water(float NdotV, float NdotL, float roughness) {
    return G_SchlickGGX_water(NdotV, roughness) * G_SchlickGGX_water(NdotL, roughness);
  }

  // Fresnel from IOR
  float F0_fromIOR(float ior) {
    float f0 = (1.0 - ior) / (1.0 + ior);
    return f0 * f0;
  }

  float F_Schlick_water(float cosTheta, float F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }

  float waterDaylight(vec3 sunDir) {
    return smoothstep(-0.08, 0.22, sunDir.y);
  }

  vec3 waterSkyReflection(vec3 reflectedView, vec3 sunDir) {
    float skyMix = smoothstep(-0.15, 0.75, reflectedView.y);
    float dayMix = waterDaylight(sunDir);
    vec3 dayLow = vec3(0.38, 0.66, 0.78);
    vec3 dayHigh = vec3(0.86, 0.95, 1.0);
    vec3 nightLow = vec3(0.02, 0.05, 0.10);
    vec3 nightHigh = vec3(0.06, 0.10, 0.18);
    vec3 twilightLow = vec3(0.14, 0.20, 0.32);
    vec3 twilightHigh = vec3(0.38, 0.45, 0.58);
    vec3 sky = mix(mix(nightLow, nightHigh, skyMix), mix(dayLow, dayHigh, skyMix), dayMix);
    float twilight = (1.0 - dayMix) * smoothstep(-0.05, 0.12, sunDir.y);
    sky = mix(sky, mix(twilightLow, twilightHigh, skyMix), twilight * 0.55);
    return sky;
  }

  void main() {
    vec2 waterWorldXZ = vWorldPosition.xz;
    vec3 waterSample = sampleWaterPattern(waterWorldXZ, uTime);
    float waterDetail = getWaterLuma(waterSample);
    float waterDetailX = sampleWaterPatternLuma(waterWorldXZ + vec2(0.22, 0.0), uTime);
    float waterDetailY = sampleWaterPatternLuma(waterWorldXZ + vec2(0.0, 0.22), uTime);

    // Base normal from wave displacement
    vec3 waveNormal = normalize(vWaveNormal);

    // Perturb with normal map
    vec2 normalUv = vUv * 8.0 + vec2(uTime * 0.008, -uTime * 0.005);
    vec3 mapNormal = texture2D(uWaterNormal, normalUv).rgb * 2.0 - 1.0;
    mapNormal.xy *= 0.35;
    vec3 normal = normalize(waveNormal + mapNormal * 0.5);

    // Also perturb with water texture detail
    vec3 texPerturb = vec3((waterDetail - waterDetailX) * 1.35, 0.0, (waterDetail - waterDetailY) * 1.35);
    normal = normalize(normal + texPerturb);

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDir = normalize(uSunDirection);
    float daylight = waterDaylight(sunDir);
    float depth = clamp(vTerrainDepth, 0.0, 24.0);
    float depthMix = smoothstep(0.0, 13.0, depth);
    float depthAbsorption = 1.0 - exp(-depth * 0.18);
    float depthAlpha = 1.0 - exp(-depth * 0.32);

    vec3 finalColor;
    float finalAlpha;

    if (uPBREnabled > 0.5) {
      // --- PBR Water Rendering ---
      vec2 mraoUv = vUv * 4.0;
      vec3 mrao = texture2D(uWaterMRAO, mraoUv).rgb;
      float roughness = clamp(mrao.g * 0.3 + 0.05, 0.02, 0.4);

      float F0 = F0_fromIOR(uWaterIOR);
      float NdotV = max(dot(normal, viewDirection), 0.001);
      float fresnel = F_Schlick_water(NdotV, F0);

      vec3 L = sunDir;
      vec3 H = normalize(viewDirection + L);
      float NdotH = max(dot(normal, H), 0.0);
      float NdotL = max(dot(normal, L), 0.0);
      float VdotH = max(dot(viewDirection, H), 0.0);

      float D = D_GGX_water(NdotH, roughness);
      float G = G_Smith_water(NdotV, NdotL, roughness);
      float F = F_Schlick_water(VdotH, F0);
      float spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);

      float ripple = waterRippleSignal(waterWorldXZ, uTime);
      float rippleFine = waterRippleSignal(waterWorldXZ * 1.73 + vec2(19.0, -31.0), uTime * 1.19);
      float rippleCrest = smoothstep(0.42, 1.0, ripple * 0.62 + rippleFine * 0.38);

      // Layered sun glints: broad mirror response plus persistent sun-facing
      // ripple sheen. The persistent term keeps water lively from most angles;
      // the mirror terms still bloom when the camera/sun alignment is perfect.
      vec3 reflectedSun = reflect(-L, normal);
      float sunMirror = max(dot(reflectedSun, viewDirection), 0.0);
      float glancingBoost = smoothstep(0.18, 0.82, 1.0 - NdotV);
      float sunFacing = smoothstep(-0.05, 0.65, NdotL);
      float rippleGlint = 0.82 + ripple * 0.18;
      float glintScale = mix(0.03, 1.0, daylight);
      float persistentGlint = (0.075 + 0.18 * sunFacing) * (0.62 + 0.38 * rippleCrest) * (1.0 - depthMix * 0.18) * glintScale;
      float grazingGlint = glancingBoost * (0.07 + 0.15 * rippleCrest) * glintScale;
      float broadSpec = pow(sunMirror, 3.6) * mix(0.28, 0.56, glancingBoost) * rippleGlint * daylight;
      float midSpec = pow(sunMirror, 18.0) * mix(0.16, 0.32, glancingBoost) * daylight;
      float tightSpec = pow(sunMirror, 110.0) * 0.44 * daylight;

      // Cheap sky reflection approximation for the custom water shader. This fills
      // the role scene.environment would normally play in a standard PBR material.
      vec3 reflectedView = reflect(-viewDirection, normal);
      vec3 skyReflection = waterSkyReflection(reflectedView, sunDir);
      float glancingReflection = (0.11 + pow(1.0 - NdotV, 1.7) * 0.46 + fresnel * 0.58) * mix(0.45, 1.0, daylight);

      vec3 baseColor = mix(uShallowColor, uDeepColor, depthAbsorption);
      baseColor = mix(baseColor, waterSample, mix(0.16, 0.055, depthAbsorption));
      baseColor *= mix(1.08, 0.64, depthAbsorption) * mix(0.52, 1.0, daylight);
      baseColor += ripple * mix(0.025, 0.010, depthAbsorption);

      float sss = pow(max(dot(viewDirection, -L), 0.0), 4.0) * 0.15 * daylight;
      vec3 subsurface = vec3(0.0, 0.4, 0.5) * sss * (1.0 - depthMix);

      vec3 fresnelTint = mix(vec3(0.15, 0.22, 0.32), vec3(0.72, 0.88, 0.96), daylight);
      finalColor = baseColor * (1.0 - fresnel * 0.42);
      finalColor = mix(finalColor, skyReflection, clamp(glancingReflection, 0.0, 0.68));
      finalColor += vec3(1.0, 0.95, 0.8) * (spec * NdotL * 0.38 * daylight + persistentGlint + grazingGlint + broadSpec + midSpec + tightSpec);
      finalColor += subsurface;
      finalColor = mix(finalColor, fresnelTint, fresnel * 0.14);

      float shore = 1.0 - smoothstep(0.0, 2.4, vTerrainDepth);
      float foamNoise = sin(vUv.x * 210.0 + uTime * 1.4) * sin(vUv.y * 185.0 - uTime * 1.1);
      float textureFoam = smoothstep(0.74, 0.98, waterDetail) * smoothstep(0.5, 3.8, vTerrainDepth);
      float foam = shore * smoothstep(0.18, 0.78, foamNoise + ripple * 0.42) * 0.68 + textureFoam * 0.07;
      finalColor = mix(finalColor, uFoamColor, foam * 0.32);

      finalAlpha = mix(uWaterAlphaShallow, uWaterAlphaDeep, depthAlpha) + fresnel * 0.16 + shore * 0.08;
    } else {
      // --- Legacy water ---
      vec3 baseNormal = normalize(vWaveNormal + vec3((waterDetail - waterDetailX) * 1.35, 0.0, (waterDetail - waterDetailY) * 1.35));
      float depth2 = clamp(vTerrainDepth, 0.0, 24.0);
      float depthMix2 = smoothstep(0.0, 13.0, depth2);
      float depthAbsorption2 = 1.0 - exp(-depth2 * 0.18);
      float depthAlpha2 = 1.0 - exp(-depth2 * 0.32);
      float fresnel2 = pow(1.0 - max(dot(baseNormal, viewDirection), 0.0), 3.0);

      float ripple2 = waterRippleSignal(waterWorldXZ, uTime);
      float rippleFine2 = waterRippleSignal(waterWorldXZ * 1.73 + vec2(19.0, -31.0), uTime * 1.19);
      float rippleCrest2 = smoothstep(0.42, 1.0, ripple2 * 0.62 + rippleFine2 * 0.38);

      vec3 color = mix(uShallowColor, uDeepColor, depthAbsorption2);
      color = mix(color, waterSample, mix(0.16, 0.055, depthAbsorption2));
      color *= mix(1.08, 0.64, depthAbsorption2);
      color += ripple2 * mix(0.035, 0.014, depthAbsorption2);
      color *= mix(0.52, 1.0, daylight);
      vec3 reflectedView2 = reflect(-viewDirection, baseNormal);
      vec3 skyReflection2 = waterSkyReflection(reflectedView2, sunDir);
      float legacyGlance = (0.07 + fresnel2 * 0.42) * mix(0.45, 1.0, daylight);
      color = mix(color, skyReflection2, clamp(legacyGlance, 0.0, 0.58));
      vec3 fresnelTint2 = mix(vec3(0.15, 0.22, 0.32), vec3(0.72, 0.88, 0.96), daylight);
      color = mix(color, fresnelTint2, fresnel2 * 0.12);

      vec3 reflectedSun = reflect(-sunDir, baseNormal);
      float sunMirror2 = max(dot(reflectedSun, viewDirection), 0.0);
      float glancingBoost2 = smoothstep(0.18, 0.82, 1.0 - max(dot(baseNormal, viewDirection), 0.0));
      float sunFacing2 = smoothstep(-0.05, 0.65, max(dot(baseNormal, sunDir), 0.0));
      float glintScale2 = mix(0.03, 1.0, daylight);
      float persistentGlint2 = (0.075 + 0.18 * sunFacing2) * (0.62 + 0.38 * rippleCrest2) * (1.0 - depthMix2 * 0.18) * glintScale2;
      float specular = persistentGlint2
        + glancingBoost2 * (0.07 + 0.15 * rippleCrest2) * glintScale2
        + pow(sunMirror2, 92.0) * 0.38 * daylight
        + pow(sunMirror2, 18.0) * mix(0.14, 0.29, glancingBoost2) * daylight
        + pow(sunMirror2, 3.6) * mix(0.24, 0.48, glancingBoost2) * daylight;
      color += vec3(1.0, 0.93, 0.74) * specular;

      float shore2 = 1.0 - smoothstep(0.0, 2.4, vTerrainDepth);
      float foamNoise2 = sin(vUv.x * 210.0 + uTime * 1.4) * sin(vUv.y * 185.0 - uTime * 1.1);
      float textureFoam2 = smoothstep(0.74, 0.98, waterDetail) * smoothstep(0.5, 3.8, vTerrainDepth);
      float foam2 = shore2 * smoothstep(0.18, 0.78, foamNoise2 + ripple2 * 0.42) * 0.68 + textureFoam2 * 0.07;
      color = mix(color, uFoamColor, foam2 * 0.32);

      finalColor = color;
      finalAlpha = mix(uWaterAlphaShallow, uWaterAlphaDeep, depthAlpha2) + fresnel2 * 0.16 + shore2 * 0.08;
    }

    // Distance fog
    float distanceToCamera = length(cameraPosition - vWorldPosition);
    float fogAmount = smoothstep(260.0, 520.0, distanceToCamera) * 0.42;
    finalColor = mix(finalColor, uFogColor, fogAmount);

    float visibility = smoothstep(-0.1, 0.35, vTerrainDepth);
    finalAlpha = clamp(finalAlpha * visibility, 0.0, uWaterAlphaMax);

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

function createWaterMaterial(textureLoader, options) {
  const {
    textures,
    sunDirection,
    fogColor = 0x9fb7d5,
    shallowColor = 0x8fcfd2,
    deepColor = 0x0b2d3d,
    foamColor = 0xe8fbff,
    shallowAlpha = 0.5,
    deepAlpha = 0.94,
    maxAlpha = 0.97,
    pbrTextures,
  } = options;

  const waterPBR = pbrTextures?.water;
  const hasPBR = !!waterPBR;

  // Default flat normal and MRAO
  const size = 4;
  const normalData = new Uint8Array(size * size * 4);
  const mraoData = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    normalData[i * 4] = 128; normalData[i * 4 + 1] = 128; normalData[i * 4 + 2] = 255; normalData[i * 4 + 3] = 255;
    mraoData[i * 4] = 0; mraoData[i * 4 + 1] = 100; mraoData[i * 4 + 2] = 255; mraoData[i * 4 + 3] = 255;
  }
  const defaultNormal = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  defaultNormal.wrapS = THREE.RepeatWrapping; defaultNormal.wrapT = THREE.RepeatWrapping;
  defaultNormal.colorSpace = THREE.LinearSRGBColorSpace; defaultNormal.needsUpdate = true;
  const defaultMRAO = new THREE.DataTexture(mraoData, size, size, THREE.RGBAFormat);
  defaultMRAO.wrapS = THREE.RepeatWrapping; defaultMRAO.wrapT = THREE.RepeatWrapping;
  defaultMRAO.colorSpace = THREE.LinearSRGBColorSpace; defaultMRAO.needsUpdate = true;

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uWaterMap: { value: loadTerrainTexture(textureLoader, textures.water) },
      uTime: { value: 0 },
      uSunDirection: { value: sunDirection },
      uShallowColor: { value: new THREE.Color(shallowColor) },
      uDeepColor: { value: new THREE.Color(deepColor) },
      uFoamColor: { value: new THREE.Color(foamColor) },
      uFogColor: { value: new THREE.Color(fogColor) },
      uWaterAlphaShallow: { value: shallowAlpha },
      uWaterAlphaDeep: { value: deepAlpha },
      uWaterAlphaMax: { value: maxAlpha },
      uWaterNormal: { value: waterPBR?.normal ? loadTerrainTexture(textureLoader, waterPBR.normal, false) : defaultNormal },
      uWaterMRAO: { value: waterPBR?.mrao ? loadTerrainTexture(textureLoader, waterPBR.mrao, false) : defaultMRAO },
      uPBREnabled: { value: hasPBR ? 1.0 : 0.0 },
      uWaterIOR: { value: 1.33 },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
  });
}

// --- TerrainRegion ---

const TEXTURE_LAYER_UNIFORMS = {
  sand: { mesh: 'terrain', uniform: 'uSand' },
  grass: { mesh: 'terrain', uniform: 'uGrass' },
  rock: { mesh: 'terrain', uniform: 'uRock' },
  snow: { mesh: 'terrain', uniform: 'uSnow' },
  water: { mesh: 'water', uniform: 'uWaterMap' },
};

/**
 * @typedef {Object} TerrainRegionOptions
 */

export class TerrainRegion {
  constructor(options = {}) {
    this.regionSize = options.regionSize ?? DEFAULT_REGION_SIZE;
    this.sampleSpacing = options.sampleSpacing ?? DEFAULT_SAMPLE_SPACING;
    this.fixedSamples = options.samples != null;
    this.seed = options.seed ?? 29;
    this.samples = options.samples
      ?? (options.heightMap ? inferSamplesFromHeightMap(options.heightMap) : samplesForRegionSize(this.regionSize, this.sampleSpacing));
    this.minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
    this.maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
    this.waterLevel = options.waterLevel ?? DEFAULT_WATER_LEVEL;
    this.waterEnabled = options.waterEnabled ?? true;
    this.waterShallowColor = options.waterShallowColor ?? 0x63c6d6;
    this.waterDeepColor = options.waterDeepColor ?? 0x0c4a66;
    this.waterFoamColor = options.waterFoamColor ?? 0xe8fbff;
    this.waterShallowAlpha = options.waterShallowAlpha ?? 0.5;
    this.waterDeepAlpha = options.waterDeepAlpha ?? 0.94;
    this.waterMaxAlpha = options.waterMaxAlpha ?? 0.97;
    this.textureDensity = options.textureDensity ?? DEFAULT_TEXTURE_DENSITY;
    this.hexTileRate = options.hexTileRate ?? DEFAULT_HEX_TILE_RATE;
    this.hexTileContrast = options.hexTileContrast ?? DEFAULT_HEX_TILE_CONTRAST;
    this.textureHeights = { ...DEFAULT_TEXTURE_HEIGHTS, ...options.textureHeights };
    this.textureBlendWidth = options.textureBlendWidth ?? DEFAULT_TEXTURE_BLEND_WIDTH;
    this.textures = requireTextures(options.textures);
    this.pbrTextures = options.pbrTextures ?? null;
    this.normalStrength = options.normalStrength ?? 1.0;
    this.terrainAOIntensity = options.terrainAOIntensity ?? 1.0;
    this.textureLoader = options.textureLoader ?? new THREE.TextureLoader();
    this.sunDirection = new THREE.Vector3(...(options.sunDirection ?? DEFAULT_SUN_DIRECTION)).normalize();
    this.onHeightmapChange = options.onHeightmapChange ?? null;

    this.heightMap = options.heightMap ?? new Float32Array(this.samples * this.samples);
    if (this.heightMap.length !== this.samples * this.samples) {
      throw new Error('metaverse-terrain: heightMap length must match samples * samples');
    }

    this.brush = {
      mode: 'raise',
      radius: 8,
      strength: 12,
      flattenHeight: null,
      temporaryLower: false,
    };

    this.brushCursor = null;

    if (!options.heightMap) {
      generateHeightMap(this.heightMap, {
        samples: this.samples,
        regionSize: this.regionSize,
        minHeight: this.minHeight,
        maxHeight: this.maxHeight,
        seed: this.seed,
      });
    }

    this.group = new THREE.Group();
    this.terrainMesh = this.createTerrainMesh();
    this.waterMesh = this.createWaterMesh();
    this.group.add(this.terrainMesh);
    this.group.add(this.waterMesh);

    if (options.addBoundaryFrame ?? true) {
      this.boundaryFrame = createBoundaryFrame(this.regionSize, this.waterLevel);
      this.group.add(this.boundaryFrame);
    }

    if (options.addBrushCursor ?? true) {
      this.attachBrushCursor();
    }

    this.setWaterEnabled(this.waterEnabled);
  }

  get halfRegion() {
    return this.regionSize / 2;
  }

  createTerrainMesh() {
    const geometry = createTerrainGeometry(this.heightMap, {
      regionSize: this.regionSize,
      samples: this.samples,
    });
    const material = createTerrainMaterial(this.textureLoader, {
      textures: this.textures,
      textureDensity: this.textureDensity,
      hexTileRate: this.hexTileRate,
      hexTileContrast: this.hexTileContrast,
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
      pbrTextures: this.pbrTextures,
      normalStrength: this.normalStrength,
      terrainAOIntensity: this.terrainAOIntensity,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  createWaterMesh() {
    const geometry = createWaterGeometry(this.heightMap, {
      regionSize: this.regionSize,
      samples: this.samples,
      waterLevel: this.waterLevel,
    });
    const material = createWaterMaterial(this.textureLoader, {
      textures: this.textures,
      sunDirection: this.sunDirection,
      shallowColor: this.waterShallowColor,
      deepColor: this.waterDeepColor,
      foamColor: this.waterFoamColor,
      shallowAlpha: this.waterShallowAlpha,
      deepAlpha: this.waterDeepAlpha,
      maxAlpha: this.waterMaxAlpha,
      pbrTextures: this.pbrTextures,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = this.waterLevel;
    mesh.renderOrder = 4;
    return mesh;
  }

  attachBrushCursor() {
    if (this.brushCursor) return this.brushCursor;
    this.brushCursor = createBrushCursor();
    this.group.add(this.brushCursor);
    return this.brushCursor;
  }

  paintAt(worldPoint, options = {}) {
    this.paint(worldPoint, options);
    this.emitHeightmapChange();
    return this;
  }

  randomize(seed = Math.floor(Math.random() * 100000)) {
    this.seed = seed;
    generateHeightMap(this.heightMap, {
      samples: this.samples,
      regionSize: this.regionSize,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      seed: this.seed,
    });
    this.sync();
    this.emitHeightmapChange();
    return this;
  }

  level(height = 8) {
    this.heightMap.fill(height);
    this.sync();
    this.emitHeightmapChange();
    return this;
  }

  setWaterEnabled(enabled) {
    this.waterEnabled = Boolean(enabled);
    this.waterMesh.visible = this.waterEnabled;
    return this;
  }

  setWaterLevel(level) {
    this.waterLevel = level;
    this.waterMesh.position.y = level;

    if (this.boundaryFrame) {
      this.boundaryFrame.position.y = level + 0.08;
    }

    // Update shader uniform if material has been compiled
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uWaterLevel) {
      shader.uniforms.uWaterLevel.value = level;
    }

    this.sync();
    this.emitHeightmapChange();
    return this;
  }

  setWaterColors({ shallowColor, deepColor, foamColor } = {}) {
    if (shallowColor != null) this.waterShallowColor = shallowColor;
    if (deepColor != null) this.waterDeepColor = deepColor;
    if (foamColor != null) this.waterFoamColor = foamColor;

    const uniforms = this.waterMesh.material.uniforms;
    if (shallowColor != null && uniforms.uShallowColor) uniforms.uShallowColor.value.set(shallowColor);
    if (deepColor != null && uniforms.uDeepColor) uniforms.uDeepColor.value.set(deepColor);
    if (foamColor != null && uniforms.uFoamColor) uniforms.uFoamColor.value.set(foamColor);
    return this;
  }

  setWaterOpacity({ shallowAlpha, deepAlpha, maxAlpha } = {}) {
    if (shallowAlpha != null) this.waterShallowAlpha = shallowAlpha;
    if (deepAlpha != null) this.waterDeepAlpha = deepAlpha;
    if (maxAlpha != null) this.waterMaxAlpha = maxAlpha;

    const uniforms = this.waterMesh.material.uniforms;
    if (shallowAlpha != null && uniforms.uWaterAlphaShallow) uniforms.uWaterAlphaShallow.value = shallowAlpha;
    if (deepAlpha != null && uniforms.uWaterAlphaDeep) uniforms.uWaterAlphaDeep.value = deepAlpha;
    if (maxAlpha != null && uniforms.uWaterAlphaMax) uniforms.uWaterAlphaMax.value = maxAlpha;
    return this;
  }

  setTextureDensity(density) {
    this.textureDensity = density;

    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uTextureScale) {
      shader.uniforms.uTextureScale.value = density;
    }

    return this;
  }

  setRegionSize(size) {
    this.regionSize = clamp(size, MIN_REGION_SIZE, MAX_REGION_SIZE);

    if (!this.fixedSamples) {
      this.samples = samplesForRegionSize(this.regionSize, this.sampleSpacing);
      this.heightMap = new Float32Array(this.samples * this.samples);
      generateHeightMap(this.heightMap, {
        samples: this.samples,
        regionSize: this.regionSize,
        minHeight: this.minHeight,
        maxHeight: this.maxHeight,
        seed: this.seed,
      });
    }

    this.rebuildTerrainGeometry();
    this.emitHeightmapChange();
    return this;
  }

  rebuildTerrainGeometry() {
    this.terrainMesh.geometry.dispose();
    this.waterMesh.geometry.dispose();

    this.terrainMesh.geometry = createTerrainGeometry(this.heightMap, {
      regionSize: this.regionSize,
      samples: this.samples,
    });
    this.waterMesh.geometry = createWaterGeometry(this.heightMap, {
      regionSize: this.regionSize,
      samples: this.samples,
      waterLevel: this.waterLevel,
    });

    if (this.boundaryFrame) {
      this.group.remove(this.boundaryFrame);
      this.boundaryFrame.geometry.dispose();
      this.boundaryFrame.material.dispose();
      this.boundaryFrame = createBoundaryFrame(this.regionSize, this.waterLevel);
      this.group.add(this.boundaryFrame);
    }

    this.sync();
    return this;
  }

  setHexTileRate(rate) {
    this.hexTileRate = rate;

    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uHexTileRate) {
      shader.uniforms.uHexTileRate.value = rate;
    }

    return this;
  }

  setHexTileContrast(contrast) {
    this.hexTileContrast = clamp(contrast, 0.5, 0.99);

    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uHexContrastR) {
      shader.uniforms.uHexContrastR.value = this.hexTileContrast;
    }

    return this;
  }

  setTextureHeights(heights) {
    this.textureHeights = { ...this.textureHeights, ...heights };
    this.syncTextureHeightUniforms();
    return this;
  }

  syncTextureHeightUniforms() {
    const shader = this.terrainMesh.material.userData?.shader;
    if (!shader?.uniforms) return this;

    if (shader.uniforms.uSandMax) shader.uniforms.uSandMax.value = this.textureHeights.sandMax;
    if (shader.uniforms.uGrassStart) shader.uniforms.uGrassStart.value = this.textureHeights.grassStart;
    if (shader.uniforms.uGrassEnd) shader.uniforms.uGrassEnd.value = this.textureHeights.grassEnd;
    if (shader.uniforms.uRockStart) shader.uniforms.uRockStart.value = this.textureHeights.rockStart;
    if (shader.uniforms.uSnowStart) shader.uniforms.uSnowStart.value = this.textureHeights.snowStart;
    if (shader.uniforms.uBlendWidth) shader.uniforms.uBlendWidth.value = this.textureBlendWidth;
    return this;
  }

  setNormalStrength(strength) {
    this.normalStrength = strength;
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uNormalStrength) {
      shader.uniforms.uNormalStrength.value = strength;
    }
    return this;
  }

  setTerrainAOIntensity(intensity) {
    this.terrainAOIntensity = intensity;
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uTerrainAOIntensity) {
      shader.uniforms.uTerrainAOIntensity.value = intensity;
    }
    return this;
  }

  setPBREnabled(enabled) {
    const value = enabled ? 1.0 : 0.0;
    if (this.waterMesh.material.uniforms?.uPBREnabled) {
      this.waterMesh.material.uniforms.uPBREnabled.value = value;
    }
    return this;
  }

  setWaterIOR(ior) {
    if (this.waterMesh.material.uniforms?.uWaterIOR) {
      this.waterMesh.material.uniforms.uWaterIOR.value = ior;
    }
    return this;
  }

  setSunDirection(direction) {
    this.sunDirection.copy(direction).normalize();
    if (this.waterMesh?.material?.uniforms?.uSunDirection) {
      this.waterMesh.material.uniforms.uSunDirection.value.copy(this.sunDirection);
    }
    return this;
  }

  setBrushMode(mode) {
    this.brush.mode = mode;
    return this;
  }

  setBrushRadius(radius) {
    this.brush.radius = radius;
    return this;
  }

  setBrushStrength(strength) {
    this.brush.strength = strength;
    return this;
  }

  beginStroke() {
    this.brush.flattenHeight = null;
    return this;
  }

  endStroke() {
    this.brush.flattenHeight = null;
    return this;
  }

  paint(worldPoint, options = {}) {
    const brush = {
      ...this.brush,
      mode: options.mode ?? this.brush.mode,
      temporaryLower: options.temporaryLower ?? false,
    };

    applyBrush(this.heightMap, worldPoint, brush, {
      regionSize: this.regionSize,
      samples: this.samples,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
    });

    this.brush.flattenHeight = brush.flattenHeight;
    this.sync();
    return this;
  }

  sync() {
    syncHeightMapToGeometry(this.heightMap, this.terrainMesh, this.waterMesh, this.waterLevel);
    return this;
  }

  raycast(raycaster) {
    const hits = raycaster.intersectObject(this.terrainMesh, false);
    return hits[0] ?? null;
  }

  updateBrushCursor(cursor, point, options = {}) {
    const mode = options.mode ?? this.brush.mode;
    cursor.visible = true;
    cursor.position.set(point.x, point.y + 0.22, point.z);
    cursor.scale.setScalar(options.radius ?? this.brush.radius);
    cursor.material.color.set(getBrushCursorColor(mode));
    return cursor;
  }

  update(elapsedTime) {
    if (!this.waterEnabled) return this;

    if (this.waterMesh.material.uniforms?.uTime) {
      this.waterMesh.material.uniforms.uTime.value = elapsedTime;
    }

    return this;
  }

  getHeightmapStats() {
    return getHeightmapStats(this.heightMap);
  }

  getHeightmapImageData() {
    return heightmapToImageData(this.heightMap);
  }

  getHeightmapSummary() {
    const { min, max } = getHeightmapStats(this.heightMap);
    return `${this.samples} x ${this.samples} samples, ${min.toFixed(1)}m to ${max.toFixed(1)}m`;
  }

  drawHeightmapPreview(canvas) {
    const context = canvas.getContext('2d');
    context.putImageData(this.getHeightmapImageData(), 0, 0);
    return this.getHeightmapSummary();
  }

  toHeightmapDataURL() {
    return heightmapToDataURL(this.heightMap);
  }

  downloadHeightmap(filename = `terrain-heightmap-${this.regionSize}.png`) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.toHeightmapDataURL();
    link.click();
    return this;
  }

  clampBrushRadius(radius, min, max) {
    this.brush.radius = clamp(radius, min, max);
    return this.brush.radius;
  }

  setTerrainTexture(layer, source) {
    const config = TEXTURE_LAYER_UNIFORMS[layer];
    if (!config) return this;

    const mesh = config.mesh === 'water' ? this.waterMesh : this.terrainMesh;
    const uniform = mesh.material.uniforms?.[config.uniform];
    if (!uniform) return this;

    const nextTexture = loadTerrainTextureFromSource(this.textureLoader, source);
    disposeTerrainTexture(uniform.value);
    uniform.value = nextTexture;
    this.textures[layer] = nextTexture;
    return this;
  }

  emitHeightmapChange() {
    this.onHeightmapChange?.(this);
    return this;
  }

  dispose() {
    // Dispose terrain textures
    const texData = this.terrainMesh.material.userData?.textures;
    if (texData) {
      for (const tex of Object.values(texData)) {
        disposeTerrainTexture(tex);
      }
    }

    // Dispose water texture
    disposeTerrainTexture(this.waterMesh.material.uniforms?.uWaterMap?.value);

    this.terrainMesh.geometry.dispose();
    this.waterMesh.geometry.dispose();
    this.terrainMesh.material.dispose();
    this.waterMesh.material.dispose();

    if (this.boundaryFrame) {
      this.boundaryFrame.geometry.dispose();
      this.boundaryFrame.material.dispose();
    }
  }
}

// --- pointerRaycast ---

export function getTerrainHitFromPointer(region, domElement, camera, raycaster, pointer, clientX, clientY) {
  const rect = domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return region.raycast(raycaster);
}

// --- bindTerrainPainting ---

export function bindTerrainPainting(region, options) {
  const {
    domElement,
    camera,
    raycaster,
    pointer,
    setControlsEnabled,
    getHit = (event) => getTerrainHitFromPointer(
      region,
      domElement,
      camera,
      raycaster,
      pointer,
      event.clientX,
      event.clientY,
    ),
  } = options;

  let isPainting = false;

  const onContextMenu = (event) => event.preventDefault();

  const onPointerDown = (event) => {
    if (event.button !== 0) return;

    const hit = getHit(event);
    if (!hit) return;

    isPainting = true;
    region.beginStroke();
    setControlsEnabled?.(false);
    domElement.setPointerCapture(event.pointerId);
    region.paintAt(hit.point, { temporaryLower: event.shiftKey });
  };

  const onPointerMove = (event) => {
    const hit = getHit(event);
    if (!hit) {
      if (region.brushCursor) region.brushCursor.visible = false;
      return;
    }

    const previewMode = event.shiftKey ? 'lower' : region.brush.mode;
    if (region.brushCursor) {
      region.updateBrushCursor(region.brushCursor, hit.point, { mode: previewMode });
    }

    if (isPainting) {
      region.paintAt(hit.point, { temporaryLower: event.shiftKey });
    }
  };

  const onPointerUp = (event) => {
    if (!isPainting) return;

    isPainting = false;
    region.endStroke();
    setControlsEnabled?.(true);

    if (domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerLeave = () => {
    if (!isPainting && region.brushCursor) {
      region.brushCursor.visible = false;
    }
  };

  domElement.addEventListener('contextmenu', onContextMenu);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('pointerleave', onPointerLeave);

  return {
    get isPainting() {
      return isPainting;
    },
    unbind() {
      domElement.removeEventListener('contextmenu', onContextMenu);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
      domElement.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}

// --- bindTextureDrop ---

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function getImageFile(dataTransfer) {
  return [...dataTransfer.files].find((file) => IMAGE_TYPES.has(file.type) || file.type.startsWith('image/')) ?? null;
}

function updateSwatchPreview(swatch, file) {
  if (swatch.dataset.previewUrl) {
    URL.revokeObjectURL(swatch.dataset.previewUrl);
  }

  const previewUrl = URL.createObjectURL(file);
  swatch.dataset.previewUrl = previewUrl;
  swatch.style.backgroundImage = `url("${previewUrl}")`;
}

export function bindTextureDrop(region, root = document) {
  const drops = [...root.querySelectorAll('[data-texture-drop]')];

  const cleanups = drops.map((drop) => {
    const layer = drop.dataset.textureDrop;
    const swatch = drop.querySelector('.swatch') ?? drop;

    const onDragEnter = (event) => {
      event.preventDefault();
      drop.classList.add('is-dragover');
    };

    const onDragOver = (event) => {
      event.preventDefault();
      drop.classList.add('is-dragover');
    };

    const onDragLeave = (event) => {
      if (!drop.contains(event.relatedTarget)) {
        drop.classList.remove('is-dragover');
      }
    };

    const onDrop = (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragover');

      const file = getImageFile(event.dataTransfer);
      if (!file || !layer) return;

      region.setTerrainTexture(layer, file);
      updateSwatchPreview(swatch, file);
    };

    drop.addEventListener('dragenter', onDragEnter);
    drop.addEventListener('dragover', onDragOver);
    drop.addEventListener('dragleave', onDragLeave);
    drop.addEventListener('drop', onDrop);

    return () => {
      drop.removeEventListener('dragenter', onDragEnter);
      drop.removeEventListener('dragover', onDragOver);
      drop.removeEventListener('dragleave', onDragLeave);
      drop.removeEventListener('drop', onDrop);
      drop.classList.remove('is-dragover');

      if (swatch.dataset.previewUrl) {
        URL.revokeObjectURL(swatch.dataset.previewUrl);
        delete swatch.dataset.previewUrl;
      }
    };
  });

  return {
    unbind() {
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}

// --- PBR texture loading helper ---

export async function loadPBRTextureSet(pbrTextures, textureLoader = new THREE.TextureLoader()) {
  const result = {};
  const terrainLayers = ['sand', 'grass', 'rock', 'snow'];

  for (const layer of terrainLayers) {
    if (!pbrTextures[layer]) continue;
    const pbr = pbrTextures[layer];

    const normal = pbr.normal
      ? (pbr.normal.isTexture ? pbr.normal : configureTerrainTexture(textureLoader.load(pbr.normal), false))
      : null;

    let mrao = null;
    if (pbr.metal && pbr.roughness && pbr.ao) {
      mrao = await packMRAO(textureLoader, pbr.metal, pbr.roughness, pbr.ao);
    } else if (pbr.mrao) {
      mrao = pbr.mrao.isTexture ? pbr.mrao : configureTerrainTexture(textureLoader.load(pbr.mrao), false);
    }

    result[layer] = { normal, mrao };
  }

  if (pbrTextures.water) {
    const pbr = pbrTextures.water;
    const normal = pbr.normal
      ? (pbr.normal.isTexture ? pbr.normal : configureTerrainTexture(textureLoader.load(pbr.normal), false))
      : null;

    let mrao = null;
    if (pbr.metal && pbr.roughness && pbr.ao) {
      mrao = await packMRAO(textureLoader, pbr.metal, pbr.roughness, pbr.ao);
    } else if (pbr.mrao) {
      mrao = pbr.mrao.isTexture ? pbr.mrao : configureTerrainTexture(textureLoader.load(pbr.mrao), false);
    }

    result.water = { normal, mrao };
  }

  return result;
}
