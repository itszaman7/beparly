import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Android resize changes the available height; this state controls fixed chrome only. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Platform.OS !== 'web' && Keyboard.isVisible());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return visible;
}
