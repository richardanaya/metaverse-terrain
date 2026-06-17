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
export const DEFAULT_RENDER_SUBDIVISIONS = 1;
export const MAX_RENDER_SUBDIVISIONS = 4;
export const DEFAULT_TERRAIN_DETAIL_STRENGTH = 0;

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

function normalizeRenderSubdivisions(value = DEFAULT_RENDER_SUBDIVISIONS) {
  return Math.max(1, Math.min(MAX_RENDER_SUBDIVISIONS, Math.round(value)));
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

function renderSamplesFor(samples, renderSubdivisions = DEFAULT_RENDER_SUBDIVISIONS) {
  const subdivisions = normalizeRenderSubdivisions(renderSubdivisions);
  return (samples - 1) * subdivisions + 1;
}

function sampleHeightMap(heightMap, samples, sampleX, sampleZ) {
  const x = clamp(sampleX, 0, samples - 1);
  const z = clamp(sampleZ, 0, samples - 1);
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(samples - 1, x0 + 1);
  const z1 = Math.min(samples - 1, z0 + 1);
  const tx = x - x0;
  const tz = z - z0;
  const a = heightMap[indexFor(x0, z0, samples)];
  const b = heightMap[indexFor(x1, z0, samples)];
  const c = heightMap[indexFor(x0, z1, samples)];
  const d = heightMap[indexFor(x1, z1, samples)];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function estimateHeightNormalY(heightMap, options, sampleX, sampleZ) {
  const { samples, regionSize } = options;
  const step = regionSize / (samples - 1);
  const hL = sampleHeightMap(heightMap, samples, sampleX - 1, sampleZ);
  const hR = sampleHeightMap(heightMap, samples, sampleX + 1, sampleZ);
  const hD = sampleHeightMap(heightMap, samples, sampleX, sampleZ - 1);
  const hU = sampleHeightMap(heightMap, samples, sampleX, sampleZ + 1);
  const dx = (hR - hL) / (step * 2);
  const dz = (hU - hD) / (step * 2);
  return 1 / Math.hypot(dx, 1, dz);
}

function terrainHash2(x, z, seed) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 17.17) * 43758.5453123;
  return n - Math.floor(n);
}

function terrainValueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = terrainHash2(x0, z0, seed);
  const b = terrainHash2(x0 + 1, z0, seed);
  const c = terrainHash2(x0, z0 + 1, seed);
  const d = terrainHash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function terrainFBM(x, z, seed, octaves = 3) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let totalAmplitude = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += terrainValueNoise(x * frequency, z * frequency, seed + octave * 19.19) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / totalAmplitude;
}

function terrainLayerWeightsAt(height, normalY, options) {
  const textureHeights = options.textureHeights ?? DEFAULT_TEXTURE_HEIGHTS;
  const blendWidth = options.textureBlendWidth ?? DEFAULT_TEXTURE_BLEND_WIDTH;
  const moisture = options.moisture ?? 0.5;
  const slope = clamp((1 - normalY) * 2.4, 0, 1);
  const wetEdge = (1 - smoothstep(options.waterLevel - 0.4, options.waterLevel + 2.4, height)) * (options.waterEnabled ? 1 : 0);
  const snowStart = textureHeights.snowStart - (moisture - 0.5) * 4;

  let sandWeight = 1 - smoothstep(textureHeights.sandMax - blendWidth, textureHeights.sandMax, height);
  let grassWeight = smoothstep(textureHeights.grassStart - blendWidth, textureHeights.grassStart + blendWidth, height)
    * (1 - smoothstep(textureHeights.grassEnd - blendWidth, textureHeights.grassEnd + blendWidth, height));
  let rockWeight = smoothstep(textureHeights.rockStart - blendWidth, textureHeights.rockStart + blendWidth, height) + slope * 0.35;
  let snowWeight = smoothstep(snowStart - blendWidth, snowStart + blendWidth, height) * (1 - slope * 0.25);

  sandWeight += wetEdge * 0.9;
  grassWeight *= 1 + slope * 0.75;
  sandWeight *= 1 - slope * 0.25;

  const weights = [Math.max(0.001, sandWeight), Math.max(0.001, grassWeight), Math.max(0.001, rockWeight), Math.max(0.001, snowWeight)];
  const total = weights[0] + weights[1] + weights[2] + weights[3];
  return weights.map((weight) => weight / total);
}

function terrainDetailDisplacement(worldX, worldZ, height, normalY, options) {
  const strength = options.terrainDetailStrength ?? DEFAULT_TERRAIN_DETAIL_STRENGTH;
  if (strength <= 0) return 0;

  const seed = options.seed ?? 0;
  const slope = clamp((1 - normalY) * 2.4, 0, 1);
  const [sandWeight, grassWeight, rockWeight, snowWeight] = terrainLayerWeightsAt(height, normalY, options);

  const sandRipples = (
    Math.sin(worldX * 0.68 + worldZ * 0.18 + seed * 0.07) * 0.12
    + Math.sin(worldX * 1.24 - worldZ * 0.31 + seed * 0.13) * 0.04
  ) * (1 - slope * 0.5);

  const grassNoise = (terrainFBM(worldX * 0.18, worldZ * 0.18, seed + 7, 3) - 0.5) * 0.32;
  const rockRidge = (1 - Math.abs(terrainFBM(worldX * 0.32 + 23, worldZ * 0.32 - 19, seed + 13, 4) * 2 - 1)) * 1.05 - 0.28;
  const snowSoft = (terrainFBM(worldX * 0.11 - 31, worldZ * 0.11 + 17, seed + 29, 2) - 0.5) * 0.12;

  return strength * (
    sandRipples * sandWeight
    + grassNoise * grassWeight
    + rockRidge * rockWeight * (0.4 + slope * 0.9)
    + snowSoft * snowWeight
  );
}

function evaluateTerrainRenderHeight(heightMap, options, renderX, renderZ, renderSamples) {
  const { samples, regionSize } = options;
  const halfRegion = regionSize / 2;
  const tX = renderX / (renderSamples - 1);
  const tZ = renderZ / (renderSamples - 1);
  const sampleX = tX * (samples - 1);
  const sampleZ = tZ * (samples - 1);
  const worldX = tX * regionSize - halfRegion;
  const worldZ = tZ * regionSize - halfRegion;
  const baseHeight = sampleHeightMap(heightMap, samples, sampleX, sampleZ);
  const normalY = estimateHeightNormalY(heightMap, options, sampleX, sampleZ);
  return baseHeight + terrainDetailDisplacement(worldX, worldZ, baseHeight, normalY, options);
}

function createTerrainGeometry(heightMap, options) {
  const { regionSize, samples, renderSubdivisions = DEFAULT_RENDER_SUBDIVISIONS } = options;
  const renderSamples = renderSamplesFor(samples, renderSubdivisions);
  const halfRegion = regionSize / 2;
  const geometry = new THREE.BufferGeometry();
  const vertexCount = renderSamples * renderSamples;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((renderSamples - 1) * (renderSamples - 1) * 6);
  const step = regionSize / (renderSamples - 1);

  for (let z = 0; z < renderSamples; z += 1) {
    for (let x = 0; x < renderSamples; x += 1) {
      const index = indexFor(x, z, renderSamples);
      const positionIndex = index * 3;
      const uvIndex = index * 2;

      positions[positionIndex] = x * step - halfRegion;
      positions[positionIndex + 1] = evaluateTerrainRenderHeight(heightMap, options, x, z, renderSamples);
      positions[positionIndex + 2] = z * step - halfRegion;
      uvs[uvIndex] = (x * step) / DEFAULT_REGION_SIZE;
      uvs[uvIndex + 1] = (z * step) / DEFAULT_REGION_SIZE;
    }
  }

  let indexPointer = 0;
  for (let z = 0; z < renderSamples - 1; z += 1) {
    for (let x = 0; x < renderSamples - 1; x += 1) {
      const a = indexFor(x, z, renderSamples);
      const b = indexFor(x + 1, z, renderSamples);
      const c = indexFor(x, z + 1, renderSamples);
      const d = indexFor(x + 1, z + 1, renderSamples);

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
  geometry.userData.renderSamples = renderSamples;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createWaterGeometry(heightMap, options) {
  const { regionSize, samples, waterLevel, renderSubdivisions = DEFAULT_RENDER_SUBDIVISIONS } = options;
  const renderSamples = renderSamplesFor(samples, renderSubdivisions);
  const halfRegion = regionSize / 2;
  const geometry = new THREE.BufferGeometry();
  const vertexCount = renderSamples * renderSamples;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const waterDepth = new Float32Array(vertexCount);
  const indices = new Uint32Array((renderSamples - 1) * (renderSamples - 1) * 6);
  const step = regionSize / (renderSamples - 1);

  for (let z = 0; z < renderSamples; z += 1) {
    for (let x = 0; x < renderSamples; x += 1) {
      const index = indexFor(x, z, renderSamples);
      const positionIndex = index * 3;
      const uvIndex = index * 2;
      const terrainHeight = evaluateTerrainRenderHeight(heightMap, options, x, z, renderSamples);

      positions[positionIndex] = x * step - halfRegion;
      positions[positionIndex + 1] = 0;
      positions[positionIndex + 2] = z * step - halfRegion;
      uvs[uvIndex] = (x * step) / DEFAULT_REGION_SIZE;
      uvs[uvIndex + 1] = (z * step) / DEFAULT_REGION_SIZE;
      waterDepth[index] = waterLevel - terrainHeight;
    }
  }

  let indexPointer = 0;
  for (let z = 0; z < renderSamples - 1; z += 1) {
    for (let x = 0; x < renderSamples - 1; x += 1) {
      const a = indexFor(x, z, renderSamples);
      const b = indexFor(x + 1, z, renderSamples);
      const c = indexFor(x, z + 1, renderSamples);
      const d = indexFor(x + 1, z + 1, renderSamples);

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
  geometry.userData.renderSamples = renderSamples;
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

function updateWaterDepthData(heightMap, waterMesh, options) {
  const depthAttribute = waterMesh?.geometry?.attributes?.waterDepth;
  if (!depthAttribute) return;
  const renderSamples = waterMesh.geometry.userData.renderSamples ?? renderSamplesFor(options.samples, options.renderSubdivisions);

  for (let z = 0; z < renderSamples; z += 1) {
    for (let x = 0; x < renderSamples; x += 1) {
      const index = indexFor(x, z, renderSamples);
      depthAttribute.array[index] = options.waterLevel - evaluateTerrainRenderHeight(heightMap, options, x, z, renderSamples);
    }
  }

  depthAttribute.needsUpdate = true;
}

function syncHeightMapToGeometry(heightMap, terrainMesh, waterMesh, options) {
  const position = terrainMesh.geometry.attributes.position;
  const renderSamples = terrainMesh.geometry.userData.renderSamples ?? renderSamplesFor(options.samples, options.renderSubdivisions);

  for (let z = 0; z < renderSamples; z += 1) {
    for (let x = 0; x < renderSamples; x += 1) {
      const index = indexFor(x, z, renderSamples);
      position.array[index * 3 + 1] = evaluateTerrainRenderHeight(heightMap, options, x, z, renderSamples);
    }
  }

  position.needsUpdate = true;
  terrainMesh.geometry.computeVertexNormals();
  terrainMesh.geometry.attributes.normal.needsUpdate = true;
  terrainMesh.geometry.computeBoundingSphere();
  updateWaterDepthData(heightMap, waterMesh, options);
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

  // Triplanar sampling: blend 3 world-space projections by normal dominance.
  // Fixes stretched textures on vertical cliffs (heightfield faces). Each
  // projection still goes through hex-tiling to avoid seams.
  vec3 hexTileTriplanar(sampler2D tex, vec3 worldPos, vec3 worldNormal, float uvScale, float hexTileRate, float hexContrastR) {
    vec3 nrm = normalize(worldNormal);
    vec3 blend = pow(abs(nrm), vec3(4.0));
    blend /= max(blend.x + blend.y + blend.z, 0.0001);

    // XZ plane (top), XY plane (front), ZY plane (side)
    vec2 uvXZ = worldPos.xz * uvScale;
    vec2 uvXY = worldPos.xy * uvScale;
    vec2 uvZY = worldPos.zy * uvScale;

    vec3 cXZ = hexTileColor(tex, uvXZ, hexTileRate, hexContrastR);
    vec3 cXY = hexTileColor(tex, uvXY, hexTileRate, hexContrastR);
    vec3 cZY = hexTileColor(tex, uvZY, hexTileRate, hexContrastR);

    return cXZ * blend.y + cXY * blend.z + cZY * blend.x;
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
    triplanarEnabled = true,
    wetSandEnabled = true,
    snowSparklesEnabled = true,
    noisePerturbEnabled = true,
    cavityAOEnabled = true,
    moisture = 0.5,
    sunDirection = new THREE.Vector3(...DEFAULT_SUN_DIRECTION),
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
    shader.uniforms.uTriplanarEnabled = { value: triplanarEnabled ? 1.0 : 0.0 };
    shader.uniforms.uWetSandEnabled = { value: wetSandEnabled ? 1.0 : 0.0 };
    shader.uniforms.uSnowSparklesEnabled = { value: snowSparklesEnabled ? 1.0 : 0.0 };
    shader.uniforms.uNoisePerturbEnabled = { value: noisePerturbEnabled ? 1.0 : 0.0 };
    shader.uniforms.uCavityAOEnabled = { value: cavityAOEnabled ? 1.0 : 0.0 };
    shader.uniforms.uMoisture = { value: moisture };
    shader.uniforms.uSunDirection = { value: sunDirection };

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
      varying vec3 vTerrainWorldPos;
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
      uniform float uTriplanarEnabled;
      uniform float uWetSandEnabled;
      uniform float uSnowSparklesEnabled;
      uniform float uNoisePerturbEnabled;
      uniform float uCavityAOEnabled;
      uniform float uMoisture;
      uniform vec3 uSunDirection;
    `;

    const terrainBlendGLSL = `
      // Cheap hash-based value noise for perturbing layer transitions.
      float terrainHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float terrainValueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = terrainHash(i);
        float b = terrainHash(i + vec2(1.0, 0.0));
        float c = terrainHash(i + vec2(0.0, 1.0));
        float d = terrainHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Perturb height to break up clean horizontal banding at layer transitions.
      float perturbedHeight(float height, vec3 worldPos) {
        if (uNoisePerturbEnabled < 0.5) return height;
        float n = terrainValueNoise(worldPos.xz * 0.18) * 2.5 - 1.25;
        return height + n;
      }

      // Cavity AO from procedural height gradient: sample noise at offset to
      // approximate local concavity. Darkens valleys/gullies.
      float terrainCavityAO(vec3 worldPos) {
        if (uCavityAOEnabled < 0.5) return 1.0;
        float here = terrainValueNoise(worldPos.xz * 0.08);
        float dx = terrainValueNoise((worldPos.xz + vec2(1.5, 0.0)) * 0.08);
        float dz = terrainValueNoise((worldPos.xz + vec2(0.0, 1.5)) * 0.08);
        float concavity = max(0.0, (here - dx) + (here - dz)) * 2.0;
        return 1.0 - clamp(concavity, 0.0, 0.6);
      }

      // Moisture shifts grass green->brown and lowers the snow line.
      vec3 moistureTint(vec3 albedo, float height, vec4 weights) {
        if (uMoisture < 0.5) return albedo;
        float m = (uMoisture - 0.5) * 2.0;
        vec3 brown = vec3(0.55, 0.45, 0.30);
        vec3 lush = vec3(0.20, 0.45, 0.15);
        vec3 grassTint = mix(vec3(1.0), lush, m);
        albedo = mix(albedo, albedo * grassTint, weights.y * m);
        albedo = mix(albedo, albedo * mix(vec3(1.0), brown, m), weights.x * m * 0.5);
        return albedo;
      }

      // Snow sparkles: high-freq noise thresholded against sun-facing normal.
      vec3 snowSparkles(vec3 albedo, vec3 worldNormal, vec3 worldPos) {
        if (uSnowSparklesEnabled < 0.5) return albedo;
        vec3 sunDir = normalize(uSunDirection);
        float sunFacing = max(dot(normalize(worldNormal), sunDir), 0.0);
        float sparkleN = terrainValueNoise(worldPos.xz * 90.0);
        float sparkle = step(0.93, sparkleN) * smoothstep(0.3, 0.8, sunFacing);
        return albedo + vec3(0.5) * sparkle;
      }

      vec4 terrainLayerWeights(float terrainHeight, vec3 terrainWorldNormal) {
        vec3 geomNormal = normalize(terrainWorldNormal);
        float slope = clamp((1.0 - geomNormal.y) * 2.4, 0.0, 1.0);
        float wetEdge = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, terrainHeight)) * uWaterEnabled;

        // Moisture lowers the effective snow line so wetter climates snow earlier.
        float snowStartEff = uSnowStart - (uMoisture - 0.5) * 4.0;

        float sandWeight = 1.0 - smoothstep(uSandMax - uBlendWidth, uSandMax, terrainHeight);
        float grassWeight = smoothstep(uGrassStart - uBlendWidth, uGrassStart + uBlendWidth, terrainHeight)
          * (1.0 - smoothstep(uGrassEnd - uBlendWidth, uGrassEnd + uBlendWidth, terrainHeight));
        float rockWeight = smoothstep(uRockStart - uBlendWidth, uRockStart + uBlendWidth, terrainHeight) + slope * 0.35;
        float snowWeight = smoothstep(snowStartEff - uBlendWidth, snowStartEff + uBlendWidth, terrainHeight) * (1.0 - slope * 0.25);

        sandWeight += wetEdge * 0.9;
        grassWeight *= 1.0 + slope * 0.75;
        sandWeight *= 1.0 - slope * 0.25;

        vec4 weights = max(vec4(sandWeight, grassWeight, rockWeight, snowWeight), vec4(0.001));
        return weights / (weights.x + weights.y + weights.z + weights.w);
      }

      mat3 terrainTangentFrame(vec3 worldNormal) {
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

      // Per-layer normal strength: rock strong, snow subtle, grass/sand medium.
      float layerNormalStrength(vec4 weights) {
        float rockScale = 1.2;
        float snowScale = 0.4;
        float grassScale = 0.8;
        float sandScale = 0.6;
        return weights.x * sandScale + weights.y * grassScale + weights.z * rockScale + weights.w * snowScale;
      }

      vec3 terrainSampleNormal(vec4 weights) {
        vec3 n = vec3(0.0);
        n += (texture2D(uSandNormal, vTerrainUv * uTextureScale * 1.15).xyz * 2.0 - 1.0) * weights.x;
        n += (texture2D(uGrassNormal, vTerrainUv * uTextureScale).xyz * 2.0 - 1.0) * weights.y;
        n += (texture2D(uRockNormal, vTerrainUv * uTextureScale * 0.82).xyz * 2.0 - 1.0) * weights.z;
        n += (texture2D(uSnowNormal, vTerrainUv * uTextureScale * 0.66).xyz * 2.0 - 1.0) * weights.w;
        n = normalize(n);
        float layerStrength = layerNormalStrength(weights) * uNormalStrength;
        n.xy *= layerStrength;
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
      vTerrainUv = uv;
      vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );


    // Replace color_fragment with hex-tiled multi-layer blending
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `// --- Hex-tiled multi-layer terrain blending ---
      vec2 terrainTiledUv = vTerrainUv * uTextureScale;
      vec3 geomNormal = normalize(vTerrainWorldNormal);
      float slope = clamp((1.0 - geomNormal.y) * 2.4, 0.0, 1.0);

      // #4: Noise-perturbed height breaks up clean horizontal banding.
      float effHeight = perturbedHeight(vTerrainHeight, vTerrainWorldPos);

      vec4 terrainWeights = terrainLayerWeights(effHeight, vTerrainWorldNormal);

      // #1: Triplanar mapping on steep slopes, regular sampling on flat ground.
      float triplanarBlend = smoothstep(0.35, 0.7, slope) * uTriplanarEnabled;
      vec3 sandColor;
      vec3 grassColor;
      vec3 rockColor;
      vec3 snowColor;
      if (triplanarBlend > 0.01) {
        float tpScale = uTextureScale / 256.0;
        vec3 tpSand = hexTileTriplanar(uSand, vTerrainWorldPos, vTerrainWorldNormal, tpScale * 1.15, uHexTileRate, uHexContrastR);
        vec3 tpGrass = hexTileTriplanar(uGrass, vTerrainWorldPos, vTerrainWorldNormal, tpScale, uHexTileRate, uHexContrastR);
        vec3 tpRock = hexTileTriplanar(uRock, vTerrainWorldPos, vTerrainWorldNormal, tpScale * 0.82, uHexTileRate, uHexContrastR);
        vec3 tpSnow = hexTileTriplanar(uSnow, vTerrainWorldPos, vTerrainWorldNormal, tpScale * 0.66, uHexTileRate, uHexContrastR);
        vec3 flatSand = hexTileColor(uSand, terrainTiledUv * 1.15, uHexTileRate, uHexContrastR);
        vec3 flatGrass = hexTileColor(uGrass, terrainTiledUv, uHexTileRate, uHexContrastR);
        vec3 flatRock = hexTileColor(uRock, terrainTiledUv * 0.82, uHexTileRate, uHexContrastR);
        vec3 flatSnow = hexTileColor(uSnow, terrainTiledUv * 0.66, uHexTileRate, uHexContrastR);
        sandColor = mix(flatSand, tpSand, triplanarBlend);
        grassColor = mix(flatGrass, tpGrass, triplanarBlend);
        rockColor = mix(flatRock, tpRock, triplanarBlend);
        snowColor = mix(flatSnow, tpSnow, triplanarBlend);
      } else {
        sandColor = hexTileColor(uSand, terrainTiledUv * 1.15, uHexTileRate, uHexContrastR);
        grassColor = hexTileColor(uGrass, terrainTiledUv, uHexTileRate, uHexContrastR);
        rockColor = hexTileColor(uRock, terrainTiledUv * 0.82, uHexTileRate, uHexContrastR);
        snowColor = hexTileColor(uSnow, terrainTiledUv * 0.66, uHexTileRate, uHexContrastR);
      }

      vec3 terrainAlbedo = sandColor * terrainWeights.x + grassColor * terrainWeights.y + rockColor * terrainWeights.z + snowColor * terrainWeights.w;

      // #2: Wet sand near shoreline — darken albedo, will lower roughness later.
      float wetEdge = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, vTerrainHeight)) * uWaterEnabled;
      float wetness = wetEdge * uWetSandEnabled;
      terrainAlbedo = mix(terrainAlbedo, terrainAlbedo * 0.55, wetness * 0.7);

      // #7: Moisture tint (lush grass in wet climates, brown in dry).
      terrainAlbedo = moistureTint(terrainAlbedo, vTerrainHeight, terrainWeights);

      // #3: Snow sparkles in direct sun.
      terrainAlbedo = snowSparkles(terrainAlbedo, vTerrainWorldNormal, vTerrainWorldPos);

      // #6: Cavity AO darkens valleys/gullies.
      float cavityAO = terrainCavityAO(vTerrainWorldPos);
      terrainAlbedo *= cavityAO;

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
          // #2: Wet sand is shinier (lower roughness) near shoreline.
          float wetEdgeR = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, vTerrainHeight)) * uWaterEnabled;
          float wetnessR = wetEdgeR * uWetSandEnabled;
          roughnessFactor = mix(roughnessFactor, 0.08, wetnessR * 0.7);
          // #6: Cavity AO also raises roughness in crevices.
          roughnessFactor = mix(roughnessFactor, 1.0, (1.0 - cavityAO) * 0.3);
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
  uniform vec2 uWindDirection;
  uniform float uWindSpeed;

  varying vec2 vUv;
  varying float vTerrainDepth;
  varying vec3 vWaveNormal;
  varying vec3 vWorldPosition;
  varying float vWaveJacobian;

  const float PI = 3.14159265359;

  vec2 rotateDir(vec2 dir, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec2(c * dir.x - s * dir.y, s * dir.x + c * dir.y);
  }

  // Gerstner wave base parameters: 5 waves with decreasing amplitude,
  // increasing frequency, and angular spread around the wind direction.
  // Amplitudes are scaled at runtime by uWindSpeed.
  const float A1 = 0.16, A2 = 0.10, A3 = 0.07, A4 = 0.04, A5 = 0.025;
  const float W1 = 0.45, W2 = 0.72, W3 = 1.05, W4 = 1.48, W5 = 2.10;
  const float Q1 = 0.85, Q2 = 0.80, Q3 = 0.70, Q4 = 0.55, Q5 = 0.40;
  const float OFF1 = 0.0, OFF2 = 0.31, OFF3 = -0.44, OFF4 = 0.73, OFF5 = -0.26;

  void main() {
    vUv = uv;
    vTerrainDepth = waterDepth;

    float waveMask = smoothstep(0.12, 3.0, waterDepth);
    vec2 pos = position.xz;
    vec2 windDir = normalize(uWindDirection);
    // windScale: 1.0 at default speed (5.0). 0 = calm (flat), 15 = stormy (3x).
    float windScale = uWindSpeed / 5.0;
    float scaledTime = uTime * windScale;

    // Scaled amplitudes — bigger waves with more wind.
    float a1 = A1 * windScale, a2 = A2 * windScale, a3 = A3 * windScale, a4 = A4 * windScale, a5 = A5 * windScale;

    vec2 D1 = rotateDir(windDir, OFF1);
    vec2 D2 = rotateDir(windDir, OFF2);
    vec2 D3 = rotateDir(windDir, OFF3);
    vec2 D4 = rotateDir(windDir, OFF4);
    vec2 D5 = rotateDir(windDir, OFF5);

    float p1 = W1 * dot(D1, pos) + sqrt(9.8 * W1) * scaledTime * 0.5;
    float p2 = W2 * dot(D2, pos) + sqrt(9.8 * W2) * scaledTime * 0.5;
    float p3 = W3 * dot(D3, pos) + sqrt(9.8 * W3) * scaledTime * 0.5;
    float p4 = W4 * dot(D4, pos) + sqrt(9.8 * W4) * scaledTime * 0.5;
    float p5 = W5 * dot(D5, pos) + sqrt(9.8 * W5) * scaledTime * 0.5;

    float c1 = cos(p1), c2 = cos(p2), c3 = cos(p3), c4 = cos(p4), c5 = cos(p5);
    float s1 = sin(p1), s2 = sin(p2), s3 = sin(p3), s4 = sin(p4), s5 = sin(p5);

    vec3 transformed = position;
    float waveHeight = a1*s1 + a2*s2 + a3*s3 + a4*s4 + a5*s5;
    transformed.x += (Q1*a1*D1.x*c1 + Q2*a2*D2.x*c2 + Q3*a3*D3.x*c3 + Q4*a4*D4.x*c4 + Q5*a5*D5.x*c5) * waveMask;
    transformed.z += (Q1*a1*D1.y*c1 + Q2*a2*D2.y*c2 + Q3*a3*D3.y*c3 + Q4*a4*D4.y*c4 + Q5*a5*D5.y*c5) * waveMask;
    transformed.y += waveHeight * waveMask;

    float WA1 = a1*W1, WA2 = a2*W2, WA3 = a3*W3, WA4 = a4*W4, WA5 = a5*W5;

    vec3 B = vec3(
      1.0 - (Q1*a1*D1.x*D1.x*W1*s1 + Q2*a2*D2.x*D2.x*W2*s2 + Q3*a3*D3.x*D3.x*W3*s3 + Q4*a4*D4.x*D4.x*W4*s4 + Q5*a5*D5.x*D5.x*W5*s5) * waveMask,
      (WA1*D1.x*c1 + WA2*D2.x*c2 + WA3*D3.x*c3 + WA4*D4.x*c4 + WA5*D5.x*c5) * waveMask,
      -(Q1*a1*D1.x*D1.y*W1*s1 + Q2*a2*D2.x*D2.y*W2*s2 + Q3*a3*D3.x*D3.y*W3*s3 + Q4*a4*D4.x*D4.y*W4*s4 + Q5*a5*D5.x*D5.y*W5*s5) * waveMask
    );
    vec3 T = vec3(
      -(Q1*a1*D1.x*D1.y*W1*s1 + Q2*a2*D2.x*D2.y*W2*s2 + Q3*a3*D3.x*D3.y*W3*s3 + Q4*a4*D4.x*D4.y*W4*s4 + Q5*a5*D5.x*D5.y*W5*s5) * waveMask,
      (WA1*D1.y*c1 + WA2*D2.y*c2 + WA3*D3.y*c3 + WA4*D4.y*c4 + WA5*D5.y*c5) * waveMask,
      1.0 - (Q1*a1*D1.y*D1.y*W1*s1 + Q2*a2*D2.y*D2.y*W2*s2 + Q3*a3*D3.y*D3.y*W3*s3 + Q4*a4*D4.y*D4.y*W4*s4 + Q5*a5*D5.y*D5.y*W5*s5) * waveMask
    );

    // cross(T, B) — not cross(B, T) — so the normal faces +y (up).
    vWaveNormal = normalize(cross(T, B));
    vWaveJacobian = B.x * T.z - B.z * T.x;

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
  uniform float uWaterLevel;

  // PBR water uniforms
  uniform sampler2D uWaterNormal;
  uniform sampler2D uWaterMRAO;
  uniform float uPBREnabled;
  uniform float uWaterIOR;
  uniform float uWaterDarkness;

  // IBL reflection (equirectangular HDR sampled directly; PMREM CubeUV layout
  // is incompatible with samplerCube, so we use sampler2D + equirect UVs).
  uniform sampler2D uEnvironment;
  uniform float uEnvEnabled;

  // Refraction seabed
  uniform sampler2D uSandMap;
  uniform sampler2D uGrassMap;
  uniform sampler2D uRockMap;
  uniform sampler2D uSnowMap;
  uniform float uSandMax;
  uniform float uGrassStart;
  uniform float uGrassEnd;
  uniform float uRockStart;
  uniform float uSnowStart;
  uniform float uSeabedUVScale;
  uniform float uRefractionEnabled;

  varying vec2 vUv;
  varying float vTerrainDepth;
  varying vec3 vWaveNormal;
  varying vec3 vWorldPosition;
  varying float vWaveJacobian;

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

  // waterDarkness: 0 = pristine beach (clear turquoise), 0.5 = ocean, 1 = swamp (murky).
  vec3 waterEffectiveShallow() {
    vec3 pristine = vec3(0.35, 0.82, 0.78);
    vec3 swamp = vec3(0.32, 0.36, 0.22);
    if (uWaterDarkness < 0.5) {
      return mix(uShallowColor, pristine, 1.0 - uWaterDarkness * 2.0);
    }
    return mix(uShallowColor, swamp, (uWaterDarkness - 0.5) * 2.0);
  }

  vec3 waterEffectiveDeep() {
    vec3 pristine = vec3(0.10, 0.42, 0.52);
    vec3 swamp = vec3(0.14, 0.16, 0.08);
    if (uWaterDarkness < 0.5) {
      return mix(uDeepColor, pristine, 1.0 - uWaterDarkness * 2.0);
    }
    return mix(uDeepColor, swamp, (uWaterDarkness - 0.5) * 2.0);
  }

  float waterAbsorptionScale() {
    return mix(0.35, 3.0, uWaterDarkness);
  }

  // Analytic sky fallback when no IBL environment is bound.
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

  // Convert a direction to equirectangular UVs.
  vec2 directionToEquirectUV(vec3 dir) {
    float u = atan(dir.z, dir.x) * 0.15915494309; // / (2*PI)
    float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830988618; // / PI
    return vec2(u + 0.5, v + 0.5);
  }

  // Sample the equirect HDR environment. Roughness is approximated by blending
  // a few rotated samples — no shader_texture_lod extension required.
  vec3 sampleEnvReflection(vec3 reflectedView, float roughness, vec3 sunDir) {
    if (uEnvEnabled > 0.5) {
      vec2 uv = directionToEquirectUV(reflectedView);
      if (roughness < 0.1) {
        return texture2D(uEnvironment, uv).rgb;
      }
      // Cheap roughness blur: 3 rotated taps within a radius scaled by roughness.
      float r = roughness * 0.04;
      vec2 aUv = directionToEquirectUV(reflectedView + vec3(r, 0.0, 0.0));
      vec2 bUv = directionToEquirectUV(reflectedView + vec3(0.0, 0.0, r));
      vec3 base = texture2D(uEnvironment, uv).rgb;
      vec3 a = texture2D(uEnvironment, aUv).rgb;
      vec3 b = texture2D(uEnvironment, bUv).rgb;
      return (base + a + b) / 3.0;
    }
    return waterSkyReflection(reflectedView, sunDir);
  }

  // Henyey-Greenstein phase function for forward-scattered SSS.
  float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
  }

  // Simplified height-based terrain blend for refraction seabed (no hex-tiling).
  vec3 sampleSeabed(vec2 worldXZ, float terrainHeight) {
    vec2 sUV = worldXZ * uSeabedUVScale;
    float sw = 1.0 - smoothstep(uSandMax - 4.0, uSandMax, terrainHeight);
    float gw = smoothstep(uGrassStart - 4.0, uGrassStart + 4.0, terrainHeight)
      * (1.0 - smoothstep(uGrassEnd - 4.0, uGrassEnd + 4.0, terrainHeight));
    float rw = smoothstep(uRockStart - 4.0, uRockStart + 4.0, terrainHeight);
    float nw = smoothstep(uSnowStart - 4.0, uSnowStart + 4.0, terrainHeight);
    vec4 w = max(vec4(sw, gw, rw, nw), vec4(0.001));
    w /= (w.x + w.y + w.z + w.w);
    vec3 sandC = texture2D(uSandMap, sUV).rgb;
    vec3 grassC = texture2D(uGrassMap, sUV).rgb;
    vec3 rockC = texture2D(uRockMap, sUV).rgb;
    vec3 snowC = texture2D(uSnowMap, sUV).rgb;
    return sandC*w.x + grassC*w.y + rockC*w.z + snowC*w.w;
  }

  // Refract view ray to seabed plane and return color with Beer-Lambert absorption.
  vec3 sampleRefractedSeabed(vec3 viewDir, vec3 normal, float terrainHeight) {
    vec3 refractDir = refract(-viewDir, normal, 1.0 / uWaterIOR);
    float dy = terrainHeight - vWorldPosition.y;
    float marchDist = dy / max(abs(refractDir.y), 0.05);
    vec2 seabedXZ = vWorldPosition.xz + refractDir.xz * marchDist;
    vec3 seabedColor = sampleSeabed(seabedXZ, terrainHeight);
    vec3 sigmaT = vec3(0.8, 0.35, 0.12);
    vec3 transmittance = exp(-sigmaT * abs(marchDist) * 0.12);
    seabedColor *= transmittance;
    return mix(uDeepColor, seabedColor, exp(-abs(marchDist) * 0.08));
  }

  // Volumetric SSS: refracted light path through column with Beer-Lambert + HG phase.
  vec3 subsurfaceScattering(vec3 viewDir, vec3 normal, vec3 sunDir, float NdotL, float depthMix) {
    vec3 refractLight = refract(-sunDir, normal, 1.0 / uWaterIOR);
    float waterColumn = max(vTerrainDepth, 0.0);
    vec3 sigmaT = vec3(0.8, 0.35, 0.12);
    vec3 lightTrans = exp(-sigmaT * waterColumn * 0.12);
    vec3 viewTrans = exp(-sigmaT * waterColumn * 0.12);
    float cosTheta = dot(refractLight, -viewDir);
    float hg = henyeyGreenstein(cosTheta, 0.7);
    float sss = hg * max(NdotL, 0.0) * (1.0 - depthMix * 0.3);
    return vec3(0.0, 0.45, 0.55) * lightTrans * viewTrans * sss * 0.4;
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

    // Sun-angle-dependent light path: light travels depth / sin(elevation)
    // through the water column. Low sun = longer path = darker, more absorbed.
    // Used by spectral Beer-Lambert base color and refraction in the PBR path.
    float sunAngleFactor = 1.0 / max(sunDir.y, 0.12);
    float lightPath = depth * sunAngleFactor;
    // Spectral absorption coefficients: red dies first, blue last.
    // Scaled by water darkness (pristine = clear, swamp = murky).
    vec3 sigmaT = vec3(0.18, 0.10, 0.04) * waterAbsorptionScale();
    vec3 spectralTransmittance = exp(-sigmaT * lightPath);
    float spectralAbsorption = 1.0 - spectralTransmittance.g;
    float spectralAlpha = 1.0 - exp(-lightPath * 0.32);

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

      // Ripple-driven glints keep water lively from most angles. The
      // multi-tier pow-N mirror fakes are gone — GGX + IBL handle the
      // roughness distribution properly now.
      float glancingBoost = smoothstep(0.18, 0.82, 1.0 - NdotV);
      float sunFacing = smoothstep(-0.05, 0.65, NdotL);
      float glintScale = mix(0.03, 1.0, daylight);
      float persistentGlint = (0.075 + 0.18 * sunFacing) * (0.62 + 0.38 * rippleCrest) * (1.0 - depthMix * 0.18) * glintScale;
      float grazingGlint = glancingBoost * (0.07 + 0.15 * rippleCrest) * glintScale;

      // IBL reflection replaces analytic sky when scene.environment is bound.
      vec3 reflectedView = reflect(-viewDirection, normal);
      vec3 skyReflection = sampleEnvReflection(reflectedView, roughness, sunDir);
      float glancingReflection = (0.11 + pow(1.0 - NdotV, 1.7) * 0.46 + fresnel * 0.58) * mix(0.45, 1.0, daylight);

      vec3 baseColor = mix(waterEffectiveShallow(), waterEffectiveDeep(), 1.0 - spectralTransmittance);

      // Refraction: blend refracted seabed into shallow water. Fades out as
      // spectral absorption climbs (deep water at low sun = opaque).
      if (uRefractionEnabled > 0.5) {
        float terrainHeight = uWaterLevel - vTerrainDepth;
        vec3 seabedColor = sampleRefractedSeabed(viewDirection, normal, terrainHeight);
        baseColor = mix(seabedColor, baseColor, spectralAbsorption);
      }

      baseColor = mix(baseColor, waterSample, mix(0.16, 0.055, spectralAbsorption));
      baseColor *= mix(1.08, 0.64, spectralAbsorption) * mix(0.52, 1.0, daylight);
      baseColor += ripple * mix(0.025, 0.010, spectralAbsorption);

      // Volumetric SSS with Beer-Lambert depth absorption.
      vec3 subsurface = subsurfaceScattering(viewDirection, normal, L, NdotL, depthMix) * daylight;

      vec3 fresnelTint = mix(vec3(0.15, 0.22, 0.32), vec3(0.72, 0.88, 0.96), daylight);
      finalColor = baseColor * (1.0 - fresnel * 0.42);
      finalColor = mix(finalColor, skyReflection, clamp(glancingReflection, 0.0, 0.68));
      finalColor += vec3(1.0, 0.95, 0.8) * (spec * NdotL * 0.38 * daylight + persistentGlint + grazingGlint);
      finalColor += subsurface;
      finalColor = mix(finalColor, fresnelTint, fresnel * 0.14);

      // Foam: Jacobian-driven breaking-wave foam + shore foam.
      float shore = 1.0 - smoothstep(0.0, 2.4, vTerrainDepth);
      float jacobianFoam = smoothstep(0.4, -0.2, vWaveJacobian);
      float textureFoam = smoothstep(0.74, 0.98, waterDetail) * smoothstep(0.5, 3.8, vTerrainDepth);
      float foam = max(shore * smoothstep(0.18, 0.78, jacobianFoam + ripple * 0.42) * 0.68, jacobianFoam * 0.25) + textureFoam * 0.07;
      finalColor = mix(finalColor, uFoamColor, foam * 0.32);

      finalAlpha = mix(uWaterAlphaShallow, uWaterAlphaDeep, spectralAlpha) * mix(0.75, 1.25, uWaterDarkness) + fresnel * 0.16 + shore * 0.08;
    } else {
      // --- Legacy water ---
      vec3 baseNormal = normalize(vWaveNormal + vec3((waterDetail - waterDetailX) * 1.35, 0.0, (waterDetail - waterDetailY) * 1.35));
      float depth2 = clamp(vTerrainDepth, 0.0, 24.0);
      float depthMix2 = smoothstep(0.0, 13.0, depth2);
      float depthAbsorption2 = 1.0 - exp(-depth2 * 0.18 * waterAbsorptionScale());
      float depthAlpha2 = 1.0 - exp(-depth2 * 0.32 * waterAbsorptionScale());
      float fresnel2 = pow(1.0 - max(dot(baseNormal, viewDirection), 0.0), 3.0);

      float ripple2 = waterRippleSignal(waterWorldXZ, uTime);
      float rippleFine2 = waterRippleSignal(waterWorldXZ * 1.73 + vec2(19.0, -31.0), uTime * 1.19);
      float rippleCrest2 = smoothstep(0.42, 1.0, ripple2 * 0.62 + rippleFine2 * 0.38);

      vec3 color = mix(waterEffectiveShallow(), waterEffectiveDeep(), depthAbsorption2);

      // Refraction in legacy mode too.
      if (uRefractionEnabled > 0.5) {
        float terrainHeight = uWaterLevel - vTerrainDepth;
        vec3 seabedColor = sampleRefractedSeabed(viewDirection, baseNormal, terrainHeight);
        color = mix(seabedColor, color, depthAbsorption2);
      }

      color = mix(color, waterSample, mix(0.16, 0.055, depthAbsorption2));
      color *= mix(1.08, 0.64, depthAbsorption2);
      color += ripple2 * mix(0.035, 0.014, depthAbsorption2);
      color *= mix(0.52, 1.0, daylight);
      vec3 reflectedView2 = reflect(-viewDirection, baseNormal);
      vec3 skyReflection2 = sampleEnvReflection(reflectedView2, 0.1, sunDir);
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

      // Simplified SSS for legacy mode.
      float sss2 = pow(max(dot(viewDirection, -sunDir), 0.0), 4.0) * 0.12 * daylight;
      color += vec3(0.0, 0.4, 0.5) * sss2 * (1.0 - depthMix2);

      float shore2 = 1.0 - smoothstep(0.0, 2.4, vTerrainDepth);
      float jacobianFoam2 = smoothstep(0.4, -0.2, vWaveJacobian);
      float textureFoam2 = smoothstep(0.74, 0.98, waterDetail) * smoothstep(0.5, 3.8, vTerrainDepth);
      float foam2 = max(shore2 * smoothstep(0.18, 0.78, jacobianFoam2 + ripple2 * 0.42) * 0.68, jacobianFoam2 * 0.25) + textureFoam2 * 0.07;
      color = mix(color, uFoamColor, foam2 * 0.32);

      finalColor = color;
      finalAlpha = mix(uWaterAlphaShallow, uWaterAlphaDeep, depthAlpha2) * mix(0.75, 1.25, uWaterDarkness) + fresnel2 * 0.16 + shore2 * 0.08;
    }

    // Distance fog
    float distanceToCamera = length(cameraPosition - vWorldPosition);
    float fogAmount = smoothstep(260.0, 520.0, distanceToCamera) * 0.42;
    finalColor = mix(finalColor, uFogColor, fogAmount);

    float visibility = smoothstep(-0.1, 0.35, vTerrainDepth);
    finalAlpha = clamp(finalAlpha * visibility, 0.0, uWaterAlphaMax);

    gl_FragColor = vec4(finalColor, finalAlpha);

    // Tone map + encode to output color space (same pipeline as MeshStandardMaterial).
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
    waterLevel = DEFAULT_WATER_LEVEL,
    terrainTextures = null,
    textureHeights = DEFAULT_TEXTURE_HEIGHTS,
    textureDensity = DEFAULT_TEXTURE_DENSITY,
    windDirection = [1, 0.3],
    windSpeed = 5.0,
    waterDarkness = 0.5,
    environment = null,
    refractionEnabled = true,
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

  // Placeholder textures for refraction seabed (1x1 neutral) — replaced with
  // actual terrain albedo textures by TerrainRegion after both meshes exist.
  const seabedPlaceholder = createSolidTerrainTexture(128, 128, 128, 255, false);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
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
      uWaterLevel: { value: waterLevel },
      uWaterNormal: { value: waterPBR?.normal ? loadTerrainTexture(textureLoader, waterPBR.normal, false) : defaultNormal },
      uWaterMRAO: { value: waterPBR?.mrao ? loadTerrainTexture(textureLoader, waterPBR.mrao, false) : defaultMRAO },
      uPBREnabled: { value: hasPBR ? 1.0 : 0.0 },
      uWaterIOR: { value: 1.33 },
      uWaterDarkness: { value: waterDarkness },
      uEnvironment: { value: environment },
      uEnvEnabled: { value: environment ? 1.0 : 0.0 },
      uSandMap: { value: terrainTextures?.sand ?? seabedPlaceholder },
      uGrassMap: { value: terrainTextures?.grass ?? seabedPlaceholder },
      uRockMap: { value: terrainTextures?.rock ?? seabedPlaceholder },
      uSnowMap: { value: terrainTextures?.snow ?? seabedPlaceholder },
      uSandMax: { value: textureHeights.sandMax },
      uGrassStart: { value: textureHeights.grassStart },
      uGrassEnd: { value: textureHeights.grassEnd },
      uRockStart: { value: textureHeights.rockStart },
      uSnowStart: { value: textureHeights.snowStart },
      uSeabedUVScale: { value: textureDensity / DEFAULT_REGION_SIZE },
      uRefractionEnabled: { value: refractionEnabled ? 1.0 : 0.0 },
      uWindDirection: { value: new THREE.Vector2(windDirection[0], windDirection[1]).normalize() },
      uWindSpeed: { value: windSpeed },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
  });

  material.userData.seabedPlaceholder = seabedPlaceholder;
  return material;
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
    this.renderSubdivisions = normalizeRenderSubdivisions(options.renderSubdivisions);
    this.terrainDetailStrength = Math.max(0, options.terrainDetailStrength ?? DEFAULT_TERRAIN_DETAIL_STRENGTH);
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
    this.environment = options.environment ?? null;
    this.refractionEnabled = options.refractionEnabled ?? true;
    this.windDirection = options.windDirection ?? [1, 0.3];
    this.windSpeed = options.windSpeed ?? 5.0;
    this.waterDarkness = options.waterDarkness ?? 0.5;
    this.triplanarEnabled = options.triplanarEnabled ?? true;
    this.wetSandEnabled = options.wetSandEnabled ?? true;
    this.snowSparklesEnabled = options.snowSparklesEnabled ?? true;
    this.noisePerturbEnabled = options.noisePerturbEnabled ?? true;
    this.cavityAOEnabled = options.cavityAOEnabled ?? true;
    this.moisture = options.moisture ?? 0.5;

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

  getRenderGeometryOptions() {
    return {
      regionSize: this.regionSize,
      samples: this.samples,
      renderSubdivisions: this.renderSubdivisions,
      terrainDetailStrength: this.terrainDetailStrength,
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
      moisture: this.moisture,
      seed: this.seed,
    };
  }

  createTerrainMesh() {
    const geometry = createTerrainGeometry(this.heightMap, this.getRenderGeometryOptions());
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
      triplanarEnabled: this.triplanarEnabled,
      wetSandEnabled: this.wetSandEnabled,
      snowSparklesEnabled: this.snowSparklesEnabled,
      noisePerturbEnabled: this.noisePerturbEnabled,
      cavityAOEnabled: this.cavityAOEnabled,
      moisture: this.moisture,
      sunDirection: this.sunDirection,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  createWaterMesh() {
    const geometry = createWaterGeometry(this.heightMap, this.getRenderGeometryOptions());
    const terrainTextures = this.terrainMesh?.material?.userData?.textures ?? null;
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
      waterLevel: this.waterLevel,
      terrainTextures,
      textureHeights: this.textureHeights,
      textureDensity: this.textureDensity,
      windDirection: this.windDirection,
      windSpeed: this.windSpeed,
      waterDarkness: this.waterDarkness,
      environment: this.environment,
      refractionEnabled: this.refractionEnabled,
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

    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uWaterEnabled) {
      shader.uniforms.uWaterEnabled.value = this.waterEnabled ? 1 : 0;
    }

    this.sync();
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

    const waterUniforms = this.waterMesh.material.uniforms;
    if (waterUniforms?.uWaterLevel) {
      waterUniforms.uWaterLevel.value = level;
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

    const wu = this.waterMesh.material.uniforms;
    if (wu?.uSeabedUVScale) {
      wu.uSeabedUVScale.value = density / DEFAULT_REGION_SIZE;
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

    this.terrainMesh.geometry = createTerrainGeometry(this.heightMap, this.getRenderGeometryOptions());
    this.waterMesh.geometry = createWaterGeometry(this.heightMap, this.getRenderGeometryOptions());

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

  setRenderSubdivisions(subdivisions) {
    const nextSubdivisions = normalizeRenderSubdivisions(subdivisions);
    if (nextSubdivisions === this.renderSubdivisions) return this;

    this.renderSubdivisions = nextSubdivisions;
    this.rebuildTerrainGeometry();
    return this;
  }

  setTerrainDetailStrength(strength) {
    this.terrainDetailStrength = Math.max(0, strength);
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
    this.sync();
    return this;
  }

  syncTextureHeightUniforms() {
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms) {
      if (shader.uniforms.uSandMax) shader.uniforms.uSandMax.value = this.textureHeights.sandMax;
      if (shader.uniforms.uGrassStart) shader.uniforms.uGrassStart.value = this.textureHeights.grassStart;
      if (shader.uniforms.uGrassEnd) shader.uniforms.uGrassEnd.value = this.textureHeights.grassEnd;
      if (shader.uniforms.uRockStart) shader.uniforms.uRockStart.value = this.textureHeights.rockStart;
      if (shader.uniforms.uSnowStart) shader.uniforms.uSnowStart.value = this.textureHeights.snowStart;
      if (shader.uniforms.uBlendWidth) shader.uniforms.uBlendWidth.value = this.textureBlendWidth;
    }

    const wu = this.waterMesh.material.uniforms;
    if (wu?.uSandMax) {
      wu.uSandMax.value = this.textureHeights.sandMax;
      wu.uGrassStart.value = this.textureHeights.grassStart;
      wu.uGrassEnd.value = this.textureHeights.grassEnd;
      wu.uRockStart.value = this.textureHeights.rockStart;
      wu.uSnowStart.value = this.textureHeights.snowStart;
    }

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
    const terrainShader = this.terrainMesh?.material?.userData?.shader;
    if (terrainShader?.uniforms?.uSunDirection) {
      terrainShader.uniforms.uSunDirection.value.copy(this.sunDirection);
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
    syncHeightMapToGeometry(this.heightMap, this.terrainMesh, this.waterMesh, this.getRenderGeometryOptions());
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

    // Sync terrain albedo textures to water shader for refraction seabed.
    if (config.mesh === 'terrain') {
      const waterUniformName = `u${layer.charAt(0).toUpperCase() + layer.slice(1)}Map`;
      const waterUniform = this.waterMesh.material.uniforms?.[waterUniformName];
      if (waterUniform) {
        if (waterUniform.value?.userData?.seabedPlaceholder) {
          disposeTerrainTexture(waterUniform.value);
        }
        waterUniform.value = nextTexture;
      }
    }

    return this;
  }

  setEnvironment(envMap) {
    this.environment = envMap;
    const wu = this.waterMesh.material.uniforms;
    if (wu?.uEnvironment) {
      wu.uEnvironment.value = envMap;
      wu.uEnvEnabled.value = envMap ? 1.0 : 0.0;
    }
    return this;
  }

  setRefractionEnabled(enabled) {
    this.refractionEnabled = Boolean(enabled);
    const wu = this.waterMesh.material.uniforms;
    if (wu?.uRefractionEnabled) {
      wu.uRefractionEnabled.value = this.refractionEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setWindDirection(direction) {
    const vec = Array.isArray(direction) ? direction : [direction.x, direction.y];
    this.windDirection = vec;
    const wu = this.waterMesh.material.uniforms;
    if (wu?.uWindDirection) {
      wu.uWindDirection.value.set(vec[0], vec[1]).normalize();
    }
    return this;
  }

  setWindSpeed(speed) {
    this.windSpeed = Math.max(0, speed);
    const wu = this.waterMesh.material.uniforms;
    if (wu?.uWindSpeed) {
      wu.uWindSpeed.value = this.windSpeed;
    }
    return this;
  }

  setWaterDarkness(darkness) {
    this.waterDarkness = clamp(darkness, 0, 1);
    const wu = this.waterMesh.material.uniforms;
    if (wu?.uWaterDarkness) {
      wu.uWaterDarkness.value = this.waterDarkness;
    }
    return this;
  }

  setTriplanarEnabled(enabled) {
    this.triplanarEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uTriplanarEnabled) {
      shader.uniforms.uTriplanarEnabled.value = this.triplanarEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setWetSandEnabled(enabled) {
    this.wetSandEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uWetSandEnabled) {
      shader.uniforms.uWetSandEnabled.value = this.wetSandEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setSnowSparklesEnabled(enabled) {
    this.snowSparklesEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uSnowSparklesEnabled) {
      shader.uniforms.uSnowSparklesEnabled.value = this.snowSparklesEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setNoisePerturbEnabled(enabled) {
    this.noisePerturbEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uNoisePerturbEnabled) {
      shader.uniforms.uNoisePerturbEnabled.value = this.noisePerturbEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setCavityAOEnabled(enabled) {
    this.cavityAOEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uCavityAOEnabled) {
      shader.uniforms.uCavityAOEnabled.value = this.cavityAOEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setMoisture(moisture) {
    this.moisture = clamp(moisture, 0, 1);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uMoisture) {
      shader.uniforms.uMoisture.value = this.moisture;
    }
    this.sync();
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

    // Dispose seabed placeholder if it was never replaced
    const placeholder = this.waterMesh.material.userData?.seabedPlaceholder;
    if (placeholder) {
      disposeTerrainTexture(placeholder);
    }

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
