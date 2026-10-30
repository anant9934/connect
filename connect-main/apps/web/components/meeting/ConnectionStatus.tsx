'use client';

import React from 'react';
import { ConnectionState } from 'livekit-client';
import { Wifi, AlertCircle, RefreshCw } from 'lucide-react';

interface ConnectionStatusProps {
  connectionState: ConnectionState;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ connectionState }) => {
  if (connectionState === ConnectionState.Reconnecting) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs animate-pulse">
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Reconnecting...</span>
      </div>
    );
  }

  if (connectionState === ConnectionState.Disconnected) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 text-xs">
        <AlertCircle className="w-3 h-3" />
        <span>Disconnected</span>
      </div>
    );
  }

  if (connectionState === ConnectionState.Connected) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <Wifi className="w-3 h-3" />
      </div>
    );
  }

  return null;
};
