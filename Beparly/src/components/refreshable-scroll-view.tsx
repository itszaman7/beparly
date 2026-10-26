import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';

import { palette } from '@/constants/design-system';

type Props = ScrollViewProps & { onRefresh: () => Promise<unknown> | void; refreshing?: boolean };

export function RefreshableScrollView({ onRefresh, refreshing: controlledRefreshing, ...props }: Props) {
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setPendingRefresh(true);
    try {
      await onRefresh();
    } catch {
      // Screens report load failures in their existing error state.
    } finally {
      pending.current = false;
      setPendingRefresh(false);
    }
  }, [onRefresh]);

  return <ScrollView {...props} refreshControl={<RefreshControl refreshing={controlledRefreshing ?? pendingRefresh} onRefresh={() => { void refresh(); }} tintColor={palette.primaryDeep} colors={[palette.primaryDeep]} />} />;
}
