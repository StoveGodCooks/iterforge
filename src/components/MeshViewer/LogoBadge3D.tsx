/**
 * LogoBadge3D — a small, auto-rotating 3D GLB badge (transparent bg, no grid,
 * no controls). Used for the animated InterForge logo in the Prospect output
 * empty state. Lit with the brand blue.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  glbUrl: string;
  size?: number;   // px (square)
}

export default function LogoBadge3D({ glbUrl, size = 150 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();               // transparent background
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xbfe0ff, 2.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5ea9ff, 1.6);   // brand blue rim
    rim.position.set(-3, -1, -2);
    scene.add(rim);

    let model: THREE.Object3D | null = null;
    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const dims = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;
        model.position.sub(center);
        model.scale.setScalar(1.7 / maxDim);
        scene.add(model);
      },
      undefined,
      () => {/* load error — badge just stays empty, non-fatal */},
    );

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (model) model.rotation.y += 0.012;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [glbUrl, size]);

  return <div ref={containerRef} style={{ width: size, height: size }} />;
}
