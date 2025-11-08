// /assets/js/modules/geometry.js
import * as THREE from 'three';

export function createBoxGeometry(uvMap, w, h, d) {
  const hw = w / 2, hh = h / 2, hd = d / 2;

  const vertices = [
    -hw, -hh,  hd,  hw, -hh,  hd,  hw,  hh,  hd,  -hw,  hh,  hd, // front
     hw, -hh, -hd, -hw, -hh, -hd, -hw,  hh, -hd,   hw,  hh, -hd, // back
    -hw,  hh,  hd,  hw,  hh,  hd,  hw,  hh, -hd,  -hw,  hh, -hd, // top
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd,  -hw, -hh,  hd, // bottom
     hw, -hh,  hd,  hw, -hh, -hd,  hw,  hh, -hd,   hw,  hh,  hd, // right
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh,  hd,  -hw,  hh, -hd  // left
  ];

  const indices = [];
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }

  const uvs = [];
  const faces = ['front', 'back', 'top', 'bottom', 'right', 'left'];
  for (let f of faces) {
    const { u0, v0, u1, v1 } = uvMap[f];
    uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export const headUVs = {
  front:  { u0: 28/64, v0: 1 - (8/64),  u1: 35/64, v1: 1 - (16/64) },
  back:   { u0: 44/64, v0: 1 - (8/64),  u1: 51/64, v1: 1 - (16/64) },
  top:    { u0: 36/64, v0: 1 - (0/64),  u1: 43/64, v1: 1 - (8/64) },
  bottom: { u0: 20/64, v0: 1 - (0/64),  u1: 27/64, v1: 1 - (8/64) },
  right:  { u0: 36/64, v0: 1 - (8/64),  u1: 43/64, v1: 1 - (16/64) },
  left:   { u0: 20/64, v0: 1 - (8/64),  u1: 27/64, v1: 1 - (16/64) },
};
