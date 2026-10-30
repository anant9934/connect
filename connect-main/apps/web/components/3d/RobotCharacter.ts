import * as THREE from 'three';

export interface RobotCharacterInstance {
  group: THREE.Group;
  update: (time: number, isWaving: boolean, waveProgress: number, isIdle: boolean) => void;
  dispose: () => void;
}

/**
 * Creates high-DPI canvas textures for the robot's expressive face visor.
 */
function createVisorTexture(eyeBrightness = 1.0, isBlinking = false): {
  texture: THREE.CanvasTexture;
  updateExpression: (brightness: number, blink: boolean) => void;
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');

  const draw = (brightness: number, blink: boolean) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Deep charcoal/violet visor plate
    ctx.fillStyle = '#17171C';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 48);
    ctx.fill();

    // Subtle edge highlight
    ctx.strokeStyle = '#282538';
    ctx.lineWidth = 4;
    ctx.stroke();

    const w = canvas.width;
    const h = canvas.height;
    const eyeSpacing = 82;
    const eyeCenterY = h / 2 - 4;

    if (blink) {
      // Slit blink line
      ctx.strokeStyle = `rgba(130, 105, 245, ${0.9 * brightness})`;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w / 2 - eyeSpacing - 22, eyeCenterY);
      ctx.lineTo(w / 2 - eyeSpacing + 22, eyeCenterY);
      ctx.moveTo(w / 2 + eyeSpacing - 22, eyeCenterY);
      ctx.lineTo(w / 2 + eyeSpacing + 22, eyeCenterY);
      ctx.stroke();
    } else {
      // Expressive illuminated pill eyes with gentle soft glow
      ctx.shadowColor = `rgba(115, 87, 232, ${0.85 * brightness})`;
      ctx.shadowBlur = 18 * brightness;

      ctx.fillStyle = `rgba(125, 98, 248, ${Math.min(1, brightness)})`;

      // Left Eye
      ctx.beginPath();
      ctx.roundRect(w / 2 - eyeSpacing - 20, eyeCenterY - 32, 40, 64, 20);
      ctx.fill();

      // Right Eye
      ctx.beginPath();
      ctx.roundRect(w / 2 + eyeSpacing - 20, eyeCenterY - 32, 40, 64, 20);
      ctx.fill();

      // Sharp white specular highlights
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(w / 2 - eyeSpacing - 6, eyeCenterY - 14, 7.5, 0, Math.PI * 2);
      ctx.arc(w / 2 + eyeSpacing + 6, eyeCenterY - 14, 7.5, 0, Math.PI * 2);
      ctx.fill();

      // Tiny secondary bottom catch-light
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(w / 2 - eyeSpacing + 6, eyeCenterY + 14, 4, 0, Math.PI * 2);
      ctx.arc(w / 2 + eyeSpacing - 6, eyeCenterY + 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  draw(eyeBrightness, isBlinking);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return {
    texture,
    canvas,
    updateExpression: (brightness: number, blink: boolean) => {
      draw(brightness, blink);
      texture.needsUpdate = true;
    },
  };
}

/**
 * Creates the original Tathastu Connect 3D Assistant Robot.
 */
export function createRobotCharacter(): RobotCharacterInstance {
  const robotGroup = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // =========================================================================
  // MATERIALS (Warm Pearl Ceramic + Deep Visor + Accent Violet / Mint)
  // =========================================================================
  const pearlMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xfafafc,
    roughness: 0.18,
    metalness: 0.05,
    clearcoat: 0.35,
    clearcoatRoughness: 0.1,
  });
  disposables.push(pearlMaterial);

  const brandMaterial = new THREE.MeshStandardMaterial({
    color: 0x7357e8,
    roughness: 0.25,
    metalness: 0.1,
  });
  disposables.push(brandMaterial);

  const accentMintMaterial = new THREE.MeshStandardMaterial({
    color: 0x4fd1c5,
    roughness: 0.2,
    emissive: 0x319795,
    emissiveIntensity: 0.3,
  });
  disposables.push(accentMintMaterial);

  const darkJointMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    roughness: 0.4,
  });
  disposables.push(darkJointMaterial);

  // =========================================================================
  // 1. HEAD & VISOR
  // =========================================================================
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.52, 0);
  robotGroup.add(headGroup);

  // Rounded pearl skull shell
  const skullGeo = new THREE.SphereGeometry(0.48, 32, 28);
  skullGeo.scale(1.08, 0.95, 0.96);
  disposables.push(skullGeo);
  const skullMesh = new THREE.Mesh(skullGeo, pearlMaterial);
  headGroup.add(skullMesh);

  // Dark Face Visor Plate
  const visorData = createVisorTexture(1.0, false);
  disposables.push(visorData.texture);

  const visorGeo = new THREE.PlaneGeometry(0.68, 0.42);
  disposables.push(visorGeo);
  const visorMat = new THREE.MeshBasicMaterial({
    map: visorData.texture,
    transparent: true,
  });
  disposables.push(visorMat);
  const visorMesh = new THREE.Mesh(visorGeo, visorMat);
  visorMesh.position.set(0, 0.01, 0.45);
  headGroup.add(visorMesh);

  // Subtle protective glass visor rim
  const rimGeo = new THREE.RingGeometry(0.24, 0.27, 24);
  disposables.push(rimGeo);

  // Cute Rounded Ear Caps
  const earGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20);
  earGeo.rotateZ(Math.PI / 2);
  disposables.push(earGeo);

  const leftEar = new THREE.Mesh(earGeo, brandMaterial);
  leftEar.position.set(-0.52, 0.02, 0);
  headGroup.add(leftEar);

  const rightEar = new THREE.Mesh(earGeo, brandMaterial);
  rightEar.position.set(0.52, 0.02, 0);
  headGroup.add(rightEar);

  // Small Top Antenna & Glowing Beacon
  const antennaStemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12);
  disposables.push(antennaStemGeo);
  const antennaStem = new THREE.Mesh(antennaStemGeo, brandMaterial);
  antennaStem.position.set(0, 0.54, 0);
  headGroup.add(antennaStem);

  const antennaTipGeo = new THREE.SphereGeometry(0.055, 16, 16);
  disposables.push(antennaTipGeo);
  const antennaTip = new THREE.Mesh(antennaTipGeo, accentMintMaterial);
  antennaTip.position.set(0, 0.67, 0);
  headGroup.add(antennaTip);

  // =========================================================================
  // 2. TORSO & FLOATING BASE
  // =========================================================================
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0, 0);
  robotGroup.add(torsoGroup);

  // Compact rounded torso
  const torsoGeo = new THREE.SphereGeometry(0.36, 28, 24);
  torsoGeo.scale(0.92, 1.15, 0.88);
  disposables.push(torsoGeo);
  const torsoMesh = new THREE.Mesh(torsoGeo, pearlMaterial);
  torsoMesh.position.set(0, -0.05, 0);
  torsoGroup.add(torsoMesh);

  // Brand collar band
  const collarGeo = new THREE.TorusGeometry(0.25, 0.022, 12, 28);
  collarGeo.rotateX(Math.PI / 2);
  disposables.push(collarGeo);
  const collarMesh = new THREE.Mesh(collarGeo, brandMaterial);
  collarMesh.position.set(0, 0.22, 0);
  torsoGroup.add(collarMesh);

  // Floating lower pod ring (Subtle propulsion ring)
  const thrusterGeo = new THREE.TorusGeometry(0.22, 0.025, 12, 28);
  thrusterGeo.rotateX(Math.PI / 2);
  disposables.push(thrusterGeo);
  const thrusterMesh = new THREE.Mesh(thrusterGeo, accentMintMaterial);
  thrusterMesh.position.set(0, -0.42, 0);
  torsoGroup.add(thrusterMesh);

  const baseDomeGeo = new THREE.SphereGeometry(0.2, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  baseDomeGeo.rotateX(Math.PI);
  disposables.push(baseDomeGeo);
  const baseDome = new THREE.Mesh(baseDomeGeo, pearlMaterial);
  baseDome.position.set(0, -0.38, 0);
  torsoGroup.add(baseDome);

  // =========================================================================
  // 3. ARTICULATED ARMS (Right Arm Rigged for Waving!)
  // =========================================================================
  // Shared arm geometries
  const shoulderGeo = new THREE.SphereGeometry(0.08, 16, 16);
  const upperArmGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.24, 14);
  upperArmGeo.translate(0, -0.12, 0);
  const handGeo = new THREE.SphereGeometry(0.07, 16, 16);
  handGeo.scale(0.9, 1.2, 0.7);
  handGeo.translate(0, -0.26, 0);
  disposables.push(shoulderGeo, upperArmGeo, handGeo);

  // Left Arm (Rests naturally beside torso)
  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.38, 0.08, 0);
  torsoGroup.add(leftArmGroup);

  const leftShoulder = new THREE.Mesh(shoulderGeo, darkJointMaterial);
  leftArmGroup.add(leftShoulder);
  const leftUpper = new THREE.Mesh(upperArmGeo, pearlMaterial);
  leftArmGroup.add(leftUpper);
  const leftHand = new THREE.Mesh(handGeo, pearlMaterial);
  leftArmGroup.add(leftHand);

  leftArmGroup.rotation.z = 0.22;
  leftArmGroup.rotation.x = 0.12;

  // Right Arm (Rigged with Shoulder Pivot for the natural wave sequence)
  const rightArmGroup = new THREE.Group();
  rightArmGroup.position.set(0.38, 0.08, 0);
  torsoGroup.add(rightArmGroup);

  const rightShoulder = new THREE.Mesh(shoulderGeo, darkJointMaterial);
  rightArmGroup.add(rightShoulder);

  // Right Forearm / Hand Pivot (child of rightArmGroup for waving)
  const rightLimbGroup = new THREE.Group();
  rightArmGroup.add(rightLimbGroup);

  const rightUpper = new THREE.Mesh(upperArmGeo, pearlMaterial);
  rightLimbGroup.add(rightUpper);
  const rightHand = new THREE.Mesh(handGeo, pearlMaterial);
  rightLimbGroup.add(rightHand);

  // Natural resting position initially
  rightArmGroup.rotation.z = -0.22;
  rightArmGroup.rotation.x = 0.12;

  // =========================================================================
  // ANIMATION & STATE TRACKING
  // =========================================================================
  let lastBlinkTime = 0;
  let isCurrentlyBlinking = false;

  return {
    group: robotGroup,
    update: (time: number, isWaving: boolean, waveProgress: number, isIdle: boolean) => {
      // 1. Natural Eye Blinking Logic
      if (time - lastBlinkTime > 3.6) {
        isCurrentlyBlinking = true;
        lastBlinkTime = time;
      }
      if (isCurrentlyBlinking && time - lastBlinkTime > 0.16) {
        isCurrentlyBlinking = false;
      }

      // Eye brightness: increases slightly when waving
      const eyeBrightness = isWaving ? 1.35 : 1.0;
      visorData.updateExpression(eyeBrightness, isCurrentlyBlinking);

      // 2. Head Micro-motion (Subtle curious tilt)
      headGroup.rotation.y = Math.sin(time * 0.9) * 0.06;
      headGroup.rotation.z = Math.sin(time * 0.7) * 0.03;

      // 3. Torso Floating Hover
      torsoGroup.position.y = Math.sin(time * 1.4) * 0.035;

      // 4. Right Arm Kinematics (Wave vs Rest)
      if (isWaving) {
        // Raise arm up smoothly into wave position
        // waveProgress: 0.0 -> 1.0 during wave duration
        const raiseWeight = Math.min(1, Math.max(0, Math.sin(waveProgress * Math.PI)));

        // Arm raised high beside head
        rightArmGroup.rotation.z = -0.22 + raiseWeight * (-1.85); // raised upwards
        rightArmGroup.rotation.x = 0.12 - raiseWeight * 0.4;
        rightArmGroup.rotation.y = raiseWeight * 0.35;

        // 2–3 gentle hand waves back and forth
        const waveOscillation = Math.sin(waveProgress * Math.PI * 5.5);
        rightLimbGroup.rotation.z = raiseWeight * waveOscillation * 0.32;
      } else {
        // Calm resting idle arm
        rightArmGroup.rotation.z = -0.22 + Math.sin(time * 1.1) * 0.03;
        rightArmGroup.rotation.x = 0.12 + Math.cos(time * 0.9) * 0.02;
        rightLimbGroup.rotation.z = 0;
      }

      // Left Arm gentle breathing float
      leftArmGroup.rotation.z = 0.22 + Math.sin(time * 1.1) * 0.03;
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
    },
  };
}
