'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Send, X, MessageSquare, ShieldAlert } from 'lucide-react';

export interface ChatMessage {
  id: string;
  senderName: string;
  senderIdentity: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onClose: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onClose,
}) => {
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottomRef = useRef(true);

  // Monitor user scroll position to avoid forcing scroll if reviewing earlier messages
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    isScrolledToBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  useEffect(() => {
    if (isScrolledToBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = inputText.trim();
    if (!trimmed) return;

    if (trimmed.length > 1000) {
      setError('Message exceeds the maximum limit of 1,000 characters.');
      return;
    }

    onSendMessage(trimmed);
    setInputText('');
    isScrolledToBottomRef.current = true;
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] border-l border-[#E5E7EB] text-[#1C1C1C] shadow-lg w-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[#1C1C1C]">In-call Messages</h3>
            <p className="text-[11px] text-[#6B7280]">Ephemeral • Active this call only</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#1C1C1C] hover:bg-[#F3F4F6] transition-colors"
          aria-label="Close chat panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Ephemeral Notice Banner */}
      <div className="px-4 py-2 bg-[#FAFAF8] border-b border-[#ECECE8] text-[11px] text-[#71717A] text-center">
        Messages are only visible to participants currently in the room.
      </div>

      {/* Message List */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#FAFAF8]"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 px-4">
            <div className="w-12 h-12 rounded-2xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-[#1C1C1C]">No messages yet</p>
            <p className="text-xs text-[#6B7280] mt-1 max-w-[200px]">
              Send a message to start communicating with everyone in the room.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-medium text-[#1C1C1C]">
                  {msg.isSelf ? 'You' : msg.senderName}
                </span>
                <span className="text-[10px] text-[#9CA3AF]">{formatTime(msg.timestamp)}</span>
              </div>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                  msg.isSelf
                    ? 'bg-[#7658E8] text-white rounded-tr-none'
                    : 'bg-[#FFFFFF] text-[#1C1C1C] border border-[#E5E7EB] rounded-tl-none'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[#E5E7EB] bg-[#FFFFFF]">
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2 px-1">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Send a message to everyone..."
            maxLength={1000}
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E5E7EB] bg-[#FAFAF8] text-[16px] sm:text-xs text-[#1C1C1C] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#7658E8] focus:border-transparent transition-all min-h-[42px]"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 rounded-xl bg-[#7658E8] hover:bg-[#6444D8] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF] text-white transition-colors flex items-center justify-center shrink-0 shadow-sm"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
