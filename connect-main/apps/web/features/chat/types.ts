export interface ChatMessage {
  id: string;
  clientMessageId: string;
  seq?: number;
  kind: 'chat' | 'announcement';
  senderName: string;
  senderIdentity: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  status: 'sending' | 'sent' | 'error';
}
