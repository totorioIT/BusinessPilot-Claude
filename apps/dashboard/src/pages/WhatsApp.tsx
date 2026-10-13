import { ChatView } from '../components/ConversationDetail';
import { ConversationSplit } from '../components/ConversationSplit';

export function WhatsAppPage({ selectedId }: { selectedId?: string }) {
  return (
    <ConversationSplit
      channel="whatsapp"
      title="WhatsApp"
      subtitle="Kundenkonversationen mit KI-Antwortvorschlägen – Sie prüfen und senden."
      listLabel="Chatliste"
      selectedId={selectedId}
      placeholder="Wählen Sie links einen Chat aus."
    >
      {selectedId ? <ChatView id={selectedId} backTo="/inbox/whatsapp" /> : undefined}
    </ConversationSplit>
  );
}
