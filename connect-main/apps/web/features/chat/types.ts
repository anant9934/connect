export interface ChatMessage {
  id: string;
  senderName: string;
  senderIdentity: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'error';
}

