# metaverse-terrain

Three.js terrain library with hex-tiled texture blending, animated water, and heightmap brush editing.

`TerrainRegion` owns the terrain mesh, shaders, and height data. Your app owns the scene graph, camera, input, and raycasting.

## Install

```bash
npm install metaverse-terrain three
```

Requires `three` >= 0.160 as a peer dependency.

## Textures

You must provide all five layers: `sand`, `grass`, `rock`, `snow`, `water`. Pass a URL string or a `THREE.Texture` per layer.

Reference PNGs ship in the package (`texture/`). They are optional — use your own assets if you prefer.

**CDN**

```js
const base = 'https://cdn.jsdelivr.net/npm/metaverse-terrain@0.1.0/texture';

export const textures = {
  sand: `${base}/terrain-sand.png`,
  grass: `${base}/terrain-grass.png`,
  rock: `${base}/terrain-rock.png`,
  snow: `${base}/terrain-snow.png`,
  water: `${base}/terrain-water.png`,
};
```

**Bundler (Vite, etc.)**

```js
import sand from 'metaverse-terrain/texture/terrain-sand.png';
import grass from 'metaverse-terrain/texture/terrain-grass.png';
import rock from 'metaverse-terrain/texture/terrain-rock.png';
import snow from 'metaverse-terrain/texture/terrain-snow.png';
import water from 'metaverse-terrain/texture/terrain-water.png';

export const textures = { sand, grass, rock, snow, water };
```

## Minimal example

```js
import * as THREE from 'three';
import { TerrainRegion } from 'metaverse-terrain';
import { textures } from './textures.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const region = new TerrainRegion({ textures, seed: 42 });
scene.add(region.group);
camera.position.set(132, 108, 168);

function animate(time) {
  region.update(time);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate(0);
```

## Painting

The library does not handle pointer events. Convert screen coordinates to a ray, intersect the terrain, then paint at the hit point.

```js
import * as THREE from 'three';
import { TerrainRegion } from 'metaverse-terrain';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const region = new TerrainRegion({
  textures,
  onHeightmapChange: () => refreshHeightmapPreview(),
});

let isPainting = false;

canvas.addEventListener('pointerdown', (event) => {
  const hit = raycastTerrain(event);
  if (!hit) return;

  isPainting = true;
  region.beginStroke();
  region.paintAt(hit.point, { temporaryLower: event.shiftKey });
});

canvas.addEventListener('pointermove', (event) => {
  if (!isPainting) return;
  const hit = raycastTerrain(event);
  if (hit) region.paintAt(hit.point, { temporaryLower: event.shiftKey });
});

canvas.addEventListener('pointerup', () => {
  region.endStroke();
  isPainting = false;
});

function raycastTerrain(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return region.raycast(raycaster);
}
```

Or use the optional pointer helper:

```js
import { getTerrainHitFromPointer } from 'metaverse-terrain';

const hit = getTerrainHitFromPointer(
  region, canvas, camera, raycaster, pointer, event.clientX, event.clientY,
);
```

## Configuration

```js
const region = new TerrainRegion({
  textures,
  regionSize: 256,
  seed: 29,
  waterLevel: 28,
  waterEnabled: true,
  textureDensity: 10,
  hexTileRate: 0.5,
  textureHeights: {
    sandMax: 10,
    grassStart: -8,
    grassEnd: 52,
    rockStart: 46,
    snowStart: 50,
  },
});
```

Tune at runtime:

```js
region.setBrushMode('raise');      // 'raise' | 'lower' | 'flatten'
region.setBrushRadius(8);
region.setBrushStrength(12);
region.setWaterLevel(24);
region.setTextureDensity(10);
region.setHexTileRate(0.5);
region.setTextureHeights({ grassEnd: 48 });
region.setTerrainTexture('grass', '/assets/new-grass.png');
```

Export a heightmap preview or PNG:

```js
region.drawHeightmapPreview(canvas);
region.downloadHeightmap();
```

## Optional DOM helpers

Convenience bindings for demos — skip these if you have your own editor UX.

```js
import { bindTerrainPainting, bindTextureDrop } from 'metaverse-terrain';

const painting = bindTerrainPainting(region, {
  domElement: canvas,
  camera,
  raycaster,
  pointer,
  setControlsEnabled: (enabled) => { controls.enabled = enabled; },
});

// HTML: <div data-texture-drop="grass"><span class="swatch"></span></div>
bindTextureDrop(region);
```

## CDN (no bundler)

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js",
      "metaverse-terrain": "https://cdn.jsdelivr.net/npm/metaverse-terrain@0.1.0/index.js"
    }
  }
</script>
<script type="module">
  import { TerrainRegion } from 'metaverse-terrain';

  const base = 'https://cdn.jsdelivr.net/npm/metaverse-terrain@0.1.0/texture';
  const region = new TerrainRegion({
    textures: {
      sand: `${base}/terrain-sand.png`,
      grass: `${base}/terrain-grass.png`,
      rock: `${base}/terrain-rock.png`,
      snow: `${base}/terrain-snow.png`,
      water: `${base}/terrain-water.png`,
    },
  });
</script>
```

## API

| Export | Purpose |
|--------|---------|
| `TerrainRegion` | Terrain mesh, water, heightmap, brush state |
| `getTerrainHitFromPointer` | Screen coords → terrain intersection |
| `bindTerrainPainting` | Wire pointer events to brush painting |
| `bindTextureDrop` | Drag-and-drop images onto texture swatches |
| `TERRAIN_TEXTURE_LAYERS` | `['sand', 'grass', 'rock', 'snow', 'water']` |
| `DEFAULT_TEXTURE_HEIGHTS` | Default height blend thresholds |

**`TerrainRegion` methods**

| Method | Description |
|--------|-------------|
| `raycast(raycaster)` | Intersect terrain mesh |
| `paintAt(point, options?)` | Apply brush and emit `onHeightmapChange` |
| `paint(point, options?)` | Apply brush without emitting |
| `beginStroke()` / `endStroke()` | Reset flatten brush state |
| `setBrushMode` / `setBrushRadius` / `setBrushStrength` | Brush settings |
| `setWaterLevel` / `setWaterEnabled` | Water plane |
| `setTextureDensity` / `setHexTileRate` / `setHexTileContrast` | Shader tiling |
| `setTextureHeights` | Sand/grass/rock/snow height bands |
| `setTerrainTexture(layer, source)` | Replace a texture at runtime |
| `randomize(seed?)` / `level(height?)` | Regenerate or flatten heightmap |
| `drawHeightmapPreview(canvas)` | Render heightmap to a 2D canvas |
| `downloadHeightmap()` | Save heightmap as PNG |
| `update(elapsedTime)` | Animate water |
| `dispose()` | Free GPU resources |

TypeScript types ship in `index.d.ts`.

## Demo apps

```bash
git clone https://github.com/richardanaya/metaverse-terrain.git
cd metaverse-terrain
python3 -m http.server 8080
```

- [Editor](http://localhost:8080/example/editor/) — full brush editor
- [Minimal](http://localhost:8080/example/simple/) — smallest integration

## License

MIT — Richard Anaya. See [LICENSE](LICENSE).

Reference textures: MIT — Richard Anaya. See [ASSET_LICENSES.md](ASSET_LICENSES.md).

## References

Hex-tiling based on Morten S. Mikkelsen, [*Practical Real-Time Hex-Tiling*](https://jcgt.org/published/0011/03/05/), JCGT Vol. 11 No. 2, 2022.