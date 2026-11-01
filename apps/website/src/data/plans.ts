// Paketstruktur. Preise sind fest vorgegeben (Preisentscheidung offen).
// 2026-11-01: Wiederbuchung (BUSINESS) und Aktionen & Neuigkeiten (AUTOPILOT) ergänzt.

export type PlanId = 'START' | 'BUSINESS' | 'AUTOPILOT';

export interface Plan {
  id: PlanId;
  name: string;
  positioning: string;
  priceMonthly: string;
  onboarding: string;
  includesPrevious?: PlanId;
  features: string[];
  highlighted?: boolean;
}

export const plans: Plan[] = [
  {
    id: 'START',
    name: 'START',
    positioning: 'Dein digitaler Empfang.',
    priceMonthly: '199 €',
    onboarding: '490 € einmaliges Onboarding',
    features: ['Website-Chatbot', 'WhatsApp', 'Terminbuchung', 'Basis-Reporting'],
  },
  {
    id: 'BUSINESS',
    name: 'BUSINESS',
    positioning: 'Dein digitaler Mitarbeiter.',
    priceMonthly: '499 €',
    onboarding: '990 € einmaliges Onboarding',
    includesPrevious: 'START',
    features: ['Telefon-KI', 'Terminerinnerungen', 'CRM / Customer 360', 'Bewertungsautomation', 'Wiederbuchung nach Besuch', 'Pro Reporting'],
    highlighted: true,
  },
  {
    id: 'AUTOPILOT',
    name: 'AUTOPILOT',
    positioning: 'Dein digitaler Prozessmanager.',
    priceMonthly: '899 €',
    onboarding: 'ab 1.990 € einmaliges Onboarding',
    includesPrevious: 'BUSINESS',
    features: ['Kundenreaktivierung', 'Aktionen & Neuigkeiten', 'Angebotsprozesse', 'individuelle Workflows', 'ROI Reporting'],
  },
];

export const getPlan = (id: PlanId) => plans.find((p) => p.id === id)!;
