import type { PublishableNotificationEvent } from '../notification/notification.publisher';
import type { ReportResult } from '../report/report.service';

export function reportOutcomeEvents(result: ReportResult, rebuilt: boolean): PublishableNotificationEvent[] {
  return result.reports.map((report) => {
    if (report.status === 'awaiting_data') return {
      id: `report:awaiting-data:${report.id}:${report.version}`,
      type: 'report_awaiting_data' as const,
      accountId: report.accountId,
      data: { reportId: report.id, missingDates: report.missingDates, missingFields: report.missingFields },
    };
    const type = rebuilt ? 'report_rebuilt' as const : 'report_generated' as const;
    return { id: `report:${type}:${report.id}:${report.version}`, type, accountId: report.accountId, data: { reportId: report.id } };
  });
}
