/**
 * metaverse-terrain — TerrainRegion library
 *
 * Peer dependency: the host app must resolve the bare specifier `three`:
 *
 *   npm install metaverse-terrain three
 *   import * as THREE from 'three/webgpu';
 *
 * CDN import map example:
 *   "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js",
 *   "three/webgpu": "https://cdn.jsdelivr.net/npm/three/build/three.webgpu.js",
 *   "three/tsl": "https://cdn.jsdelivr.net/npm/three/build/three.tsl.js",
 *   "metaverse-terrain": "https://cdn.jsdelivr.net/npm/metaverse-terrain/index.js"
 */

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, attribute,
  vec2, vec3, vec4, float,
  max, min, mix, clamp as nodeClamp, smoothstep as nodeSmoothstep, dot, cross, normalize, length, pow, exp, sin, cos, sqrt, abs, reflect,
  positionLocal, positionWorld, normalWorld, cameraPosition, uv,
} from 'three/tsl';

// --- constants ---

export const DEFAULT_REGION_SIZE = 256;
export const MIN_REGION_SIZE = 64;
export const MAX_REGION_SIZE = 512;
export const DEFAULT_SAMPLE_SPACING = 1;
export const DEFAULT_SAMPLES = DEFAULT_REGION_SIZE / DEFAULT_SAMPLE_SPACING + 1;
export const DEFAULT_MIN_HEIGHT = -12;
export const DEFAULT_MAX_HEIGHT = 52;
export const DEFAULT_WATER_LEVEL = 21.5;
export const DEFAULT_WET_SAND_HEIGHT = 0.25;
export const DEFAULT_TEXTURE_DENSITY = 20;
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
// Terrain layer weights (CPU mirror of the GLSL terrainLayerWeights), used by
// the heightmap-preview/brush code. No procedural noise: pure height-band +
// slope smoothsteps, matching the simplified shader path.
function terrainLayerWeightsAt(height, normalY, options) {
  const textureHeights = options.textureHeights ?? DEFAULT_TEXTURE_HEIGHTS;
  const blendWidth = options.textureBlendWidth ?? DEFAULT_TEXTURE_BLEND_WIDTH;
  const slope = clamp((1 - normalY) * 2.4, 0, 1);
  const wetSandHeight = options.wetSandHeight ?? DEFAULT_WET_SAND_HEIGHT;
  const wetEdge = (1 - smoothstep(options.waterLevel - 0.25, options.waterLevel + wetSandHeight, height)) * (options.waterEnabled ? 1 : 0);

  let sandWeight = 1 - smoothstep(textureHeights.sandMax - blendWidth, textureHeights.sandMax, height);
  let grassWeight = smoothstep(textureHeights.grassStart - blendWidth, textureHeights.grassStart + blendWidth, height)
    * (1 - smoothstep(textureHeights.grassEnd - blendWidth, textureHeights.grassEnd + blendWidth, height));
  let rockWeight = smoothstep(textureHeights.rockStart - blendWidth, textureHeights.rockStart + blendWidth, height) + slope * 0.35;
  let snowWeight = smoothstep(textureHeights.snowStart - blendWidth, textureHeights.snowStart + blendWidth, height) * (1 - slope * 0.25);

  sandWeight += wetEdge * 0.6;
  grassWeight *= 1 + slope * 0.75;
  sandWeight *= 1 - slope * 0.25;

  const weights = [Math.max(0.001, sandWeight), Math.max(0.001, grassWeight), Math.max(0.001, rockWeight), Math.max(0.001, snowWeight)];
  const total = weights[0] + weights[1] + weights[2] + weights[3];
  return weights.map((weight) => weight / total);
}

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
      const terrainHeight = heightMap[index];

      positions[positionIndex] = x * step - halfRegion;
      positions[positionIndex + 1] = 0;
      positions[positionIndex + 2] = z * step - halfRegion;
      uvs[uvIndex] = (x * step) / DEFAULT_REGION_SIZE;
      uvs[uvIndex + 1] = (z * step) / DEFAULT_REGION_SIZE;
      waterDepth[index] = waterLevel - terrainHeight;
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

function updateWaterDepthData(heightMap, waterMesh, options) {
  const depthAttribute = waterMesh?.geometry?.attributes?.waterDepth;
  if (!depthAttribute) return;
  const { samples } = options;

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const index = indexFor(x, z, samples);
      depthAttribute.array[index] = options.waterLevel - heightMap[index];
    }
  }

  depthAttribute.needsUpdate = true;
}

function markAttributeRange(attribute, offset, count) {
  if (typeof attribute.addUpdateRange === 'function') {
    attribute.addUpdateRange(offset, count);
  } else if (attribute.updateRange) {
    if (attribute.updateRange.count === -1) {
      attribute.updateRange.offset = offset;
      attribute.updateRange.count = count;
    } else {
      const start = Math.min(attribute.updateRange.offset, offset);
      const end = Math.max(attribute.updateRange.offset + attribute.updateRange.count, offset + count);
      attribute.updateRange.offset = start;
      attribute.updateRange.count = end - start;
    }
  }
}

function syncHeightMapRegionToGeometry(heightMap, terrainMesh, waterMesh, options, sampleBounds, syncOptions = {}) {
  if (!sampleBounds) return;

  const position = terrainMesh.geometry.attributes.position;
  const { samples } = options;
  const margin = 2;
  const minX = Math.max(0, Math.floor(sampleBounds.minX) - margin);
  const maxX = Math.min(samples - 1, Math.ceil(sampleBounds.maxX) + margin);
  const minZ = Math.max(0, Math.floor(sampleBounds.minZ) - margin);
  const maxZ = Math.min(samples - 1, Math.ceil(sampleBounds.maxZ) + margin);

  for (let z = minZ; z <= maxZ; z += 1) {
    const rowStart = indexFor(minX, z, samples);
    for (let x = minX; x <= maxX; x += 1) {
      const index = indexFor(x, z, samples);
      position.array[index * 3 + 1] = heightMap[index];
    }
    markAttributeRange(position, rowStart * 3, (maxX - minX + 1) * 3);
  }

  position.needsUpdate = true;

  if (syncOptions.updateWaterDepth) {
    const depthAttribute = waterMesh?.geometry?.attributes?.waterDepth;
    if (depthAttribute) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const rowStart = indexFor(minX, z, samples);
        for (let x = minX; x <= maxX; x += 1) {
          const index = indexFor(x, z, samples);
          depthAttribute.array[index] = options.waterLevel - heightMap[index];
        }
        markAttributeRange(depthAttribute, rowStart, maxX - minX + 1);
      }
      depthAttribute.needsUpdate = true;
    }
  }
}

function syncHeightMapToGeometry(heightMap, terrainMesh, waterMesh, options) {
  const position = terrainMesh.geometry.attributes.position;
  const { samples } = options;

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const index = indexFor(x, z, samples);
      position.array[index * 3 + 1] = heightMap[index];
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
  const dirtyBounds = {
    minX: samples - 1,
    minZ: samples - 1,
    maxX: 0,
    maxZ: 0,
  };
  let changed = false;

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
      const previousHeight = heightMap[index];

      if (effectiveMode === 'flatten') {
        heightMap[index] = clamp(
          lerp(heightMap[index], brush.flattenHeight, flattenBlend * falloff),
          minHeight,
          maxHeight,
        );
      } else {
        heightMap[index] = clamp(heightMap[index] + delta * falloff, minHeight, maxHeight);
      }

      if (heightMap[index] !== previousHeight) {
        dirtyBounds.minX = Math.min(dirtyBounds.minX, x);
        dirtyBounds.minZ = Math.min(dirtyBounds.minZ, z);
        dirtyBounds.maxX = Math.max(dirtyBounds.maxX, x);
        dirtyBounds.maxZ = Math.max(dirtyBounds.maxZ, z);
        changed = true;
      }
    }
  }

  return changed ? dirtyBounds : null;
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

// --- TSL material helpers ---

function uniformProxy(node) {
  return {
    get value() { return node.value; },
    set value(next) {
      if (node.value?.copy && next?.isColor) node.value.copy(next);
      else if (node.value?.copy && next?.isVector2) node.value.copy(next);
      else if (node.value?.copy && next?.isVector3) node.value.copy(next);
      else node.value = next;
    },
  };
}

function assignUniform(material, name, node) {
  if (!material.userData.uniforms) material.userData.uniforms = {};
  if (!material.userData.shader) material.userData.shader = { uniforms: material.userData.uniforms };
  material.uniforms = material.userData.uniforms;
  material.userData.uniforms[name] = uniformProxy(node);
  return node;
}

function luminanceNode(color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

function terrainLayerWeightsNode(height, worldNormal, u) {
  const slope = nodeClamp(float(1.0).sub(normalize(worldNormal).y).mul(2.4), 0.0, 1.0);
  const wetEdge = float(1.0).sub(nodeSmoothstep(u.uWaterLevel.sub(0.25), u.uWaterLevel.add(u.uWetSandHeight), height)).mul(u.uWaterEnabled);

  let sandWeight = float(1.0).sub(nodeSmoothstep(u.uSandMax.sub(u.uBlendWidth), u.uSandMax, height));
  let grassWeight = nodeSmoothstep(u.uGrassStart.sub(u.uBlendWidth), u.uGrassStart.add(u.uBlendWidth), height)
    .mul(float(1.0).sub(nodeSmoothstep(u.uGrassEnd.sub(u.uBlendWidth), u.uGrassEnd.add(u.uBlendWidth), height)));
  let rockWeight = nodeSmoothstep(u.uRockStart.sub(u.uBlendWidth), u.uRockStart.add(u.uBlendWidth), height).add(slope.mul(0.35));
  let snowWeight = nodeSmoothstep(u.uSnowStart.sub(u.uBlendWidth), u.uSnowStart.add(u.uBlendWidth), height).mul(float(1.0).sub(slope.mul(0.25)));

  sandWeight = sandWeight.add(wetEdge.mul(0.6));
  grassWeight = grassWeight.mul(float(1.0).add(slope.mul(0.75)));
  sandWeight = sandWeight.mul(float(1.0).sub(slope.mul(0.25)));

  const weights = max(vec4(sandWeight, grassWeight, rockWeight, snowWeight), vec4(0.001));
  return weights.div(weights.x.add(weights.y).add(weights.z).add(weights.w));
}

function terrainTiledUv(baseUv, scale, layerScale = 1.0) {
  return baseUv.mul(scale).mul(layerScale);
}

// Wet-sand factor: a band confined to the exposed shore. It is strictly 0 at and
// below the waterline (submerged sand is never wet), ramps in just above the
// line, then fades back to 0 by uWetSandHeight above it.
function wetSandFactorNode(height, u) {
  const aboveWater = nodeSmoothstep(u.uWaterLevel, u.uWaterLevel.add(0.05), height);
  const fade = float(1.0).sub(nodeSmoothstep(u.uWaterLevel.add(0.05), u.uWaterLevel.add(u.uWetSandHeight), height));
  return aboveWater.mul(fade).mul(u.uWaterEnabled).mul(u.uWetSandEnabled);
}

function terrainAlbedoNode(baseUv, height, worldNormal, u) {
  const weights = terrainLayerWeightsNode(height, worldNormal, u);
  const sandColor = texture(u.uSand, terrainTiledUv(baseUv, u.uTextureScale, 1.15)).rgb;
  const grassColor = texture(u.uGrass, terrainTiledUv(baseUv, u.uTextureScale)).rgb;
  const rockColor = texture(u.uRock, terrainTiledUv(baseUv, u.uTextureScale, 0.82)).rgb;
  const snowColor = texture(u.uSnow, terrainTiledUv(baseUv, u.uTextureScale, 0.66)).rgb;
  let albedo = sandColor.mul(weights.x).add(grassColor.mul(weights.y)).add(rockColor.mul(weights.z)).add(snowColor.mul(weights.w));
  const wetness = wetSandFactorNode(height, u);
  albedo = mix(albedo, albedo.mul(0.55), wetness.mul(0.7));
  return albedo;
}

function terrainMRAONode(baseUv, height, worldNormal, u) {
  const weights = terrainLayerWeightsNode(height, worldNormal, u);
  const sand = texture(u.uSandMRAO, terrainTiledUv(baseUv, u.uTextureScale, 1.15)).rgb;
  const grass = texture(u.uGrassMRAO, terrainTiledUv(baseUv, u.uTextureScale)).rgb;
  const rock = texture(u.uRockMRAO, terrainTiledUv(baseUv, u.uTextureScale, 0.82)).rgb;
  const snow = texture(u.uSnowMRAO, terrainTiledUv(baseUv, u.uTextureScale, 0.66)).rgb;
  return sand.mul(weights.x).add(grass.mul(weights.y)).add(rock.mul(weights.z)).add(snow.mul(weights.w));
}

function terrainNormalNode(baseUv, height, worldNormal, u) {
  const weights = terrainLayerWeightsNode(height, worldNormal, u);
  let n = texture(u.uSandNormal, terrainTiledUv(baseUv, u.uTextureScale, 1.15)).xyz.mul(2.0).sub(1.0).mul(weights.x)
    .add(texture(u.uGrassNormal, terrainTiledUv(baseUv, u.uTextureScale)).xyz.mul(2.0).sub(1.0).mul(weights.y))
    .add(texture(u.uRockNormal, terrainTiledUv(baseUv, u.uTextureScale, 0.82)).xyz.mul(2.0).sub(1.0).mul(weights.z))
    .add(texture(u.uSnowNormal, terrainTiledUv(baseUv, u.uTextureScale, 0.66)).xyz.mul(2.0).sub(1.0).mul(weights.w));
  n = normalize(n);
  const layerStrength = weights.x.mul(0.6).add(weights.y.mul(0.8)).add(weights.z.mul(1.2)).add(weights.w.mul(0.4)).mul(u.uNormalStrength);
  n = normalize(vec3(n.x.mul(layerStrength), n.y.mul(layerStrength), max(n.z, 0.001)));

  // Approximate the old fixed tangent frame in world space. This keeps the TSL
  // material self-contained and avoids onBeforeCompile hooks.
  const nW = normalize(worldNormal);
  let tW = vec3(1.0, 0.0, 0.0).sub(nW.mul(dot(vec3(1.0, 0.0, 0.0), nW)));
  const fallback = vec3(0.0, 0.0, 1.0).sub(nW.mul(dot(vec3(0.0, 0.0, 1.0), nW)));
  tW = dot(tW, tW).lessThan(0.000001).select(fallback, tW);
  tW = normalize(tW);
  const bW = normalize(cross(tW, nW));
  return normalize(tW.mul(n.x).add(bW.mul(n.y)).add(nW.mul(n.z)));
}

// --- Terrain material (MeshStandardNodeMaterial) ---

function createTerrainMaterial(textureLoader, options) {
  const {
    textures,
    textureDensity,
    waterLevel,
    waterEnabled = 1,
    textureHeights,
    textureBlendWidth,
    pbrTextures,
    normalStrength = 1.0,
    terrainAOIntensity = 1.0,
    terrainMetalIntensity = 1.0,
    terrainRoughnessIntensity = 1.0,
    wetSandEnabled = true,
    wetSandHeight = DEFAULT_WET_SAND_HEIGHT,
  } = options;

  const sandTex = loadTerrainTexture(textureLoader, textures.sand);
  const grassTex = loadTerrainTexture(textureLoader, textures.grass);
  const rockTex = loadTerrainTexture(textureLoader, textures.rock);
  const snowTex = loadTerrainTexture(textureLoader, textures.snow);

  const layers = ['sand', 'grass', 'rock', 'snow'];
  const pbrNormals = {};
  const pbrMrao = {};
  const defaultNormal = createSolidTerrainTexture(128, 128, 255, 255, false);
  const defaultMRAO = createSolidTerrainTexture(0, 204, 255, 255, false);
  for (const layer of layers) {
    pbrNormals[layer] = pbrTextures?.[layer]?.normal ? loadTerrainTexture(textureLoader, pbrTextures[layer].normal, false) : defaultNormal;
    pbrMrao[layer] = pbrTextures?.[layer]?.mrao ? loadTerrainTexture(textureLoader, pbrTextures[layer].mrao, false) : defaultMRAO;
  }

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });

  const u = {
    uSand: assignUniform(material, 'uSand', texture(sandTex)),
    uGrass: assignUniform(material, 'uGrass', texture(grassTex)),
    uRock: assignUniform(material, 'uRock', texture(rockTex)),
    uSnow: assignUniform(material, 'uSnow', texture(snowTex)),
    uTextureScale: assignUniform(material, 'uTextureScale', uniform(textureDensity)),
    uSandMax: assignUniform(material, 'uSandMax', uniform(textureHeights.sandMax)),
    uGrassStart: assignUniform(material, 'uGrassStart', uniform(textureHeights.grassStart)),
    uGrassEnd: assignUniform(material, 'uGrassEnd', uniform(textureHeights.grassEnd)),
    uRockStart: assignUniform(material, 'uRockStart', uniform(textureHeights.rockStart)),
    uSnowStart: assignUniform(material, 'uSnowStart', uniform(textureHeights.snowStart)),
    uBlendWidth: assignUniform(material, 'uBlendWidth', uniform(textureBlendWidth)),
    uWaterLevel: assignUniform(material, 'uWaterLevel', uniform(waterLevel)),
    uWaterEnabled: assignUniform(material, 'uWaterEnabled', uniform(waterEnabled ? 1 : 0)),
    uTerrainAOIntensity: assignUniform(material, 'uTerrainAOIntensity', uniform(terrainAOIntensity)),
    uTerrainMetalIntensity: assignUniform(material, 'uTerrainMetalIntensity', uniform(terrainMetalIntensity)),
    uTerrainRoughnessIntensity: assignUniform(material, 'uTerrainRoughnessIntensity', uniform(terrainRoughnessIntensity)),
    uWetSandEnabled: assignUniform(material, 'uWetSandEnabled', uniform(wetSandEnabled ? 1.0 : 0.0)),
    uWetSandHeight: assignUniform(material, 'uWetSandHeight', uniform(wetSandHeight)),
    uSandNormal: assignUniform(material, 'uSandNormal', texture(pbrNormals.sand)),
    uGrassNormal: assignUniform(material, 'uGrassNormal', texture(pbrNormals.grass)),
    uRockNormal: assignUniform(material, 'uRockNormal', texture(pbrNormals.rock)),
    uSnowNormal: assignUniform(material, 'uSnowNormal', texture(pbrNormals.snow)),
    uSandMRAO: assignUniform(material, 'uSandMRAO', texture(pbrMrao.sand)),
    uGrassMRAO: assignUniform(material, 'uGrassMRAO', texture(pbrMrao.grass)),
    uRockMRAO: assignUniform(material, 'uRockMRAO', texture(pbrMrao.rock)),
    uSnowMRAO: assignUniform(material, 'uSnowMRAO', texture(pbrMrao.snow)),
    uNormalStrength: assignUniform(material, 'uNormalStrength', uniform(normalStrength)),
  };

  const terrainUv = uv();
  const terrainHeight = positionLocal.y;
  const terrainNormal = normalWorld;
  const mrao = terrainMRAONode(terrainUv, terrainHeight, terrainNormal, u);
  const wetness = wetSandFactorNode(terrainHeight, u);

  material.colorNode = terrainAlbedoNode(terrainUv, terrainHeight, terrainNormal, u);
  material.roughnessNode = mix(nodeClamp(mrao.g.mul(u.uTerrainRoughnessIntensity), 0.04, 1.0), nodeClamp(float(0.08).mul(u.uTerrainRoughnessIntensity), 0.04, 1.0), wetness.mul(0.7));
  material.metalnessNode = nodeClamp(mrao.r.mul(u.uTerrainMetalIntensity), 0.0, 1.0);
  material.normalNode = terrainNormalNode(terrainUv, terrainHeight, terrainNormal, u);
  if ('aoNode' in material) material.aoNode = mix(float(1.0), nodeClamp(mrao.b, 0.0, 1.0), nodeClamp(u.uTerrainAOIntensity, 0.0, 2.0));

  material.userData.textures = { sand: sandTex, grass: grassTex, rock: rockTex, snow: snowTex };
  material.userData.pbrTextures = { normals: pbrNormals, mrao: pbrMrao };
  return material;
}

// --- WaterMaterial (MeshBasicNodeMaterial + TSL) ---

function rotate2(v, angle) {
  const s = sin(angle);
  const c = cos(angle);
  return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
}

// `windDir` is the normalized wind direction (world XZ); `windScale` scales the
// scroll speed with wind strength. The texture scroll is aligned to the wind so
// the surface visibly drifts downwind. Each octave rotates the wind flow by the
// same angle as its UV so all layers travel the same world direction.
function sampleWaterPatternNode(worldXZ, time, uWaterMap, windDir, windScale) {
  const baseUv = worldXZ.mul(0.012);
  const flow = windDir.mul(time).mul(windScale);
  const warpA = luminanceNode(texture(uWaterMap, baseUv.mul(0.42).add(flow.mul(0.006))).rgb).sub(0.5);
  const warpB = luminanceNode(texture(uWaterMap, rotate2(baseUv.mul(0.31), 1.7).add(rotate2(flow, 1.7).mul(0.005))).rgb).sub(0.5);
  const warp = vec2(warpA, warpB).mul(0.18);
  const a = texture(uWaterMap, rotate2(baseUv.mul(2.15).add(warp), 0.36).add(rotate2(flow, 0.36).mul(0.012))).rgb;
  const b = texture(uWaterMap, rotate2(baseUv.mul(3.70).sub(warp.mul(0.65)), -0.92).add(rotate2(flow, -0.92).mul(0.010))).rgb;
  const c = texture(uWaterMap, rotate2(baseUv.mul(6.40).add(warp.mul(0.35)), 2.21).add(rotate2(flow, 2.21).mul(0.007))).rgb;
  return a.mul(0.48).add(b.mul(0.34)).add(c.mul(0.18));
}

// Ripples propagate along the wind direction (with small per-octave fan-out) and
// advance in time at a rate that scales with wind speed.
function waterRippleSignalNode(worldXZ, time, windDir, windScale) {
  const t = time.mul(windScale);
  const d1 = windDir, d2 = rotate2(windDir, 0.42), d3 = rotate2(windDir, -0.55), d4 = rotate2(windDir, 0.16);
  const w1 = sin(dot(worldXZ, d1).mul(0.58).add(t.mul(1.70)));
  const w2 = sin(dot(worldXZ, d2).mul(0.73).add(t.mul(1.13)));
  const w3 = sin(dot(worldXZ.add(vec2(w1, w2).mul(0.7)), d3).mul(1.05).add(t.mul(2.05)));
  const w4 = sin(dot(worldXZ, d4).mul(0.31).add(t.mul(0.82)));
  return w1.mul(0.34).add(w2.mul(0.27)).add(w3.mul(0.25)).add(w4.mul(0.14));
}

function waterEffectiveShallowNode(u) {
  const pristine = vec3(0.35, 0.82, 0.78);
  const swamp = vec3(0.32, 0.36, 0.22);
  const clearMix = mix(u.uShallowColor, pristine, float(1.0).sub(u.uWaterDarkness.mul(2.0)));
  const murkyMix = mix(u.uShallowColor, swamp, u.uWaterDarkness.sub(0.5).mul(2.0));
  return u.uWaterDarkness.lessThan(0.5).select(clearMix, murkyMix);
}

function waterEffectiveDeepNode(u) {
  const pristine = vec3(0.10, 0.42, 0.52);
  const swamp = vec3(0.14, 0.16, 0.08);
  const clearMix = mix(u.uDeepColor, pristine, float(1.0).sub(u.uWaterDarkness.mul(2.0)));
  const murkyMix = mix(u.uDeepColor, swamp, u.uWaterDarkness.sub(0.5).mul(2.0));
  return u.uWaterDarkness.lessThan(0.5).select(clearMix, murkyMix);
}

function sampleSeabedNode(worldXZ, terrainHeight, u) {
  const sUV = worldXZ.mul(u.uSeabedUVScale);
  const sw = float(1.0).sub(nodeSmoothstep(u.uSandMax.sub(4.0), u.uSandMax, terrainHeight));
  const gw = nodeSmoothstep(u.uGrassStart.sub(4.0), u.uGrassStart.add(4.0), terrainHeight)
    .mul(float(1.0).sub(nodeSmoothstep(u.uGrassEnd.sub(4.0), u.uGrassEnd.add(4.0), terrainHeight)));
  const rw = nodeSmoothstep(u.uRockStart.sub(4.0), u.uRockStart.add(4.0), terrainHeight);
  const nw = nodeSmoothstep(u.uSnowStart.sub(4.0), u.uSnowStart.add(4.0), terrainHeight);
  const w = max(vec4(sw, gw, rw, nw), vec4(0.001));
  const weights = w.div(w.x.add(w.y).add(w.z).add(w.w));
  return texture(u.uSandMap, sUV).rgb.mul(weights.x)
    .add(texture(u.uGrassMap, sUV).rgb.mul(weights.y))
    .add(texture(u.uRockMap, sUV).rgb.mul(weights.z))
    .add(texture(u.uSnowMap, sUV).rgb.mul(weights.w));
}

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

  const seabedPlaceholder = createSolidTerrainTexture(128, 128, 128, 255, false);
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = true;

  const u = {
    uWaterMap: assignUniform(material, 'uWaterMap', texture(loadTerrainTexture(textureLoader, textures.water))),
    uTime: assignUniform(material, 'uTime', uniform(0)),
    uSunDirection: assignUniform(material, 'uSunDirection', uniform(sunDirection)),
    uShallowColor: assignUniform(material, 'uShallowColor', uniform(new THREE.Color(shallowColor))),
    uDeepColor: assignUniform(material, 'uDeepColor', uniform(new THREE.Color(deepColor))),
    uFoamColor: assignUniform(material, 'uFoamColor', uniform(new THREE.Color(foamColor))),
    uFogColor: assignUniform(material, 'uFogColor', uniform(new THREE.Color(fogColor))),
    uWaterAlphaShallow: assignUniform(material, 'uWaterAlphaShallow', uniform(shallowAlpha)),
    uWaterAlphaDeep: assignUniform(material, 'uWaterAlphaDeep', uniform(deepAlpha)),
    uWaterAlphaMax: assignUniform(material, 'uWaterAlphaMax', uniform(maxAlpha)),
    uWaterLevel: assignUniform(material, 'uWaterLevel', uniform(waterLevel)),
    uWaterNormal: assignUniform(material, 'uWaterNormal', texture(waterPBR?.normal ? loadTerrainTexture(textureLoader, waterPBR.normal, false) : defaultNormal)),
    uWaterMRAO: assignUniform(material, 'uWaterMRAO', texture(waterPBR?.mrao ? loadTerrainTexture(textureLoader, waterPBR.mrao, false) : defaultMRAO)),
    uPBREnabled: assignUniform(material, 'uPBREnabled', uniform(waterPBR ? 1.0 : 0.0)),
    uWaterIOR: assignUniform(material, 'uWaterIOR', uniform(1.33)),
    uWaterDarkness: assignUniform(material, 'uWaterDarkness', uniform(waterDarkness)),
    uEnvironment: assignUniform(material, 'uEnvironment', uniform(environment)),
    uEnvEnabled: assignUniform(material, 'uEnvEnabled', uniform(environment ? 1.0 : 0.0)),
    uSandMap: assignUniform(material, 'uSandMap', texture(terrainTextures?.sand ?? seabedPlaceholder)),
    uGrassMap: assignUniform(material, 'uGrassMap', texture(terrainTextures?.grass ?? seabedPlaceholder)),
    uRockMap: assignUniform(material, 'uRockMap', texture(terrainTextures?.rock ?? seabedPlaceholder)),
    uSnowMap: assignUniform(material, 'uSnowMap', texture(terrainTextures?.snow ?? seabedPlaceholder)),
    uSandMax: assignUniform(material, 'uSandMax', uniform(textureHeights.sandMax)),
    uGrassStart: assignUniform(material, 'uGrassStart', uniform(textureHeights.grassStart)),
    uGrassEnd: assignUniform(material, 'uGrassEnd', uniform(textureHeights.grassEnd)),
    uRockStart: assignUniform(material, 'uRockStart', uniform(textureHeights.rockStart)),
    uSnowStart: assignUniform(material, 'uSnowStart', uniform(textureHeights.snowStart)),
    uSeabedUVScale: assignUniform(material, 'uSeabedUVScale', uniform(textureDensity / DEFAULT_REGION_SIZE)),
    uRefractionEnabled: assignUniform(material, 'uRefractionEnabled', uniform(refractionEnabled ? 1.0 : 0.0)),
    uWindDirection: assignUniform(material, 'uWindDirection', uniform(new THREE.Vector2(windDirection[0], windDirection[1]).normalize())),
    uWindSpeed: assignUniform(material, 'uWindSpeed', uniform(windSpeed)),
  };

  const depth = attribute('waterDepth', 'float');
  const localXZ = positionLocal.xz;
  const windScale = u.uWindSpeed.div(5.0);
  const t = u.uTime.mul(windScale);
  const waveMask = nodeSmoothstep(0.12, 3.0, depth);
  const windDir = normalize(u.uWindDirection);
  const d1 = rotate2(windDir, 0.0), d2 = rotate2(windDir, 0.31), d3 = rotate2(windDir, -0.44), d4 = rotate2(windDir, 0.73), d5 = rotate2(windDir, -0.26);
  const a1 = windScale.mul(0.16), a2 = windScale.mul(0.10), a3 = windScale.mul(0.07), a4 = windScale.mul(0.04), a5 = windScale.mul(0.025);
  const p1 = dot(d1, localXZ).mul(0.45).add(sqrt(9.8 * 0.45).mul(t).mul(0.5));
  const p2 = dot(d2, localXZ).mul(0.72).add(sqrt(9.8 * 0.72).mul(t).mul(0.5));
  const p3 = dot(d3, localXZ).mul(1.05).add(sqrt(9.8 * 1.05).mul(t).mul(0.5));
  const p4 = dot(d4, localXZ).mul(1.48).add(sqrt(9.8 * 1.48).mul(t).mul(0.5));
  const p5 = dot(d5, localXZ).mul(2.10).add(sqrt(9.8 * 2.10).mul(t).mul(0.5));
  const c1 = cos(p1), c2 = cos(p2), c3 = cos(p3), c4 = cos(p4), c5 = cos(p5);
  const s1 = sin(p1), s2 = sin(p2), s3 = sin(p3), s4 = sin(p4), s5 = sin(p5);
  const waveHeight = a1.mul(s1).add(a2.mul(s2)).add(a3.mul(s3)).add(a4.mul(s4)).add(a5.mul(s5));
  const offsetX = d1.x.mul(0.85).mul(a1).mul(c1).add(d2.x.mul(0.80).mul(a2).mul(c2)).add(d3.x.mul(0.70).mul(a3).mul(c3)).add(d4.x.mul(0.55).mul(a4).mul(c4)).add(d5.x.mul(0.40).mul(a5).mul(c5));
  const offsetZ = d1.y.mul(0.85).mul(a1).mul(c1).add(d2.y.mul(0.80).mul(a2).mul(c2)).add(d3.y.mul(0.70).mul(a3).mul(c3)).add(d4.y.mul(0.55).mul(a4).mul(c4)).add(d5.y.mul(0.40).mul(a5).mul(c5));
  material.positionNode = positionLocal.add(vec3(offsetX.mul(waveMask), waveHeight.mul(waveMask), offsetZ.mul(waveMask)));

  const fragment = Fn(() => {
    const worldXZ = positionWorld.xz;
    const windDir = normalize(u.uWindDirection);
    const windScale = u.uWindSpeed.div(5.0);
    const waterSample = sampleWaterPatternNode(worldXZ, u.uTime, u.uWaterMap, windDir, windScale);
    const waterDetail = luminanceNode(waterSample);
    const waterDetailX = luminanceNode(sampleWaterPatternNode(worldXZ.add(vec2(0.22, 0.0)), u.uTime, u.uWaterMap, windDir, windScale));
    const waterDetailY = luminanceNode(sampleWaterPatternNode(worldXZ.add(vec2(0.0, 0.22)), u.uTime, u.uWaterMap, windDir, windScale));
    const mapNormal = texture(u.uWaterNormal, uv().mul(8.0).add(windDir.mul(u.uTime).mul(windScale).mul(0.008))).rgb.mul(2.0).sub(1.0);
    const normal = normalize(normalWorld.add(vec3(mapNormal.x.mul(0.22).add(waterDetail.sub(waterDetailX).mul(1.35)), mapNormal.z.mul(0.18), mapNormal.y.mul(0.22).add(waterDetail.sub(waterDetailY).mul(1.35)))));
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const sunDir = normalize(u.uSunDirection);
    const daylight = nodeSmoothstep(-0.08, 0.22, sunDir.y);
    const d = nodeClamp(depth, 0.0, 24.0);
    const depthMix = nodeSmoothstep(0.0, 13.0, d);
    const waterDarkScale = mix(0.35, 3.0, u.uWaterDarkness);
    const sunAngleFactor = float(1.0).div(max(sunDir.y, 0.12));
    const lightPath = d.mul(sunAngleFactor);
    const spectralTransmittance = exp(vec3(0.18, 0.10, 0.04).mul(waterDarkScale).mul(lightPath).negate());
    const spectralAbsorption = float(1.0).sub(spectralTransmittance.g);
    const spectralAlpha = float(1.0).sub(exp(lightPath.mul(-0.32)));
    const terrainHeight = u.uWaterLevel.sub(depth);
    const seabedColor = sampleSeabedNode(worldXZ, terrainHeight, u);
    let baseColor = mix(seabedColor, mix(waterEffectiveShallowNode(u), waterEffectiveDeepNode(u), spectralAbsorption), u.uRefractionEnabled.greaterThan(0.5).select(spectralAbsorption, float(1.0)));
    baseColor = mix(baseColor, waterSample, mix(0.16, 0.055, spectralAbsorption));
    baseColor = baseColor.mul(mix(1.08, 0.64, spectralAbsorption)).mul(mix(0.52, 1.0, daylight));
    const ripple = waterRippleSignalNode(worldXZ, u.uTime, windDir, windScale);
    const rippleFine = waterRippleSignalNode(worldXZ.mul(1.73).add(vec2(19.0, -31.0)), u.uTime.mul(1.19), windDir, windScale);
    const rippleCrest = nodeSmoothstep(0.42, 1.0, ripple.mul(0.62).add(rippleFine.mul(0.38)));
    baseColor = baseColor.add(ripple.mul(mix(0.025, 0.010, spectralAbsorption)));
    const nDotV = max(dot(normal, viewDirection), 0.001);
    const fresnel = pow(float(1.0).sub(nDotV), 3.0);
    const reflectedY = reflect(viewDirection.negate(), normal).y;
    const skyMix = nodeSmoothstep(-0.15, 0.75, reflectedY);
    const skyReflection = mix(mix(vec3(0.02, 0.05, 0.10), vec3(0.06, 0.10, 0.18), skyMix), mix(vec3(0.38, 0.66, 0.78), vec3(0.86, 0.95, 1.0), skyMix), daylight);
    let color = mix(baseColor, skyReflection, nodeClamp(float(0.10).add(fresnel.mul(0.54)), 0.0, 0.68));
    const sunFacing = nodeSmoothstep(-0.05, 0.65, max(dot(normal, sunDir), 0.0));
    const glint = (float(0.075).add(sunFacing.mul(0.18))).mul(float(0.62).add(rippleCrest.mul(0.38))).mul(float(1.0).sub(depthMix.mul(0.18))).mul(mix(0.03, 1.0, daylight));
    color = color.add(vec3(1.0, 0.95, 0.8).mul(glint));
    const shore = float(1.0).sub(nodeSmoothstep(0.0, 2.4, depth));
    const foam = shore.mul(nodeSmoothstep(0.18, 0.78, ripple.mul(0.42).add(0.35))).add(nodeSmoothstep(0.74, 0.98, waterDetail).mul(nodeSmoothstep(0.5, 3.8, depth)).mul(0.07));
    color = mix(color, u.uFoamColor, foam.mul(0.32));
    const fogAmount = nodeSmoothstep(260.0, 520.0, length(cameraPosition.sub(positionWorld))).mul(0.42);
    color = mix(color, u.uFogColor, fogAmount);
    const visibility = nodeSmoothstep(-0.1, 0.35, depth);
    const alpha = nodeClamp(mix(u.uWaterAlphaShallow, u.uWaterAlphaDeep, spectralAlpha).mul(mix(0.75, 1.25, u.uWaterDarkness)).add(fresnel.mul(0.16)).add(shore.mul(0.08)).mul(visibility), 0.0, u.uWaterAlphaMax);
    return vec4(color, alpha);
  });

  material.fragmentNode = fragment();
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
    this.textureDensity = options.textureDensity ?? DEFAULT_TEXTURE_DENSITY;
    this.textureHeights = { ...DEFAULT_TEXTURE_HEIGHTS, ...options.textureHeights };
    this.textureBlendWidth = options.textureBlendWidth ?? DEFAULT_TEXTURE_BLEND_WIDTH;
    this.textures = requireTextures(options.textures);
    this.pbrTextures = options.pbrTextures ?? null;
    this.normalStrength = options.normalStrength ?? 1.0;
    this.terrainAOIntensity = options.terrainAOIntensity ?? 1.0;
    this.terrainMetalIntensity = options.terrainMetalIntensity ?? 1.0;
    this.terrainRoughnessIntensity = options.terrainRoughnessIntensity ?? 1.0;
    this.textureLoader = options.textureLoader ?? new THREE.TextureLoader();
    this.sunDirection = new THREE.Vector3(...(options.sunDirection ?? DEFAULT_SUN_DIRECTION)).normalize();
    this.onHeightmapChange = options.onHeightmapChange ?? null;
    this.environment = options.environment ?? null;
    this.refractionEnabled = options.refractionEnabled ?? true;
    this.windDirection = options.windDirection ?? [1, 0.3];
    this.windSpeed = options.windSpeed ?? 5.0;
    this.waterDarkness = options.waterDarkness ?? 0.5;
    this.wetSandEnabled = options.wetSandEnabled ?? true;
    this.wetSandHeight = options.wetSandHeight ?? DEFAULT_WET_SAND_HEIGHT;
    this.shadowsEnabled = options.shadowsEnabled ?? true;
    this.castShadowsEnabled = options.castShadowsEnabled ?? true;

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
    this.strokeDirtyBounds = null;

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
    this.collisionMesh = this.createCollisionMesh();
    this.waterMesh = this.createWaterMesh();
    this.group.add(this.terrainMesh);
    this.group.add(this.collisionMesh);
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
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      wetSandHeight: this.wetSandHeight,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
      seed: this.seed,
    };
  }

  getCollisionGeometryOptions() {
    return {
      regionSize: this.regionSize,
      samples: this.samples,
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      wetSandHeight: this.wetSandHeight,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
      seed: this.seed,
    };
  }

  createTerrainMesh() {
    const geometry = createTerrainGeometry(this.heightMap, this.getRenderGeometryOptions());
    const material = createTerrainMaterial(this.textureLoader, {
      textures: this.textures,
      textureDensity: this.textureDensity,
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
      pbrTextures: this.pbrTextures,
      normalStrength: this.normalStrength,
      terrainAOIntensity: this.terrainAOIntensity,
      terrainMetalIntensity: this.terrainMetalIntensity,
      terrainRoughnessIntensity: this.terrainRoughnessIntensity,
      wetSandEnabled: this.wetSandEnabled,
      wetSandHeight: this.wetSandHeight,
      sunDirection: this.sunDirection,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = this.shadowsEnabled;
    mesh.castShadow = this.castShadowsEnabled;
    return mesh;
  }

  createCollisionMesh() {
    const geometry = createTerrainGeometry(this.heightMap, this.getCollisionGeometryOptions());
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'TerrainRegionCollisionMesh';
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
    if (options.emit !== false) {
      this.emitHeightmapChange();
    }
    return this;
  }

  randomize(seed = Math.floor(Math.random() * 100000), options = {}) {
    if (seed && typeof seed === 'object') {
      options = seed;
      seed = Math.floor(Math.random() * 100000);
    }
    options ??= {};

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
    this.collisionMesh.geometry.dispose();
    this.waterMesh.geometry.dispose();

    this.terrainMesh.geometry = createTerrainGeometry(this.heightMap, this.getRenderGeometryOptions());
    this.collisionMesh.geometry = createTerrainGeometry(this.heightMap, this.getCollisionGeometryOptions());
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

  setTerrainMetalIntensity(intensity) {
    this.terrainMetalIntensity = intensity;
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uTerrainMetalIntensity) {
      shader.uniforms.uTerrainMetalIntensity.value = intensity;
    }
    return this;
  }

  setTerrainRoughnessIntensity(intensity) {
    this.terrainRoughnessIntensity = intensity;
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uTerrainRoughnessIntensity) {
      shader.uniforms.uTerrainRoughnessIntensity.value = intensity;
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
    this.strokeDirtyBounds = null;
    return this;
  }

  endStroke(options = {}) {
    const hadChanges = !!this.strokeDirtyBounds;
    this.brush.flattenHeight = null;
    this.strokeDirtyBounds = null;
    if (hadChanges) {
      this.sync();
      if (options.emit !== false) {
        this.emitHeightmapChange();
      }
    }
    return this;
  }

  paint(worldPoint, options = {}) {
    const brush = {
      ...this.brush,
      mode: options.mode ?? this.brush.mode,
      temporaryLower: options.temporaryLower ?? false,
    };

    const dirtyBounds = applyBrush(this.heightMap, worldPoint, brush, {
      regionSize: this.regionSize,
      samples: this.samples,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
    });

    this.brush.flattenHeight = brush.flattenHeight;
    if (!dirtyBounds) return this;

    if (options.live) {
      this.mergeStrokeDirtyBounds(dirtyBounds);
      syncHeightMapRegionToGeometry(this.heightMap, this.terrainMesh, this.waterMesh, this.getRenderGeometryOptions(), dirtyBounds);
      syncHeightMapRegionToGeometry(this.heightMap, this.collisionMesh, null, this.getCollisionGeometryOptions(), dirtyBounds);
    } else {
      this.sync();
    }
    return this;
  }

  mergeStrokeDirtyBounds(bounds) {
    if (!this.strokeDirtyBounds) {
      this.strokeDirtyBounds = { ...bounds };
      return this.strokeDirtyBounds;
    }

    this.strokeDirtyBounds.minX = Math.min(this.strokeDirtyBounds.minX, bounds.minX);
    this.strokeDirtyBounds.minZ = Math.min(this.strokeDirtyBounds.minZ, bounds.minZ);
    this.strokeDirtyBounds.maxX = Math.max(this.strokeDirtyBounds.maxX, bounds.maxX);
    this.strokeDirtyBounds.maxZ = Math.max(this.strokeDirtyBounds.maxZ, bounds.maxZ);
    return this.strokeDirtyBounds;
  }

  sync() {
    syncHeightMapToGeometry(this.heightMap, this.terrainMesh, this.waterMesh, this.getRenderGeometryOptions());
    syncHeightMapToGeometry(this.heightMap, this.collisionMesh, null, this.getCollisionGeometryOptions());
    return this;
  }

  raycast(raycaster) {
    const hits = raycaster.intersectObject(this.collisionMesh ?? this.terrainMesh, false);
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

  setWetSandEnabled(enabled) {
    this.wetSandEnabled = Boolean(enabled);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uWetSandEnabled) {
      shader.uniforms.uWetSandEnabled.value = this.wetSandEnabled ? 1.0 : 0.0;
    }
    return this;
  }

  setWetSandHeight(height) {
    this.wetSandHeight = Math.max(0, height);
    const shader = this.terrainMesh.material.userData?.shader;
    if (shader?.uniforms?.uWetSandHeight) {
      shader.uniforms.uWetSandHeight.value = this.wetSandHeight;
    }
    this.emitHeightmapChange();
    return this;
  }

  setShadowsEnabled(enabled) {
    this.shadowsEnabled = Boolean(enabled);
    this.terrainMesh.receiveShadow = this.shadowsEnabled;
    this.terrainMesh.material.needsUpdate = true;
    return this;
  }

  setCastShadowsEnabled(enabled) {
    this.castShadowsEnabled = Boolean(enabled);
    this.terrainMesh.castShadow = this.castShadowsEnabled;
    this.terrainMesh.material.needsUpdate = true;
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
    this.collisionMesh.geometry.dispose();
    this.waterMesh.geometry.dispose();
    this.terrainMesh.material.dispose();
    this.collisionMesh.material.dispose();
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
    region.paintAt(hit.point, { temporaryLower: event.shiftKey, live: true, emit: false });
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
      region.paintAt(hit.point, { temporaryLower: event.shiftKey, live: true, emit: false });
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
