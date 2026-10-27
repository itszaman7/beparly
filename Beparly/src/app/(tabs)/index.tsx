import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, symbols } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { BusinessPicker } from '@/components/business-picker';
import { Entrance, PressScale } from '@/components/motion';
import { ProfileMenu } from '@/components/profile-menu';
import { elevation, palette, radius, spacing, typography } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { useDashboard, type DashboardActivity } from '@/features/dashboard/use-dashboard';
import { sumMoney } from '@/features/dashboard/money';
import { weekStart } from '@/features/dashboard/week';
import { formatBdt } from '@/features/products/product-rules';
import { businessToday } from '@/features/reports/dates';
import { blurWebFocus } from '@/utils/web-focus';
import type { SalesHubSummary } from '@/services/api';

const actions = [
  { label: 'Sale', icon: 'sale', color: palette.primaryDeep, background: palette.primarySoft },
  { label: 'Purchase', icon: 'purchase', color: palette.orange, background: palette.orangeSoft },
  { label: 'Receive', icon: 'receive', color: palette.primaryDeep, background: palette.primarySoft },
  { label: 'Expense', icon: 'expense', color: palette.orange, background: palette.orangeSoft },
  { label: 'Products', icon: 'products', color: palette.blue, background: palette.blueSoft },
  { label: 'Stock', icon: 'stock', color: palette.purple, background: palette.purpleSoft },
  { label: 'Contacts', icon: 'parties', color: palette.rose, background: palette.roseSoft },
] as const satisfies readonly { label: string; icon: keyof typeof symbols; color: string; background: string }[];

const actionRoutes: Partial<Record<(typeof actions)[number]['label'], string>> = {
  Sale: '/sales-hub',
  Purchase: '/purchases/new',
  Receive: '/money/new?flow=in',
  Expense: '/money/new?flow=expense',
  Products: '/products',
  Stock: '/stock',
  Contacts: '/contacts',
};

const amountOrDash = (value: string | null | undefined) => value == null ? '—' : formatBdt(value);

export default function HomeScreen() {
  const { session } = useAuth();
  const { businessPicker } = useLocalSearchParams<{ businessPicker?: string }>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const account = session?.account;
  const owner = account?.role === 'owner';
  const timezone = account?.business.timezone ?? 'Asia/Dhaka';
  const today = businessToday(timezone);
  const startOfWeek = weekStart(today);
  const dashboard = useDashboard({ token: session?.token, businessId: account?.business.id, today,
    owner });

  useEffect(() => {
    if (businessPicker !== '1') return;
    const timeout = setTimeout(() => setPickerOpen(true), 0);
    return () => clearTimeout(timeout);
  }, [businessPicker]);

  if (!session) return null;
  if (!account) return <BusinessStart name={session.user.name} />;
  const displayName = account.user.name || (account.role === 'owner' ? 'Owner' : 'Employee');
  const daysThisWeek = dashboard.sales?.value?.last_seven_days.filter((day) => day.date >= startOfWeek && day.date <= today);
  const salesThisWeek = daysThisWeek ? sumMoney(daysThisWeek.map((day) => day.amount)) : null;
  const completedThisWeek = daysThisWeek?.reduce((count, day) => count + day.count, 0);
  const weekLabel = `${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${startOfWeek}T12:00:00Z`))} – ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`))}`;
  const overview = [
    ...(owner ? [
      { label: 'Customer বাকি', value: amountOrDash(dashboard.finance?.value?.customerDue), detail: 'To collect', icon: 'dues', color: palette.primaryDeep, background: palette.primarySoft, route: '/dues' },
      { label: 'Supplier due', value: amountOrDash(dashboard.finance?.value?.supplierDue), detail: 'To pay', icon: 'purchase', color: palette.orange, background: palette.orangeSoft, route: '/dues' },
      { label: 'Expenses', value: amountOrDash(dashboard.finance?.value?.expenses), detail: 'This week', icon: 'expense', color: palette.purple, background: palette.purpleSoft, route: `/reports/expenses?start_date=${startOfWeek}&end_date=${today}` },
    ] as const : []),
    { label: 'Low stock', value: dashboard.stock?.value ? String(dashboard.stock.value.low_stock) : '—', detail: 'Products to restock', icon: 'warning', color: palette.amber, background: palette.amberSoft, route: '/products?stock=low_stock' },
    { label: 'Out of stock', value: dashboard.stock?.value ? String(dashboard.stock.value.out_of_stock) : '—', detail: 'Products unavailable', icon: 'stock', color: palette.rose, background: palette.roseSoft, route: '/products?stock=out_of_stock' },
  ] as const;
  const closePicker = () => {
    setPickerOpen(false);
    if (businessPicker === '1') router.setParams({ businessPicker: undefined });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={dashboard.refreshing} onRefresh={dashboard.refresh} tintColor={palette.primaryDeep} />}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Entrance>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <Text style={styles.brand}>GOTIBOOKS</Text>
                  <PressScale onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Switch business" style={styles.businessButton}>
                    <View style={styles.businessRow}>
                      <Text style={styles.businessName} numberOfLines={1}>{account.business.name}</Text>
                      <AppSymbol name="down" color={palette.ink} size={20} />
                    </View>
                  </PressScale>
                  <Text style={styles.greeting}>Good to see you, {displayName}</Text>
                </View>
                <PressScale onPress={() => setProfileMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Open account menu" style={styles.avatarHit}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text></View>
                </PressScale>
              </View>
            </Entrance>
            <Entrance delay={80}>
              <View style={styles.salesCard}>
                <View style={styles.salesTop}>
                  <View style={styles.salesTitleRow}>
                    <View style={styles.salesIcon}><AppSymbol name="arrow" size={18} color={palette.primary} /></View>
                    <Text style={styles.salesLabel}>This week&apos;s sales</Text>
                  </View>
                  <View style={styles.datePill}><Text style={styles.dateText}>{weekLabel}</Text></View>
                </View>
                <Text style={styles.salesValue}>{amountOrDash(salesThisWeek)}</Text>
                {dashboard.sales?.error ? <Text accessibilityRole="alert" style={styles.loadError}>Sales unavailable. Pull down to try again.</Text> : null}
                <View style={styles.salesRule} />
                <View style={styles.salesBottom}>
                  {owner ? <View><Text style={styles.salesMetaLabel}>Money received this week</Text><Text style={styles.salesMetaValue}>{amountOrDash(dashboard.finance?.value?.received)}</Text></View> :
                    <View><Text style={styles.salesMetaLabel}>Completed this week</Text><Text style={styles.salesMetaValue}>{completedThisWeek ?? '—'} invoices</Text></View>}
                </View>
              </View>
            </Entrance>
          </View>

          <View style={styles.body}>
            <View>
              <Entrance delay={130}><SectionTitle title="Quick actions" /></Entrance>
              <View style={styles.actionGrid}>
                {actions.filter((action) => (owner || action.label !== 'Receive' && action.label !== 'Expense') &&
                  (action.label !== 'Purchase' || owner || account.can_manage_purchases)).map((action, index) => (
                  <Entrance key={action.label} delay={160 + index * 45} style={styles.actionSlot}>
                    <PressScale
                      onPress={() => {
                        const route = actionRoutes[action.label];
                        if (route) { blurWebFocus(); router.push(route as Href); }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${action.label === 'Stock' ? 'shops and warehouses' : action.label}`}
                      style={styles.actionPressable}>
                      <View style={styles.actionCell}>
                        <View style={[styles.actionIcon, { backgroundColor: action.background }]}><AppSymbol name={action.icon} size={25} color={action.color} /></View>
                        <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
                      </View>
                    </PressScale>
                  </Entrance>
                ))}
              </View>
            </View>

            <Entrance delay={280}>
              <SectionTitle title="At a glance" />
              <View style={styles.overviewGrid}>
                {overview.map((item) => (
                  <PressScale key={item.label} onPress={() => router.push(item.route as Href)} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.value}. ${item.detail}`} style={styles.overviewPressable}>
                    <View style={styles.overviewCard}>
                      <View style={styles.overviewTop}>
                        <View style={[styles.overviewIcon, { backgroundColor: item.background }]}><AppSymbol name={item.icon} size={19} color={item.color} /></View>
                        <AppSymbol name="chevron" size={16} color={palette.muted} />
                      </View>
                      <Text style={styles.overviewLabel}>{item.label}</Text>
                      <Text style={styles.overviewValue}>{item.value}</Text>
                      <Text style={styles.overviewDetail}>{item.detail}</Text>
                    </View>
                  </PressScale>
                ))}
              </View>
              {owner && dashboard.finance?.value && [dashboard.finance.value.received, dashboard.finance.value.expenses, dashboard.finance.value.customerDue, dashboard.finance.value.supplierDue].some((value) => value === null) ?
                <Text style={styles.partialNote}>Some money figures are unavailable. Pull down to try again.</Text> : null}
            </Entrance>

            <Entrance delay={360}>
              <SectionTitle title="Sales · last 7 days" />
              <SalesTrend days={dashboard.sales?.value?.last_seven_days ?? null} error={dashboard.sales?.error ?? ''} />
            </Entrance>

            <Entrance delay={400}>
              <SectionTitle title="Recent activity" />
              {dashboard.activity?.error ? <Text accessibilityRole="alert" style={styles.loadError}>{dashboard.activity.error}</Text> :
                dashboard.activity?.value?.length ? <View style={styles.activityCard}>{dashboard.activity.value.map((event, index) =>
                  <View key={`${event.kind}-${event.id}`}>{index > 0 ? <View style={styles.activityDivider} /> : null}<ActivityRow event={event} timezone={timezone} /></View>)}</View> :
                <View style={styles.emptyCard}><AppSymbol name="movements" size={25} color={palette.muted} />
                  <Text style={styles.emptyTitle}>{dashboard.activity ? 'No posted activity yet' : 'Loading recent activity…'}</Text>
                  {dashboard.activity ? <Text style={styles.emptyDetail}>Sales and purchases will appear here.</Text> : null}</View>}
            </Entrance>
          </View>
        </View>
      </ScrollView>
      <BusinessPicker visible={pickerOpen} onClose={closePicker} />
      <ProfileMenu visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} onSwitchBusiness={() => setPickerOpen(true)} />
    </SafeAreaView>
  );
}

function BusinessStart({ name }: { name: string }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  return (
    <SafeAreaView style={styles.startSafeArea}>
      <ScrollView contentContainerStyle={styles.startScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.startContent}>
          <View style={styles.startHeader}>
            <View><Text style={styles.startBrand}>GOTIBOOKS</Text><Text style={styles.startGreeting}>Welcome{name ? `, ${name}` : ''}</Text></View>
            <PressScale onPress={() => setProfileMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Open account menu">
              <View style={styles.startAvatar}><AppSymbol name="account" color={palette.primary} size={23} /></View>
            </PressScale>
          </View>
          <Text style={styles.startTitle}>No business assigned yet</Text>
          <Text style={styles.startSubtitle}>Ask your administrator to assign your account to a business, then sign in again.</Text>
        </View>
      </ScrollView>
      <ProfileMenu visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} />
    </SafeAreaView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionRule} /></View>;
}

function SalesTrend({ days, error }: { days: SalesHubSummary['last_seven_days'] | null; error: string }) {
  if (error) return <View style={styles.trendCard}><Text accessibilityRole="alert" style={styles.loadError}>Sales trend unavailable.</Text></View>;
  if (!days) return <View style={styles.trendCard}><Text style={styles.emptyDetail}>Loading sales trend…</Text></View>;
  const maximum = Math.max(...days.map((day) => Number(day.amount)), 0);
  if (!maximum) return <View style={styles.trendCard}><Text style={styles.emptyDetail}>No sales recorded in the last 7 days.</Text></View>;
  return <View style={styles.trendCard}>
    <View style={styles.trendBars}>{days.map((day) => {
      const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`));
      return <View key={day.date} style={styles.trendColumn} accessibilityLabel={`${weekday}: ${formatBdt(day.amount)}, ${day.count} invoices`}>
        <View style={styles.trendTrack}><View style={[styles.trendFill, { height: `${Math.max(3, Math.min(100, Number(day.amount) / maximum * 100))}%` }]} /></View>
        <Text style={styles.trendLabel}>{weekday}</Text>
      </View>;
    })}</View>
    <Text style={styles.trendHint}>Net completed sale value by invoice day</Text>
  </View>;
}

function ActivityRow({ event, timezone }: { event: DashboardActivity; timezone: string }) {
  const sale = event.kind === 'sale';
  const title = `${sale ? 'Sale' : 'Purchase'} ${event.number}`;
  const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(event.created_at));
  return <PressScale onPress={() => router.push(`${sale ? '/sales' : '/purchases'}/${event.id}` as Href)} accessibilityRole="button" accessibilityLabel={`${title}, ${event.party_name}, ${formatBdt(event.amount)}`}>
    <View style={styles.activityRow}>
      <View style={[styles.activityIcon, { backgroundColor: sale ? palette.primarySoft : palette.orangeSoft }]}>
        <AppSymbol name={sale ? 'sale' : 'purchase'} size={19} color={sale ? palette.primaryDeep : palette.orange} />
      </View>
      <View style={styles.activityCopy}><Text style={styles.activityTitle} numberOfLines={1}>{title}</Text><Text style={styles.activityDetail} numberOfLines={1}>{date} · {event.party_name}</Text></View>
      <Text style={styles.activityAmount}>{formatBdt(event.amount)}</Text>
    </View>
  </PressScale>;
}

const styles = StyleSheet.create({
  startSafeArea: { flex: 1, backgroundColor: palette.background },
  startScroll: { flexGrow: 1, alignItems: 'center', paddingBottom: 90 },
  startContent: { width: '100%', maxWidth: 480, padding: spacing.xl },
  startHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xxxl },
  startBrand: { color: palette.primaryDark, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  startGreeting: { color: palette.secondary, fontSize: 14 },
  startAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  startTitle: { color: palette.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  startSubtitle: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  startButton: { minHeight: 52, backgroundColor: palette.primary, borderRadius: radius.sm, marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  startButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  safeArea: { flex: 1, backgroundColor: palette.primary },
  scroll: { flexGrow: 1, backgroundColor: palette.background, alignItems: 'center', paddingBottom: 102 },
  content: { width: '100%', maxWidth: 480 },
  hero: { backgroundColor: palette.primary, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxxl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.xxl },
  headerCopy: { flex: 1 },
  brand: { color: palette.primaryDark, fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  businessButton: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 36, justifyContent: 'center' },
  businessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  businessName: { color: palette.ink, fontSize: typography.title, fontWeight: '700', flexShrink: 1, letterSpacing: -0.4 },
  greeting: { color: palette.primaryDark, fontSize: typography.body, marginTop: spacing.xs },
  avatarHit: { marginTop: spacing.sm },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D6F8F2' },
  avatarText: { color: palette.ink, fontSize: 19, fontWeight: '700' },
  salesCard: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.xl, ...elevation.hero },
  salesTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  salesTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  salesIcon: { width: 29, height: 29, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft },
  salesLabel: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  datePill: { backgroundColor: palette.primarySoft, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  dateText: { color: palette.primaryDeep, fontSize: 11, fontWeight: '700' },
  salesValue: { color: palette.ink, fontSize: typography.amount, fontWeight: '700', letterSpacing: -1, marginTop: spacing.md },
  salesRule: { height: 1, backgroundColor: palette.border, marginTop: spacing.lg, marginBottom: spacing.lg },
  salesBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  salesMetaLabel: { color: palette.muted, fontSize: typography.caption },
  salesMetaValue: { color: palette.ink, fontSize: 17, fontWeight: '700', marginTop: spacing.xs },
  loadError: { color: '#A62925', fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.xxl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sectionTitle: { color: palette.ink, fontSize: typography.section, fontWeight: '700', letterSpacing: -0.2 },
  sectionRule: { flex: 1, height: 1, backgroundColor: palette.border },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionSlot: { width: '22%' },
  actionPressable: { width: '100%' },
  actionCell: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, minHeight: 99, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, ...elevation.card },
  actionIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: palette.ink, fontSize: typography.action, fontWeight: '600', textAlign: 'center' },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  overviewPressable: { width: '48%', flexGrow: 1 },
  overviewCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.lg, minHeight: 148, ...elevation.card },
  overviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  overviewIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  overviewLabel: { color: palette.secondary, fontSize: typography.caption, fontWeight: '600' },
  overviewValue: { color: palette.ink, fontSize: 23, fontWeight: '700', marginTop: spacing.xs, letterSpacing: -0.5 },
  overviewDetail: { color: palette.muted, fontSize: typography.caption, marginTop: spacing.xs },
  partialNote: { color: palette.muted, fontSize: 11, marginTop: spacing.sm },
  trendCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md,
    padding: spacing.lg, minHeight: 100, justifyContent: 'center', gap: spacing.sm },
  trendBars: { height: 106, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  trendColumn: { flex: 1, alignItems: 'center', gap: spacing.xs },
  trendTrack: { width: '100%', height: 84, justifyContent: 'flex-end', backgroundColor: palette.background,
    borderRadius: 7, overflow: 'hidden' },
  trendFill: { width: '100%', backgroundColor: palette.primaryDeep, borderRadius: 7 },
  trendLabel: { color: palette.muted, fontSize: 10, fontWeight: '600' },
  trendHint: { color: palette.muted, fontSize: 11, marginTop: spacing.xs },
  activityCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, ...elevation.card },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  activityIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, gap: spacing.xs },
  activityTitle: { color: palette.ink, fontSize: typography.action, fontWeight: '700' },
  activityDetail: { color: palette.muted, fontSize: typography.caption },
  activityAmount: { color: palette.ink, fontSize: typography.action, fontWeight: '700' },
  activityDivider: { height: 1, backgroundColor: palette.border, marginLeft: 52 },
  emptyCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md,
    padding: spacing.xl, minHeight: 125, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  emptyTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  emptyDetail: { color: palette.muted, fontSize: 12, textAlign: 'center' },
});
