import * as THREE from 'three';

export interface OrbitPathInstance {
  group: THREE.Group;
  getPositionAt: (progress: number) => { position: THREE.Vector3; rotationY: number };
  settledPosition: THREE.Vector3;
  settledRotationY: number;
  setOpacity: (opacity: number) => void;
  dispose: () => void;
}

/**
 * Creates the subtle, elegant central orbital halo and calculates
 * the cinematic elliptical travel path for the robot's arrival.
 */
export function createOrbitPath(): OrbitPathInstance {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // 1. Subtle Translucent Globe Volume (Placed at z: -0.4 so it sits behind the meeting window)
  const globeGeo = new THREE.SphereGeometry(1.4, 32, 24);
  const globeMat = new THREE.MeshBasicMaterial({
    color: 0x7357e8,
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
  });
  disposables.push(globeGeo, globeMat);
  const globeMesh = new THREE.Mesh(globeGeo, globeMat);
  globeMesh.position.set(0, 0, -0.4);
  group.add(globeMesh);

  // 2. Thin Elegant Orbital Halo Ring
  const haloGeo = new THREE.TorusGeometry(2.35, 0.012, 16, 80);
  haloGeo.rotateX(Math.PI / 2.7);
  haloGeo.rotateZ(0.25);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x7357e8,
    transparent: true,
    opacity: 0.22,
  });
  disposables.push(haloGeo, haloMat);
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  group.add(haloMesh);

  // 3. Subtle Secondary Orbit Accent Ring (Soft cyan/mint)
  const accentRingGeo = new THREE.TorusGeometry(2.5, 0.008, 12, 60);
  accentRingGeo.rotateX(Math.PI / 2.3);
  accentRingGeo.rotateZ(-0.35);
  const accentRingMat = new THREE.MeshBasicMaterial({
    color: 0x4fd1c5,
    transparent: true,
    opacity: 0.16,
  });
  disposables.push(accentRingGeo, accentRingMat);
  const accentRingMesh = new THREE.Mesh(accentRingGeo, accentRingMat);
  group.add(accentRingMesh);

  // Target settled position: Upper-right / center-right of hero visual area
  const settledPosition = new THREE.Vector3(1.4, 1.25, 0.3);
  const settledRotationY = -0.25;

  return {
    group,
    settledPosition,
    settledRotationY,
    setOpacity: (alpha: number) => {
      haloMat.opacity = 0.22 * alpha;
      accentRingMat.opacity = 0.16 * alpha;
      globeMat.opacity = 0.035 * alpha;
    },
    getPositionAt: (rawProgress: number) => {
      // Easing function for smooth arrival: cubic in-out
      const progress = Math.min(1, Math.max(0, rawProgress));
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // Complete one elegant 360-degree elliptical orbit
      // Starting from far back-left (-2.2, -0.6, -1.5)
      // Sweeping smoothly through front-bottom and rising to upper-right
      const startAngle = Math.PI * 1.25;
      const angle = startAngle + eased * (Math.PI * 2.0);

      const radiusX = 2.35;
      const radiusY = 1.15;
      const radiusZ = 1.4;

      const orbitX = Math.cos(angle) * radiusX;
      const orbitY = Math.sin(angle) * radiusY;
      const orbitZ = Math.sin(angle * 1.05) * radiusZ;

      // During the final 20% of orbit travel (0.8 -> 1.0), smoothly interpolate to settledPosition
      if (progress > 0.8) {
        const blend = (progress - 0.8) / 0.2;
        const smoothBlend = blend * blend * (3 - 2 * blend); // smoothstep
        return {
          position: new THREE.Vector3(
            THREE.MathUtils.lerp(orbitX, settledPosition.x, smoothBlend),
            THREE.MathUtils.lerp(orbitY, settledPosition.y, smoothBlend),
            THREE.MathUtils.lerp(orbitZ, settledPosition.z, smoothBlend)
          ),
          rotationY: THREE.MathUtils.lerp(-angle + Math.PI / 2, settledRotationY, smoothBlend),
        };
      }

      // Robot faces forward tangent to its orbital motion
      const rotY = -angle + Math.PI / 2;

      return {
        position: new THREE.Vector3(orbitX, orbitY, orbitZ),
        rotationY: rotY,
      };
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
    },
  };
}
