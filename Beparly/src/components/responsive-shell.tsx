import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AccountAvatar } from '@/components/account-avatar';
import { AppText as Text } from '@/components/app-text';
import { BusinessPicker } from '@/components/business-picker';
import { ProfileMenu } from '@/components/profile-menu';
import { palette, spacing } from '@/constants/design-system';
import { DESKTOP_WIDTH, TABLET_WIDTH } from '@/constants/responsive';
import { useAuth } from '@/features/auth/auth-context';
import { blurWebFocus } from '@/utils/web-focus';

type NavItem = { label: string; href: Href; icon: AppSymbolName; match: string[] };
const item = (label: string, href: Href, icon: AppSymbolName, ...match: string[]): NavItem => ({ label, href, icon, match });

export function ResponsiveShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { session } = useAuth();
  const [businessPickerOpen, setBusinessPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const wide = width >= TABLET_WIDTH && !!session?.account && !isFocusedRoute(pathname);

  const full = width >= DESKTOP_WIDTH;
  const owner = session?.account?.role === 'owner';
  const canPurchase = owner || !!session?.account?.can_manage_purchases;
  const groups: { title: string; links: NavItem[] }[] = [
    { title: 'Workspace', links: [item('Home', '/', 'home', '/'), item('Sales', '/sales-hub', 'sale', '/sales-hub', '/sales'), item('Inventory', '/inventory', 'stock', '/inventory')] },
    { title: 'Trade', links: [item('Products', '/products', 'products', '/products'), item('Stock locations', '/stock', 'location', '/stock'),
      ...(canPurchase ? [item('Purchases', '/purchases', 'purchase', '/purchases')] : []),
      item('Contacts', '/contacts', 'parties', '/contacts'), ...(canPurchase ? [item('Suppliers', '/suppliers', 'parties', '/suppliers')] : [])] },
    ...(owner ? [{ title: 'Finance', links: [item('Finance', '/finance', 'money', '/finance'), item('Money', '/money', 'receive', '/money'),
      item('Dues', '/dues', 'dues', '/dues'), item('Reports', '/reports', 'reports', '/reports')] }] : []),
    { title: 'Account', links: [item('Settings', '/more', 'edit', '/more', '/business-settings', '/print-settings', '/media'),
      item('Account & team', '/explore', 'account', '/explore')] },
  ];
  const active = groups.flatMap((group) => group.links).find((link) =>
    link.match.some((route) => route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(`${route}/`)));

  return <SafeAreaView style={styles.safe} edges={wide ? ['top', 'bottom'] : []}>
    <View style={styles.row}>
      {wide && <View style={[styles.sidebar, full ? styles.fullSidebar : styles.rail]}>
        <Pressable onPress={() => router.navigate('/')} accessibilityRole="button" accessibilityLabel="GotiBooks home" style={[styles.brand, !full && styles.railBrand]}>
          <Image source={require('@/assets/images/android-chrome-512x512.png')} style={styles.brandMark} resizeMode="contain" />
          {full && <View><Text style={styles.brandTitle}>GotiBooks</Text><Text style={styles.brandCaption}>Business workspace</Text></View>}
        </Pressable>
        <ScrollView style={styles.navScroll} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
          {groups.map((group) => <View key={group.title} style={styles.group}>
            {full && <Text style={styles.groupTitle}>{group.title}</Text>}
            {group.links.map((link) => {
              const selected = active?.href === link.href;
              return <Pressable key={link.label} onPress={() => { blurWebFocus(); router.navigate(link.href); }} accessibilityRole="link"
                accessibilityLabel={link.label} accessibilityState={{ selected }}
                style={[styles.link, !full && styles.railLink, selected && styles.selected]}>
                <AppSymbol name={link.icon} size={21} color={selected ? palette.primaryDeep : palette.secondary} />
                {full && <Text style={[styles.linkText, selected && styles.selectedText]}>{link.label}</Text>}
              </Pressable>;
            })}
          </View>)}
        </ScrollView>
      </View>}
      <View style={styles.main}>
        {wide && <View style={styles.navbar}>
          <Text style={styles.pageTitle} numberOfLines={1}>{active?.label ?? 'GotiBooks'}</Text>
          <View style={styles.navbarActions}>
            <Pressable onPress={() => setBusinessPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Switch business" style={styles.businessButton}>
              <Text style={styles.businessName} numberOfLines={1}>{session?.account?.business.name}</Text>
              <AppSymbol name="down" size={17} color={palette.secondary} />
            </Pressable>
            <Pressable onPress={() => setProfileOpen(true)} accessibilityRole="button" accessibilityLabel="Open account menu" style={styles.avatar}>
              <AccountAvatar size={36} />
            </Pressable>
          </View>
        </View>}
        <View style={styles.content}>{children}</View>
      </View>
    </View>
    {wide && <BusinessPicker visible={businessPickerOpen} onClose={() => setBusinessPickerOpen(false)} />}
    {wide && <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} onSwitchBusiness={() => setBusinessPickerOpen(true)} />}
  </SafeAreaView>;
}

function isFocusedRoute(pathname: string) {
  return pathname === '/sign-in' || pathname === '/register' ||
    pathname.endsWith('/document') || pathname.endsWith('/barcode-label');
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, row: { flex: 1, flexDirection: 'row' },
  sidebar: { backgroundColor: palette.surface, borderRightWidth: 1, borderRightColor: palette.border },
  fullSidebar: { width: 252 }, rail: { width: 76 },
  brand: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border },
  railBrand: { justifyContent: 'center', paddingHorizontal: 0 }, brandMark: { width: 40, height: 40, borderRadius: 11 }, brandTitle: { color: palette.ink, fontSize: 19, fontWeight: '800' },
  brandCaption: { color: palette.muted, fontSize: 10 }, navScroll: { flex: 1 }, navContent: { padding: 10, paddingBottom: 28, gap: 14 },
  group: { gap: 3 }, groupTitle: { color: palette.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 6 },
  link: { minHeight: 43, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  railLink: { justifyContent: 'center', paddingHorizontal: 0, minHeight: 48 }, selected: { backgroundColor: palette.primarySoft },
  linkText: { color: palette.secondary, fontSize: 13, fontWeight: '600', flexShrink: 1 }, selectedText: { color: palette.primaryDeep, fontWeight: '800' },
  main: { flex: 1, minWidth: 0 }, navbar: { height: 70, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border,
    paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  pageTitle: { color: palette.ink, fontSize: 19, fontWeight: '800', flexShrink: 1 }, navbarActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 1 },
  businessButton: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 240, minHeight: 44 }, businessName: { color: palette.secondary, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minHeight: 0, minWidth: 0 },
});
