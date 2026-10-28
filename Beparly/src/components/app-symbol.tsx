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
  money: { ios: 'creditcard.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' },
  expense: { ios: 'doc.text.fill', android: 'receipt_long', web: 'receipt_long' },
  parties: { ios: 'person.2.fill', android: 'groups', web: 'groups' },
  dues: { ios: 'clock.fill', android: 'schedule', web: 'schedule' },
  reports: { ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' },
  day: { ios: 'sun.max.fill', android: 'today', web: 'today' },
  month: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  dateRange: { ios: 'calendar.badge.clock', android: 'date_range', web: 'date_range' },
  down: { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  up: { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' },
  back: { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' },
  arrow: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  receipt: { ios: 'doc.text.fill', android: 'receipt_long', web: 'receipt_long' },
  attachFile: { ios: 'paperclip', android: 'attach_file', web: 'attach_file' },
  gallery: { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' },
  camera: { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  movements: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  adjustment: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  sort: { ios: 'arrow.up.arrow.down', android: 'sort', web: 'sort' },
  waste: { ios: 'trash', android: 'delete_outline', web: 'delete_outline' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  duplicate: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' },
  default: { ios: 'star.fill', android: 'star', web: 'star' },
  activate: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  deactivate: { ios: 'power', android: 'power_settings_new', web: 'power_settings_new' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  category: { ios: 'tag', android: 'category', web: 'category' },
  price: { ios: 'tag.fill', android: 'sell', web: 'sell' },
  percent: { ios: 'percent', android: 'percent', web: 'percent' },
  package: { ios: 'shippingbox', android: 'package_2', web: 'package_2' },
  batch: { ios: 'square.stack', android: 'layers', web: 'layers' },
  barcode: { ios: 'barcode.viewfinder', android: 'barcode_scanner', web: 'qr_code_scanner' },
  location: { ios: 'mappin', android: 'location_on', web: 'location_on' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning_amber', web: 'warning_amber' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
} as const satisfies Record<string, SymbolName>;

export type AppSymbolName = keyof typeof symbols;

export function AppSymbol({ name, size = 24, color }: { name: AppSymbolName; size?: number; color: string }) {
  return <SymbolView name={symbols[name]} size={size} tintColor={color} />;
}
