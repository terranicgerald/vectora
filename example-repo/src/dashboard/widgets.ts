import { getDashboardOverview, DashboardStats } from './overview';
import { getEnv } from '../config/env';

export type WidgetType = 'summary' | 'recent-activity' | 'spending-chart' | 'quick-actions';

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  data: unknown;
  refreshIntervalMs: number;
}

export interface WidgetConfig {
  sessionId: string;
  ipAddress: string;
  enabledWidgets: WidgetType[];
}

export interface DashboardLayout {
  widgets: Widget[];
  generatedAt: Date;
  userId: string;
}

function buildSummaryWidget(stats: DashboardStats): Widget {
  return {
    id: 'widget-summary',
    type: 'summary',
    title: 'Account Overview',
    data: {
      totalCharges: stats.totalCharges,
      totalSpentCents: stats.totalAmountCents,
      activeSessions: stats.activeSessions,
    },
    refreshIntervalMs: 30000,
  };
}

function buildRecentActivityWidget(stats: DashboardStats): Widget {
  return {
    id: 'widget-recent-activity',
    type: 'recent-activity',
    title: 'Recent Activity',
    data: stats.recentCharges.slice(0, 5).map(c => ({
      id: c.chargeId,
      amount: c.amountCents,
      currency: c.currency,
      status: c.status,
      date: c.createdAt,
    })),
    refreshIntervalMs: 15000,
  };
}

export async function renderDashboard(config: WidgetConfig): Promise<DashboardLayout> {
  const env = getEnv();
  void env;

  const { stats, session } = await getDashboardOverview({
    sessionId: config.sessionId,
    ipAddress: config.ipAddress,
  });

  const enabled = config.enabledWidgets.length > 0
    ? config.enabledWidgets
    : (['summary', 'recent-activity'] as WidgetType[]);

  const widgets: Widget[] = [];

  if (enabled.includes('summary')) widgets.push(buildSummaryWidget(stats));
  if (enabled.includes('recent-activity')) widgets.push(buildRecentActivityWidget(stats));

  return {
    widgets,
    generatedAt: new Date(),
    userId: session.userId,
  };
}

export function getDefaultWidgets(): WidgetType[] {
  return ['summary', 'recent-activity'];
}
