/**
 * metaverse-terrain — TerrainRegion library
 *
 * Peer dependency: the host app must resolve the bare specifier `three`
 * so both this file and the consumer can use:
 *
 *   import * as THREE from 'three';
 *
 * CDN import map example:
 *   "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js"
 */

import * as THREE from 'three';

// --- constants ---

export const DEFAULT_REGION_SIZE = 256;
export const MIN_REGION_SIZE = 64;
export const MAX_REGION_SIZE = 512;
export const DEFAULT_SAMPLES = 256;
export const DEFAULT_MIN_HEIGHT = -12;
export const DEFAULT_MAX_HEIGHT = 52;
export const DEFAULT_WATER_LEVEL = 28;
export const DEFAULT_TEXTURE_DENSITY = 10;
export const DEFAULT_HEX_TILE_RATE = 0.5;
export const DEFAULT_HEX_TILE_CONTRAST = 0.75;
export const DEFAULT_SUN_DIRECTION = [0.45, 0.86, 0.24];

export const DEFAULT_TEXTURE_URLS = {
  sand: './texture/terrain-sand.png',
  grass: './texture/terrain-grass.png',
  rock: './texture/terrain-rock.png',
  snow: './texture/terrain-snow.png',
  water: './texture/terrain-water.png',
};

export const DEFAULT_TEXTURE_HEIGHTS = {
  sandMax: 10,
  grassStart: -8,
  grassEnd: 52,
  rockStart: 46,
  snowStart: 50,
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

function configureTerrainTexture(texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadTerrainTexture(textureLoader, source) {
  if (source?.isTexture) {
    return source;
  }

  return configureTerrainTexture(textureLoader.load(source));
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
      uvs[uvIndex] = x / (samples - 1);
      uvs[uvIndex + 1] = z / (samples - 1);
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
      uvs[uvIndex] = x / (samples - 1);
      uvs[uvIndex + 1] = z / (samples - 1);
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
    minHeight,
    maxHeight,
    seed,
  } = options;
  const noise = createValueNoise(seed);

  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      const nx = x / (samples - 1) - 0.5;
      const nz = z / (samples - 1) - 0.5;
      const distanceFromCenter = Math.sqrt(nx * nx + nz * nz) / 0.707;
      const edgeDrop = smoothstep(0.7, 1, distanceFromCenter) * 12;
      const broad = noise.fbm(x * 0.012, z * 0.012, 5);
      const ridges = Math.abs(noise.fbm(x * 0.032 + 41, z * 0.032 - 17, 4) - 0.5) * 2;
      const detail = noise.fbm(x * 0.09 - 22, z * 0.09 + 13, 3);
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

// --- TerrainMaterial ---

const terrainVertexShader = `
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
`;

const terrainFragmentShader = `
  #ifdef GL_OES_standard_derivatives
    #extension GL_OES_standard_derivatives : enable
  #endif

  uniform sampler2D uSand;
  uniform sampler2D uGrass;
  uniform sampler2D uRock;
  uniform sampler2D uSnow;
  uniform float uMinHeight;
  uniform float uMaxHeight;
  uniform float uTextureScale;
  uniform float uHexTileRate;
  uniform float uHexContrastR;
  uniform vec3 uSunDirection;
  uniform float uWaterLevel;
  uniform float uWaterEnabled;
  uniform float uSandMax;
  uniform float uGrassStart;
  uniform float uGrassEnd;
  uniform float uRockStart;
  uniform float uSnowStart;
  uniform float uBlendWidth;

  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

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
    if (angle > 3.14159265) {
      angle -= 6.2831853;
    }
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

  vec3 hexTileColor(sampler2D tex, vec2 st) {
    st *= uHexTileRate;

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
    float hexExponent = mix(
      HEX_BLEND_EXP_MIN,
      HEX_BLEND_EXP_MAX,
      clamp((uHexContrastR - 0.5) / 0.45, 0.0, 1.0)
    );

    if (abs(uHexContrastR - 0.5) > 0.001) {
      bw = gain3(bw, uHexContrastR);
    }

    vec3 W = Dw * pow(bw, vec3(hexExponent));
    W /= W.x + W.y + W.z;

    return W.x * c1 + W.y * c2 + W.z * c3;
  }

  float remapHeight(float height) {
    return clamp((height - uMinHeight) / (uMaxHeight - uMinHeight), 0.0, 1.0);
  }

  void main() {
    vec2 tiledUv = vUv * uTextureScale;
    vec3 normal = normalize(vNormal);
    float slope = clamp((1.0 - normal.y) * 2.4, 0.0, 1.0);
    float wetEdge = (1.0 - smoothstep(uWaterLevel - 0.4, uWaterLevel + 2.4, vHeight)) * uWaterEnabled;

    float sandWeight = 1.0 - smoothstep(uSandMax - uBlendWidth, uSandMax, vHeight);
    float grassWeight = smoothstep(uGrassStart - uBlendWidth, uGrassStart + uBlendWidth, vHeight)
      * (1.0 - smoothstep(uGrassEnd - uBlendWidth, uGrassEnd + uBlendWidth, vHeight));
    float rockWeight = smoothstep(uRockStart - uBlendWidth, uRockStart + uBlendWidth, vHeight) + slope * 1.5;
    float snowWeight = smoothstep(uSnowStart - uBlendWidth, uSnowStart + uBlendWidth, vHeight) * (1.0 - slope * 0.25);
    sandWeight += wetEdge * 0.9;

    grassWeight *= 1.0 - slope * 0.58;
    sandWeight *= 1.0 - slope * 0.35;
    vec4 weights = max(vec4(sandWeight, grassWeight, rockWeight, snowWeight), vec4(0.001));
    weights /= weights.x + weights.y + weights.z + weights.w;

    vec3 sand = hexTileColor(uSand, tiledUv * 1.15);
    vec3 grass = hexTileColor(uGrass, tiledUv);
    vec3 rock = hexTileColor(uRock, tiledUv * 0.82);
    vec3 snow = hexTileColor(uSnow, tiledUv * 0.66);
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
`;

function createTerrainMaterial(textureLoader, options) {
  const {
    textures,
    minHeight,
    maxHeight,
    textureDensity,
    hexTileRate,
    hexTileContrast,
    sunDirection,
    waterLevel,
    waterEnabled = 1,
    textureHeights,
    textureBlendWidth,
  } = options;

  return new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    uniforms: {
      uSand: { value: loadTerrainTexture(textureLoader, textures.sand) },
      uGrass: { value: loadTerrainTexture(textureLoader, textures.grass) },
      uRock: { value: loadTerrainTexture(textureLoader, textures.rock) },
      uSnow: { value: loadTerrainTexture(textureLoader, textures.snow) },
      uMinHeight: { value: minHeight },
      uMaxHeight: { value: maxHeight },
      uTextureScale: { value: textureDensity },
      uHexTileRate: { value: hexTileRate },
      uHexContrastR: { value: hexTileContrast },
      uSunDirection: { value: sunDirection },
      uWaterLevel: { value: waterLevel },
      uWaterEnabled: { value: waterEnabled ? 1 : 0 },
      uSandMax: { value: textureHeights.sandMax },
      uGrassStart: { value: textureHeights.grassStart },
      uGrassEnd: { value: textureHeights.grassEnd },
      uRockStart: { value: textureHeights.rockStart },
      uSnowStart: { value: textureHeights.snowStart },
      uBlendWidth: { value: textureBlendWidth },
    },
    vertexShader: terrainVertexShader,
    fragmentShader: terrainFragmentShader,
  });
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

  varying vec2 vUv;
  varying float vTerrainDepth;
  varying vec3 vWaveNormal;
  varying vec3 vWorldPosition;

  float getWaterLuma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 waterUvA = vec2(vUv.x * 12.6 + uTime * 0.010, vUv.y * 7.1 - uTime * 0.006);
    vec2 waterUvB = vec2(vUv.x * -6.2 - uTime * 0.004, vUv.y * 3.5 + uTime * 0.008);
    vec3 waterSampleA = texture2D(uWaterMap, waterUvA).rgb;
    vec3 waterSampleB = texture2D(uWaterMap, waterUvB).rgb;
    vec3 waterSample = mix(waterSampleA, waterSampleB, 0.35);
    float waterDetail = getWaterLuma(waterSample);
    float waterDetailX = getWaterLuma(texture2D(uWaterMap, waterUvA + vec2(0.003, 0.0)).rgb);
    float waterDetailY = getWaterLuma(texture2D(uWaterMap, waterUvA + vec2(0.0, 0.003)).rgb);
    vec3 normal = normalize(vWaveNormal + vec3((waterDetail - waterDetailX) * 1.35, 0.0, (waterDetail - waterDetailY) * 1.35));
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float depth = clamp(vTerrainDepth, 0.0, 18.0);
    float depthMix = smoothstep(0.0, 13.0, depth);
    float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);

    float rippleA = sin((vUv.x * 118.0 + vUv.y * 63.0) + uTime * 1.7);
    float rippleB = sin((vUv.x * -77.0 + vUv.y * 142.0) + uTime * 1.15);
    float ripple = (rippleA + rippleB) * 0.5;

    vec3 color = mix(uShallowColor, uDeepColor, depthMix);
    color = mix(color, waterSample, mix(0.18, 0.10, depthMix));
    color += ripple * 0.035;
    color = mix(color, vec3(0.72, 0.88, 0.96), fresnel * 0.24);

    vec3 reflectedSun = reflect(-normalize(uSunDirection), normal);
    float specular = pow(max(dot(reflectedSun, viewDirection), 0.0), 92.0);
    color += vec3(1.0, 0.93, 0.74) * specular * 0.45;

    float shore = 1.0 - smoothstep(0.0, 2.4, vTerrainDepth);
    float foamNoise = sin(vUv.x * 210.0 + uTime * 1.4) * sin(vUv.y * 185.0 - uTime * 1.1);
    float textureFoam = smoothstep(0.74, 0.98, waterDetail) * smoothstep(0.5, 3.8, vTerrainDepth);
    float foam = shore * smoothstep(0.18, 0.78, foamNoise + ripple * 0.42) * 0.68 + textureFoam * 0.07;
    color = mix(color, uFoamColor, foam * 0.32);

    float distanceToCamera = length(cameraPosition - vWorldPosition);
    float fogAmount = smoothstep(260.0, 520.0, distanceToCamera) * 0.42;
    color = mix(color, uFogColor, fogAmount);

    float visibility = smoothstep(-0.1, 0.35, vTerrainDepth);
    float alpha = mix(0.34, 0.58, depthMix) + fresnel * 0.2 + shore * 0.16;
    gl_FragColor = vec4(color, clamp(alpha * visibility, 0.0, 0.78));
  }
`;

function createWaterMaterial(textureLoader, options) {
  const {
    textures,
    sunDirection,
    fogColor = 0x9fb7d5,
    shallowColor = 0x63c6d6,
    deepColor = 0x0c4a66,
    foamColor = 0xe8fbff,
  } = options;

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
 * @property {number} [regionSize]
 * @property {number} [samples]
 * @property {number} [minHeight]
 * @property {number} [maxHeight]
 * @property {number} [waterLevel]
 * @property {boolean} [waterEnabled]
 * @property {number} [textureDensity]
 * @property {number} [hexTileRate]
 * @property {number} [hexTileContrast]
 * @property {number} [seed]
 * @property {Float32Array} [heightMap]
 * @property {{ sand: string|THREE.Texture, grass: string|THREE.Texture, rock: string|THREE.Texture, snow: string|THREE.Texture, water: string|THREE.Texture }} [textures]
 * @property {[number, number, number]} [sunDirection]
 * @property {THREE.TextureLoader} [textureLoader]
 * @property {boolean} [addBoundaryFrame]
 * @property {boolean} [addBrushCursor]
 * @property {{ sandMax: number, grassStart: number, grassEnd: number, rockStart: number, snowStart: number }} [textureHeights]
 * @property {number} [textureBlendWidth]
 * @property {(region: TerrainRegion) => void} [onHeightmapChange]
 */

export class TerrainRegion {
  /**
   * @param {TerrainRegionOptions} [options]
   */
  constructor(options = {}) {
    this.regionSize = options.regionSize ?? DEFAULT_REGION_SIZE;
    this.samples = options.samples ?? DEFAULT_SAMPLES;
    this.minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
    this.maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
    this.waterLevel = options.waterLevel ?? DEFAULT_WATER_LEVEL;
    this.waterEnabled = options.waterEnabled ?? true;
    this.textureDensity = options.textureDensity ?? DEFAULT_TEXTURE_DENSITY;
    this.hexTileRate = options.hexTileRate ?? DEFAULT_HEX_TILE_RATE;
    this.hexTileContrast = options.hexTileContrast ?? DEFAULT_HEX_TILE_CONTRAST;
    this.textureHeights = { ...DEFAULT_TEXTURE_HEIGHTS, ...options.textureHeights };
    this.textureBlendWidth = options.textureBlendWidth ?? DEFAULT_TEXTURE_BLEND_WIDTH;
    this.textures = { ...DEFAULT_TEXTURE_URLS, ...options.textures };
    this.textureLoader = options.textureLoader ?? new THREE.TextureLoader();
    this.sunDirection = new THREE.Vector3(...(options.sunDirection ?? DEFAULT_SUN_DIRECTION)).normalize();
    this.onHeightmapChange = options.onHeightmapChange ?? null;

    this.heightMap = options.heightMap ?? new Float32Array(this.samples * this.samples);
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
        minHeight: this.minHeight,
        maxHeight: this.maxHeight,
        seed: options.seed ?? 29,
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
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      textureDensity: this.textureDensity,
      hexTileRate: this.hexTileRate,
      hexTileContrast: this.hexTileContrast,
      sunDirection: this.sunDirection,
      waterLevel: this.waterLevel,
      waterEnabled: this.waterEnabled,
      textureHeights: this.textureHeights,
      textureBlendWidth: this.textureBlendWidth,
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
    generateHeightMap(this.heightMap, {
      samples: this.samples,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      seed,
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

    if (this.terrainMesh.material.uniforms?.uWaterEnabled) {
      this.terrainMesh.material.uniforms.uWaterEnabled.value = this.waterEnabled ? 1 : 0;
    }

    return this;
  }

  setWaterLevel(level) {
    this.waterLevel = level;
    this.waterMesh.position.y = level;

    if (this.boundaryFrame) {
      this.boundaryFrame.position.y = level + 0.08;
    }

    if (this.terrainMesh.material.uniforms?.uWaterLevel) {
      this.terrainMesh.material.uniforms.uWaterLevel.value = level;
    }

    this.sync();
    this.emitHeightmapChange();
    return this;
  }

  setTextureDensity(density) {
    this.textureDensity = density;

    if (this.terrainMesh.material.uniforms?.uTextureScale) {
      this.terrainMesh.material.uniforms.uTextureScale.value = density;
    }

    return this;
  }

  setRegionSize(size) {
    this.regionSize = clamp(size, MIN_REGION_SIZE, MAX_REGION_SIZE);
    this.rebuildTerrainGeometry();
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

    if (this.terrainMesh.material.uniforms?.uHexTileRate) {
      this.terrainMesh.material.uniforms.uHexTileRate.value = rate;
    }

    return this;
  }

  setHexTileContrast(contrast) {
    this.hexTileContrast = clamp(contrast, 0.5, 0.99);

    if (this.terrainMesh.material.uniforms?.uHexContrastR) {
      this.terrainMesh.material.uniforms.uHexContrastR.value = this.hexTileContrast;
    }

    return this;
  }

  setTextureHeights(heights) {
    this.textureHeights = { ...this.textureHeights, ...heights };
    this.syncTextureHeightUniforms();
    return this;
  }

  syncTextureHeightUniforms() {
    const uniforms = this.terrainMesh.material.uniforms;
    if (!uniforms) return this;

    uniforms.uSandMax.value = this.textureHeights.sandMax;
    uniforms.uGrassStart.value = this.textureHeights.grassStart;
    uniforms.uGrassEnd.value = this.textureHeights.grassEnd;
    uniforms.uRockStart.value = this.textureHeights.rockStart;
    uniforms.uSnowStart.value = this.textureHeights.snowStart;
    uniforms.uBlendWidth.value = this.textureBlendWidth;
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
    const { min, max } = this.getHeightmapStats();
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
    Object.values(TEXTURE_LAYER_UNIFORMS).forEach(({ mesh, uniform }) => {
      const material = mesh === 'water' ? this.waterMesh.material : this.terrainMesh.material;
      disposeTerrainTexture(material.uniforms?.[uniform]?.value);
    });

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

/**
 * App-layer helper: convert pointer coordinates to a terrain hit.
 * Owns the screen → NDC → ray step; TerrainRegion only intersects its mesh.
 */
export function getTerrainHitFromPointer(region, domElement, camera, raycaster, pointer, clientX, clientY) {
  const rect = domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return region.raycast(raycaster);
}

// --- bindTerrainPainting ---

/**
 * Optional convenience: wire DOM pointer events to TerrainRegion painting.
 * Your app still owns camera, raycaster, pointer, and control policy.
 */
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

/**
 * Optional UX helper: drag-and-drop image files onto texture swatches.
 */
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