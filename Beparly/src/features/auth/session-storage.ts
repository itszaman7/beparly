import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const tokenKey = 'beparly.auth.token';
const businessKey = 'beparly.auth.business';

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const sessionStorage = {
  token: () => read(tokenKey),
  saveToken: (token: string) => write(tokenKey, token),
  businessId: async () => {
    const value = await read(businessKey);
    const id = Number(value);
    return value && Number.isSafeInteger(id) && id > 0 ? id : null;
  },
  saveBusinessId: (id: number) => write(businessKey, String(id)),
  clear: async () => {
    await Promise.all([remove(tokenKey), remove(businessKey)]);
  },
};
