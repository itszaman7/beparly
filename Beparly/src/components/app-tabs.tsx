import { usePathname } from 'expo-router';
import { Tabs, TabList, TabTrigger, TabSlot, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { blurWebFocus } from '@/utils/web-focus';

export default function AppTabs() {
  const pathname = usePathname();
  const { session } = useAuth();
  const financeVisible = session?.account?.role === 'owner';
  const count = financeVisible ? 5 : 4;
  const selected = pathname === '/sales-hub' ? 1 : pathname === '/inventory' ? 2 :
    pathname === '/finance' && financeVisible ? 3 : pathname === '/more' || pathname === '/explore' ? count - 1 : 0;

  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <AppTabList selected={selected} count={count}>
          <TabTrigger name="index" href="/" asChild><TabButton label="Home" icon="home" /></TabTrigger>
          <TabTrigger name="sales-hub" href="/sales-hub" asChild><TabButton label="Sales" icon="sale" /></TabTrigger>
          <TabTrigger name="inventory" href="/inventory" asChild><TabButton label="Inventory" icon="stock" /></TabTrigger>
          {financeVisible && <TabTrigger name="finance" href="/finance" asChild><TabButton label="Finance" icon="money" /></TabTrigger>}
          <TabTrigger name="more" href="/more" asChild><TabButton label="More" icon="account" /></TabTrigger>
        </AppTabList>
      </TabList>
    </Tabs>
  );
}

function AppTabList({ selected, count, children, ...props }: TabListProps & { selected: number; count: number }) {
  const keyboardVisible = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const position = useSharedValue(selected);

  useEffect(() => {
    position.value = reducedMotion ? selected : withTiming(selected, { duration: 220 });
  }, [position, reducedMotion, selected]);

  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * (width / count) }],
  }));

  return (
    <View {...props} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }, keyboardVisible && styles.hiddenBar]}>
      <View style={styles.inner} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 && <Animated.View pointerEvents="none" style={[styles.indicator, { width: width / count - 6, left: 3 }, indicator]} />}
        {children}
      </View>
    </View>
  );
}

function TabButton({ label, icon, isFocused, ref: _ref, ...props }: TabTriggerSlotProps & { label: string; icon: 'home' | 'sale' | 'stock' | 'money' | 'account' }) {
  return (
    <Pressable
      {...props}
      onPress={(event) => { blurWebFocus(); props.onPress?.(event); }}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={styles.trigger}>
      <View style={styles.triggerContent}>
        <AppSymbol name={icon} size={21} color={isFocused ? palette.primaryDeep : palette.muted} />
        <Text style={[styles.label, isFocused && styles.activeLabel]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  bar: { width: '100%', backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  hiddenBar: { height: 0, paddingTop: 0, paddingBottom: 0, borderTopWidth: 0, overflow: 'hidden' },
  inner: { width: '100%', maxWidth: 480, minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  indicator: { position: 'absolute', top: 2, height: 49, borderRadius: radius.sm, backgroundColor: palette.primarySoft },
  trigger: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  triggerContent: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { color: palette.muted, fontSize: 10, fontWeight: '600' },
  activeLabel: { color: palette.primaryDeep, fontWeight: '700' },
});
