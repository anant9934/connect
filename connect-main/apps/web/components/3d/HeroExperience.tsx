'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createRobotCharacter } from './RobotCharacter';
import { createOrbitPath } from './OrbitPath';
import { createMeetingSurface3D } from './MeetingSurface3D';

export interface HeroExperienceProps {
  tier?: 'high' | 'medium';
}

export const HeroExperience: React.FC<HeroExperienceProps> = ({ tier = 'high' }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Check user preferences & session state or URL preview override
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const previewParam = urlParams?.get('preview');

    const prefersReducedMotion =
      previewParam === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasSeenIntro = sessionStorage.getItem('tathastu_hero_intro_seen') === 'true';
    const skipIntro = previewParam === 'settled' || prefersReducedMotion || hasSeenIntro;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 520;

    // 1. Scene & Perspective Camera Setup
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

    // 3. Studio Daylight Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaee, 1.3);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xedf2ff, 0.7);
    fillLight.position.set(-5, -3, 4);
    scene.add(fillLight);

    // Master Group for pointer parallax
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // =========================================================================
    // 4. SCENE SUB-MODULES (Orbit, Robot Character, VC Meeting Surface)
    // =========================================================================
    const orbit = createOrbitPath();
    masterGroup.add(orbit.group);

    const robot = createRobotCharacter();
    masterGroup.add(robot.group);

    const meetingSurface = createMeetingSurface3D();
    masterGroup.add(meetingSurface.group);

    // Scale robot to friendly proportional size relative to meeting screen
    robot.group.scale.set(0.85, 0.85, 0.85);

    // If skipping intro, immediately position in settled idle state
    if (skipIntro) {
      orbit.setOpacity(0);
      robot.group.position.copy(orbit.settledPosition);
      robot.group.rotation.y = orbit.settledRotationY;
      meetingSurface.updateReveal(1.0);
    } else {
      // Start at initial orbit coordinate
      const initial = orbit.getPositionAt(0);
      robot.group.position.copy(initial.position);
      robot.group.rotation.y = initial.rotationY;
      meetingSurface.updateReveal(0);
    }

    // =========================================================================
    // 5. TIMELINE TIMINGS (Exact 5–8 second Directed Narrative)
    // =========================================================================
    // 0.0s – 0.8s: Page opens, robot enters scene
    // 0.8s – 3.8s: Cinematic elliptical orbit around subtle central halo (3.0s)
    // 3.8s – 4.5s: Robot eases and settles beside hero (0.7s)
    // 4.5s – 5.5s: Robot waves right arm (2–3 natural gentle motions) (1.0s)
    // 5.5s – 6.8s: Meeting window unfolds causally; side document slides out (1.3s)
    // 6.8s onward: Calm idle state
    const T_ORBIT_START = 0.8;
    const T_ORBIT_END = 3.8;
    const T_SETTLE_END = 4.5;
    const T_WAVE_START = 4.5;
    const T_WAVE_END = 5.5;
    const T_REVEAL_START = 5.5;
    const T_REVEAL_END = 6.8;

    // =========================================================================
    // 6. POINTER PARALLAX INTERACTION (Desktop)
    // =========================================================================
    let targetRotX = 0;
    let targetRotY = 0;

    const handlePointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.06;
      targetRotX = -y * 0.04;
    };

    if (tier === 'high') {
      window.addEventListener('mousemove', handlePointerMove, { passive: true });
    }

    // =========================================================================
    // 7. ANIMATION LOOP
    // =========================================================================
    let animationFrameId: number;
    let isRunning = true;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      if (!isRunning) return;

      const elapsed = (currentTime - startTime) * 0.001;
      const forcedTime = previewParam === 'wave' ? 5.0 : previewParam === 'reveal' ? 6.2 : null;
      const animTime = forcedTime !== null ? forcedTime : elapsed;

      // Parallax damping
      masterGroup.rotation.y += (targetRotY - masterGroup.rotation.y) * 0.05;
      masterGroup.rotation.x += (targetRotX - masterGroup.rotation.x) * 0.05;

      if (skipIntro) {
        // Direct calm idle state
        robot.group.position.y = orbit.settledPosition.y + Math.sin(elapsed * 1.2) * 0.04;
        robot.group.position.x = orbit.settledPosition.x;
        robot.group.position.z = orbit.settledPosition.z;
        robot.group.rotation.y = orbit.settledRotationY + Math.sin(elapsed * 0.7) * 0.03;

        robot.update(elapsed, false, 0, true);
        meetingSurface.updateIdle(elapsed);
      } else {
        // Directed Narrative Intro Sequence
        if (animTime < T_ORBIT_START) {
          // State 1: Entry fade-in / glide
          const entryP = animTime / T_ORBIT_START;
          const posData = orbit.getPositionAt(0);
          robot.group.position.copy(posData.position);
          robot.group.position.y += Math.sin(animTime * 2) * 0.02;
          robot.group.rotation.y = posData.rotationY;
          robot.update(animTime, false, 0, false);
          orbit.setOpacity(entryP);
        } else if (animTime < T_ORBIT_END) {
          // State 2: Orbit travel around subtle halo (360° elliptical curve)
          const orbitProgress = (animTime - T_ORBIT_START) / (T_ORBIT_END - T_ORBIT_START);
          const posData = orbit.getPositionAt(orbitProgress);
          robot.group.position.copy(posData.position);
          robot.group.rotation.y = posData.rotationY;
          robot.update(animTime, false, 0, false);
        } else if (animTime < T_SETTLE_END) {
          // State 3: Easing and settling into place
          const settleProgress = (animTime - T_ORBIT_END) / (T_SETTLE_END - T_ORBIT_END);
          const ease = 1 - Math.pow(1 - settleProgress, 3);
          robot.group.position.lerpVectors(robot.group.position, orbit.settledPosition, ease * 0.35);
          robot.group.rotation.y = THREE.MathUtils.lerp(robot.group.rotation.y, orbit.settledRotationY, 0.1);
          robot.update(animTime, false, 0, false);
        } else if (animTime < T_WAVE_END) {
          // State 4: Robot waves right arm (2–3 gentle hand waves, eyes brighten)
          const waveProgress = (animTime - T_WAVE_START) / (T_WAVE_END - T_WAVE_START);
          robot.group.position.set(
            orbit.settledPosition.x,
            orbit.settledPosition.y + Math.sin(elapsed * 1.3) * 0.03,
            orbit.settledPosition.z
          );
          robot.group.rotation.y = orbit.settledRotationY;
          robot.update(elapsed, true, waveProgress, false);
        } else if (animTime < T_REVEAL_END) {
          // State 5: VC Meeting screen unfolds causally
          const revealProgress = (animTime - T_REVEAL_START) / (T_REVEAL_END - T_REVEAL_START);
          meetingSurface.updateReveal(revealProgress);

          robot.group.position.set(
            orbit.settledPosition.x,
            orbit.settledPosition.y + Math.sin(elapsed * 1.2) * 0.035,
            orbit.settledPosition.z
          );
          robot.group.rotation.y = orbit.settledRotationY;
          robot.update(elapsed, false, 0, false);

          // Fade orbital halo as meeting screen takes focal presence
          orbit.setOpacity(Math.max(0, 1 - revealProgress * 1.5));
        } else {
          // State 6: Idle state reached! Persist session state
          sessionStorage.setItem('tathastu_hero_intro_seen', 'true');

          orbit.setOpacity(0);
          meetingSurface.updateReveal(1.0);
          meetingSurface.updateIdle(elapsed);

          robot.group.position.y = orbit.settledPosition.y + Math.sin(elapsed * 1.2) * 0.04;
          robot.group.rotation.y = orbit.settledRotationY + Math.sin(elapsed * 0.7) * 0.03;
          robot.update(elapsed, false, 0, true);
        }
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    // 8. Resize Handling
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

    // 9. Visibility Change Handling (auto-pause RAF when tab hidden)
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isRunning = false;
        cancelAnimationFrame(animationFrameId);
      } else {
        if (!isRunning) {
          isRunning = true;
          animationFrameId = requestAnimationFrame(animate);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 10. Clean Cleanup on Unmount
    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (tier === 'high') {
        window.removeEventListener('mousemove', handlePointerMove);
      }
      resizeObserver.disconnect();

      orbit.dispose();
      robot.dispose();
      meetingSurface.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [tier]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-[400px] sm:h-[480px] lg:h-[520px] flex items-center justify-center select-none"
      aria-hidden="true"
    />
  );
};

export default HeroExperience;
