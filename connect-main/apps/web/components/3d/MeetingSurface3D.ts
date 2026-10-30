import * as THREE from 'three';

export interface MeetingSurface3DInstance {
  group: THREE.Group;
  updateReveal: (revealProgress: number) => void;
  updateIdle: (time: number) => void;
  dispose: () => void;
}

/**
 * Creates rounded rectangular extrusion geometry with smooth bevels.
 */
function createRoundedPanelGeometry(width: number, height: number, radius: number, depth: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.02,
    bevelThickness: 0.02,
  });
}

/**
 * Creates the high-DPI 3D VC Screen and the slide-out collaboration card.
 * Loads the real participant images onto the canvas texture.
 */
export function createMeetingSurface3D(): MeetingSurface3DInstance {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // Start initially scaled down to 0 until the robot's waving gesture triggers it
  group.scale.set(0.001, 0.001, 0.001);
  group.position.set(0, -0.3, 0);

  // =========================================================================
  // 1. DYNAMIC CANVAS TEXTURE FOR MAIN VC SCREEN (Real Portraits)
  // =========================================================================
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  const p1Img = new Image();
  p1Img.src = '/demo/participant-01.webp';
  const p2Img = new Image();
  p2Img.src = '/demo/participant-02.webp';

  const drawScreen = () => {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    // Window Chassis Surface (Warm White Ceramic)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Top Header Bar
    ctx.fillStyle = '#F8F8F5';
    ctx.fillRect(0, 0, w, 56);
    ctx.fillStyle = '#EEEEEE';
    ctx.fillRect(0, 55, w, 1);

    // macOS Window dots
    ctx.fillStyle = '#E56F63';
    ctx.beginPath();
    ctx.arc(36, 28, 6.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#E3B936';
    ctx.beginPath();
    ctx.arc(56, 28, 6.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#52B879';
    ctx.beginPath();
    ctx.arc(76, 28, 6.5, 0, Math.PI * 2);
    ctx.fill();

    // Clean top center room pill
    ctx.fillStyle = '#ECECE8';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 50, 18, 100, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#52B879';
    ctx.beginPath();
    ctx.arc(w / 2 - 32, 28, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#171717';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Live Room', w / 2 - 20, 32);

    // Video Tiles Layout (Two Tiles side by side)
    const tilePadding = 24;
    const tileGap = 20;
    const tileW = (w - tilePadding * 2 - tileGap) / 2;
    const tileH = h - 175;
    const tileY = 72;
    const tileRadius = 20;

    // --- Tile 1: Left Participant (p1) ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tilePadding, tileY, tileW, tileH, tileRadius);
    ctx.clip();

    if (p1Img.complete && p1Img.naturalWidth > 0) {
      ctx.drawImage(p1Img, tilePadding, tileY, tileW, tileH);
    } else {
      ctx.fillStyle = '#F6F4FE';
      ctx.fillRect(tilePadding, tileY, tileW, tileH);
      ctx.fillStyle = '#7357E8';
      ctx.beginPath();
      ctx.arc(tilePadding + tileW / 2, tileY + tileH / 2, 48, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Active Speaker Mint Border on Tile 1
    ctx.strokeStyle = '#52B879';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(tilePadding, tileY, tileW, tileH, tileRadius);
    ctx.stroke();

    // Tile 1 Mic Pill
    ctx.fillStyle = 'rgba(23, 23, 23, 0.65)';
    ctx.beginPath();
    ctx.roundRect(tilePadding + 14, tileY + tileH - 36, 52, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#52B879';
    ctx.beginPath();
    ctx.arc(tilePadding + 28, tileY + tileH - 25, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.fillText('MIC', tilePadding + 38, tileY + tileH - 21);

    // --- Tile 2: Right Participant (p2) ---
    const rightX = tilePadding + tileW + tileGap;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rightX, tileY, tileW, tileH, tileRadius);
    ctx.clip();

    if (p2Img.complete && p2Img.naturalWidth > 0) {
      ctx.drawImage(p2Img, rightX, tileY, tileW, tileH);
    } else {
      ctx.fillStyle = '#F0F7FF';
      ctx.fillRect(rightX, tileY, tileW, tileH);
      ctx.fillStyle = '#65A8E8';
      ctx.beginPath();
      ctx.arc(rightX + tileW / 2, tileY + tileH / 2, 48, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Clean neutral border on Tile 2
    ctx.strokeStyle = '#E5E5DF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rightX, tileY, tileW, tileH, tileRadius);
    ctx.stroke();

    // Tile 2 Mic Pill
    ctx.fillStyle = 'rgba(23, 23, 23, 0.65)';
    ctx.beginPath();
    ctx.roundRect(rightX + 14, tileY + tileH - 36, 52, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(rightX + 28, tileY + tileH - 25, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.fillText('MIC', rightX + 38, tileY + tileH - 21);

    // --- Bottom Meeting Controls Pill Bar (🎙 🎥 🖥 ••• Leave) ---
    const barW = 420;
    const barH = 68;
    const barX = (w - barW) / 2;
    const barY = h - 86;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 34);
    ctx.fill();
    ctx.strokeStyle = '#E2E2DC';
    ctx.lineWidth = 2;
    ctx.stroke();

    const btnRadius = 24;
    const btnY = barY + barH / 2;

    // Mic (Mint)
    const b1 = barX + 56;
    ctx.fillStyle = '#F4FAF6';
    ctx.beginPath();
    ctx.arc(b1, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D5EDE0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#52B879';
    ctx.beginPath();
    ctx.roundRect(b1 - 5, btnY - 11, 10, 15, 5);
    ctx.fill();
    ctx.strokeStyle = '#52B879';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(b1, btnY - 2, 9, 0, Math.PI);
    ctx.moveTo(b1, btnY + 7);
    ctx.lineTo(b1, btnY + 12);
    ctx.stroke();

    // Camera (Dark)
    const b2 = barX + 136;
    ctx.fillStyle = '#F7F7F5';
    ctx.beginPath();
    ctx.arc(b2, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E6E6E1';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#171717';
    ctx.beginPath();
    ctx.roundRect(b2 - 12, btnY - 8, 14, 16, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(b2 + 3, btnY - 5);
    ctx.lineTo(b2 + 11, btnY - 9);
    ctx.lineTo(b2 + 11, btnY + 9);
    ctx.lineTo(b2 + 3, btnY + 5);
    ctx.closePath();
    ctx.fill();

    // Screen Share (Brand Purple)
    const b3 = barX + 216;
    ctx.fillStyle = '#F6F4FE';
    ctx.beginPath();
    ctx.arc(b3, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E2DCF8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#7357E8';
    ctx.beginPath();
    ctx.roundRect(b3 - 12, btnY - 10, 24, 15, 3);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(b3 - 9, btnY - 7, 18, 9);
    ctx.fillStyle = '#7357E8';
    ctx.fillRect(b3 - 4, btnY + 5, 8, 3.5);

    // More Options (•••)
    const b4 = barX + 296;
    ctx.fillStyle = '#F7F7F5';
    ctx.beginPath();
    ctx.arc(b4, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E6E6E1';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#666666';
    for (let offset = -7; offset <= 7; offset += 7) {
      ctx.beginPath();
      ctx.arc(b4 + offset, btnY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Leave Call (Soft Coral)
    const b5 = barX + 372;
    ctx.fillStyle = '#FFE7E2';
    ctx.beginPath();
    ctx.arc(b5, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFD2CA';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#E56F63';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b5 - 6, btnY - 6);
    ctx.lineTo(b5 + 6, btnY + 6);
    ctx.moveTo(b5 + 6, btnY - 6);
    ctx.lineTo(b5 - 6, btnY + 6);
    ctx.stroke();
  };

  drawScreen();

  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.minFilter = THREE.LinearFilter;
  screenTex.magFilter = THREE.LinearFilter;
  disposables.push(screenTex);

  const onImageLoad = () => {
    drawScreen();
    screenTex.needsUpdate = true;
  };
  p1Img.onload = onImageLoad;
  p2Img.onload = onImageLoad;

  // VC Screen Chassis (Rounded Porcelain Frame)
  const screenGeo = createRoundedPanelGeometry(3.6, 2.52, 0.22, 0.08);
  const screenMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.02,
    clearcoat: 0.25,
  });
  disposables.push(screenGeo, screenMat);
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  group.add(screenMesh);

  // Screen Front Canvas Surface
  const screenFrontGeo = new THREE.PlaneGeometry(3.54, 2.46);
  const screenFrontMat = new THREE.MeshBasicMaterial({
    map: screenTex,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  disposables.push(screenFrontGeo, screenFrontMat);
  const screenFrontMesh = new THREE.Mesh(screenFrontGeo, screenFrontMat);
  screenFrontMesh.position.set(0, 0, 0.105);
  screenMesh.add(screenFrontMesh);

  // Soft Radial Drop Shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 512;
  shadowCanvas.height = 384;
  const sCtx = shadowCanvas.getContext('2d');
  if (sCtx) {
    const grad = sCtx.createRadialGradient(256, 192, 40, 256, 192, 256);
    grad.addColorStop(0, 'rgba(23, 23, 23, 0.09)');
    grad.addColorStop(0.7, 'rgba(23, 23, 23, 0.02)');
    grad.addColorStop(1, 'rgba(23, 23, 23, 0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 512, 384);
  }
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  disposables.push(shadowTex);

  const shadowGeo = new THREE.PlaneGeometry(4.4, 3.2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
  });
  disposables.push(shadowGeo, shadowMat);
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.set(0.04, -0.06, -0.12);
  group.add(shadowMesh);

  // =========================================================================
  // 2. SIDE COLLABORATION ELEMENT (Small Shared Presentation / Doc Thumbnail)
  // =========================================================================
  // Section 14: "After VC window appears: a small card can slide out beside it.
  // Replace sticky note with meaningful shared document preview ('We can do more than just video')."
  const sideCardGroup = new THREE.Group();
  sideCardGroup.position.set(1.4, -0.7, 0.15); // Starts tucked near/behind
  sideCardGroup.scale.set(0.001, 0.001, 0.001);
  group.add(sideCardGroup);

  const sideCardCanvas = document.createElement('canvas');
  sideCardCanvas.width = 400;
  sideCardCanvas.height = 320;
  const scCtx = sideCardCanvas.getContext('2d');
  if (scCtx) {
    // Pure White Card
    scCtx.fillStyle = '#FFFFFF';
    scCtx.beginPath();
    scCtx.roundRect(0, 0, 400, 320, 24);
    scCtx.fill();
    scCtx.strokeStyle = '#E9E9E5';
    scCtx.lineWidth = 3;
    scCtx.stroke();

    // Top Header with mini document icon & label
    scCtx.fillStyle = '#FAF9FD';
    scCtx.beginPath();
    scCtx.roundRect(16, 16, 368, 52, 14);
    scCtx.fill();
    scCtx.fillStyle = '#7357E8';
    scCtx.beginPath();
    scCtx.arc(42, 42, 10, 0, Math.PI * 2);
    scCtx.fill();
    scCtx.fillStyle = '#171717';
    scCtx.font = 'bold 16px system-ui, sans-serif';
    scCtx.fillText('Shared Presentation', 64, 48);

    // Mini Slide Preview Box
    scCtx.fillStyle = '#F8F8F5';
    scCtx.beginPath();
    scCtx.roundRect(16, 84, 368, 180, 16);
    scCtx.fill();

    // Diagram bars & badges inside mini preview
    scCtx.fillStyle = '#7357E8';
    scCtx.beginPath();
    scCtx.roundRect(36, 110, 120, 18, 9);
    scCtx.fill();

    scCtx.fillStyle = '#E2DCF8';
    scCtx.beginPath();
    scCtx.roundRect(36, 142, 220, 12, 6);
    scCtx.roundRect(36, 164, 180, 12, 6);
    scCtx.roundRect(36, 186, 260, 12, 6);
    scCtx.fill();

    // Mini chart / graph preview
    scCtx.fillStyle = '#52B879';
    scCtx.beginPath();
    scCtx.roundRect(280, 130, 80, 68, 10);
    scCtx.fill();
    scCtx.fillStyle = '#FFFFFF';
    scCtx.font = 'bold 14px system-ui, sans-serif';
    scCtx.textAlign = 'center';
    scCtx.fillText('LIVE', 320, 170);

    // Bottom tiny status
    scCtx.fillStyle = '#666666';
    scCtx.font = '500 13px system-ui, sans-serif';
    scCtx.textAlign = 'left';
    scCtx.fillText('Realtime Shared Canvas', 24, 294);
  }

  const sideCardTex = new THREE.CanvasTexture(sideCardCanvas);
  disposables.push(sideCardTex);

  const sideCardGeo = createRoundedPanelGeometry(1.22, 0.98, 0.1, 0.04);
  const sideCardMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.02,
    clearcoat: 0.2,
  });
  disposables.push(sideCardGeo, sideCardMat);
  const sideCardMesh = new THREE.Mesh(sideCardGeo, sideCardMat);
  sideCardGroup.add(sideCardMesh);

  const sideFrontGeo = new THREE.PlaneGeometry(1.2, 0.96);
  const sideFrontMat = new THREE.MeshBasicMaterial({
    map: sideCardTex,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  disposables.push(sideFrontGeo, sideFrontMat);
  const sideFrontMesh = new THREE.Mesh(sideFrontGeo, sideFrontMat);
  sideFrontMesh.position.set(0, 0, 0.065);
  sideCardMesh.add(sideFrontMesh);

  return {
    group,
    updateReveal: (revealProgress: number) => {
      // revealProgress: 0.0 (hidden) -> 1.0 (fully unfolded)
      const p = Math.min(1, Math.max(0, revealProgress));

      if (p <= 0.01) {
        group.scale.set(0.001, 0.001, 0.001);
        sideCardGroup.scale.set(0.001, 0.001, 0.001);
        return;
      }

      // Smooth elastic / cubic-out expansion
      // Starts as a thin sliver (scaleX: 0.2, scaleY: 0.05) and unfolds into full screen
      const scaleEase = 1 - Math.pow(1 - p, 3);
      const scaleX = THREE.MathUtils.lerp(0.15, 1.0, scaleEase);
      const scaleY = THREE.MathUtils.lerp(0.08, 1.0, scaleEase);
      const scaleZ = THREE.MathUtils.lerp(0.1, 1.0, scaleEase);

      group.scale.set(scaleX, scaleY, scaleZ);

      // Slight rotation correction during unfold: from -0.15 rad tilt to 0.0
      group.rotation.y = THREE.MathUtils.lerp(-0.18, 0.0, scaleEase);
      group.rotation.x = THREE.MathUtils.lerp(0.12, 0.0, scaleEase);

      // Section 14: Side collaboration card slides out once main VC window is ~60% unfolded
      if (p > 0.55) {
        const sideP = (p - 0.55) / 0.45;
        const sideEase = 1 - Math.pow(1 - sideP, 3);

        const targetX = 2.15;
        const targetY = -0.75;
        const currentX = THREE.MathUtils.lerp(1.3, targetX, sideEase);
        const currentY = THREE.MathUtils.lerp(-0.5, targetY, sideEase);

        sideCardGroup.position.set(currentX, currentY, 0.25);
        sideCardGroup.rotation.set(-0.04, -0.12, 0.08);
        sideCardGroup.scale.set(sideEase, sideEase, sideEase);
      } else {
        sideCardGroup.scale.set(0.001, 0.001, 0.001);
      }
    },
    updateIdle: (time: number) => {
      // Gentle calm breathing motion during idle state
      screenMesh.position.y = Math.sin(time * 0.6) * 0.025;
      sideCardGroup.position.y = -0.75 + Math.cos(time * 0.8) * 0.025;
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
    },
  };
}
