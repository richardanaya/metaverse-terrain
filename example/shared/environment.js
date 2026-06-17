import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const DEFAULT_HDRI_URL = 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr';

export async function setupPBREnvironment(scene, renderer, options = {}) {
  const {
    hdriUrl = DEFAULT_HDRI_URL,
    background = false,
    backgroundColor = 0x9fb7d5,
    exposure = 1.0,
    sunIntensity = 3.0,
    sunPosition = [80, 140, 60],
    shadows = false,
  } = options;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  if (!background && backgroundColor !== null) {
    scene.background = new THREE.Color(backgroundColor);
  }

  const sunLight = new THREE.DirectionalLight(0xffffff, sunIntensity);
  sunLight.name = 'Sun';
  sunLight.position.set(...sunPosition);
  sunLight.castShadow = shadows;

  if (shadows) {
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 520;
    sunLight.shadow.camera.left = -220;
    sunLight.shadow.camera.right = 220;
    sunLight.shadow.camera.top = 220;
    sunLight.shadow.camera.bottom = -220;
  }

  scene.add(sunLight);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  try {
    const hdrTexture = await new RGBELoader().loadAsync(hdriUrl);
    const environment = pmrem.fromEquirectangular(hdrTexture).texture;

    scene.environment = environment;
    if (background) {
      scene.background = environment;
    }

    hdrTexture.dispose();
    return { environment, sunLight };
  } catch (error) {
    console.warn('Failed to load HDRI environment map; falling back to directional sun only.', error);
    return { environment: null, sunLight };
  } finally {
    pmrem.dispose();
  }
}
