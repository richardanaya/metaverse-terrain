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

Open [http://localhost:8080/](http://localhost:8080/)