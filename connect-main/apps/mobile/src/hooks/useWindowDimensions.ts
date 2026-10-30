import { useAdaptiveLayout, AdaptiveLayout } from './useAdaptiveLayout';

/**
 * Enhanced useWindowDimensions
 * Backward-compatible with React Native's ScaledSize ({ width, height, scale, fontScale })
 * while exposing the full universal AdaptiveLayout engine for phones and tablets.
 */
export function useWindowDimensions(): AdaptiveLayout {
  return useAdaptiveLayout();
}

export { useAdaptiveLayout };
export type { AdaptiveLayout };
export default useWindowDimensions;
