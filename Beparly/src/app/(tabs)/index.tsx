import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, symbols } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { BusinessCreateForm, BusinessPicker } from '@/components/business-picker';
import { Entrance, PressScale } from '@/components/motion';
import { elevation, palette, radius, spacing, typography } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';

const actions = [
  { label: 'Sales', icon: 'receipt', color: palette.primary, background: palette.primarySoft },
  { label: 'POS', icon: 'sale', color: palette.blue, background: palette.blueSoft },
  { label: 'Purchase', icon: 'purchase', color: palette.orange, background: palette.orangeSoft },
  { label: 'Products', icon: 'products', color: palette.blue, background: palette.blueSoft },
  { label: 'Stock', icon: 'stock', color: palette.purple, background: palette.purpleSoft },
  { label: 'Receive', icon: 'receive', color: palette.primary, background: palette.primarySoft },
  { label: 'Parties', icon: 'parties', color: palette.rose, background: palette.roseSoft },
  { label: 'Dues', icon: 'dues', color: palette.amber, background: palette.amberSoft },
  { label: 'Reports', icon: 'reports', color: palette.blue, background: palette.blueSoft },
  { label: 'Accounting', icon: 'money', color: palette.primary, background: palette.primarySoft },
  { label: 'Expense', icon: 'expense', color: palette.orange, background: palette.orangeSoft },
] as const satisfies ReadonlyArray<{ label: string; icon: keyof typeof symbols; color: string; background: string }>;

const actionRoutes: Partial<Record<(typeof actions)[number]['label'], string>> = {
  Sales: '/sales',
  POS: '/sales/new?mode=quick',
  Products: '/products',
  Stock: '/stock',
  Accounting: '/money',
  Expense: '/money/new?flow=expense',
};

const overview = [
  { label: 'Customer বাকি', value: '৳8,500', detail: 'To collect', icon: 'receive', color: palette.primary, background: palette.primarySoft },
  { label: 'Supplier due', value: '৳3,200', detail: 'To pay', icon: 'purchase', color: palette.orange, background: palette.orangeSoft },
  { label: 'Low stock', value: '—', detail: 'Available with Products', icon: 'stock', color: palette.amber, background: palette.amberSoft },
  { label: 'Expenses', value: '৳1,450', detail: 'Today', icon: 'reports', color: palette.purple, background: palette.purpleSoft },
] as const satisfies ReadonlyArray<{ label: string; value: string; detail: string; icon: keyof typeof symbols; color: string; background: string }>;

export default function HomeScreen() {
  const { session } = useAuth();
  const { businessPicker } = useLocalSearchParams<{ businessPicker?: string }>();
  const [notice, setNotice] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (businessPicker === '1') setPickerOpen(true);
  }, [businessPicker]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timeout);
  }, [notice]);

  if (!session) return null;
  if (!session.account) return <BusinessStart name={session.user.name} />;
  const { account } = session;
  const displayName = account.user.name || (account.role === 'owner' ? 'Owner' : 'Employee');
  const showPreview = (label: string) => setNotice(`${label} is coming soon`);
  const closePicker = () => {
    setPickerOpen(false);
    if (businessPicker === '1') router.setParams({ businessPicker: undefined });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Entrance>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <Text style={styles.brand}>BEPARLY</Text>
                  <PressScale onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Switch or add business profile" style={styles.businessButton}>
                    <View style={styles.businessRow}>
                      <Text style={styles.businessName} numberOfLines={1}>{account.business.name}</Text>
                      <AppSymbol name="down" color={palette.ink} size={20} />
                    </View>
                  </PressScale>
                  <Text style={styles.greeting}>Good to see you, {displayName}</Text>
                </View>
                <PressScale onPress={() => router.push('/explore')} accessibilityRole="button" accessibilityLabel="Account and team" style={styles.avatarHit}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text></View>
                </PressScale>
              </View>
            </Entrance>
            <Entrance delay={80}>
              <View style={styles.salesCard}>
                <View style={styles.salesTop}>
                  <View style={styles.salesTitleRow}>
                    <View style={styles.salesIcon}><AppSymbol name="arrow" size={18} color={palette.primary} /></View>
                    <Text style={styles.salesLabel}>Today's sales</Text>
                  </View>
                  <View style={styles.samplePill}><Text style={styles.sampleText}>SAMPLE DATA</Text></View>
                </View>
                <Text style={styles.salesValue}>৳12,450</Text>
                <View style={styles.salesRule} />
                <View style={styles.salesBottom}>
                  <View><Text style={styles.salesMetaLabel}>Money received</Text><Text style={styles.salesMetaValue}>৳10,800</Text></View>
                  <View style={styles.invoiceBadge}><AppSymbol name="receipt" size={16} color={palette.secondary} /><Text style={styles.invoiceText}>5 invoices</Text></View>
                </View>
              </View>
            </Entrance>
          </View>

          <View style={styles.body}>
            <View>
              <Entrance delay={130}><SectionTitle title="Quick actions" /></Entrance>
              <View style={styles.actionGrid}>
                {actions.filter((action) => account.role === 'owner' || (action.label !== 'Accounting' && action.label !== 'Expense')).map((action, index) => (
                  <Entrance key={action.label} delay={160 + index * 45} style={styles.actionSlot}>
                    <PressScale
                      onPress={() => {
                        const route = actionRoutes[action.label];
                        if (route) router.push(route as Href);
                        else showPreview(action.label);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={actionRoutes[action.label] ? `Open ${action.label === 'Stock' ? 'shops and warehouses' : action.label}` : `${action.label}, coming soon`}
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
              <SectionTitle title="At a glance" sample />
              <View style={styles.overviewGrid}>
                {overview.map((item) => (
                  <PressScale key={item.label} onPress={() => showPreview(item.label)} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.value}, ${item.detail}, sample data. Details coming soon`} style={styles.overviewPressable}>
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
            </Entrance>

            <Entrance delay={360}>
              <SectionTitle title="Recent activity" sample />
              <View style={styles.activityCard}>
                <ActivityRow icon="sale" iconColor={palette.primary} iconBackground={palette.primarySoft} title="Retail sale" detail="Today · Invoice #1003" amount="৳2,500" />
                <View style={styles.activityDivider} />
                <ActivityRow icon="receive" iconColor={palette.amber} iconBackground={palette.amberSoft} title="Customer due received" detail="Yesterday · Karim Store" amount="৳1,200" />
              </View>
              <Text style={styles.previewNote}>Dashboard preview · Figures and activity are examples.</Text>
            </Entrance>
          </View>
        </View>
      </ScrollView>
      {!!notice && <View accessibilityRole="alert" style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>}
      <BusinessPicker visible={pickerOpen} onClose={closePicker} />
    </SafeAreaView>
  );
}

function BusinessStart({ name }: { name: string }) {
  return (
    <SafeAreaView style={styles.startSafeArea}>
      <ScrollView contentContainerStyle={styles.startScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.startContent}>
          <View style={styles.startHeader}>
            <View><Text style={styles.startBrand}>BEPARLY</Text><Text style={styles.startGreeting}>Welcome{name ? `, ${name}` : ''}</Text></View>
            <PressScale onPress={() => router.push('/explore')} accessibilityRole="button" accessibilityLabel="Account and sign out">
              <View style={styles.startAvatar}><AppSymbol name="account" color={palette.primary} size={23} /></View>
            </PressScale>
          </View>
          <Text style={styles.startTitle}>Set up your first business</Text>
          <Text style={styles.startSubtitle}>Your dashboard will show its sales, stock, and dues here.</Text>
          <BusinessCreateForm />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, sample = false }: { title: string; sample?: boolean }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionRule} />{sample && <Text style={styles.sectionSample}>SAMPLE</Text>}</View>;
}

function ActivityRow({ icon, iconColor, iconBackground, title, detail, amount }: { icon: keyof typeof symbols; iconColor: string; iconBackground: string; title: string; detail: string; amount: string }) {
  return <View style={styles.activityRow}>
    <View style={[styles.activityIcon, { backgroundColor: iconBackground }]}><AppSymbol name={icon} size={19} color={iconColor} /></View>
    <View style={styles.activityCopy}><Text style={styles.activityTitle}>{title}</Text><Text style={styles.activityDetail}>{detail}</Text></View>
    <Text style={styles.activityAmount}>{amount}</Text>
  </View>;
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
  samplePill: { backgroundColor: palette.primarySoft, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
  sampleText: { color: palette.primaryDark, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  salesValue: { color: palette.ink, fontSize: typography.amount, fontWeight: '700', letterSpacing: -1, marginTop: spacing.md },
  salesRule: { height: 1, backgroundColor: palette.border, marginTop: spacing.lg, marginBottom: spacing.lg },
  salesBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  salesMetaLabel: { color: palette.muted, fontSize: typography.caption },
  salesMetaValue: { color: palette.ink, fontSize: 17, fontWeight: '700', marginTop: spacing.xs },
  invoiceBadge: { backgroundColor: palette.background, borderRadius: 10, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  invoiceText: { color: palette.secondary, fontSize: typography.caption, fontWeight: '600' },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.xxl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sectionTitle: { color: palette.ink, fontSize: typography.section, fontWeight: '700', letterSpacing: -0.2 },
  sectionRule: { flex: 1, height: 1, backgroundColor: palette.border },
  sectionSample: { color: palette.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
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
  activityCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, ...elevation.card },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  activityIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, gap: spacing.xs },
  activityTitle: { color: palette.ink, fontSize: typography.action, fontWeight: '700' },
  activityDetail: { color: palette.muted, fontSize: typography.caption },
  activityAmount: { color: palette.ink, fontSize: typography.action, fontWeight: '700' },
  activityDivider: { height: 1, backgroundColor: palette.border, marginLeft: 52 },
  previewNote: { color: palette.muted, fontSize: typography.caption, textAlign: 'center', lineHeight: 18, paddingTop: spacing.xl },
  notice: { position: 'absolute', bottom: 84, alignSelf: 'center', maxWidth: '90%', backgroundColor: palette.ink, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, ...elevation.hero },
  noticeText: { color: '#FFFFFF', fontSize: typography.body, fontWeight: '600', textAlign: 'center' },
});
