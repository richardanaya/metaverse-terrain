# metaverse-terrain

Single-file ES module library (`index.js`). `TerrainRegion` owns terrain logic in world space. Your app owns input, cameras, and raycasting.

## Core integration

```js
import * as THREE from 'three';
import { TerrainRegion } from 'metaverse-terrain';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const region = new TerrainRegion({ onHeightmapChange: refreshPreview });
scene.add(region.group);

// App: pointer → ray → terrain hit
function getHit(event) {
  const rect = domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return region.raycast(raycaster);
}

// Library: world point → brush
region.paintAt(hit.point, { temporaryLower: event.shiftKey });
```

## Optional helpers

```js
import { getTerrainHitFromPointer, bindTerrainPainting } from 'metaverse-terrain';

const hit = getTerrainHitFromPointer(region, domElement, camera, raycaster, pointer, x, y);

const painting = bindTerrainPainting(region, { domElement, camera, raycaster, pointer });
```

`bindTerrainPainting` is demo sugar — not required for custom UX.

## TerrainRegion API

- `raycast(raycaster)` — intersect terrain mesh
- `paintAt(worldPoint)` — apply brush, emit `onHeightmapChange`
- `setBrushMode()`, `setWaterLevel()`, `setTextureHeights()`, …
- `drawHeightmapPreview(canvas)`, `downloadHeightmap()`

## Run

```bash
python3 -m http.server 8080
```

- Editor: [http://localhost:8080/example/editor/](http://localhost:8080/example/editor/)
- Minimal: [http://localhost:8080/example/simple/](http://localhost:8080/example/simple/)

## References

Terrain texture hex-tiling follows the color-path adaptation in:

> Morten S. Mikkelsen, [*Practical Real-Time Hex-Tiling*](https://jcgt.org/published/0011/03/05/), Journal of Computer Graphics Techniques, Vol. 11, No. 2, 2022.

Based on the by-example noise hex-tiling of Heitz and Neyret; see the [JCGT paper](https://jcgt.org/published/0011/03/05/) and [reference demo](https://github.com/mmikk/hextile-demo).