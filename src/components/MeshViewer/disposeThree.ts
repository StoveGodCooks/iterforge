/**
 * Three.js disposal helpers.
 *
 * material.dispose() does NOT free the textures referenced by that material
 * (.map, .normalMap, .roughnessMap, …). Those must be disposed explicitly or
 * their GPU memory leaks — which matters here because the mesh viewers remount
 * on every glbUrl change. These helpers walk an object graph and free geometry,
 * materials, and every texture hanging off them.
 */
import * as THREE from "three";

/** Dispose a material and every texture property it holds. */
export function disposeMaterial(material: THREE.Material): void {
  const props = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    const val = props[key] as THREE.Texture | undefined;
    if (val && val.isTexture) val.dispose();
  }
  material.dispose();
}

/** Recursively dispose all geometries, materials, and textures under a root. */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}
