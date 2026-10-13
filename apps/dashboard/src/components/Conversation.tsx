import { MessageCircle, Phone, Globe } from 'lucide-react';
import type { Channel, ConversationStatus } from '../api';
import { conversationStatus } from '../lib/labels';
import { Badge } from './ui';

export function ChannelIcon({ channel }: { channel: Channel | string }) {
  const Icon = channel === 'phone' ? Phone : channel === 'whatsapp' ? MessageCircle : Globe;
  const label = channel === 'phone' ? 'Telefon' : channel === 'whatsapp' ? 'WhatsApp' : 'Webchat';
  return (
    <span className={`channel-icon channel-icon--${channel}`} title={label}>
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const s = conversationStatus[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
