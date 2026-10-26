import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { PressScale } from '@/components/motion';
import { elevation, palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, type BusinessSwitcherStat } from '@/services/api';

export function BusinessPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, selectBusiness } = useAuth();
  const [stats, setStats] = useState<BusinessSwitcherStat[] | null>(null);
  const [statsError, setStatsError] = useState(false);
  const token = session?.token;

  useEffect(() => {
    if (!visible || !token) return;
    let active = true;
    void api.businessSwitcherSummary(token)
      .then((result) => { if (active) { setStats(result.businesses); setStatsError(false); } })
      .catch(() => { if (active) { setStats(null); setStatsError(true); } });
    return () => { active = false; };
  }, [visible, token]);
  if (!session) return null;

  const currentStats = stats?.length === session.businesses.length ? stats : null;
  const statByBusiness = new Map(currentStats?.map((item) => [item.business_id, item]));
  const products = currentStats?.reduce((total, item) => total + item.products, 0);
  const locations = currentStats?.reduce((total, item) => total + item.locations, 0);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close business picker" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeading}>
            <View><Text style={styles.title}>Your businesses</Text><Text style={styles.subtitle}>Choose where you want to work.</Text></View>
            <View style={styles.headingActions}>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>Across your businesses</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryMetric}><Text style={styles.summaryValue}>{session.businesses.length}</Text><Text style={styles.summaryLabel}>Businesses</Text></View>
                <View style={styles.summaryMetric}><Text style={styles.summaryValue}>{currentStats ? products : '—'}</Text><Text style={styles.summaryLabel}>Products</Text></View>
                <View style={styles.summaryMetric}><Text style={styles.summaryValue}>{currentStats ? locations : '—'}</Text><Text style={styles.summaryLabel}>Locations</Text></View>
              </View>
              {statsError && <Text style={styles.summaryHint}>Business counts are unavailable right now.</Text>}
            </View>
            {session.businesses.map((business) => (
              <PressScale
                key={business.id}
                onPress={() => { selectBusiness(business.id); onClose(); }}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${business.name}`}>
                <View style={[styles.businessRow, session.account?.business.id === business.id && styles.selectedRow]}>
                  <View style={styles.businessAvatar}><Text style={styles.businessInitial}>{business.name.charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.businessCopy}>
                    <Text style={styles.businessName} numberOfLines={1}>{business.name}</Text>
                    <Text style={styles.businessRole}>{business.role === 'owner' ? 'Owner' : 'Employee'}{session.account?.business.id === business.id ? ' · Current' : ''}</Text>
                    {statByBusiness.has(business.id) && <Text style={styles.businessStats}>
                      {statByBusiness.get(business.id)?.products} products · {statByBusiness.get(business.id)?.locations} locations
                    </Text>}
                  </View>
                  <AppSymbol name="chevron" color={palette.muted} size={20} />
                </View>
              </PressScale>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(11, 35, 31, 0.45)' },
  sheet: { backgroundColor: palette.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%', ...elevation.hero },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.border, alignSelf: 'center', marginTop: spacing.sm },
  sheetHeading: { padding: spacing.xl, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.ink, fontSize: 21, fontWeight: '700' },
  subtitle: { color: palette.muted, fontSize: 13, marginTop: spacing.xs },
  close: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  closeText: { color: palette.primaryDeep, fontSize: 13, fontWeight: '600' },
  sheetContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  summary: { backgroundColor: palette.primaryDeep, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm, gap: spacing.md },
  summaryTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row', gap: spacing.sm },
  summaryMetric: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.sm, padding: spacing.sm, minHeight: 65, justifyContent: 'center' },
  summaryValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  summaryLabel: { color: '#D7F5F0', fontSize: 11 },
  summaryHint: { color: '#D7F5F0', fontSize: 12 },
  businessRow: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68 },
  addRow: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68, marginTop: spacing.sm },
  addAvatar: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  selectedRow: { borderColor: palette.primary, backgroundColor: '#F5FCFA' },
  businessAvatar: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  businessInitial: { color: palette.primaryDeep, fontSize: 18, fontWeight: '700' },
  businessCopy: { flex: 1, gap: spacing.xs },
  businessName: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  businessRole: { color: palette.muted, fontSize: 12 },
  businessStats: { color: palette.secondary, fontSize: 11 },
});
