'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { HeroFallback } from './HeroFallback';
import { isReducedMotionPreferred, subscribeToMotionPreference } from '@/lib/accessibility/motion';
import { getDeviceTier } from '@/lib/performance/metrics';

const DynamicExperience = dynamic(() => import('./HeroExperience'), {
  ssr: false,
  loading: () => <HeroFallback />,
});

export const HeroExperienceLoader: React.FC = () => {
  const [useFallback, setUseFallback] = useState(false);
  const [tier, setTier] = useState<'high' | 'medium'>('high');

  useEffect(() => {
    // 1. Accessibility: Detect prefers-reduced-motion or preview=reduced
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (urlParams?.get('preview') === 'reduced' || isReducedMotionPreferred()) {
      setUseFallback(true);
      return;
    }

    const unsubscribe = subscribeToMotionPreference((reduced) => {
      setUseFallback(reduced);
    });

    // 2. Hardware Capability: Detect device tier
    const detectedTier = getDeviceTier();
    setTier(detectedTier === 'low' ? 'medium' : detectedTier);

    return () => {
      unsubscribe();
    };
  }, []);

  if (useFallback) {
    return <HeroFallback />;
  }

  return <DynamicExperience tier={tier} />;
};

export default HeroExperienceLoader;
