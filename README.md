<img width="2879" height="1594" alt="image" src="https://github.com/user-attachments/assets/b25e75f0-dd80-451d-a99a-644819dbfb71" />


# metaverse-terrain

Three.js terrain library with hex-tiled texture blending, optional PBR maps (normal, metallic, roughness, AO), animated water, and heightmap brush editing.

`TerrainRegion` owns the terrain mesh, shaders, and height data. Your app owns the scene graph, camera, input, and raycasting.

## Install

**npm**

```bash
npm install metaverse-terrain three
```

Requires `three` >= 0.160 as a peer dependency. Use with Vite, Webpack, or any bundler — no import map needed.

**jsDelivr**

No install step. Load from [cdn.jsdelivr.net/npm/metaverse-terrain](https://cdn.jsdelivr.net/npm/metaverse-terrain/) in the browser using an import map (see below).

---

## Using with jsDelivr

Browsers cannot resolve bare imports like `'metaverse-terrain'` on their own. Add an **import map** in your HTML, then load your app in a **`<script type="module">`**.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js",
          "metaverse-terrain": "https://cdn.jsdelivr.net/npm/metaverse-terrain/index.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { TerrainRegion } from 'metaverse-terrain';

      // your app here
    </script>
  </body>
</html>
```

Serve over HTTP (not `file://`). The snippets below go inside that `<script type="module">` block.

### Textures

Provide all five layers: `sand`, `grass`, `rock`, `snow`, `water`. Reference PNGs are on jsDelivr:

```js
const TEXTURE_BASE = 'https://cdn.jsdelivr.net/npm/metaverse-terrain/texture';

const textures = {
  sand: `${TEXTURE_BASE}/terrain-sand.png`,
  grass: `${TEXTURE_BASE}/terrain-grass.png`,
  rock: `${TEXTURE_BASE}/terrain-rock.png`,
  snow: `${TEXTURE_BASE}/terrain-snow.png`,
  water: `${TEXTURE_BASE}/terrain-water.png`,
};
```

### PBR textures (optional)

PBR is optional — albedo-only terrain still works. To enable physically based shading, provide per-layer **normal**, **metallic**, **roughness**, and **AO** maps (or a pre-packed **MRAO** texture). Reference maps ship with the package:

```js
const pbrTextures = {
  sand: {
    metal: `${TEXTURE_BASE}/terrain-sand_metal.png`,
    roughness: `${TEXTURE_BASE}/terrain-sand_roughness.png`,
    normal: `${TEXTURE_BASE}/terrain-sand_normal.png`,
    ao: `${TEXTURE_BASE}/terrain-sand_ao.png`,
  },
  grass: {
    metal: `${TEXTURE_BASE}/terrain-grass_metal.png`,
    roughness: `${TEXTURE_BASE}/terrain-grass_roughness.png`,
    normal: `${TEXTURE_BASE}/terrain-grass_normal.png`,
    ao: `${TEXTURE_BASE}/terrain-grass_ao.png`,
  },
  rock: {
    metal: `${TEXTURE_BASE}/terrain-rock_metal.png`,
    roughness: `${TEXTURE_BASE}/terrain-rock_roughness.png`,
    normal: `${TEXTURE_BASE}/terrain-rock_normal.png`,
    ao: `${TEXTURE_BASE}/terrain-rock_ao.png`,
  },
  snow: {
    metal: `${TEXTURE_BASE}/terrain-snow_metal.png`,
    roughness: `${TEXTURE_BASE}/terrain-snow_roughness.png`,
    normal: `${TEXTURE_BASE}/terrain-snow_normal.png`,
    ao: `${TEXTURE_BASE}/terrain-snow_ao.png`,
  },
  water: {
    metal: `${TEXTURE_BASE}/terrain-water_metal.png`,
    roughness: `${TEXTURE_BASE}/terrain-water_roughness.png`,
    normal: `${TEXTURE_BASE}/terrain-water_normal.png`,
    ao: `${TEXTURE_BASE}/terrain-water_ao.png`,
  },
};
```

`loadPBRTextureSet()` loads the maps and packs metallic, roughness, and AO into a single MRAO texture per layer:

```js
import { TerrainRegion, loadPBRTextureSet } from 'metaverse-terrain';

const packedPBR = await loadPBRTextureSet(pbrTextures);

const region = new TerrainRegion({
  textures,
  pbrTextures: packedPBR,
  normalStrength: 1.0,
  terrainAOIntensity: 1.0,
});
```

For best results, set `scene.environment` from an HDRI (image-based lighting). The bundled examples load a Venice sunset HDR via Three.js `RGBELoader` and `PMREMGenerator`. PBR terrain integrates with Three.js `MeshStandardMaterial`; water uses a custom shader with fresnel, specular, and normal detail. Disable PBR water at runtime with `region.setPBREnabled(false)` on low-end devices.

### Minimal example

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three/build/three.module.js",
          "metaverse-terrain": "https://cdn.jsdelivr.net/npm/metaverse-terrain/index.js"
        }
      }
    </script>
    <style>body { margin: 0; } canvas { display: block; }</style>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { TerrainRegion } from 'metaverse-terrain';

      const TEXTURE_BASE = 'https://cdn.jsdelivr.net/npm/metaverse-terrain/texture';
      const textures = {
        sand: `${TEXTURE_BASE}/terrain-sand.png`,
        grass: `${TEXTURE_BASE}/terrain-grass.png`,
        rock: `${TEXTURE_BASE}/terrain-rock.png`,
        snow: `${TEXTURE_BASE}/terrain-snow.png`,
        water: `${TEXTURE_BASE}/terrain-water.png`,
      };

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(innerWidth, innerHeight);
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fb7d5);

      const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);
      camera.position.set(132, 108, 168);
      camera.lookAt(0, 10, 0);

      const region = new TerrainRegion({ textures, seed: 42 });
      scene.add(region.group);

      function animate(time) {
        region.update(time);
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }

      animate(0);
    </script>
  </body>
</html>
```

### Painting

The library does not handle pointer events. Raycast the terrain, then call `paintAt`:

```js
import { TerrainRegion, getTerrainHitFromPointer } from 'metaverse-terrain';

const TEXTURE_BASE = 'https://cdn.jsdelivr.net/npm/metaverse-terrain/texture';
const textures = { /* sand, grass, rock, snow, water — see above */ };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const canvas = renderer.domElement;

const region = new TerrainRegion({ textures });
let isPainting = false;

canvas.addEventListener('pointerdown', (event) => {
  const hit = getTerrainHitFromPointer(
    region, canvas, camera, raycaster, pointer, event.clientX, event.clientY,
  );
  if (!hit) return;

  isPainting = true;
  region.beginStroke();
  region.paintAt(hit.point, { temporaryLower: event.shiftKey });
});

canvas.addEventListener('pointermove', (event) => {
  if (!isPainting) return;
  const hit = getTerrainHitFromPointer(
    region, canvas, camera, raycaster, pointer, event.clientX, event.clientY,
  );
  if (hit) region.paintAt(hit.point, { temporaryLower: event.shiftKey });
});

canvas.addEventListener('pointerup', () => {
  region.endStroke();
  isPainting = false;
});
```

### Configuration

```js
import { TerrainRegion } from 'metaverse-terrain';

const region = new TerrainRegion({
  textures,
  regionSize: 256,
  seed: 29,
  waterLevel: 28,
  textureDensity: 10,
  hexTileRate: 0.5,
});

region.setBrushMode('raise');
region.setBrushRadius(8);
region.setWaterLevel(24);
region.downloadHeightmap();
```

### Optional DOM helpers

```js
import { bindTerrainPainting, bindTextureDrop } from 'metaverse-terrain';

bindTerrainPainting(region, { domElement: canvas, camera, raycaster, pointer });
bindTextureDrop(region); // needs [data-texture-drop="grass"] elements in HTML
```

---

## Using with npm

```js
import * as THREE from 'three';
import { TerrainRegion, loadPBRTextureSet } from 'metaverse-terrain';
import sand from 'metaverse-terrain/texture/terrain-sand.png';
import grass from 'metaverse-terrain/texture/terrain-grass.png';
import rock from 'metaverse-terrain/texture/terrain-rock.png';
import snow from 'metaverse-terrain/texture/terrain-snow.png';
import water from 'metaverse-terrain/texture/terrain-water.png';
import sandMetal from 'metaverse-terrain/texture/terrain-sand_metal.png';
import sandRoughness from 'metaverse-terrain/texture/terrain-sand_roughness.png';
import sandNormal from 'metaverse-terrain/texture/terrain-sand_normal.png';
import sandAO from 'metaverse-terrain/texture/terrain-sand_ao.png';
// ... same pattern for grass, rock, snow, water

const pbrTextures = await loadPBRTextureSet({
  sand: { metal: sandMetal, roughness: sandRoughness, normal: sandNormal, ao: sandAO },
  // grass, rock, snow, water ...
});

const region = new TerrainRegion({
  textures: { sand, grass, rock, snow, water },
  pbrTextures,
  seed: 42,
});

scene.add(region.group);
```

Omit `pbrTextures` for albedo-only rendering.

---

## API

| Export | Purpose |
|--------|---------|
| `TerrainRegion` | Terrain mesh, water, heightmap, brush state |
| `loadPBRTextureSet` | Load and pack PBR maps (metal, roughness, normal, AO → MRAO) |
| `getTerrainHitFromPointer` | Screen coords → terrain intersection |
| `bindTerrainPainting` | Wire pointer events to brush painting |
| `bindTextureDrop` | Drag-and-drop images onto texture swatches |
| `TERRAIN_TEXTURE_LAYERS` | `['sand', 'grass', 'rock', 'snow', 'water']` |
| `PBR_CHANNELS` | `['metal', 'roughness', 'normal', 'ao']` |
| `DEFAULT_TEXTURE_HEIGHTS` | Default height blend thresholds |

**`TerrainRegion` methods**

| Method | Description |
|--------|-------------|
| `raycast(raycaster)` | Intersect terrain mesh |
| `paintAt(point, options?)` | Apply brush and emit `onHeightmapChange` |
| `setBrushMode` / `setBrushRadius` / `setBrushStrength` | Brush settings |
| `setWaterLevel` / `setWaterEnabled` | Water plane |
| `setTextureDensity` / `setHexTileRate` / `setHexTileContrast` | Shader tiling |
| `setTextureHeights` | Sand/grass/rock/snow height bands |
| `setNormalStrength` / `setTerrainAOIntensity` | PBR normal and AO intensity |
| `setPBREnabled` / `setWaterIOR` | PBR water toggle and index of refraction |
| `setTerrainTexture(layer, source)` | Replace a texture at runtime |
| `randomize(seed?)` / `level(height?)` | Regenerate or flatten heightmap |
| `drawHeightmapPreview(canvas)` / `downloadHeightmap()` | Export heightmap |
| `update(elapsedTime)` | Animate water |
| `dispose()` | Free GPU resources |

TypeScript types ship in `index.d.ts`.

## Demo apps

```bash
git clone https://github.com/richardanaya/metaverse-terrain.git
cd metaverse-terrain
python3 -m http.server 8080
```

- [Editor](http://localhost:8080/example/editor/) — full brush editor with PBR and HDRI lighting
- [Minimal](http://localhost:8080/example/simple/) — smallest PBR integration

## License

MIT — Richard Anaya. See [LICENSE](LICENSE).

Reference textures: MIT — Richard Anaya. See [ASSET_LICENSES.md](ASSET_LICENSES.md).

## References

Hex-tiling based on Morten S. Mikkelsen, [*Practical Real-Time Hex-Tiling*](https://jcgt.org/published/0011/03/05/), JCGT Vol. 11 No. 2, 2022.
