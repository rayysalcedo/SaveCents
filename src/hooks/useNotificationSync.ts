// M5.6 part 2 — keeps the scheduled "due tomorrow" reminders matched to the
// current budgets. Lives in its own file (not notifications.ts) because the
// finance store imports notifyBudgetCrossings from the service; importing the
// store back there would create a require cycle.
//
// Debounced: budget arrays change identity on every spent bump, and there is
// no need to cancel-and-reschedule mid-burst.
import { useEffect } from 'react';
import { useFinance } from '../store/finance';
import { syncScheduledNotifications } from '../services/notifications';

export function useNotificationSync() {
  const categories = useFinance((s) => s.categories);
  const transactions = useFinance((s) => s.transactions);
  const goals = useFinance((s) => s.goals);
  const enabled = useFinance((s) => s.notificationsEnabled);
  const hydrated = useFinance((s) => s.hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => {
      syncScheduledNotifications({ categories, transactions, goals, enabled });
    }, 1200);
    return () => clearTimeout(id);
  }, [categories, transactions, goals, enabled, hydrated]);
}
