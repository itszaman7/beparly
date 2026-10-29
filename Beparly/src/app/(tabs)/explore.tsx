import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, XStack, YStack } from 'tamagui';

import { useAuth } from '@/features/auth/auth-context';
import { ProfileCard } from '@/features/auth/profile-card';
import { api, Employee } from '@/services/api';

const green = '#00B8A9';
const ink = '#15211F';
const muted = '#788580';

export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savingPermissionFor, setSavingPermissionFor] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setEmployees([]);
      if (!session?.account || session.account.role !== 'owner') {
        setLoading(false);
        return;
      }
      setLoading(true);
      void api.employees(session.token, session.account.business.id)
        .then((result) => {
          if (!active) return;
          setEmployees(result.employees);
          setError('');
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : 'Could not load employees.');
        })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timeout); };
  }, [session, refreshCount]);

  if (!session) return null;
  const { account, token } = session;

  if (!account) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F8F7' }}>
      <YStack padding={22} gap={18}>
        <Text color={ink} fontSize={25} fontWeight="700">Account</Text>
        <ProfileCard />
        <Text color={muted} fontSize={13}>Ask your administrator to assign you to a business.</Text>
        {!!error && <Text color="#A62925" fontSize={13}>{error}</Text>}
        <Button backgroundColor="#E5F8F4" onPress={() => router.push('/')}><Text color={green} fontWeight="600">Go to Home</Text></Button>
        <Button backgroundColor="white" onPress={logout} disabled={busy}><Text color="#A62925" fontWeight="600">Sign out</Text></Button>
      </YStack>
    </SafeAreaView>
  );

  async function logout() {
    setBusy(true);
    setError('');
    try { await signOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  }

  async function setLocationPermission(employee: Employee, enabled: boolean) {
    if (!account) return;
    setSavingPermissionFor(employee.id);
    setError('');
    try {
      const result = await api.setLocationPermission(token, account.business.id, employee.id, enabled);
      setEmployees((current) => current.map((item) => item.id === employee.id ? result.employee : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update location access.');
    } finally {
      setSavingPermissionFor(null);
    }
  }

  async function setStockPermission(employee: Employee, enabled: boolean) {
    if (!account) return;
    setSavingPermissionFor(employee.id);
    setError('');
    try {
      const result = await api.setStockPermission(token, account.business.id, employee.id, enabled);
      setEmployees((current) => current.map((item) => item.id === employee.id ? result.employee : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update stock access.');
    } finally {
      setSavingPermissionFor(null);
    }
  }

  async function setPurchasePermission(employee: Employee, enabled: boolean) {
    if (!account) return;
    setSavingPermissionFor(employee.id);
    setError('');
    try {
      const result = await api.setPurchasePermission(token, account.business.id, employee.id, enabled);
      setEmployees(current => current.map(item => item.id === employee.id ? result.employee : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update purchase access.');
    } finally { setSavingPermissionFor(null); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAF9' }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignItems: 'center', paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRefreshCount((count) => count + 1)} />}>
        <YStack width="100%" maxWidth={600} paddingHorizontal={22} paddingTop={26} gap={22}>
          <YStack gap={3}>
            <Text color={ink} fontSize={28} fontWeight="700">Account & team</Text>
            <Text color={muted} fontSize={14}>Manage who can sign in to {account.business.name}.</Text>
          </YStack>

          <Button height={44} borderRadius={12} backgroundColor="#E0F3EA" onPress={() => router.push('/?businessPicker=1')}>
            <Text color={green} fontSize={14} fontWeight="700">Switch business profile</Text>
          </Button>

          <ProfileCard role={account.role === 'owner' ? 'Business owner' : 'Employee'} />

          {account.role === 'owner' && (
            <YStack gap={14}>
              <XStack alignItems="center" justifyContent="space-between">
                <YStack gap={2}>
                  <Text color={ink} fontSize={20} fontWeight="700">Employees</Text>
                  <Text color={muted} fontSize={13}>A separate sign-in for each person</Text>
                </YStack>
              </XStack>


              {loading ? <ActivityIndicator color={green} /> : employees.length === 0 ? (
                <YStack backgroundColor="white" borderRadius={18} padding={20} borderWidth={1} borderColor="#E2EAE4" gap={5}>
                  <Text color={ink} fontSize={15} fontWeight="700">No employees yet</Text>
                  <Text color={muted} fontSize={13}>Ask your administrator to add employees.</Text>
                </YStack>
              ) : employees.map((employee) => (
                <YStack key={employee.id} backgroundColor="white" borderRadius={16} borderWidth={1} borderColor="#E2EAE4" padding={16} gap={12}>
                  <XStack alignItems="center" gap={12}>
                    <YStack width={38} height={38} borderRadius={19} backgroundColor="#E0F3EA" alignItems="center" justifyContent="center">
                      <Text color={green} fontWeight="700">{(employee.name || employee.phone).charAt(0).toUpperCase()}</Text>
                    </YStack>
                    <YStack gap={2}>
                      <Text color={ink} fontSize={15} fontWeight="700">{employee.name || employee.phone}</Text>
                      {!!employee.name && <Text color={muted} fontSize={12}>{employee.phone}</Text>}
                    </YStack>
                  </XStack>
                  <XStack alignItems="center" justifyContent="space-between" paddingTop={10} borderTopWidth={1} borderTopColor="#EEF1EE">
                    <YStack flex={1} paddingRight={10}>
                      <Text color={ink} fontSize={13} fontWeight="600">Manage shops & warehouses</Text>
                      <Text color={muted} fontSize={12}>Add, edit or deactivate locations</Text>
                    </YStack>
                    <Switch
                      accessibilityLabel={`Allow ${employee.name || employee.phone} to manage locations`}
                      value={employee.can_manage_locations}
                      disabled={savingPermissionFor !== null}
                      onValueChange={(value) => void setLocationPermission(employee, value)}
                      trackColor={{ false: '#DCE5DF', true: '#8FD7C8' }}
                      thumbColor={employee.can_manage_locations ? green : '#FFFFFF'}
                    />
                  </XStack>
                  <XStack alignItems="center" justifyContent="space-between" paddingTop={10} borderTopWidth={1} borderTopColor="#EEF1EE">
                    <YStack flex={1} paddingRight={10}>
                      <Text color={ink} fontSize={13} fontWeight="600">Post stock changes</Text>
                      <Text color={muted} fontSize={12}>Transfer, adjust or record waste when available</Text>
                    </YStack>
                    <Switch
                      accessibilityLabel={`Allow ${employee.name || employee.phone} to post stock changes`}
                      value={employee.can_post_stock}
                      disabled={savingPermissionFor !== null}
                      onValueChange={(value) => void setStockPermission(employee, value)}
                      trackColor={{ false: '#DCE5DF', true: '#8FD7C8' }}
                      thumbColor={employee.can_post_stock ? green : '#FFFFFF'}
                    />
                  </XStack>
                  <XStack alignItems="center" justifyContent="space-between" paddingTop={10} borderTopWidth={1} borderTopColor="#EEF1EE">
                    <YStack flex={1} paddingRight={10}>
                      <Text color={ink} fontSize={13} fontWeight="600">Can manage purchases</Text>
                      <Text color={muted} fontSize={12}>Suppliers, purchases and supplier payments</Text>
                    </YStack>
                    <Switch accessibilityLabel={`Allow ${employee.name || employee.phone} to manage purchases`}
                      value={employee.can_manage_purchases} disabled={savingPermissionFor !== null}
                      onValueChange={value => void setPurchasePermission(employee, value)}
                      trackColor={{ false: '#DCE5DF', true: '#8FD7C8' }}
                      thumbColor={employee.can_manage_purchases ? green : '#FFFFFF'} />
                  </XStack>
                </YStack>
              ))}
            </YStack>
          )}

          {!!error && <YStack backgroundColor="#FCEBE9" borderRadius={12} padding={12}><Text color="#A62925" fontSize={13}>{error}</Text></YStack>}

          <Button height={48} borderRadius={14} backgroundColor="white" borderWidth={1} borderColor="#DCE5DF" onPress={logout} disabled={busy}>
            <Text color="#A62925" fontSize={15} fontWeight="700">Sign out</Text>
          </Button>
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
