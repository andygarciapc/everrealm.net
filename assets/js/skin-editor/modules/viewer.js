// /assets/js/modules/viewer.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initViewer(canvas) {
  const preview = document.getElementById('preview');
  const renderer = new THREE.WebGLRenderer({ canvas: preview, antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.position.z = 100;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  const skinMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

  function resize() {
    const size = document.getElementById('rightPanel').clientHeight;
    renderer.setSize(size, size);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = false;
  controls.target.set(0, 0.5, 0);

  return { scene, renderer, camera, controls, skinMat, resize };
}
