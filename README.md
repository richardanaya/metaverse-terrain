# Terrain Heightmap Editor

A small ThreeJS terrain editor for a 256m region heightfield:

- 256m x 256m plot.
- 256 x 256 heightmap stored as a `Float32Array`.
- Four generated terrain maps: sand, grass, rock, and snow.
- Four generated 1024 x 1024 terrain texture PNGs in `public/textures/`.
- Shader blending by height, waterline, and slope.
- Texture density slider for controlling terrain map repeat scale.
- Raise/lower brush editing directly against the heightmap.
- Flatten brush editing that levels terrain toward the height where the stroke begins.
- Heightmap PNG preview/export.

## Run

```bash
npm install
npm run dev
```

## Controls

- Left-drag: paint terrain.
- Shift + left-drag: temporarily lower terrain.
- Right-drag: orbit camera.
- Mouse wheel: zoom.
- Middle-drag: pan.
- `1`: raise mode.
- `2`: lower mode.
- `3`: flatten mode.
- `[` and `]`: adjust brush size.
