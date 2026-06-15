import type * as THREE from 'three';

export const DEFAULT_REGION_SIZE: number;
export const MIN_REGION_SIZE: number;
export const MAX_REGION_SIZE: number;
export const DEFAULT_SAMPLES: number;
export const DEFAULT_MIN_HEIGHT: number;
export const DEFAULT_MAX_HEIGHT: number;
export const DEFAULT_WATER_LEVEL: number;
export const DEFAULT_TEXTURE_DENSITY: number;
export const DEFAULT_HEX_TILE_RATE: number;
export const DEFAULT_HEX_TILE_CONTRAST: number;
export const DEFAULT_SUN_DIRECTION: [number, number, number];
export const TERRAIN_TEXTURE_LAYERS: readonly ['sand', 'grass', 'rock', 'snow', 'water'];
export const DEFAULT_TEXTURE_HEIGHTS: TextureHeights;
export const DEFAULT_TEXTURE_BLEND_WIDTH: number;

export type BrushMode = 'raise' | 'lower' | 'flatten';
export type TerrainTextureLayer = (typeof TERRAIN_TEXTURE_LAYERS)[number];

export interface TerrainTextures {
  sand: string | THREE.Texture;
  grass: string | THREE.Texture;
  rock: string | THREE.Texture;
  snow: string | THREE.Texture;
  water: string | THREE.Texture;
}

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
  samples?: number;
  minHeight?: number;
  maxHeight?: number;
  waterLevel?: number;
  waterEnabled?: boolean;
  textureDensity?: number;
  hexTileRate?: number;
  hexTileContrast?: number;
  seed?: number;
  heightMap?: Float32Array;
  textures: TerrainTextures;
  sunDirection?: [number, number, number];
  textureLoader?: THREE.TextureLoader;
  addBoundaryFrame?: boolean;
  addBrushCursor?: boolean;
  textureHeights?: Partial<TextureHeights>;
  textureBlendWidth?: number;
  onHeightmapChange?: ((region: TerrainRegion) => void) | null;
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
  samples: number;
  minHeight: number;
  maxHeight: number;
  waterLevel: number;
  waterEnabled: boolean;
  textureDensity: number;
  hexTileRate: number;
  hexTileContrast: number;
  textureHeights: TextureHeights;
  textureBlendWidth: number;
  textures: TerrainTextures;
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
  setTextureDensity(density: number): this;
  setRegionSize(size: number): this;
  rebuildTerrainGeometry(): this;
  setHexTileRate(rate: number): this;
  setHexTileContrast(contrast: number): this;
  setTextureHeights(heights: Partial<TextureHeights>): this;
  syncTextureHeightUniforms(): this;

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