import { Platform } from 'react-native';

/** Release a pressed button before Expo Router hides its previous web screen. */
export function releaseWebFocus() {
  if (Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
