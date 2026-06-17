import type * as THREE from 'three';

export const DEFAULT_REGION_SIZE: number;
export const MIN_REGION_SIZE: number;
export const MAX_REGION_SIZE: number;
export const DEFAULT_SAMPLE_SPACING: number;
export const DEFAULT_SAMPLES: number;
export const DEFAULT_MIN_HEIGHT: number;
export const DEFAULT_MAX_HEIGHT: number;
export const DEFAULT_WATER_LEVEL: number;
export const DEFAULT_TEXTURE_DENSITY: number;
export const DEFAULT_HEX_TILE_RATE: number;
export const DEFAULT_HEX_TILE_CONTRAST: number;
export const DEFAULT_SUN_DIRECTION: [number, number, number];
export const TERRAIN_TEXTURE_LAYERS: readonly ['sand', 'grass', 'rock', 'snow', 'water'];
export const PBR_CHANNELS: readonly ['metal', 'roughness', 'normal', 'ao'];
export const DEFAULT_TEXTURE_HEIGHTS: TextureHeights;
export const DEFAULT_TEXTURE_BLEND_WIDTH: number;

export type BrushMode = 'raise' | 'lower' | 'flatten';
export type TerrainTextureLayer = (typeof TERRAIN_TEXTURE_LAYERS)[number];
export type PBRChannel = (typeof PBR_CHANNELS)[number];
export type PBRLayer = TerrainTextureLayer;

export interface TerrainTextures {
  sand: string | THREE.Texture;
  grass: string | THREE.Texture;
  rock: string | THREE.Texture;
  snow: string | THREE.Texture;
  water: string | THREE.Texture;
}

/** Per-layer metallic-roughness PBR maps. Provide separate channels or a pre-packed `mrao` texture. */
export interface PBRTextureSet {
  /** Metallic channel (packed into MRAO `.r` when using `loadPBRTextureSet`). */
  metal?: string | THREE.Texture | null;
  /** Roughness channel (packed into MRAO `.g`). */
  roughness?: string | THREE.Texture | null;
  /** Tangent-space normal map. */
  normal?: string | THREE.Texture | null;
  /** Ambient occlusion (packed into MRAO `.b`). */
  ao?: string | THREE.Texture | null;
  /** Pre-packed MRAO texture (metal, roughness, AO in RGB). Skips runtime packing. */
  mrao?: string | THREE.Texture | null;
}

/** Optional PBR maps for each terrain layer. Albedo textures remain required in `TerrainTextures`. */
export type PBRTextures = Partial<Record<PBRLayer, PBRTextureSet>>;

/** Packed PBR textures ready to pass to `TerrainRegion` as `pbrTextures`. */
export interface LoadedPBRTextureSet {
  normal: THREE.Texture | null;
  mrao: THREE.Texture | null;
}

export type LoadedPBRTextures = Partial<Record<PBRLayer, LoadedPBRTextureSet>>;

export interface TextureHeights {
  sandMax: number;
  grassStart: number;
  grassEnd: number;
  rockStart: number;
  snowStart: number;
}

export interface TerrainBrush {
  mode: BrushMode;
  radius: number;
  strength: number;
  flattenHeight: number | null;
  temporaryLower: boolean;
}

export interface HeightmapStats {
  min: number;
  max: number;
}

export interface TerrainRegionOptions {
  regionSize?: number;
  /** World units between generated height samples. Ignored when samples is provided. */
  sampleSpacing?: number;
  /** Fixed sample count. If omitted, samples are derived from regionSize / sampleSpacing. */
  samples?: number;
  minHeight?: number;
  maxHeight?: number;
  waterLevel?: number;
  waterEnabled?: boolean;
  waterShallowColor?: THREE.ColorRepresentation;
  waterDeepColor?: THREE.ColorRepresentation;
  waterFoamColor?: THREE.ColorRepresentation;
  waterShallowAlpha?: number;
  waterDeepAlpha?: number;
  waterMaxAlpha?: number;
  textureDensity?: number;
  hexTileRate?: number;
  hexTileContrast?: number;
  seed?: number;
  heightMap?: Float32Array;
  textures: TerrainTextures;
  /** Optional PBR normal/MRAO maps per layer. Use `loadPBRTextureSet()` to pack channels. */
  pbrTextures?: PBRTextures | LoadedPBRTextures | null;
  /** Scales blended terrain normal maps. Default `1.0`. */
  normalStrength?: number;
  /** Scales terrain ambient occlusion from MRAO maps. Default `1.0`. */
  terrainAOIntensity?: number;
  sunDirection?: [number, number, number];
  textureLoader?: THREE.TextureLoader;
  addBoundaryFrame?: boolean;
  addBrushCursor?: boolean;
  textureHeights?: Partial<TextureHeights>;
  textureBlendWidth?: number;
  onHeightmapChange?: ((region: TerrainRegion) => void) | null;
  /** PMREM-processed cube environment map for IBL water reflection. Pass scene.environment. */
  environment?: THREE.Texture | null;
  /** Enable refraction of the seabed through the water surface. Default true. */
  refractionEnabled?: boolean;
  /** Wind direction (vec2) driving Gerstner wave propagation. Default [1, 0.3]. */
  windDirection?: [number, number] | THREE.Vector2;
  /** Wind speed scaling wave amplitude and propagation rate. Default 5.0 (0 = calm, 15 = stormy). */
  windSpeed?: number;
}

export interface PaintOptions {
  mode?: BrushMode;
  temporaryLower?: boolean;
}

export interface BrushCursorOptions {
  mode?: BrushMode;
  radius?: number;
}

export class TerrainRegion {
  regionSize: number;
  sampleSpacing: number;
  fixedSamples: boolean;
  seed: number;
  samples: number;
  minHeight: number;
  maxHeight: number;
  waterLevel: number;
  waterEnabled: boolean;
  waterShallowColor: THREE.ColorRepresentation;
  waterDeepColor: THREE.ColorRepresentation;
  waterFoamColor: THREE.ColorRepresentation;
  waterShallowAlpha: number;
  waterDeepAlpha: number;
  waterMaxAlpha: number;
  textureDensity: number;
  hexTileRate: number;
  hexTileContrast: number;
  textureHeights: TextureHeights;
  textureBlendWidth: number;
  textures: TerrainTextures;
  pbrTextures: PBRTextures | LoadedPBRTextures | null;
  normalStrength: number;
  terrainAOIntensity: number;
  textureLoader: THREE.TextureLoader;
  sunDirection: THREE.Vector3;
  onHeightmapChange: ((region: TerrainRegion) => void) | null;
  heightMap: Float32Array;
  brush: TerrainBrush;
  brushCursor: THREE.Mesh | null;
  group: THREE.Group;
  terrainMesh: THREE.Mesh;
  waterMesh: THREE.Mesh;
  boundaryFrame?: THREE.Line;
  environment: THREE.Texture | null;
  refractionEnabled: boolean;
  windDirection: [number, number];
  windSpeed: number;

  constructor(options: TerrainRegionOptions);

  get halfRegion(): number;

  createTerrainMesh(): THREE.Mesh;
  createWaterMesh(): THREE.Mesh;
  attachBrushCursor(): THREE.Mesh;

  paintAt(worldPoint: THREE.Vector3, options?: PaintOptions): this;
  paint(worldPoint: THREE.Vector3, options?: PaintOptions): this;

  randomize(seed?: number): this;
  level(height?: number): this;

  setWaterEnabled(enabled: boolean): this;
  setWaterLevel(level: number): this;
  setWaterColors(colors?: { shallowColor?: THREE.ColorRepresentation; deepColor?: THREE.ColorRepresentation; foamColor?: THREE.ColorRepresentation }): this;
  setWaterOpacity(opacity?: { shallowAlpha?: number; deepAlpha?: number; maxAlpha?: number }): this;
  setTextureDensity(density: number): this;
  setRegionSize(size: number): this;
  rebuildTerrainGeometry(): this;
  setHexTileRate(rate: number): this;
  setHexTileContrast(contrast: number): this;
  setTextureHeights(heights: Partial<TextureHeights>): this;
  syncTextureHeightUniforms(): this;
  /** Scale blended terrain normal maps at runtime. */
  setNormalStrength(strength: number): this;
  /** Scale terrain AO contribution from MRAO maps at runtime. */
  setTerrainAOIntensity(intensity: number): this;
  /** Toggle PBR water shading (specular, fresnel, normal detail). */
  setPBREnabled(enabled: boolean): this;
  /** Set water index of refraction for fresnel/specular (default `1.33`). */
  setWaterIOR(ior: number): this;
  /** Sync water sun direction with scene lighting (normalized world-space vector). */
  setSunDirection(direction: THREE.Vector3): this;
  /** Bind a PMREM-processed environment map for IBL water reflection (scene.environment). */
  setEnvironment(envMap: THREE.Texture | null): this;
  /** Toggle refraction of the seabed through the water surface. */
  setRefractionEnabled(enabled: boolean): this;
  /** Set wind direction driving Gerstner wave propagation. */
  setWindDirection(direction: [number, number] | THREE.Vector2): this;
  /** Set wind speed scaling wave amplitude and propagation rate. */
  setWindSpeed(speed: number): this;

  setBrushMode(mode: BrushMode): this;
  setBrushRadius(radius: number): this;
  setBrushStrength(strength: number): this;
  beginStroke(): this;
  endStroke(): this;

  sync(): this;
  raycast(raycaster: THREE.Raycaster): THREE.Intersection | null;
  updateBrushCursor(cursor: THREE.Mesh, point: THREE.Vector3, options?: BrushCursorOptions): THREE.Mesh;
  update(elapsedTime: number): this;

  getHeightmapStats(): HeightmapStats;
  getHeightmapImageData(): ImageData;
  getHeightmapSummary(): string;
  drawHeightmapPreview(canvas: HTMLCanvasElement): string;
  toHeightmapDataURL(): string;
  downloadHeightmap(filename?: string): this;

  clampBrushRadius(radius: number, min: number, max: number): number;
  setTerrainTexture(layer: TerrainTextureLayer, source: string | THREE.Texture | File | Blob): this;
  emitHeightmapChange(): this;
  dispose(): void;
}

export function getTerrainHitFromPointer(
  region: TerrainRegion,
  domElement: HTMLElement,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  clientX: number,
  clientY: number,
): THREE.Intersection | null;

export interface BindTerrainPaintingOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  setControlsEnabled?: (enabled: boolean) => void;
  getHit?: (event: PointerEvent) => THREE.Intersection | null;
}

export interface TerrainPaintingBinding {
  readonly isPainting: boolean;
  unbind(): void;
}

export function bindTerrainPainting(
  region: TerrainRegion,
  options: BindTerrainPaintingOptions,
): TerrainPaintingBinding;

export interface TextureDropBinding {
  unbind(): void;
}

export function bindTextureDrop(
  region: TerrainRegion,
  root?: ParentNode,
): TextureDropBinding;

/**
 * Load and pack PBR textures for all terrain layers.
 * Accepts per-layer { metal, roughness, normal, ao } URLs or textures.
 * Packs metal+roughness+ao into single MRAO textures per layer.
 */
export function loadPBRTextureSet(
  pbrTextures: PBRTextures,
  textureLoader?: THREE.TextureLoader,
): Promise<LoadedPBRTextures>;
