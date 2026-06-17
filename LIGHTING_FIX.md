# PBR Lighting Fix - Complete ✓

## Problem
Terrain was very dark with PBR enabled because ambient lighting was only 3% of albedo.

## Solution
Replaced flat ambient with **hemisphere lighting** (sky + ground bounce):

### Shader Change
```glsl
// Hemisphere ambient lighting (sky + ground bounce)
vec3 skyColor = vec3(0.4, 0.6, 0.9);      // Blue sky
vec3 groundColor = vec3(0.2, 0.15, 0.1);  // Brown ground bounce
float hemiMix = 0.5 + 0.5 * N.y;          // Blend based on normal
vec3 hemiLight = mix(groundColor, skyColor, hemiMix);
vec3 ambient = albedo * hemiLight * ao * 0.4;
```

### Benefits
- **13x brighter** (0.4 vs 0.03)
- **Directional** - up-facing surfaces get sky light, down-facing get ground bounce
- **Realistic colors** - blue sky + warm ground reflection
- **PBR accurate** - still respects AO and materials

## Do You Need HDRI?

**No!** Hemisphere lighting is often sufficient for terrain.

### HDRI Would Add (Optional)
- Environment reflections from photos
- Complex real-world lighting
- Better specular highlights
- More file size + processing

### Recommendation
Use hemisphere lighting (current solution) for:
- ✓ Great performance
- ✓ Good visual quality
- ✓ No extra assets needed
- ✓ Perfect for outdoor terrain

Add HDRI later if you need:
- Indoor scenes
- Specific environment reflections
- Photorealistic lighting from HDR photos

## Status
✓ Shader compiles without errors
✓ WebGL2 rendering active  
✓ Hemisphere lighting applied
✓ Terrain properly lit

**Result**: Terrain is now bright with realistic ambient lighting! 🎨
