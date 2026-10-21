import { usePathname } from 'expo-router';
import { Tabs, TabList, TabTrigger, TabSlot, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';

export default function AppTabs() {
  const pathname = usePathname();
  const selected = pathname === '/stock-tab' ? 1 : pathname === '/more' || pathname === '/explore' ? 2 : 0;

  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <AppTabList selected={selected}>
          <TabTrigger name="index" href="/" asChild><TabButton label="Home" icon="home" /></TabTrigger>
          <TabTrigger name="stock-tab" href="/stock-tab" asChild><TabButton label="Stock" icon="stock" /></TabTrigger>
          <TabTrigger name="more" href="/more" asChild><TabButton label="More" icon="account" /></TabTrigger>
        </AppTabList>
      </TabList>
    </Tabs>
  );
}

function AppTabList({ selected, children, ...props }: TabListProps & { selected: number }) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const position = useSharedValue(selected);

  useEffect(() => {
    position.value = reducedMotion ? selected : withTiming(selected, { duration: 220 });
  }, [position, reducedMotion, selected]);

  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * (width / 3) }],
  }));

  return (
    <View {...props} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.inner} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 && <Animated.View pointerEvents="none" style={[styles.indicator, { left: width / 6 - 43 }, indicator]} />}
        {children}
      </View>
    </View>
  );
}

function TabButton({ label, icon, isFocused, ref: _ref, ...props }: TabTriggerSlotProps & { label: string; icon: 'home' | 'stock' | 'account' }) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      onPressIn={(event) => {
        if (!reducedMotion) scale.value = withTiming(0.97, { duration: 110 });
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reducedMotion) scale.value = withTiming(1, { duration: 150 });
        props.onPressOut?.(event);
      }}
      style={styles.trigger}>
      <Animated.View style={[styles.triggerContent, animatedStyle]}>
        <AppSymbol name={icon} size={22} color={isFocused ? palette.primaryDeep : palette.muted} />
        <Text style={[styles.label, isFocused && styles.activeLabel]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  bar: { width: '100%', backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 480, minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  indicator: { position: 'absolute', top: 2, width: 86, height: 46, borderRadius: radius.sm, backgroundColor: palette.primarySoft },
  trigger: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  triggerContent: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  label: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  activeLabel: { color: palette.primaryDeep, fontWeight: '700' },
});
