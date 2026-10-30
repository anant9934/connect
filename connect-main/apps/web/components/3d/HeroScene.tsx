'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface HeroSceneProps {
  tier?: 'high' | 'medium';
}

/**
 * Creates a rounded rectangular extrusion geometry.
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
 * Creates high-DPI canvas textures for crisp 3D screen UI and robot face
 */
function createTexture(
  drawFn: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  width = 512,
  height = 360
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawFn(ctx, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export const HeroScene: React.FC<HeroSceneProps> = ({ tier = 'high' }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 520;

    // 1. Scene & Camera Setup (Calm, studio depth)
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0, 8.4);

    // 2. High-performance WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'high' ? 2 : 1.25));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    // 3. Daylight Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaee, 1.25);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xedf2ff, 0.65);
    fillLight.position.set(-5, -3, 4);
    scene.add(fillLight);

    // Master composition group
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // =========================================================================
    // 1. THE VC SCREEN (Central Video Call Window)
    // =========================================================================
    // 1. THE VC SCREEN (Central Video Call Window)
    // =========================================================================
    const screenTexture = createTexture((ctx, w, h) => {
      // Background Window Frame
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);

      // Top Window Header Bar
      ctx.fillStyle = '#F8F8F5';
      ctx.fillRect(0, 0, w, 56);

      // Window dots
      ctx.fillStyle = '#E56F63';
      ctx.beginPath();
      ctx.arc(36, 28, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#E3B936';
      ctx.beginPath();
      ctx.arc(58, 28, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#52B879';
      ctx.beginPath();
      ctx.arc(80, 28, 7, 0, Math.PI * 2);
      ctx.fill();

      // Top center pill (room indicator)
      ctx.fillStyle = '#ECECE8';
      ctx.beginPath();
      ctx.roundRect(w / 2 - 60, 18, 120, 20, 10);
      ctx.fill();

      // Video Tiles Area (Two Tiles: Left ○, Right ○)
      const tilePadding = 24;
      const tileGap = 20;
      const tileW = (w - tilePadding * 2 - tileGap) / 2;
      const tileH = h - 170;
      const tileY = 72;

      // Participant Tile 1 (Left: Soft Lavender background with avatar circle ○)
      ctx.fillStyle = '#F6F4FE';
      ctx.beginPath();
      ctx.roundRect(tilePadding, tileY, tileW, tileH, 22);
      ctx.fill();
      ctx.strokeStyle = '#E2DCF8';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Avatar Circle Left ○
      const leftCenterX = tilePadding + tileW / 2;
      const leftCenterY = tileY + tileH / 2 - 12;
      ctx.fillStyle = '#7357E8';
      ctx.beginPath();
      ctx.arc(leftCenterX, leftCenterY, 56, 0, Math.PI * 2);
      ctx.fill();

      // Active speaker mint halo
      ctx.strokeStyle = '#52B879';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(leftCenterX, leftCenterY, 66, 0, Math.PI * 2);
      ctx.stroke();

      // Participant Tile 2 (Right: Soft Sky background with avatar circle ○)
      const rightX = tilePadding + tileW + tileGap;
      ctx.fillStyle = '#F0F7FF';
      ctx.beginPath();
      ctx.roundRect(rightX, tileY, tileW, tileH, 22);
      ctx.fill();
      ctx.strokeStyle = '#DCEAFC';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Avatar Circle Right ○
      const rightCenterX = rightX + tileW / 2;
      const rightCenterY = tileY + tileH / 2 - 12;
      ctx.fillStyle = '#65A8E8';
      ctx.beginPath();
      ctx.arc(rightCenterX, rightCenterY, 56, 0, Math.PI * 2);
      ctx.fill();

      // Bottom Control Bar Pill (🎙 🎥 share End)
      const barW = 380;
      const barH = 76;
      const barX = (w - barW) / 2;
      const barY = h - 96;

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 38);
      ctx.fill();
      ctx.strokeStyle = '#E2E2DC';
      ctx.lineWidth = 2;
      ctx.stroke();

      const btnRadius = 26;
      const btnY = barY + barH / 2;

      // Button 1: Mic 🎙 (Mint Active)
      const btn1X = barX + 54;
      ctx.fillStyle = '#F4FAF6';
      ctx.beginPath();
      ctx.arc(btn1X, btnY, btnRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#D5EDE0';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#52B879';
      ctx.beginPath();
      ctx.roundRect(btn1X - 6, btnY - 14, 12, 18, 6);
      ctx.fill();
      ctx.strokeStyle = '#52B879';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(btn1X, btnY - 3, 11, 0, Math.PI);
      ctx.moveTo(btn1X, btnY + 8);
      ctx.lineTo(btn1X, btnY + 14);
      ctx.moveTo(btn1X - 7, btnY + 14);
      ctx.lineTo(btn1X + 7, btnY + 14);
      ctx.stroke();

      // Button 2: Camera 🎥
      const btn2X = barX + 144;
      ctx.fillStyle = '#F7F7F5';
      ctx.beginPath();
      ctx.arc(btn2X, btnY, btnRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#E6E6E1';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#171717';
      ctx.beginPath();
      ctx.roundRect(btn2X - 14, btnY - 9, 16, 18, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(btn2X + 3, btnY - 5);
      ctx.lineTo(btn2X + 13, btnY - 10);
      ctx.lineTo(btn2X + 13, btnY + 10);
      ctx.lineTo(btn2X + 3, btnY + 5);
      ctx.closePath();
      ctx.fill();

      // Button 3: Share Screen 🖥
      const btn3X = barX + 234;
      ctx.fillStyle = '#F6F4FE';
      ctx.beginPath();
      ctx.arc(btn3X, btnY, btnRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#E2DCF8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#7357E8';
      ctx.beginPath();
      ctx.roundRect(btn3X - 13, btnY - 11, 26, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(btn3X - 9, btnY - 7, 18, 10);
      ctx.fillStyle = '#7357E8';
      ctx.fillRect(btn3X - 4, btnY + 5, 8, 4);
      ctx.fillRect(btn3X - 8, btnY + 9, 16, 2.5);

      // Button 4: End Call ✕ (Soft Coral)
      const btn4X = barX + 324;
      ctx.fillStyle = '#FFE7E2';
      ctx.beginPath();
      ctx.arc(btn4X, btnY, btnRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFD2CA';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = '#E56F63';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(btn4X - 8, btnY - 8);
      ctx.lineTo(btn4X + 8, btnY + 8);
      ctx.moveTo(btn4X + 8, btnY - 8);
      ctx.lineTo(btn4X - 8, btnY + 8);
      ctx.stroke();
    }, 1024, 720);
    disposables.push(screenTexture);

    // VC Screen Chassis (Rounded Porcelain Frame)
    const screenGeo = createRoundedPanelGeometry(3.6, 2.52, 0.22, 0.08);
    const screenMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.02,
      clearcoat: 0.2,
    });
    disposables.push(screenGeo, screenMat);
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, -0.3, 0);
    masterGroup.add(screenMesh);

    const screenFrontGeo = new THREE.PlaneGeometry(3.54, 2.46);
    const screenFrontMat = new THREE.MeshBasicMaterial({
      map: screenTexture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposables.push(screenFrontGeo, screenFrontMat);
    const screenFrontMesh = new THREE.Mesh(screenFrontGeo, screenFrontMat);
    screenFrontMesh.position.set(0, 0, 0.105);
    screenMesh.add(screenFrontMesh);

    // Screen Soft Contact Shadow (Smooth Radial)
    const shadowTex = createTexture((ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(23, 23, 23, 0.08)');
      grad.addColorStop(0.7, 'rgba(23, 23, 23, 0.02)');
      grad.addColorStop(1, 'rgba(23, 23, 23, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }, 512, 384);
    disposables.push(shadowTex);

    const shadowGeo = new THREE.PlaneGeometry(4.2, 3.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    disposables.push(shadowGeo, shadowMat);
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(0.04, -0.36, -0.12);
    masterGroup.add(shadowMesh);

    // =========================================================================
    // 2. THE LITTLE ROBOT 🤖 (Cute AI Companion Hovering Above VC Screen)
    // =========================================================================
    const robotGroup = new THREE.Group();
    robotGroup.position.set(0, 1.7, 0.3);
    masterGroup.add(robotGroup);

    // Robot Head (Soft matte rounded white porcelain head)
    const headGeo = createRoundedPanelGeometry(0.9, 0.65, 0.16, 0.35);
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.05,
      clearcoat: 0.2,
    });
    disposables.push(headGeo, headMat);
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.set(0, 0, 0);
    robotGroup.add(headMesh);

    // Robot Face Visor Texture (Dark glossy screen with friendly glowing eyes ^ ^)
    const visorTex = createTexture((ctx, w, h) => {
      ctx.fillStyle = '#1E1B2E';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 32);
      ctx.fill();

      // Glowing friendly eyes
      ctx.fillStyle = '#7357E8';
      ctx.shadowColor = '#9E8BF8';
      ctx.shadowBlur = 14;

      // Left Eye
      ctx.beginPath();
      ctx.roundRect(w / 2 - 76, h / 2 - 24, 38, 48, 19);
      ctx.fill();

      // Right Eye
      ctx.beginPath();
      ctx.roundRect(w / 2 + 38, h / 2 - 24, 38, 48, 19);
      ctx.fill();

      // Eye reflections
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(w / 2 - 62, h / 2 - 10, 8, 0, Math.PI * 2);
      ctx.arc(w / 2 + 52, h / 2 - 10, 8, 0, Math.PI * 2);
      ctx.fill();
    }, 400, 240);
    disposables.push(visorTex);

    const visorGeo = new THREE.PlaneGeometry(0.72, 0.44);
    const visorMat = new THREE.MeshBasicMaterial({
      map: visorTex,
      transparent: true,
    });
    disposables.push(visorGeo, visorMat);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.02, 0.38);
    robotGroup.add(visorMesh);

    // Robot Ears (Cute pastel purple headphone cylinders)
    const earGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16);
    const earMat = new THREE.MeshStandardMaterial({
      color: 0x7357E8,
      roughness: 0.3,
    });
    disposables.push(earGeo, earMat);

    const earLeft = new THREE.Mesh(earGeo, earMat);
    earLeft.rotation.z = Math.PI / 2;
    earLeft.position.set(-0.48, 0, 0.18);
    robotGroup.add(earLeft);

    const earRight = new THREE.Mesh(earGeo, earMat);
    earRight.rotation.z = Math.PI / 2;
    earRight.position.set(0.48, 0, 0.18);
    robotGroup.add(earRight);

    // Robot Antenna (Rod + Glowing Sphere Tip)
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.24, 8);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x7357E8 });
    disposables.push(stemGeo, stemMat);
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    stemMesh.position.set(0, 0.44, 0.18);
    robotGroup.add(stemMesh);

    const tipGeo = new THREE.SphereGeometry(0.07, 16, 16);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0x52B879,
      emissive: 0x52B879,
      emissiveIntensity: 0.5,
    });
    disposables.push(tipGeo, tipMat);
    const tipMesh = new THREE.Mesh(tipGeo, tipMat);
    tipMesh.position.set(0, 0.58, 0.18);
    robotGroup.add(tipMesh);

    // Robot Floating Body Torso (Small rounded egg base)
    const bodyGeo = new THREE.SphereGeometry(0.24, 24, 24);
    bodyGeo.scale(1, 0.8, 0.9);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.25,
    });
    disposables.push(bodyGeo, bodyMat);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.set(0, -0.42, 0.18);
    robotGroup.add(bodyMesh);

    // Subtle Connecting Beam / Filament (Robot │ VC Screen)
    const beamCurve = new THREE.LineCurve3(
      new THREE.Vector3(0, 1.25, 0.18),
      new THREE.Vector3(0, 0.98, 0.06)
    );
    const beamGeo = new THREE.BufferGeometry().setFromPoints(beamCurve.getPoints(12));
    const beamMat = new THREE.LineDashedMaterial({
      color: 0x7357E8,
      dashSize: 0.05,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.6,
    });
    disposables.push(beamGeo, beamMat);
    const beamLine = new THREE.Line(beamGeo, beamMat);
    beamLine.computeLineDistances();
    masterGroup.add(beamLine);

    // =========================================================================
    // 3. THE SMALL NOTE ╲ (Angled Floating Pastel Sticky Note)
    // =========================================================================
    const noteGeo = createRoundedPanelGeometry(1.0, 0.9, 0.08, 0.03);
    const noteMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff4bf,
      roughness: 0.35,
      metalness: 0.02,
      clearcoat: 0.1,
    });
    disposables.push(noteGeo, noteMat);
    const noteMesh = new THREE.Mesh(noteGeo, noteMat);
    noteMesh.position.set(1.9, -1.2, 0.35);
    noteMesh.rotation.set(-0.06, -0.15, 0.12);
    masterGroup.add(noteMesh);

    // Front sticky note texture
    const noteFrontTex = createTexture((ctx, w, h) => {
      ctx.fillStyle = '#FFF6C7';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#E3B936';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.roundRect(24, 30, 140, 9, 4.5);
      ctx.roundRect(24, 52, 180, 9, 4.5);
      ctx.roundRect(24, 74, 110, 9, 4.5);
      ctx.fill();
    }, 240, 200);
    disposables.push(noteFrontTex);

    const noteFrontGeo = new THREE.PlaneGeometry(0.96, 0.86);
    const noteFrontMat = new THREE.MeshBasicMaterial({
      map: noteFrontTex,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposables.push(noteFrontGeo, noteFrontMat);
    const noteFrontMesh = new THREE.Mesh(noteFrontGeo, noteFrontMat);
    noteFrontMesh.position.set(0, 0, 0.055);
    noteMesh.add(noteFrontMesh);

    // Connecting filament curve from screen to small note (╲ in user drawing)
    const noteCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(1.4, -0.9, 0.1),
      new THREE.Vector3(1.6, -1.05, 0.22),
      new THREE.Vector3(1.8, -1.15, 0.32)
    );
    const noteCurveGeo = new THREE.BufferGeometry().setFromPoints(noteCurve.getPoints(24));
    const noteCurveMat = new THREE.LineBasicMaterial({
      color: 0xe3b936,
      transparent: true,
      opacity: 0.5,
    });
    disposables.push(noteCurveGeo, noteCurveMat);
    const noteLine = new THREE.Line(noteCurveGeo, noteCurveMat);
    masterGroup.add(noteLine);

    // -------------------------------------------------------------
    // 4. Subtle Pointer-Follow Parallax (Desktop)
    // -------------------------------------------------------------
    let targetRotX = 0;
    let targetRotY = 0;

    const handlePointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.07;
      targetRotX = -y * 0.05;
    };

    if (tier === 'high') {
      window.addEventListener('mousemove', handlePointerMove, { passive: true });
    }

    // -------------------------------------------------------------
    // 5. Calm, Delightful Motion Loop
    // -------------------------------------------------------------
    let animationFrameId: number;
    let isRunning = true;
    let startTime = performance.now();

    const animate = (currentTime: number) => {
      if (!isRunning) return;

      const elapsed = (currentTime - startTime) * 0.001;

      // Smooth parallax damping
      masterGroup.rotation.y += (targetRotY - masterGroup.rotation.y) * 0.05;
      masterGroup.rotation.x += (targetRotX - masterGroup.rotation.x) * 0.05;

      // Master calm breathing
      screenMesh.position.y = -0.3 + Math.sin(elapsed * 0.6) * 0.035;

      if (tier === 'high') {
        // Robot charming hovering & slight tilt
        robotGroup.position.y = 1.7 + Math.sin(elapsed * 1.1) * 0.05;
        robotGroup.rotation.z = Math.sin(elapsed * 0.8) * 0.04;
        robotGroup.rotation.y = Math.sin(elapsed * 0.5) * 0.06;

        // Small note gentle float
        noteMesh.position.y = -1.2 + Math.cos(elapsed * 0.9) * 0.04;
        noteMesh.rotation.z = 0.12 + Math.sin(elapsed * 0.7) * 0.02;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    // 6. Responsive Resize Handling
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = entry.contentRect.width;
        const newH = entry.contentRect.height;
        if (newW > 0 && newH > 0) {
          camera.aspect = newW / newH;
          camera.updateProjectionMatrix();
          renderer.setSize(newW, newH);
        }
      }
    });
    resizeObserver.observe(container);

    // 7. Auto-Pause render loop when tab hidden
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isRunning = false;
        cancelAnimationFrame(animationFrameId);
      } else {
        if (!isRunning) {
          isRunning = true;
          startTime = performance.now();
          animationFrameId = requestAnimationFrame(animate);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Cleanup resources
    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (tier === 'high') {
        window.removeEventListener('mousemove', handlePointerMove);
      }
      resizeObserver.disconnect();

      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [tier]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-[400px] sm:h-[480px] lg:h-[520px] flex items-center justify-center select-none pointer-events-none"
      aria-hidden="true"
    />
  );
};

export default HeroScene;
