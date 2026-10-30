'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Camera,
  Mic,
  SlidersHorizontal,
  ExternalLink,
  Copy,
  Check,
  Smartphone,
  ShieldAlert,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { TargetMediaDevice, DevicePermissionState } from '@/features/meeting/permissions/types';
import { detectBrowserEnvironment, BrowserEnvironmentInfo } from '@/features/meeting/permissions/browserDetection';

interface PermissionHelpSheetProps {
  isOpen: boolean;
  onClose: () => void;
  targetDevice: TargetMediaDevice;
  cameraState?: DevicePermissionState;
  micState?: DevicePermissionState;
  onRetry?: (device: TargetMediaDevice) => Promise<boolean | void>;
  isRetrying?: boolean;
}

export const PermissionHelpSheet: React.FC<PermissionHelpSheetProps> = ({
  isOpen,
  onClose,
  targetDevice,
  cameraState,
  micState,
  onRetry,
  isRetrying = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'chrome' | 'android' | 'inapp'>('chrome');
  const [localRetrying, setLocalRetrying] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const [env, setEnv] = useState<BrowserEnvironmentInfo>(() => detectBrowserEnvironment());

  useEffect(() => {
    if (isOpen) {
      setEnv(detectBrowserEnvironment());
      setRetryFeedback(null);
      // Auto-switch to in-app tab if in-app browser detected
      const currentEnv = detectBrowserEnvironment();
      if (currentEnv.isInAppBrowser) {
        setActiveTab('inapp');
      } else {
        setActiveTab('chrome');
      }
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isCamera = targetDevice === 'camera';
  const isMic = targetDevice === 'microphone';
  const isBoth = targetDevice === 'both';

  const deviceLabel = isCamera ? 'Camera' : isMic ? 'Microphone' : 'Camera & Microphone';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback copy
      const input = document.createElement('input');
      input.value = window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleExecuteRetry = async () => {
    if (!onRetry || localRetrying || isRetrying) return;
    setLocalRetrying(true);
    setRetryFeedback(null);

    try {
      const success = await onRetry(targetDevice);
      if (success === true) {
        onClose();
        return;
      } else {
        setRetryFeedback(
          `${deviceLabel} is still blocked. Please allow access in your browser settings above and try again.`
        );
      }
    } catch (err: any) {
      setRetryFeedback(
        `${deviceLabel} is still blocked. Please check your browser permissions.`
      );
    } finally {
      setLocalRetrying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-help-title"
      className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center bg-black/60 backdrop-blur-xs transition-opacity duration-200 p-0 sm:p-4 select-none"
    >
      {/* Backdrop click dismiss */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      {/* Sheet / Dialog Container */}
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-[#E5E5E3] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[85vh] overflow-y-auto z-10 animate-in slide-in-from-bottom-5 duration-200">
        {/* Header with Title and Close Button */}
        <div className="flex items-start justify-between gap-3 border-b border-[#EBEBE8] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#FFF2EE] text-[#D32F2F] flex items-center justify-center border border-[#F8C8BF] shrink-0">
              {isCamera ? (
                <Camera className="w-5 h-5" />
              ) : isMic ? (
                <Mic className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 id="permission-help-title" className="text-base font-bold text-[#171717] leading-tight">
                {deviceLabel} is blocked
              </h2>
              <p className="text-xs text-[#686868] mt-0.5">
                Chrome needs permission to use your {deviceLabel.toLowerCase()}.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#686868] hover:text-[#171717] hover:bg-[#F2F2F0] transition-colors"
            aria-label="Close device help"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Browser Guidance Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[#FAFAF8] rounded-xl border border-[#E5E5E3] text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('chrome')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center ${
              activeTab === 'chrome'
                ? 'bg-white text-[#7658E8] shadow-xs border border-[#E5E5E3]/60'
                : 'text-[#686868] hover:text-[#171717]'
            }`}
          >
            Chrome Settings
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('android')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center ${
              activeTab === 'android'
                ? 'bg-white text-[#7658E8] shadow-xs border border-[#E5E5E3]/60'
                : 'text-[#686868] hover:text-[#171717]'
            }`}
          >
            Phone Settings
          </button>
          {env.isInAppBrowser && (
            <button
              type="button"
              onClick={() => setActiveTab('inapp')}
              className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center ${
                activeTab === 'inapp'
                  ? 'bg-white text-[#7658E8] shadow-xs border border-[#E5E5E3]/60'
                  : 'text-[#686868] hover:text-[#171717]'
              }`}
            >
              In-App Browser
            </button>
          )}
        </div>

        {/* Tab 1: Chrome Site Settings (Step-by-step) */}
        {activeTab === 'chrome' && (
          <div className="space-y-3 py-1">
            <div className="bg-[#FAFAF8] rounded-xl border border-[#E5E5E3] p-3.5 space-y-2.5 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#7658E8] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  1
                </span>
                <p className="text-[#333333] leading-relaxed">
                  Tap the <strong className="text-[#171717]">tune or lock icon</strong> in Chrome&apos;s address bar at the top of your screen.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#7658E8] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  2
                </span>
                <p className="text-[#333333] leading-relaxed">
                  Select <strong className="text-[#171717]">Permissions</strong> (or Site settings).
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#7658E8] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  3
                </span>
                <p className="text-[#333333] leading-relaxed">
                  Set <strong className="text-[#171717]">{deviceLabel}</strong> to <span className="text-emerald-700 font-semibold">Allow</span> (or tap <strong className="text-[#171717]">Reset permissions</strong>).
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#7658E8] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  4
                </span>
                <p className="text-[#333333] leading-relaxed">
                  Return to this meeting and tap <strong className="text-[#171717]">Try {deviceLabel.toLowerCase()} again</strong> below.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Android OS-Level Settings */}
        {activeTab === 'android' && (
          <div className="space-y-3 py-1 text-xs">
            <div className="bg-[#FAFAF8] rounded-xl border border-[#E5E5E3] p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-[#333333]">
                <Smartphone className="w-4 h-4 text-[#7658E8] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#171717]">Android App Permissions:</p>
                  <p className="mt-1 leading-relaxed">
                    Open your phone&apos;s <strong>Settings</strong> → <strong>Apps</strong> → <strong>Chrome</strong> → <strong>Permissions</strong> → Allow <strong>{deviceLabel}</strong>.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-[#E5E5E3] flex items-start gap-2 text-[#333333]">
                <SlidersHorizontal className="w-4 h-4 text-[#7658E8] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#171717]">Device Privacy Toggles:</p>
                  <p className="mt-1 leading-relaxed">
                    Swipe down from the top of your screen to open Quick Settings. Ensure the master <strong>Camera access</strong> and <strong>Mic access</strong> tiles are turned on.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: In-App Browser Guidance */}
        {activeTab === 'inapp' && (
          <div className="space-y-3 py-1 text-xs">
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-3.5 space-y-2 text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>In-App Browser Detected {env.inAppBrowserName ? `(${env.inAppBrowserName})` : ''}</span>
              </div>
              <p className="leading-relaxed text-amber-800">
                In-app browsers often restrict camera and microphone access. For the best meeting experience, open this link in the full Google Chrome app.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyLink}
              className="w-full py-2.5 px-3 rounded-xl bg-[#FAFAF8] hover:bg-[#F2F2F0] border border-[#E5E5E3] text-[#171717] font-medium flex items-center justify-center gap-2 transition-all active:scale-98"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">Meeting link copied! Paste in Chrome</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#7658E8]" />
                  <span>Copy meeting link to open in Chrome</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Feedback Alert if Retry Failed */}
        {retryFeedback && (
          <div className="p-2.5 rounded-xl bg-[#FFF2EE] border border-[#F8C8BF] text-[#D32F2F] text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-tight">{retryFeedback}</span>
          </div>
        )}

        {/* Action Buttons: Try Again & Dismiss */}
        <div className="pt-2 flex flex-col gap-2">
          {onRetry && (
            <button
              id="retry-permission-btn"
              data-testid="retry-permission-btn"
              type="button"
              disabled={localRetrying || isRetrying}
              onClick={handleExecuteRetry}
              className="w-full py-2.5 px-4 rounded-xl bg-[#7658E8] hover:bg-[#6045D8] disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-xs active:scale-98 transition-all"
            >
              {localRetrying || isRetrying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Checking permissions...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try {deviceLabel.toLowerCase()} again</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 px-4 rounded-xl text-[#686868] hover:text-[#171717] text-xs font-medium transition-colors"
          >
            Continue without {deviceLabel.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  );
};
