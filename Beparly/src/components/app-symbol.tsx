import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

export const symbols = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  account: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  sale: { ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' },
  purchase: { ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' },
  products: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' },
  stock: { ios: 'square.stack.3d.up.fill', android: 'warehouse', web: 'warehouse' },
  receive: { ios: 'banknote.fill', android: 'payments', web: 'payments' },
  parties: { ios: 'person.2.fill', android: 'groups', web: 'groups' },
  dues: { ios: 'clock.fill', android: 'schedule', web: 'schedule' },
  reports: { ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' },
  down: { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  arrow: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  receipt: { ios: 'doc.text.fill', android: 'receipt_long', web: 'receipt_long' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  movements: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  adjustment: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  waste: { ios: 'trash', android: 'delete_outline', web: 'delete_outline' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  default: { ios: 'star.fill', android: 'star', web: 'star' },
  activate: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  deactivate: { ios: 'power', android: 'power_settings_new', web: 'power_settings_new' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
} as const satisfies Record<string, SymbolName>;

export function AppSymbol({ name, size = 24, color }: { name: keyof typeof symbols; size?: number; color: string }) {
  return <SymbolView name={symbols[name]} size={size} tintColor={color} />;
}
