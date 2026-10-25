import type { AppSymbolName } from '@/components/app-symbol';

export type ReportGroup = 'Business' | 'Inventory' | 'Accounting';
export type ReportItem = { name: string; title: string; subtitle: string; icon: AppSymbolName; group: ReportGroup };

export const reportItems: ReportItem[] = [
  { name: 'sales-summary', title: 'Sales Summary', subtitle: 'Posted sales and returns', icon: 'sale', group: 'Business' },
  { name: 'daily-sales', title: 'Daily Sales', subtitle: 'Sales by posting day', icon: 'day', group: 'Business' },
  { name: 'money-received', title: 'Money Received', subtitle: 'Collections and receipts', icon: 'receive', group: 'Business' },
  { name: 'expenses', title: 'Expenses', subtitle: 'Operating costs', icon: 'expense', group: 'Business' },
  { name: 'purchase-summary', title: 'Purchase Summary', subtitle: 'Posted purchases', icon: 'purchase', group: 'Business' },
  { name: 'customer-dues', title: 'Customer Dues', subtitle: 'বাকি and overdue amounts', icon: 'dues', group: 'Business' },
  { name: 'supplier-dues', title: 'Supplier Dues', subtitle: 'Amounts to pay', icon: 'parties', group: 'Business' },
  { name: 'stock-sold', title: 'Stock Sold', subtitle: 'Base units and recorded cost', icon: 'sale', group: 'Inventory' },
  { name: 'best-sellers', title: 'Best Sellers', subtitle: 'Products and variants', icon: 'reports', group: 'Inventory' },
  { name: 'current-stock', title: 'Current Stock', subtitle: 'Quantity on hand', icon: 'stock', group: 'Inventory' },
  { name: 'stock-valuation', title: 'Stock Valuation', subtitle: 'Current FIFO cost', icon: 'money', group: 'Inventory' },
  { name: 'wastage-loss', title: 'Wastage & Loss', subtitle: 'Recorded waste and adjustments', icon: 'waste', group: 'Inventory' },
  { name: 'expiry', title: 'Expiry', subtitle: 'Expired stock awaiting disposal', icon: 'warning', group: 'Inventory' },
  { name: 'stock-movements', title: 'Stock Movements', subtitle: 'Receipts, sales and transfers', icon: 'movements', group: 'Inventory' },
  { name: 'profit-loss', title: 'Profit & Loss', subtitle: 'Income, costs and net profit', icon: 'reports', group: 'Accounting' },
  { name: 'balance-sheet', title: 'Balance Sheet', subtitle: 'Assets, liabilities and equity', icon: 'money', group: 'Accounting' },
  { name: 'trial-balance', title: 'Trial Balance', subtitle: 'Debit and credit totals', icon: 'default', group: 'Accounting' },
  { name: 'general-ledger', title: 'General Ledger', subtitle: 'Account entries and balances', icon: 'movements', group: 'Accounting' },
];

export const reportGroups: ReportGroup[] = ['Business', 'Inventory', 'Accounting'];
