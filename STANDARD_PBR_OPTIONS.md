# Standard Three.js PBR Integration Options

## Current Implementation
- Custom ShaderMaterial with full PBR (GGX, Smith-Schlick, etc.)
- Hex-tiling for texture repetition
- Multi-layer texture blending (sand, grass, rock, snow)
- Manual lighting calculation

## Option 1: MeshStandardMaterial + onBeforeCompile ⭐ RECOMMENDED

### How It Works
```javascript
const material = new THREE.MeshStandardMaterial({
  map: albedoTexture,
  normalMap: normalTexture,
  roughnessMap: roughnessTexture,
  metalnessMap: metalnessTexture,
  envMap: hdrEnvironmentMap, // Automatic IBL!
  envMapIntensity: 1.0,
});

material.onBeforeCompile = (shader) => {
  // Inject hex-tiling into vertex/fragment shaders
  // Inject multi-layer blending logic
  // Modify UVs for hex-tiling
};
```

### Benefits
✅ Automatic IBL (Image-Based Lighting) from environment maps
✅ All MeshStandardMaterial features work (clearcoat, sheen, transmission)
✅ Proper tone mapping (ACES, Reinhard, etc.)
✅ Better physical accuracy
✅ Three.js optimizations and WebGL2 features
✅ Easier to add features (emissive, ao, displacement, etc.)
✅ Community support and documentation

### Challenges
⚠️ Need to carefully inject hex-tiling code
⚠️ Multi-layer blending requires custom shader chunks
⚠️ More complex than simple material setup

### Implementation Effort
**Medium** - 2-3 hours to implement properly

---

## Option 2: MeshPhysicalMaterial + Custom Shader Chunks

### How It Works
```javascript
const material = new THREE.MeshPhysicalMaterial({
  clearcoat: 0.5,
  clearcoatRoughness: 0.1,
  sheen: 1.0,
  sheenColor: new THREE.Color(0.5, 0.3, 0.2),
  // ... advanced PBR features
});

// Similar onBeforeCompile injection
```

### Benefits
✅ All Option 1 benefits PLUS:
✅ Clearcoat (for wet surfaces, varnished wood)
✅ Sheen (for fabric, velvet, grass)
✅ Transmission (for glass, water)
✅ Subsurface scattering
✅ More physically accurate

### Challenges
⚠️ Same as Option 1
⚠️ More features = more complexity

### Implementation Effort
**Medium-High** - 3-4 hours

---

## Option 3: Custom Shader + Environment Map IBL

### How It Works
Keep our custom shader but add:
```glsl
// Add IBL uniforms
uniform samplerCube envMap;
uniform float envMapIntensity;

// Sample environment for diffuse
vec3 iblDiffuse = textureCube(envMap, worldNormal).rgb * envMapIntensity;

// Sample environment for specular (with mip levels for roughness)
vec3 iblSpecular = textureCubeLod(envMap, reflect(-viewDir, normal), roughness * 8.0).rgb;
```

### Benefits
✅ Full control over rendering
✅ Already have hex-tiling working
✅ Can optimize specifically for terrain

### Challenges
❌ Need to implement full IBL pipeline
❌ Need pre-filtered environment maps
❌ Need BRDF lookup texture
❌ More shader code to maintain
❌ Won't be as optimized as Three.js

### Implementation Effort
**High** - 5-6 hours

---

## Option 4: Hybrid Approach ⭐ BEST OF BOTH WORLDS

### How It Works
Use MeshStandardMaterial for PBR lighting, but:
- Keep hex-tiling in custom vertex/fragment modifications
- Keep multi-layer blending logic
- Add environment map support automatically

```javascript
const material = new THREE.MeshStandardMaterial();

material.onBeforeCompile = (shader) => {
  // Replace diffuse color calculation with hex-tiled multi-layer
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    `
    // Hex-tiled multi-layer blending
    vec3 sandColor = hexTile(uSand, vUv);
    vec3 grassColor = hexTile(uGrass, vUv);
    vec3 rockColor = hexTile(uRock, vUv);
    vec3 snowColor = hexTile(uSnow, vUv);
    
    float slope = 1.0 - vNormal.y;
    vec3 diffuseColor = mix(sandColor, grassColor, smoothstep(0.0, 0.3, slope));
    diffuseColor = mix(diffuseColor, rockColor, smoothstep(0.3, 0.6, slope));
    diffuseColor = mix(diffuseColor, snowColor, smoothstep(0.6, 0.9, vPosition.y / maxHeight));
    `
  );
  
  // Inject hex-tiling functions
  shader.fragmentShader = hexTilingFunctions + shader.fragmentShader;
};
```

### Benefits
✅ All standard PBR features (IBL, tone mapping, etc.)
✅ Hex-tiling preserved
✅ Multi-layer blending preserved
✅ Environment maps work automatically
✅ Less code than pure custom shader
✅ Future-proof (Three.js updates automatically improve it)

### Challenges
⚠️ Need to understand Three.js shader chunk system
⚠️ Careful injection to avoid breaking standard material

### Implementation Effort
**Medium** - 2-3 hours

---

## Comparison Table

| Feature | Current Custom | Option 1 | Option 2 | Option 3 | Option 4 |
|---------|----------------|----------|----------|----------|----------|
| IBL/Environment Maps | ❌ Manual | ✅ Auto | ✅ Auto | ⚠️ Manual | ✅ Auto |
| Hex-Tiling | ✅ Yes | ✅ Injected | ✅ Injected | ✅ Yes | ✅ Injected |
| Multi-Layer Blend | ✅ Yes | ✅ Injected | ✅ Injected | ✅ Yes | ✅ Injected |
| Tone Mapping | ❌ Manual | ✅ Auto | ✅ Auto | ⚠️ Manual | ✅ Auto |
| Clearcoat/Sheen | ❌ No | ❌ No | ✅ Yes | ❌ No | ✅ Yes |
| Code Complexity | Medium | Medium | Medium-High | High | Medium |
| Maintenance | High | Low | Low | High | Low |
| Performance | Good | Excellent | Excellent | Good | Excellent |
| Future-Proof | ❌ No | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |

---

## Recommendation: Option 4 (Hybrid)

**Use MeshStandardMaterial with onBeforeCompile to inject hex-tiling and multi-layer blending.**

### Why?
1. **Best lighting**: Automatic IBL with environment maps
2. **Standard compliance**: Works with all Three.js features
3. **Less maintenance**: Three.js handles complex PBR math
4. **Future-proof**: Benefits from Three.js updates
5. **Preserves features**: Hex-tiling and multi-layer blending still work

### Implementation Plan
1. Create MeshStandardMaterial
2. Use onBeforeCompile to inject:
   - Hex-tiling GLSL functions
   - Multi-layer texture uniforms
   - Custom diffuse color calculation
3. Add environment map support (automatic!)
4. Test and tune lighting

### Expected Result
- **Much better lighting** out of the box (environment maps!)
- **Same visual style** (hex-tiling, texture blending)
- **More features** (can add clearcoat for wet surfaces, etc.)
- **Easier to maintain**

---

## Quick Example

```javascript
// Before (custom shader)
const material = new THREE.ShaderMaterial({
  vertexShader: customVertexShader,
  fragmentShader: customFragmentShader,
  uniforms: { /* 20+ uniforms */ }
});

// After (standard PBR)
const material = new THREE.MeshStandardMaterial({
  roughness: 0.8,
  metalness: 0.0,
  envMap: hdrTexture, // Automatic beautiful lighting!
  envMapIntensity: 1.0,
});

material.onBeforeCompile = (shader) => {
  // Inject hex-tiling + multi-layer blending
  // ~100 lines of custom code
};
```

**Result**: Same visual quality + better lighting + less code + more features!

---

## Next Steps

If you want to proceed with Option 4:
1. I'll implement the hybrid approach
2. Add environment map support
3. Keep hex-tiling and multi-layer blending
4. Result: Professional PBR terrain with minimal custom code

**Shall I implement Option 4?**
