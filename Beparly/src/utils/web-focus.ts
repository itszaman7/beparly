import { Platform } from 'react-native';

/** Release focus before Expo Router hides the outgoing web screen. */
export function blurWebFocus() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  (document.activeElement as HTMLElement | null)?.blur();
}
