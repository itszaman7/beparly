import { router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { DESKTOP_WIDTH, TABLET_WIDTH } from '@/constants/responsive';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, radius, spacing } from '@/constants/design-system';
import { blurWebFocus } from '@/utils/web-focus';

export type HubAction = { title: string; caption: string; icon: AppSymbolName; href: Href; color: string; background: string };
export type ChartBar = { label: string; value: number; display?: string };

export function HubPage({ eyebrow, title, subtitle, children, onRefresh, refreshing }: { eyebrow: string; title: string; subtitle: string; children?: React.ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const { width } = useWindowDimensions();
  const Scroller = onRefresh ? RefreshableScrollView : ScrollView;
  return <SafeAreaView style={styles.safe} edges={['top']}><Scroller contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} onRefresh={onRefresh!} refreshing={refreshing}>
    <View style={[styles.content, width >= TABLET_WIDTH && styles.wideContent]}>
      <View style={styles.header}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
      {children}
    </View>
  </Scroller></SafeAreaView>;
}

export function HubSectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>;
}

export function HubActions({ actions }: { actions: HubAction[] }) {
  const { width } = useWindowDimensions();
  return <View style={styles.actionGrid}>{actions.map((action) => <Pressable key={action.title} onPress={() => { blurWebFocus(); router.push(action.href); }}
    accessibilityRole="button" accessibilityLabel={action.title} accessibilityHint={action.caption}
    style={({ pressed }) => [styles.action, width >= TABLET_WIDTH && styles.wideAction, pressed && styles.pressed]}>
    <View style={[styles.actionIcon, { backgroundColor: action.background }]}><AppSymbol name={action.icon} color={action.color} size={19} /></View>
    <Text style={styles.actionTitle} numberOfLines={1}>{action.title}</Text>
  </Pressable>)}</View>;
}

export function HubMetrics({ items }: { items: { label: string; value: string; color?: string }[] }) {
  const { width } = useWindowDimensions();
  return <View style={[styles.metricGrid, width >= TABLET_WIDTH && styles.wideMetrics]}>{items.map((item) => <View key={item.label} style={[styles.metric, width >= TABLET_WIDTH && styles.wideMetric]}>
    <Text style={styles.metricLabel}>{item.label}</Text><Text style={[styles.metricValue, item.color ? { color: item.color } : null]} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
  </View>)}</View>;
}

export function HubChart({ title, subtitle, bars, color = palette.primaryDeep, empty = 'No activity in this period.' }:
  { title: string; subtitle: string; bars: ChartBar[]; color?: string; empty?: string }) {
  const { width } = useWindowDimensions();
  const maximum = Math.max(0, ...bars.map((bar) => Math.max(0, bar.value)));
  return <View style={[styles.chartCard, width >= DESKTOP_WIDTH && styles.wideChartCard]}>
    <Text style={styles.chartTitle}>{title}</Text><Text style={styles.chartSubtitle}>{subtitle}</Text>
    {maximum === 0 ? <View style={styles.empty}><AppSymbol name="reports" color={palette.muted} size={25} /><Text style={styles.emptyText}>{empty}</Text></View> :
      <View style={styles.chartRows}>{bars.map((bar) => <View key={bar.label} style={styles.chartRow} accessibilityLabel={`${bar.label}: ${bar.display ?? bar.value}`}>
        <Text style={styles.barLabel} numberOfLines={1}>{bar.label}</Text>
        <View style={styles.track}><View style={[styles.fill, { backgroundColor: color, width: `${Math.max(0, Math.min(100, bar.value / maximum * 100))}%` }]} /></View>
        <Text style={styles.barValue} numberOfLines={1}>{bar.display ?? String(bar.value)}</Text>
      </View>)}</View>}
  </View>;
}

export function HubState({ loading, error, onRetry, children }: { loading: boolean; error: string; onRetry: () => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (loading) return <View style={styles.state}><ActivityIndicator color={palette.primaryDeep} /><Text style={styles.emptyText}>Loading current figures…</Text></View>;
  if (error) return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
    <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>;
  return width >= DESKTOP_WIDTH ? <View style={styles.chartGrid}>{children}</View> : <>{children}</>;
}

export function HubLink({ title, detail, href }: { title: string; detail: string; href: Href }) {
  return <Pressable onPress={() => router.push(href)} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
    <View style={styles.linkCopy}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.linkDetail}>{detail}</Text></View>
    <AppSymbol name="chevron" color={palette.primaryDeep} size={20} />
  </Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { flexGrow: 1, alignItems: 'center', paddingBottom: 90 },
  content: { width: '100%', maxWidth: 640, padding: spacing.lg, gap: spacing.lg },
  wideContent: { maxWidth: 1200, padding: spacing.xl },
  header: { backgroundColor: palette.primary, borderRadius: radius.xl, padding: spacing.xl, gap: 5, marginBottom: spacing.xs },
  eyebrow: { color: palette.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: palette.ink, fontSize: 27, fontWeight: '800' },
  subtitle: { color: palette.primaryDark, fontSize: 13, lineHeight: 19 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  sectionDetail: { color: palette.muted, fontSize: 11 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { width: '48%', minHeight: 54, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, gap: spacing.sm },
  wideAction: { width: '23%', flexGrow: 1 },
  pressed: { opacity: 0.75 },
  actionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { color: palette.ink, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wideMetrics: { width: '100%' },
  metric: { width: '47%', flexGrow: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
    borderRadius: radius.md, padding: spacing.md, minHeight: 78, justifyContent: 'center', gap: spacing.xs },
  wideMetric: { width: '23%' },
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metricLabel: { color: palette.secondary, fontSize: 11 },
  metricValue: { color: palette.ink, fontSize: 21, fontWeight: '800' },
  chartCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md,
    padding: spacing.lg, gap: spacing.sm },
  wideChartCard: { flexGrow: 1, flexBasis: '46%' },
  chartTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  chartSubtitle: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  chartRows: { gap: spacing.md, marginTop: spacing.sm },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  barLabel: { color: palette.secondary, fontSize: 11, width: 68 },
  track: { height: 12, flex: 1, backgroundColor: palette.background, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
  barValue: { color: palette.ink, fontSize: 11, fontWeight: '700', width: 75, textAlign: 'right' },
  empty: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { color: palette.muted, fontSize: 12 },
  state: { padding: spacing.xl, backgroundColor: palette.surface, borderRadius: radius.md, alignItems: 'center', gap: spacing.md },
  error: { color: '#A62925', fontSize: 12, textAlign: 'center' },
  retry: { backgroundColor: palette.primarySoft, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.sm },
  retryText: { color: palette.primaryDeep, fontWeight: '700' },
  link: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  linkCopy: { flex: 1, gap: 4 },
  linkTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  linkDetail: { color: palette.muted, fontSize: 11 },
});
