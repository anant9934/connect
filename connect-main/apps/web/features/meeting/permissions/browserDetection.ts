'use client';

export interface BrowserEnvironmentInfo {
  isAndroid: boolean;
  isiOS: boolean;
  isMobile: boolean;
  isChrome: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  isEdge: boolean;
  isInAppBrowser: boolean;
  inAppBrowserName: string | null;
  isSecureContext: boolean;
  hasMediaDevicesSupport: boolean;
}

export function detectBrowserEnvironment(): BrowserEnvironmentInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isAndroid: false,
      isiOS: false,
      isMobile: false,
      isChrome: false,
      isSafari: false,
      isFirefox: false,
      isEdge: false,
      isInAppBrowser: false,
      inAppBrowserName: null,
      isSecureContext: true,
      hasMediaDevicesSupport: true,
    };
  }

  const ua = navigator.userAgent || '';
  const vendor = navigator.vendor || '';

  const isAndroid = /Android/i.test(ua);
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isiOS || /Mobile/i.test(ua);

  // Common In-App Browser user agent signatures
  let isInAppBrowser = false;
  let inAppBrowserName: string | null = null;

  if (/Instagram/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Instagram';
  } else if (/FBAN|FBAV|FB_IAB/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Facebook';
  } else if (/LinkedInApp/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'LinkedIn';
  } else if (/Twitter|TwitterAndroid/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Twitter / X';
  } else if (/musical_ly|ByteLocale|TikTok/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'TikTok';
  } else if (/Slack/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Slack';
  } else if (/WhatsApp/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'WhatsApp';
  } else if (/Telegram/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Telegram';
  } else if (/Snapchat/i.test(ua)) {
    isInAppBrowser = true;
    inAppBrowserName = 'Snapchat';
  } else if (/GSA\//i.test(ua)) {
    // Google Search App in-app browser
    isInAppBrowser = true;
    inAppBrowserName = 'Google App';
  } else if (isAndroid && /Version\/4\.0|\bwv\b/i.test(ua)) {
    // Generic Android WebView
    isInAppBrowser = true;
    inAppBrowserName = 'In-App Browser';
  }

  const isEdge = /EdgA?|Edge/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isChrome = !isEdge && !isInAppBrowser && (/Chrome|CriOS/i.test(ua) || /Google Inc/.test(vendor));
  const isSafari = !isEdge && !isChrome && !isInAppBrowser && /Safari/i.test(ua) && /Apple Computer/.test(vendor);

  const isSecure = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : window.location.protocol === 'https:';
  const hasMediaDevices = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

  return {
    isAndroid,
    isiOS,
    isMobile,
    isChrome,
    isSafari,
    isFirefox,
    isEdge,
    isInAppBrowser,
    inAppBrowserName,
    isSecureContext: isSecure,
    hasMediaDevicesSupport: hasMediaDevices,
  };
}
