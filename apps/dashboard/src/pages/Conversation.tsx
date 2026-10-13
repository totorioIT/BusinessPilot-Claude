import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ConversationDetail } from '../api';
import { ChatView } from '../components/ConversationDetail';
import { ErrorState, PageHeader, Skeleton } from '../components/ui';
import { PhonePage } from './Phone';
import { WhatsAppPage } from './WhatsApp';

/** /inbox/:id – zeigt die Konversation im passenden Kanal-Layout. */
export function ConversationPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    enabled: !!id,
  });
  if (q.isPending)
    return (
      <div className="card card--pad">
        <Skeleton lines={8} />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const channel = q.data.conversation.channel;
  if (channel === 'phone') return <PhonePage selectedId={id} />;
  if (channel === 'whatsapp') return <WhatsAppPage selectedId={id} />;
  return (
    <div className="stack-lg">
      <PageHeader title="Webchat" subtitle="Konversation über den Website-Chat." />
      <ChatView id={id!} backTo="/inbox" />
    </div>
  );
}
