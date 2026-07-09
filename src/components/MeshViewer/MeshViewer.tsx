/**
 * MeshViewer — Interactive 3D GLB viewer using Three.js.
 *
 * Renders a GLB model with orbit controls, grid, and ambient + directional lighting.
 * Designed to drop into the Forge tab's viewport area.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  /** Full URL to the .glb file (e.g. http://127.0.0.1:7842/outputs/…/asset.glb) */
  glbUrl: string;
}

export default function MeshViewer({ glbUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 0.8, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-2, 1, -2);
    scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(4, 20, 0x333333, 0x262626);
    scene.add(grid);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.4, 0);
    controls.minDistance = 0.5;
    controls.maxDistance = 10;
    controls.update();

    // Load GLB
    setLoading(true);
    setError(null);
    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        const model = gltf.scene;

        // Ensure all mesh materials render correctly regardless of normal winding.
        // Trimesh-exported GLBs can have inverted normals (especially from marching
        // cubes / Poisson reconstruction) which causes the mesh to appear as a
        // near-black silhouette due to backface culling. DoubleSide + recomputing
        // normals when absent fixes this entirely.
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material)
              ? child.material
              : [child.material];
            mats.forEach((m) => { m.side = THREE.DoubleSide; });
            if (!child.geometry.attributes.normal) {
              child.geometry.computeVertexNormals();
            }
          }
        });

        // Auto-center and scale
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? 1.5 / maxDim : 1;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y += size.y * scale * 0.5;

        scene.add(model);
        controls.target.set(0, size.y * scale * 0.5, 0);
        controls.update();
        setLoading(false);
      },
      undefined,
      (err) => {
        console.error("GLB load error:", err);
        setError("Failed to load mesh");
        setLoading(false);
      },
    );

    // Animate
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };
  }, [glbUrl]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "rgba(0,0,0,0.6)",
            zIndex: 2,
          }}
        >
          <span className="spinner spinner--lg" />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Loading mesh...
          </span>
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            zIndex: 2,
            color: "var(--ember-bright)",
            fontSize: "var(--text-sm)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
