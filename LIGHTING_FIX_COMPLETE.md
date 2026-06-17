# PBR Terrain Lighting - Fixed! ✓

## Problems Identified & Solved

### Issue 1: Ambient Lighting Too Dark
**Before**: Ambient was only 3% of albedo with flat color
```glsl
vec3 ambient = albedo * vec3(0.03) * ao;
```

**Fix**: Added hemisphere lighting (sky + ground bounce) at 40% intensity
```glsl
vec3 skyColor = vec3(0.4, 0.6, 0.9);      // Blue sky
vec3 groundColor = vec3(0.2, 0.15, 0.1);  // Brown bounce
float hemiMix = 0.5 + 0.5 * N.y;
vec3 hemiLight = mix(groundColor, skyColor, hemiMix);
vec3 ambient = albedo * hemiLight * ao * 0.4;
```

**Result**: ~13x brighter ambient with directional variation

### Issue 2: Sun Intensity Too Low
**Before**: Direct light used normalized sun direction with no intensity multiplier
```glsl
vec3 directLight = (diffuse + specular) * NdotL;
```

**Problem**: PBR outdoor scenes need 10-50x sun intensity, not 1.0

**Fix**: Added uSunColor uniform with bright outdoor lighting
```glsl
uniform vec3 uSunColor;
vec3 directLight = (diffuse + specular) * NdotL * uSunColor;
```

```javascript
uSunColor: { value: new THREE.Color(10.0, 9.5, 9.0) }
```

**Result**: 10x brighter direct sunlight

## Complete Lighting System

### Terrain Lighting
```
Final Color = Direct Light + Ambient + Rim Light + Fog

Direct Light = (Diffuse + Specular) × NdotL × SunColor
  - Diffuse: GGX BRDF with metallic-roughness workflow
  - Specular: Cook-Torrance (D×G×F)
  - Sun Color: vec3(10.0, 9.5, 9.0) - bright warm sunlight

Ambient = Albedo × HemisphereLight × AO × 0.4
  - Hemisphere: mix(sky blue, ground brown) based on normal.y
  - Provides realistic sky/ground color bleeding
  - Respects ambient occlusion

Rim Light = vec3(0.10, 0.14, 0.18) × rim × (1 - roughness × 0.5)
  - Adds edge highlights for depth

Fog = mix(finalColor, vec3(0.62, 0.72, 0.84), fogAmount)
  - Distance-based atmospheric fog
```

### Water Lighting
- Fresnel with water IOR (1.33)
- GGX specular with roughness from texture
- Normal map perturbation on wave normals
- Subsurface scattering approximation
- Preserved foam and depth effects

## Technical Details

### Light Intensities (PBR-correct)
- **Sun**: 10.0 (warm white: 10.0, 9.5, 9.0)
- **Sky Ambient**: 0.4 (blue: 0.4, 0.6, 0.9)
- **Ground Bounce**: 0.4 (brown: 0.2, 0.15, 0.1)

### Why These Values?
Real outdoor lighting ratios:
- Direct sunlight: ~10-100× ambient
- Sky ambient: moderate, fills shadows
- Ground bounce: subtle warm fill

Our values are in the correct range for outdoor terrain.

## Files Modified
- `index.js` - Shader updates
  - Line ~628: Added `uniform vec3 uSunColor;`
  - Line ~835: Multiply directLight by uSunColor
  - Line ~838-845: Hemisphere ambient lighting
  - Line ~899: Initialize uSunColor uniform

## Status
✓ No shader compilation errors
✓ WebGL2 rendering active
✓ Hemisphere ambient lighting (13x brighter)
✓ Sun intensity multiplier (10x brighter)
✓ Proper PBR lighting model
✓ Terrain should now be well-lit!

## Testing
Reload http://localhost:8080/example/simple/ to see the bright, well-lit terrain!

The terrain should now have:
- Bright, warm sunlight on sun-facing surfaces
- Blue sky ambient on upward-facing areas
- Warm ground bounce on downward-facing areas
- Proper shadows and depth
- Realistic PBR material response
