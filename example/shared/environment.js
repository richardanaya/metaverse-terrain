import * as THREE from 'three/webgpu';
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

  try {
    const hdrTexture = await new RGBELoader().loadAsync(hdriUrl);
    // WebGPURenderer consumes equirectangular environment textures directly.
    // Avoid PMREMGenerator here: it is tied to the classic WebGL renderer path.
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

    scene.environment = hdrTexture;
    if (background) {
      scene.background = hdrTexture;
    }

    return { environment: hdrTexture, envMap: hdrTexture };
  } catch (error) {
    console.warn('Failed to load HDRI environment map.', error);
    return { environment: null, envMap: null };
  }
}
