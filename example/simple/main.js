import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainRegion, loadPBRTextureSet } from 'metaverse-terrain';
import { setupPBREnvironment } from '../shared/environment.js';
import { TEXTURE_URLS, PBR_TEXTURE_URLS } from '../shared/textures.js';

const canvas = document.querySelector('canvas');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7d5);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
camera.position.set(132, 108, 168);

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const environmentReady = setupPBREnvironment(scene, renderer);

async function init() {
  // Load and pack PBR textures while the HDRI environment initializes.
  const [pbrTextures] = await Promise.all([
    loadPBRTextureSet(PBR_TEXTURE_URLS),
    environmentReady,
  ]);
  
  const terrain = new TerrainRegion({
    textures: TEXTURE_URLS,
    pbrTextures,
    normalStrength: 1.0,
  });
  scene.add(terrain.group);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 10, 0);
  controls.update();

  const clock = new THREE.Clock();

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate() {
    terrain.update(clock.getElapsedTime());
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', resize);
  resize();
  animate();
}

init().catch(console.error);