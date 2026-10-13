import { CallDetail } from '../components/ConversationDetail';
import { ConversationSplit } from '../components/ConversationSplit';

export function PhonePage({ selectedId }: { selectedId?: string }) {
  return (
    <ConversationSplit
      channel="phone"
      title="Telefon"
      subtitle="Alle Anrufe mit KI-Zusammenfassung, Transkript und Aktionen."
      listLabel="Anrufliste"
      selectedId={selectedId}
      placeholder="Wählen Sie links einen Anruf aus, um Zusammenfassung und Transkript zu sehen."
    >
      {selectedId ? <CallDetail id={selectedId} backTo="/inbox/phone" /> : undefined}
    </ConversationSplit>
  );
}
