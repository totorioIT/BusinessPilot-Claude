import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { ErrorState, FullPageLoader } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { InboxPage } from './pages/Inbox';
import { PhonePage } from './pages/Phone';
import { WhatsAppPage } from './pages/WhatsApp';
import { ConversationPage } from './pages/Conversation';
import { CustomersPage } from './pages/Customers';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { LeadsPage } from './pages/Leads';
import { AppointmentsPage } from './pages/Appointments';
import { QuotesPage } from './pages/Quotes';
import { TasksPage } from './pages/Tasks';
import { AutomationsPage } from './pages/Automations';
import { ReviewsPage } from './pages/Reviews';
import { KnowledgePage } from './pages/Knowledge';
import { AnalyticsPage } from './pages/Analytics';
import { AiEmployeePage } from './pages/AiEmployee';
import { IntegrationsPage } from './pages/Integrations';
import { SettingsPage } from './pages/Settings';
import { AdminPage } from './pages/Admin';
import { NotFoundPage } from './pages/NotFound';

function Protected() {
  const { me, loading, error } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (error && !me) {
    return (
      <div className="center-screen">
        <ErrorState error={error} />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Layout />;
}

function AdminOnly() {
  const { me } = useAuth();
  if (!me?.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <AdminPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<DashboardPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/phone" element={<PhonePage />} />
        <Route path="inbox/whatsapp" element={<WhatsAppPage />} />
        <Route path="inbox/:id" element={<ConversationPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="ai-employee" element={<AiEmployeePage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminOnly />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
