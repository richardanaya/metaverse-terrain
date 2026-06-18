import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const DEFAULT_HDRI_URL = 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr';

export async function setupPBREnvironment(scene, renderer, options = {}) {
  const {
    hdriUrl = DEFAULT_HDRI_URL,
    background = false,
    backgroundColor = 0x9fb7d5,
    exposure = 1.0,
  } = options;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  if (!background && backgroundColor !== null) {
    scene.background = new THREE.Color(backgroundColor);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  try {
    const hdrTexture = await new RGBELoader().loadAsync(hdriUrl);
    const environment = pmrem.fromEquirectangular(hdrTexture).texture;

    scene.environment = environment;
    if (background) {
      scene.background = environment;
    }

    // Keep the raw equirectangular HDR texture for custom ShaderMaterials.
    // PMREM's `.texture` is a 2D DataTexture with CubeUV layout — wrong for
    // `samplerCube`. Sampling the equirect directly with `sampler2D` + equirect
    // UV mapping is version-robust and needs no extensions. The caller owns
    // the texture's lifetime (it must outlive the TerrainRegion that uses it).
    return { environment, envMap: hdrTexture };
  } catch (error) {
    console.warn('Failed to load HDRI environment map.', error);
    return { environment: null, envMap: null };
  } finally {
    pmrem.dispose();
  }
}
