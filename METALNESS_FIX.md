# Metalness Fixed - All Terrain is Dielectric ✓

## What Was Fixed

### 1. Created All-Black Metalness Maps
All 5 terrain metalness textures are now solid black (RGB 0,0,0):
- `terrain-sand_metal.png` - 512×512 solid black
- `terrain-grass_metal.png` - 512×512 solid black  
- `terrain-rock_metal.png` - 512×512 solid black
- `terrain-snow_metal.png` - 512×512 solid black
- `terrain-water_metal.png` - 512×512 solid black

### 2. Optimized Shader
Changed shader to use constant `metalness = 0.0` instead of sampling:
```glsl
// Before
float metallic = blendedMRAO.r;  // Sampled from texture

// After
float metallic = 0.0;  // All terrain is dielectric
```

## Why This Matters

### PBR Material Types
**Metals** (metalness = 1.0):
- Gold, copper, steel, aluminum
- Colored specular reflections (F0 = albedo)
- No diffuse lighting

**Dielectrics** (metalness = 0.0):
- Stone, wood, water, organic matter, fabric
- Gray/white specular reflections (F0 = 0.04)
- Full diffuse lighting

### Terrain Materials (All Dielectrics!)
- **Sand** = Silica (dielectric)
- **Grass** = Organic cellulose (dielectric)
- **Rock** = Minerals (dielectric)
- **Snow** = Ice (dielectric)
- **Water** = Liquid H2O (dielectric)

**None are metallic!** They should all have metalness = 0.

## Impact

### Before (Metalness with noise)
- ❌ Incorrect specular colors
- ❌ Reduced diffuse (metal workflow)
- ❌ Physically inaccurate
- ❌ Terrain looked wrong

### After (Metalness = 0)
- ✅ Correct dielectric specular (F0 = 0.04)
- ✅ Full diffuse lighting
- ✅ Physically accurate
- ✅ Natural material appearance
- ✅ Better performance (no texture sample)

## Result

Terrain now renders with **correct PBR dielectric lighting** - natural stone, sand, grass, snow, and water with proper gray/white specular highlights and full color saturation! 🎨

Reload the page to see the fix!
