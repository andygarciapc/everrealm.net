// /assets/js/modules/character.js
import * as THREE from 'three';
import { createBoxGeometry, headUVs } from './geometry.js';

export function createCharacter(skinMat) {
  const group = new THREE.Group();

  const head = new THREE.Mesh(createBoxGeometry(headUVs, 8, 8, 10), skinMat);
  head.position.set(0, 14, 0);
  group.add(head);

  // Later: torso, arms, legs, etc.
  return group;
}
