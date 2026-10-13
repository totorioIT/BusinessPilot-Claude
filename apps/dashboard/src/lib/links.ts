export function entityLink(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  switch (entityType) {
    case 'customer':
      return entityId ? `/customers/${entityId}` : '/customers';
    case 'conversation':
    case 'call':
      return entityId && entityType === 'conversation' ? `/inbox/${entityId}` : '/inbox';
    case 'lead':
      return '/leads';
    case 'appointment':
      return '/appointments';
    case 'quote':
      return '/quotes';
    case 'task':
      return '/tasks';
    case 'automation':
      return '/automations';
    case 'review':
    case 'review_request':
      return '/reviews';
    case 'knowledge':
      return '/knowledge';
    case 'integration':
      return '/integrations';
    default:
      return null;
  }
}
