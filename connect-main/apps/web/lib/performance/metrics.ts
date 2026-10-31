/**
 * Client performance metrics and device capability estimation
 */

export type HardwareTier = 'high' | 'medium' | 'low';

export function getDeviceTier(): HardwareTier {
  if (typeof window === 'undefined') return 'high';

  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (cores <= 2) {
    return 'low';
  } else if (cores < 4 || isMobile) {
    return 'medium';
  }

  return 'high';
}

export function reportWebVitals(metric: { name: string; value: number }): void {
  // In development, log to console if debug mode enabled
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    // console.debug(`[Web Vitals] ${metric.name}: ${metric.value}`);
  }
}
