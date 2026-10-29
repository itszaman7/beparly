import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';

type IconProps = { size?: number; color: string };

function icon(name: AppSymbolName) {
  return function SalesIcon({ size, color }: IconProps) {
    return <AppSymbol name={name} size={size} color={color} />;
  };
}

export const Barcode = icon('barcode');
export const Camera = icon('camera');
export const ChevronDown = icon('down');
export const ChevronLeft = icon('back');
export const Eye = icon('view');
export const FileText = icon('receipt');
export const Funnel = icon('filter');
export const MoreHorizontal = icon('more');
export const Plus = icon('plus');
export const Printer = icon('print');
export const RotateCcw = icon('return');
export const Search = icon('search');
export const Share2 = icon('share');
export const X = icon('close');
export const CheckSquare2 = icon('selectAll');
export const ListChecks = icon('listSelect');
export const Pencil = icon('edit');
export const StickyNote = icon('note');
