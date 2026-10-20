import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from './auth-context';
import { AppText as Text } from '@/components/app-text';
import { appFontFamily } from '@/constants/design-system';

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function Field({ label, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor="#9AA7A3"
        autoCorrect={false}
        {...inputProps}
      />
    </View>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const registering = mode === 'register';
  const { signIn, register } = useAuth();
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function changeMode(nextMode: 'login' | 'register') {
    if (nextMode === mode) return;
    router.replace(nextMode === 'login' ? '/sign-in' : '/register');
  }

  async function submit() {
    setError('');
    if (!phone.trim() || !password) {
      setError('Enter your phone number and password.');
      return;
    }
    setBusy(true);
    try {
      if (registering) {
        await register({ username: username.trim(), phone: phone.trim(), password });
      } else {
        await signIn(phone.trim(), password);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.logo}><Text style={styles.logoText}>ব</Text></View>
              <Text style={styles.title}>{registering ? 'Create account' : 'Login'}</Text>
              <Text style={styles.subtitle}>Your business, simply managed.</Text>
            </View>

            <View style={styles.switcher}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: !registering }}
                style={[styles.switchTab, !registering && styles.activeTab]}
                onPress={() => changeMode('login')}>
                <Text style={[styles.switchText, !registering && styles.activeTabText]}>Login</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: registering }}
                style={[styles.switchTab, registering && styles.activeTab]}
                onPress={() => changeMode('register')}>
                <Text style={[styles.switchText, registering && styles.activeTabText]}>Register</Text>
              </Pressable>
            </View>

            <View style={styles.form}>
              <Field
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                placeholder="01XXXXXXXXX"
                keyboardType="phone-pad"
                autoComplete="tel"
                maxLength={24}
              />
              {registering && <Field label="Username (optional)" value={username} onChangeText={setUsername} placeholder="How should we call you?" autoCapitalize="words" maxLength={150} />}
              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordBox}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password"
                    placeholderTextColor="#9AA7A3"
                    secureTextEntry={!showPassword}
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    onPress={() => setShowPassword((value) => !value)}
                    style={styles.showButton}>
                    <Text style={styles.showText}>{showPassword ? 'Hide' : 'Show'}</Text>
                  </Pressable>
                </View>
              </View>
              {registering && <Text style={styles.helper}>Use at least 8 characters and avoid common passwords.</Text>}
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                style={[styles.submit, busy && styles.disabled]}
                onPress={submit}
                disabled={busy}>
                {busy ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>{registering ? 'Create account' : 'Login'}</Text>}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const teal = '#00B8A9';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },
  content: { width: '100%', maxWidth: 420 },
  header: { alignItems: 'center', marginBottom: 36 },
  logo: { width: 50, height: 50, borderRadius: 13, backgroundColor: teal, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  logoText: { color: '#FFFFFF', fontSize: 29, fontWeight: '800' },
  title: { color: '#15211F', fontSize: 27, fontWeight: '700', marginBottom: 5 },
  subtitle: { color: '#788580', fontSize: 14, textAlign: 'center' },
  switcher: { flexDirection: 'row', backgroundColor: '#EDF2F1', borderRadius: 10, padding: 4, marginBottom: 24 },
  switchTab: { flex: 1, height: 42, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: teal },
  switchText: { color: '#687673', fontSize: 15, fontWeight: '500' },
  activeTabText: { color: '#FFFFFF', fontWeight: '700' },
  form: { gap: 17 },
  field: { gap: 8 },
  label: { color: '#35433F', fontSize: 13, fontWeight: '600' },
  input: { height: 54, borderWidth: 1, borderColor: '#DDE6E3', borderRadius: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 15, color: '#15211F', fontSize: 15, fontFamily: appFontFamily },
  passwordBox: { height: 54, borderWidth: 1, borderColor: '#DDE6E3', borderRadius: 10, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, height: '100%', paddingLeft: 15, color: '#15211F', fontSize: 15, fontFamily: appFontFamily },
  showButton: { paddingHorizontal: 14, paddingVertical: 12 },
  showText: { color: '#008E84', fontSize: 13, fontWeight: '600' },
  helper: { color: '#788580', fontSize: 12, lineHeight: 18 },
  error: { color: '#A62925', fontSize: 13, backgroundColor: '#FCEBE9', padding: 12, borderRadius: 9 },
  submit: { height: 52, borderRadius: 9, backgroundColor: teal, alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  disabled: { opacity: 0.65 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
