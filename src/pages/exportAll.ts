import { liveAccounts, catById, contactById, currentDbWs, debts, entries, ledger, openWorkspace, settings } from '../store/data';
import { todayKey } from '../domain/reports';
import { describe } from '../ui/describe';

export async function exportAllForWorkspace(wsId: string) {
  if (currentDbWs() !== wsId) await openWorkspace(wsId);
  const s = settings.value;
  if (!s) return;
  const { exportExcel } = await import('../export/report');
  exportExcel({
    settings: s,
    entries: entries.value,
    accounts: liveAccounts.value,
    cats: catById.value,
    contacts: contactById.value,
    debts: debts.value,
    ledger: ledger.value,
    range: { from: 0, to: Number.MAX_SAFE_INTEGER },
    rangeLabel: 'Semua data',
    todayKey: todayKey(s.tz),
    describe,
  });
}
