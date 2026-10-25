import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api, type DashboardActivityRecord, type ProductSummary, type SalesHubSummary } from '@/services/api';
import { weekStart } from './week';

type Slice<T> = { scope: string; value: T | null; error: string } | null;
export type DashboardActivity = DashboardActivityRecord;
type Finance = { received: string | null; expenses: string | null; customerDue: string | null; supplierDue: string | null };

const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load this section.';
const settledValue = <T,>(result: PromiseSettledResult<T>) => result.status === 'fulfilled' ? result.value : null;

export function useDashboard({ token, businessId, today, owner }: {
  token?: string; businessId?: number; today: string; owner: boolean;
}) {
  const [sales, setSales] = useState<Slice<SalesHubSummary>>(null);
  const [stock, setStock] = useState<Slice<ProductSummary>>(null);
  const [finance, setFinance] = useState<Slice<Finance>>(null);
  const [activity, setActivity] = useState<Slice<DashboardActivity[]>>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const scope = `${token}:${businessId}:${today}:${refreshCount}`;

  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    let active = true;
    const key = scope;
    void api.salesHubSummary(token, businessId)
      .then((value) => { if (active) setSales({ scope: key, value, error: '' }); })
      .catch((error) => { if (active) setSales({ scope: key, value: null, error: message(error) }); });
    void api.productSummary(token, businessId)
      .then((value) => { if (active) setStock({ scope: key, value, error: '' }); })
      .catch((error) => { if (active) setStock({ scope: key, value: null, error: message(error) }); });

    void api.dashboardActivity(token, businessId)
      .then((result) => { if (active) setActivity({ scope: key, value: result.activity, error: '' }); })
      .catch((error) => { if (active) setActivity({ scope: key, value: null, error: message(error) }); });

    if (owner) {
      const dates = new URLSearchParams({ start_date: weekStart(today), end_date: today });
      void Promise.allSettled([
        api.report(token, businessId, 'money-received', dates),
        api.report(token, businessId, 'expenses', dates),
        api.report(token, businessId, 'customer-dues', new URLSearchParams({ as_of: today })),
        api.report(token, businessId, 'supplier-dues', new URLSearchParams({ as_of: today })),
      ]).then(([receivedResult, expensesResult, customerResult, supplierResult]) => {
        if (!active) return;
        const value: Finance = { received: settledValue(receivedResult)?.total ?? null,
          expenses: settledValue(expensesResult)?.total ?? null,
          customerDue: settledValue(customerResult)?.total_outstanding ?? null,
          supplierDue: settledValue(supplierResult)?.total_outstanding ?? null };
        setFinance({ scope: key, value, error: '' });
      });
    }
    return () => { active = false; };
  }, [token, businessId, today, owner, scope]));

  return {
    sales: sales?.scope === scope ? sales : null,
    stock: stock?.scope === scope ? stock : null,
    finance: finance?.scope === scope ? finance : null,
    activity: activity?.scope === scope ? activity : null,
    refresh: () => setRefreshCount((count) => count + 1),
  };
}
