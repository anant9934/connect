'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { ChatMessage } from './types';
import * as api from './api';

const POLL_INTERVAL_MS = 4000;
const REACTION_VISIBLE_MS = 3500;
const PAGE_SIZE = 50;

export type InteractionStatus = 'loading' | 'ready' | 'offline';

function toChatMessage(stored: api.StoredMessage, selfIdentity: string): ChatMessage {
  return {
    id: stored.id,
    clientMessageId: stored.clientMessageId,
    seq: stored.seq,
    kind: stored.kind,
    senderName: stored.senderName,
    senderIdentity: stored.senderIdentity,
    text: stored.body,
    timestamp: new Date(stored.createdAt).getTime(),
    isSelf: stored.senderIdentity === selfIdentity,
    status: 'sent',
  };
}

// Stored messages replace their optimistic copies; unsent ones stay after everything stored.
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const bySender = new Map(current.map((m) => [`${m.senderIdentity}|${m.clientMessageId}`, m]));
  for (const message of incoming) {
    bySender.set(`${message.senderIdentity}|${message.clientMessageId}`, message);
  }
  return Array.from(bySender.values()).sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
    if (a.seq !== undefined) return -1;
    if (b.seq !== undefined) return 1;
    return a.timestamp - b.timestamp;
  });
}

/**
 * Keeps chat, hands and reactions in step with the server, which is the source of truth. A data
 * channel hint from another participant only triggers an earlier fetch; polling covers missed
 * hints, reconnects and reloads.
 */
export function useMeetingInteraction(
  roomCode: string,
  selfIdentity: string,
  sendHint: () => void,
  onNewMessages: (fromOthers: ChatMessage[]) => void
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<InteractionStatus>('loading');
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const lastSeq = useRef(0);
  const firstLoad = useRef(true);
  const seenReactions = useRef(new Set<string>());
  const inFlight = useRef(false);
  const callbacks = useRef({ sendHint, onNewMessages, selfIdentity });
  callbacks.current = { sendHint, onNewMessages, selfIdentity };

  const showReaction = useCallback((identity: string, emoji: string) => {
    setReactions((prev) => ({ ...prev, [identity]: emoji }));
    setTimeout(() => {
      setReactions((prev) => {
        if (prev[identity] !== emoji) return prev;
        const next = { ...prev };
        delete next[identity];
        return next;
      });
    }, REACTION_VISIBLE_MS);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current || !roomCode) return;
    inFlight.current = true;
    try {
      const state = await api.getLiveState(roomCode, lastSeq.current);
      const self = callbacks.current.selfIdentity;
      const incoming = state.messages.map((m) => toChatMessage(m, self));
      if (incoming.length > 0) {
        setMessages((prev) => merge(prev, incoming));
        lastSeq.current = Math.max(lastSeq.current, ...state.messages.map((m) => m.seq));
        if (firstLoad.current) {
          setHasOlder(incoming.length >= PAGE_SIZE);
        } else {
          const fromOthers = incoming.filter((m) => !m.isSelf);
          if (fromOthers.length > 0) callbacks.current.onNewMessages(fromOthers);
        }
      }
      firstLoad.current = false;
      setRaisedHands(new Set(state.raisedHands));
      for (const reaction of state.reactions) {
        if (!seenReactions.current.has(reaction.id)) {
          seenReactions.current.add(reaction.id);
          showReaction(reaction.identity, reaction.emoji);
        }
      }
      setStatus('ready');
    } catch {
      setStatus('offline');
    } finally {
      inFlight.current = false;
    }
  }, [roomCode, showReaction]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    const onOnline = () => refresh();
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onOnline);
    };
  }, [refresh]);

  const deliver = useCallback(
    async (clientMessageId: string, text: string, kind: 'chat' | 'announcement') => {
      try {
        const stored = await api.postMessage(roomCode, clientMessageId, text, kind);
        setMessages((prev) => merge(prev, [toChatMessage(stored, callbacks.current.selfIdentity)]));
        callbacks.current.sendHint();
        setStatus('ready');
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) => (m.clientMessageId === clientMessageId && m.seq === undefined ? { ...m, status: 'error' } : m))
        );
        setActionError(err instanceof ApiError ? err.message : 'The message could not be sent. It will stay here to retry.');
      }
    },
    [roomCode]
  );

  const sendMessage = useCallback(
    (text: string, kind: 'chat' | 'announcement') => {
      setActionError(null);
      const clientMessageId = crypto.randomUUID();
      const self = callbacks.current.selfIdentity;
      setMessages((prev) =>
        merge(prev, [
          { id: clientMessageId, clientMessageId, kind, senderName: 'You', senderIdentity: self, text, timestamp: Date.now(), isSelf: true, status: 'sending' },
        ])
      );
      return deliver(clientMessageId, text, kind);
    },
    [deliver]
  );

  // A retry reuses the same id, so the server cannot store the message twice.
  const retryMessage = useCallback(
    (message: ChatMessage) => {
      setActionError(null);
      setMessages((prev) => prev.map((m) => (m.clientMessageId === message.clientMessageId ? { ...m, status: 'sending' } : m)));
      return deliver(message.clientMessageId, message.text, message.kind);
    },
    [deliver]
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((m) => m.seq !== undefined)?.seq;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await api.getOlderMessages(roomCode, oldest, PAGE_SIZE);
      setMessages((prev) => merge(prev, older.map((m) => toChatMessage(m, callbacks.current.selfIdentity))));
      setHasOlder(older.length >= PAGE_SIZE);
    } catch {
      setActionError('Earlier messages could not be loaded.');
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messages, roomCode]);

  const react = useCallback(
    async (emoji: string) => {
      setActionError(null);
      try {
        await api.postReaction(roomCode, emoji);
        callbacks.current.sendHint();
        await refresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'The reaction could not be sent.');
      }
    },
    [refresh, roomCode]
  );

  const setOwnHand = useCallback(
    async (raised: boolean) => {
      setActionError(null);
      try {
        await api.setHand(roomCode, raised);
        callbacks.current.sendHint();
        await refresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Your hand could not be changed.');
      }
    },
    [refresh, roomCode]
  );

  const lowerHand = useCallback(
    async (identity: string) => {
      setActionError(null);
      try {
        await api.lowerParticipantHand(roomCode, identity);
        callbacks.current.sendHint();
        await refresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'That hand could not be lowered.');
      }
    },
    [refresh, roomCode]
  );

  return { messages, raisedHands, reactions, status, hasOlder, loadingOlder, actionError, refresh, sendMessage, retryMessage, loadOlder, react, setOwnHand, lowerHand };
}
