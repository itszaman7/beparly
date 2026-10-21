import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { toast } from 'tamagui/toast';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';
import { validDecimal } from '@/features/products/product-rules';
import { StockUnitPicker, TrackingPicker } from '@/features/products/product-options';
import type { Product, StockLocation, VariantInput } from '@/services/api';

export type AttributeDraft = { name: string };
export type SimpleAttribute = { name: string; value: string };
export type VariantDraft = { id: string; selections: Record<string, string>; sku: string; barcode: string;
  buying: string; selling: string; wholesale: string; unit: string; minimum: string;
  tracking: Product['tracking_mode']; opening: string; lot: string; expiry: string; locationId: number | null };

const newId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});
export const newVariantDraft = (): VariantDraft => ({ id: newId(), selections: {}, sku: '', barcode: '', buying: '', selling: '',
  wholesale: '', unit: 'Piece', minimum: '0', tracking: 'simple', opening: '', lot: '', expiry: '', locationId: null });

const combination = (attributes: AttributeDraft[], draft: VariantDraft) =>
  JSON.stringify(attributes.map(({ name }) => draft.selections[name]?.trim().toLocaleLowerCase() ?? ''));

export function validateVariantDrafts(attributes: AttributeDraft[], drafts: VariantDraft[], defaultLocationId: number | null) {
  if (!attributes.length) return 'Add at least one attribute, such as Color.';
  if (!drafts.length) return 'Add at least one variant.';
  const skus = new Set<string>(); const combinations = new Set<string>();
  for (const draft of drafts) {
    if (attributes.some(({ name }) => !draft.selections[name]?.trim())) return 'Enter a value for every variant attribute.';
    const selected = combination(attributes, draft);
    if (combinations.has(selected)) return 'Each variant needs different attribute values.';
    combinations.add(selected);
    const sku = draft.sku.trim().toLocaleLowerCase();
    if (sku && skus.has(sku)) return 'Give each variant a different SKU.';
    if (sku) skus.add(sku);
    if (!draft.unit.trim() || !draft.buying.trim() || !draft.selling.trim() ||
      !validDecimal(draft.buying, 2) || !validDecimal(draft.selling, 2) ||
      !validDecimal(draft.wholesale, 2, true) || !validDecimal(draft.minimum, 3) ||
      !validDecimal(draft.opening, 3, true)) return 'Enter a unit and valid buying and selling prices for every variant.';
    if (Number(draft.opening) > 0 && !(draft.locationId ?? defaultLocationId)) return 'Choose a stock location for opening stock.';
    if (Number(draft.opening) > 0 && draft.tracking !== 'simple' &&
      (!draft.lot.trim() || draft.tracking === 'expiry' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry)))
      return 'Enter the opening batch and expiry date when required.';
  }
  return null;
}

export function variantAttributes(attributes: AttributeDraft[], drafts: VariantDraft[]) {
  return attributes.map(({ name }) => ({ name, values: [...new Map(drafts.map((draft) => draft.selections[name]?.trim())
    .filter((value): value is string => !!value).map((value) => [value.toLocaleLowerCase(), value])).values()] }));
}

export function variantInputs(drafts: VariantDraft[], defaultLocationId: number | null): VariantInput[] {
  return drafts.map((draft) => ({ id: draft.id,
    selections: Object.fromEntries(Object.entries(draft.selections).map(([name, value]) => [name, value.trim()])),
    sku: draft.sku.trim(), barcode: draft.barcode.trim(), base_unit: draft.unit.trim(),
    purchase_price: draft.buying.trim(), retail_price: draft.selling.trim(), wholesale_price: draft.wholesale.trim() || null,
    minimum_stock: draft.minimum.trim(), tracking_mode: draft.tracking,
    ...(Number(draft.opening) > 0 ? { opening_stock: { quantity: draft.opening, unit_cost: draft.buying.trim(),
      location_id: (draft.locationId ?? defaultLocationId)!,
      ...(draft.tracking !== 'simple' ? { lot_code: draft.lot.trim() } : {}),
      ...(draft.tracking === 'expiry' ? { expires_on: draft.expiry } : {}) } } : {}) }));
}

function EditorModal({ title, visible, onClose, onSave, children }: { title: string; visible: boolean; onClose: () => void; onSave: () => void; children: ReactNode }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}><Text style={styles.heading}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}><AppSymbol name="close" size={22} color={palette.secondary} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>{children}</ScrollView>
        <Pressable accessibilityRole="button" onPress={onSave} style={styles.saveButton}><Text style={styles.saveText}>Done</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Field({ label, value, onChange, placeholder, numeric = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder}
    keyboardType={numeric ? 'decimal-pad' : 'default'} placeholderTextColor={palette.muted} style={styles.input} /></View>;
}
function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.addButton}>
    <AppSymbol name="plus" size={19} color={palette.primaryDeep} /><Text style={styles.addText}>{label}</Text>
  </Pressable>;
}

export function SimpleAttributes({ items, onChange }: { items: SimpleAttribute[]; onChange: (items: SimpleAttribute[]) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [value, setValue] = useState('');
  const save = () => {
    const label = name.trim(); const detail = value.trim();
    if (!label || !detail || items.some((item) => item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      toast.error('Enter a unique attribute name and its value.'); return;
    }
    onChange([...items, { name: label, value: detail }]); setName(''); setValue(''); setOpen(false);
  };
  return <View style={styles.section}>
    <View style={styles.sectionHeader}><AppSymbol name="category" size={20} color={palette.primary} /><Text style={styles.heading}>Attributes</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="About product attributes" onPress={() => toast.info('Optional details such as Color: Red or Material: Cotton.')} style={styles.iconButton}><AppSymbol name="info" size={19} color={palette.secondary} /></Pressable></View>
    {items.map((item) => <View key={item.name} style={styles.summary}><Text style={styles.summaryText}>{item.name}: {item.value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => onChange(items.filter((entry) => entry.name !== item.name))}><AppSymbol name="close" size={18} color={palette.secondary} /></Pressable></View>)}
    <AddButton label="Add attribute" onPress={() => setOpen(true)} />
    <EditorModal title="Add attribute" visible={open} onClose={() => setOpen(false)} onSave={save}>
      <Field label="Attribute name *" value={name} onChange={setName} placeholder="Color" />
      <Field label="Value *" value={value} onChange={setValue} placeholder="Red" />
    </EditorModal>
  </View>;
}

export function VariantFields({ attributes, setAttributes, drafts, setDrafts, locations, defaultLocationId }:
  { attributes: AttributeDraft[]; setAttributes: (value: AttributeDraft[]) => void;
    drafts: VariantDraft[]; setDrafts: (value: VariantDraft[]) => void;
    locations: StockLocation[]; defaultLocationId: number | null }) {
  const [attributeOpen, setAttributeOpen] = useState(false); const [attributeName, setAttributeName] = useState('');
  const [draft, setDraft] = useState<VariantDraft | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const edit = (values: Partial<VariantDraft>) => setDraft((current) => current ? { ...current, ...values } : null);
  const addAttribute = () => {
    const name = attributeName.trim();
    if (!name || attributes.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      toast.error('Enter a unique attribute name.'); return;
    }
    setAttributes([...attributes, { name }]); setAttributeName(''); setAttributeOpen(false);
  };
  const saveDraft = () => {
    if (!draft) return;
    const problem = validateVariantDrafts(attributes, [draft], defaultLocationId);
    if (problem) { toast.error(problem); return; }
    const existing = drafts.filter((item) => item.id !== draft.id);
    if (existing.some((item) => combination(attributes, item) === combination(attributes, draft))) {
      toast.error('Each variant needs different attribute values.'); return;
    }
    if (draft.sku.trim() && existing.some((item) => item.sku.trim().toLocaleLowerCase() === draft.sku.trim().toLocaleLowerCase())) {
      toast.error('Give each variant a different SKU.'); return;
    }
    if (draft.barcode.trim() && existing.some((item) => item.barcode.trim().toLocaleLowerCase() === draft.barcode.trim().toLocaleLowerCase())) {
      toast.error('Give each variant a different barcode.'); return;
    }
    const next = [...existing, draft];
    setDrafts(next); setDraft(null);
  };
  return <View style={styles.section}>
    <View style={styles.sectionHeader}><AppSymbol name="products" size={20} color={palette.primary} /><Text style={styles.heading}>Variants</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="About variants" onPress={() => toast.info('Add an attribute such as Color. Give each variant its own value, SKU and prices.')} style={styles.iconButton}><AppSymbol name="info" size={19} color={palette.secondary} /></Pressable></View>
    {attributes.map(({ name }) => <View key={name} style={styles.summary}><Text style={styles.summaryText}>{name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name} attribute`} onPress={() => {
        setAttributes(attributes.filter((item) => item.name !== name));
        setDrafts(drafts.map((item) => { const selections = { ...item.selections }; delete selections[name]; return { ...item, selections }; }));
      }}><AppSymbol name="close" size={18} color={palette.secondary} /></Pressable></View>)}
    <AddButton label="Add attribute" onPress={() => setAttributeOpen(true)} />
    {drafts.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => { setMoreOpen(false); setDraft({ ...item, selections: { ...item.selections } }); }} style={styles.variantSummary}>
      <View style={{ flex: 1 }}><Text style={styles.summaryTitle}>{attributes.map(({ name }) => item.selections[name]).filter(Boolean).join(' / ') || 'Variant'}</Text>
        <Text style={styles.summaryText}>SKU {item.sku || 'Auto'} · Buying ৳{item.buying} · Selling ৳{item.selling}</Text></View>
      <AppSymbol name="edit" size={19} color={palette.primary} />
    </Pressable>)}
    <AddButton label="Add variant" onPress={() => {
      if (!attributes.length) { toast.error('Add an attribute first.'); return; }
      setMoreOpen(false); setDraft(newVariantDraft());
    }} />
    <EditorModal title="Add attribute" visible={attributeOpen} onClose={() => setAttributeOpen(false)} onSave={addAttribute}>
      <Text style={styles.help}>Name what makes variants different. Enter the value when adding each variant.</Text>
      <Field label="Attribute name *" value={attributeName} onChange={setAttributeName} placeholder="Color" />
    </EditorModal>
    <EditorModal title="Variant details" visible={!!draft} onClose={() => setDraft(null)} onSave={saveDraft}>
      <View style={styles.subheading}><AppSymbol name="category" size={19} color={palette.primary} /><Text style={styles.subheadingText}>Attribute values</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="About variant attributes" onPress={() => toast.info('Enter the value that identifies this variant, such as Red for Color.')} style={styles.iconButton}><AppSymbol name="info" size={18} color={palette.secondary} /></Pressable></View>
      {attributes.map(({ name }) => <Field key={name} label={`${name} *`} value={draft?.selections[name] ?? ''}
        onChange={(value) => edit({ selections: { ...draft?.selections, [name]: value } })} placeholder={`Enter ${name.toLocaleLowerCase()}`} />)}
      <View style={styles.subheading}><AppSymbol name="price" size={19} color={palette.primary} /><Text style={styles.subheadingText}>Prices</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="About variant prices" onPress={() => toast.info('Each variant has its own buying and selling price in BDT.')} style={styles.iconButton}><AppSymbol name="info" size={18} color={palette.secondary} /></Pressable></View>
      <Field label="Buying price (৳) *" value={draft?.buying ?? ''} onChange={(buying) => edit({ buying })} numeric />
      <Field label="Selling price (৳) *" value={draft?.selling ?? ''} onChange={(selling) => edit({ selling })} numeric />
      <View style={styles.subheading}><AppSymbol name="stock" size={19} color={palette.primary} /><Text style={styles.subheadingText}>Stock</Text></View>
      <StockUnitPicker value={draft?.unit ?? 'Piece'} onChange={(unit) => edit({ unit })} inline />
      <TrackingPicker value={draft?.tracking ?? 'simple'} onChange={(tracking) => edit({ tracking })} />
      <Field label="Opening stock (optional)" value={draft?.opening ?? ''} onChange={(opening) => edit({ opening })} numeric />
      {Number(draft?.opening) > 0 && <><Text style={styles.label}>Stock location *</Text><View style={styles.choices}>{locations.map((location) =>
        <Pressable key={location.id} accessibilityRole="button" accessibilityState={{ selected: (draft?.locationId ?? defaultLocationId) === location.id }}
          onPress={() => edit({ locationId: location.id })} style={[styles.choice, (draft?.locationId ?? defaultLocationId) === location.id && styles.selected]}><Text style={styles.choiceText}>{location.name}</Text></Pressable>)}</View></>}
      {Number(draft?.opening) > 0 && draft?.tracking !== 'simple' && <Field label="Opening batch identifier *" value={draft?.lot ?? ''} onChange={(lot) => edit({ lot })} />}
      {Number(draft?.opening) > 0 && draft?.tracking === 'expiry' && <Field label="Expiry date YYYY-MM-DD *" value={draft?.expiry ?? ''} onChange={(expiry) => edit({ expiry })} />}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen(!moreOpen)} style={styles.moreButton}>
        <AppSymbol name="category" size={20} color={palette.primary} /><Text style={styles.moreText}>More options</Text>
        <AppSymbol name={moreOpen ? 'up' : 'down'} size={20} color={palette.primary} />
      </Pressable>
      {moreOpen && <>
        <Field label="SKU (auto if blank)" value={draft?.sku ?? ''} onChange={(sku) => edit({ sku })} />
        <Field label="Barcode (auto if blank)" value={draft?.barcode ?? ''} onChange={(barcode) => edit({ barcode })} />
        <Field label="Wholesale price (৳)" value={draft?.wholesale ?? ''} onChange={(wholesale) => edit({ wholesale })} numeric />
        <Field label="Minimum stock alert" value={draft?.minimum ?? ''} onChange={(minimum) => edit({ minimum })} numeric />
      </>}
      {drafts.some((item) => item.id === draft?.id) && <Pressable accessibilityRole="button" onPress={() => {
        setDrafts(drafts.filter((item) => item.id !== draft?.id)); setDraft(null);
      }} style={styles.removeButton}><Text style={styles.removeText}>Remove variant</Text></Pressable>}
    </EditorModal>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, heading: { flex: 1, color: palette.ink, fontSize: 17, fontWeight: '700' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  help: { color: palette.secondary, fontSize: 13, lineHeight: 20 },
  summary: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: palette.primarySoft },
  summaryText: { flex: 1, color: palette.secondary, fontSize: 13 }, summaryTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  variantSummary: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  addButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: palette.primary, borderRadius: radius.sm },
  addText: { color: palette.primaryDeep, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(21,33,31,0.45)' },
  modalCard: { width: '100%', maxWidth: 520, maxHeight: '90%', alignSelf: 'center', padding: spacing.lg, borderRadius: radius.md, backgroundColor: palette.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 }, modalBody: { gap: 12, paddingBottom: 20 },
  saveButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: palette.primary },
  saveText: { color: '#fff', fontWeight: '700' }, field: { gap: 5 }, label: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, color: palette.ink, paddingHorizontal: 12 },
  subheading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 }, subheadingText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, choiceText: { color: palette.ink },
  removeButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' }, removeText: { color: palette.rose, fontWeight: '700' },
  moreButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: palette.border },
  moreText: { flex: 1, color: palette.primaryDeep, fontWeight: '700' },
});
