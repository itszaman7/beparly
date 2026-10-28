import { router, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CheckSquare2, FileText, ListChecks, Pencil, Printer, RotateCcw, StickyNote, X } from 'lucide-react-native';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/services/api';

type Kind = 'sale' | 'purchase';
type Row = { id: string; status: string; number?: string; invoice_number?: string };
const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
  const n = Math.floor(Math.random() * 16);
  return (char === 'x' ? n : (n & 3) | 8).toString(16);
});

export function useRecordSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const clear = useCallback(() => { setSelected([]); setSelecting(false); setLimitReached(false); }, []);
  const clearSelected = () => { setSelected([]); setLimitReached(false); };
  const selectAll = (ids: string[]) => {
    setSelecting(true);
    const merged = [...new Set([...selected, ...ids])];
    setLimitReached(merged.length > 25);
    setSelected(merged.slice(0, 25));
  };
  const toggle = (id: string) => {
    setSelecting(true);
    if (selected.includes(id)) { setLimitReached(false); setSelected(current => current.filter(value => value !== id)); }
    else if (selected.length >= 25) setLimitReached(true);
    else setSelected(current => [...current, id]);
  };
  const longPress = (id: string) => toggle(id);
  const press = (id: string, open: () => void) => {
    if (selecting) toggle(id); else open();
  };
  return { selected, selecting, limitReached, clear, clearSelected, selectAll, toggle, longPress, press, start: () => setSelecting(true) };
}

export function SelectionToolbar({ type, rows, selected, selecting, limitReached, clear, clearSelected, selectAll, visibleIds, start, onChanged }: {
  type: Kind; rows: Row[]; selected: string[]; selecting: boolean; limitReached: boolean; clear: () => void;
  clearSelected?: () => void; selectAll?: (ids: string[]) => void; visibleIds?: string[];
  start: () => void; onChanged: () => void;
}) {
  const { session } = useAuth();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const noteCommand = useRef(commandId());
  const picked = selected.map(id => rows.find(row => row.id === id)).filter((row): row is Row => !!row);
  const one = picked.length === 1 ? picked[0] : null;
  const recordName = (row: Row) => row.invoice_number || row.number || row.id;

  function print(kind: 'invoice' | 'label' | 'summary') {
    const invalid = picked.find(row => row.status !== 'completed');
    if (invalid) { setIssue(`${recordName(invalid)} is ${invalid.status}; only completed records can be printed.`); return; }
    if (!selected.length || selected.length > 25) { setIssue('Choose between 1 and 25 records.'); return; }
    setActionsOpen(false); setIssue('');
    const path = `/sales/${selected[0]}/document?kind=${kind}&batch=${encodeURIComponent(selected.join(','))}&entity=${type}`;
    router.push(path as Href);
  }

  async function addNote() {
    if (!session?.account || !note.trim() || busy) return;
    setBusy(true); setIssue('');
    try {
      if (type === 'sale') await api.addSaleNotes(session.token, session.account.business.id, selected, note.trim(), noteCommand.current);
      else await api.addPurchaseNotes(session.token, session.account.business.id, selected, note.trim(), noteCommand.current);
      noteCommand.current = commandId(); setNote(''); setNoteOpen(false); clear(); onChanged();
    } catch (problem) { setIssue(problem instanceof Error ? problem.message : 'Could not add note.'); }
    finally { setBusy(false); }
  }

  function go(path: string) { setActionsOpen(false); clear(); router.push(path as Href); }

  return <View style={styles.shell}>
    <View style={styles.row}>
      {type === 'sale' && selecting ? <>
        <Text style={styles.count}>{selected.length} selected</Text>
        {selectAll && visibleIds?.length ? <Pressable accessibilityRole="button" accessibilityLabel="Select all sales on this page" onPress={() => selectAll(visibleIds)} style={styles.textButton}><CheckSquare2 size={16} color="#006D64" /><Text style={styles.link}>Select all on page</Text></Pressable> : null}
        {selected.length ? <Pressable accessibilityRole="button" accessibilityLabel="Clear selected sales" onPress={clearSelected ?? clear} style={styles.textButton}><X size={16} color="#006D64" /><Text style={styles.link}>Clear</Text></Pressable> : null}
        {selected.length ? <Pressable accessibilityRole="button" accessibilityLabel="Actions for selected records" onPress={() => { setIssue(''); setActionsOpen(true); }} style={styles.round}><Text style={styles.roundText}>Actions</Text></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Done selecting" onPress={clear} style={styles.textButton}><Text style={styles.link}>Done</Text></Pressable>
      </> : type === 'sale' ? <Pressable accessibilityRole="button" accessibilityLabel="Select sales" onPress={start} style={styles.textButton}><ListChecks size={18} color="#006D64" /><Text style={styles.link}>Select sales</Text></Pressable>
        : selected.length ? <><Text style={styles.count}>{selected.length} selected</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Clear selection" onPress={clear} style={styles.textButton}><Text style={styles.link}>Clear</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Actions for selected records" onPress={() => { setIssue(''); setActionsOpen(true); }} style={styles.round}><Text style={styles.roundText}>Actions</Text></Pressable></>
          : <Pressable accessibilityRole="button" accessibilityLabel={selecting ? 'Stop selecting records' : 'Select records'} onPress={selecting ? clear : start} style={styles.textButton}><Text style={styles.link}>{selecting ? 'Done selecting' : 'Select'}</Text></Pressable>}
    </View>
    {limitReached && <Text style={styles.error}>You can select up to 25 records at once.</Text>}
    {!!issue && !actionsOpen && !noteOpen && <Text style={styles.error}>{issue}</Text>}
    <Modal visible={actionsOpen} transparent animationType="fade" onRequestClose={() => setActionsOpen(false)}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <Text style={styles.title}>{selected.length} selected · Actions</Text>
        {one && type === 'sale' && <Action icon={FileText} label="View sale" onPress={() => go(`/sales/${one.id}/details`)} />}
        {type === 'sale' ? <><Action icon={Printer} label="Print invoices" onPress={() => print('invoice')} /><Action icon={Printer} label="Print labels" onPress={() => print('label')} /></>
          : <Action icon={Printer} label="Print internal purchase summaries" onPress={() => print('summary')} />}
        <Action icon={StickyNote} label="Add note" onPress={() => { setIssue(''); setActionsOpen(false); setNoteOpen(true); }} />
        {one && type === 'sale' && one.status === 'completed' && <Action icon={RotateCcw} label="Return / Refund" onPress={() => go(`/sales/${one.id}/return`)} />}
        {one && type === 'sale' && one.status === 'draft' && session?.account?.role === 'owner' && <Action icon={X} label="Cancel draft" onPress={() => go(`/sales/${one.id}/details?action=cancel`)} />}
        {one && type === 'purchase' && one.status === 'draft' && <Action icon={Pencil} label="Edit draft" onPress={() => go(`/purchases/${one.id}/edit`)} />}
        {one && type === 'purchase' && one.status !== 'cancelled' && <Action icon={X} label="Cancel purchase" onPress={() => go(`/purchases/${one.id}?action=cancel`)} />}
        {!!issue && <Text style={styles.error}>{issue}</Text>}
        <Action icon={X} label="Close" onPress={() => setActionsOpen(false)} />
      </View></View>
    </Modal>
    <Modal visible={noteOpen} transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={styles.noteSheet} contentContainerStyle={styles.noteContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>Add note to {selected.length} {selected.length === 1 ? 'record' : 'records'}</Text>
        <Text style={styles.hint}>The note is dated and attributed. Original document notes stay unchanged.</Text>
        <TextInput accessibilityLabel="Note text" multiline maxLength={2000} value={note}
          onChangeText={value => { setNote(value); noteCommand.current = commandId(); setIssue(''); }} style={styles.input} placeholder="Write a note" />
        {!!issue && <Text style={styles.error}>{issue}</Text>}
        <Action label={busy ? 'Saving…' : 'Add note'} onPress={() => void addNote()} disabled={busy || !note.trim()} />
        <Action label="Close" onPress={() => setNoteOpen(false)} />
      </ScrollView></KeyboardAvoidingView>
    </Modal>
  </View>;
}

function Action({ label, onPress, disabled, icon: Icon }: { label: string; onPress: () => void; disabled?: boolean; icon?: typeof Printer }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.action, disabled && { opacity: 0.5 }]}>{Icon ? <Icon size={18} color="#006D64" /> : null}<Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({ shell: { gap: 5 }, row: { minHeight: 42, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }, count: { flex: 1, minWidth: 90, fontWeight: '800', color: '#15211F' }, textButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 5 }, link: { color: '#006D64', fontSize: 12, fontWeight: '800' }, round: { minWidth: 74, minHeight: 44, borderRadius: 22, backgroundColor: '#006D64', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, roundText: { color: 'white', fontSize: 11, fontWeight: '800' }, backdrop: { flex: 1, backgroundColor: 'rgba(15,25,22,.45)', justifyContent: 'flex-end' }, sheet: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 20, paddingBottom: 30, gap: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'white' }, noteSheet: { width: '100%', maxWidth: 620, maxHeight: '85%', alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'white' }, noteContent: { padding: 20, paddingBottom: 30, gap: 10 }, title: { color: '#15211F', fontSize: 18, fontWeight: '800' }, hint: { color: '#52635E', fontSize: 12 }, action: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: '#DDF3EF', paddingHorizontal: 14 }, actionText: { color: '#006D64', fontWeight: '800' }, input: { minHeight: 90, borderWidth: 1, borderColor: '#CED9D5', borderRadius: 12, padding: 12, textAlignVertical: 'top' }, error: { color: '#B42318', fontSize: 12 } });
