import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainRegion } from 'metaverse-terrain';

const canvas = document.querySelector('canvas');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb7d5);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
camera.position.set(132, 108, 168);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 10, 0);
controls.update();

const terrain = new TerrainRegion();
scene.add(terrain.group);

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