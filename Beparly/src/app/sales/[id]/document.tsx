import { router, useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as Print from 'expo-print';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { shareLocalFile } from '@/features/documents/share-local-file';
import { api } from '@/services/api';

export default function SaleDocument() {
  const { session } = useAuth();
  const { id, kind, batch, entity } = useLocalSearchParams<{ id: string; kind?: string; batch?: string; entity?: string }>();
  const format = kind === 'summary' ? 'summary' : kind === 'receipt' ? 'receipt' : kind === 'label' ? 'label' : 'invoice';
  const batchIds = useMemo(() => batch?.split(',').filter(Boolean) ?? [], [batch]);
  const batchType = entity === 'purchase' ? 'purchase' : 'sale';
  const businessId = session?.account?.business.id;
  const [paper, setPaper] = useState<'A4' | 'A5' | '58mm' | '80mm'>(format === 'receipt' ? '80mm' : 'A4');
  const documentKey = `${businessId}:${id}:${format}:${paper}:${batch ?? ''}:${batchType}`;
  const [loaded, setLoaded] = useState({ key: '', uri: '' });
  const [issue, setIssue] = useState({ key: '', message: '' });
  const [busy, setBusy] = useState(false);
  const webBlob = useRef<Blob | null>(null);
  const source = loaded.key === documentKey ? loaded.uri : '';
  const error = issue.key === documentKey ? issue.message : '';

  useEffect(() => {
    if (!session || !businessId || batchIds.length || format === 'label' || format === 'summary') return;
    let active = true;
    void api.businessProfile(session.token, businessId).then(({ business }) => {
      if (active) setPaper(format === 'receipt' ? business.receipt_paper ?? '80mm' : business.invoice_paper ?? 'A4');
    }).catch(() => {});
    return () => { active = false; };
  }, [session, businessId, batchIds.length, format]);

  useEffect(() => {
    if (!session || !businessId || !id) return;
    let cancelled = false;
    let objectUrl = '';
    webBlob.current = null;
    const url = batchIds.length ? api.batchDocumentUrl(businessId, batchType, format === 'summary' ? 'summary' : format === 'label' ? 'label' : 'invoice', batchIds)
      : api.documentUrl(businessId, id, format === 'summary' ? 'invoice' : format, format === 'receipt' || format === 'invoice' ? paper : undefined);
    if (Platform.OS === 'web') {
      void fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
        .then(async (response) => {
          if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? 'Could not load document.'); }
          return response.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          webBlob.current = blob;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ key: documentKey, uri: objectUrl });
        })
        .catch((problem) => { if (!cancelled) setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not load document.' }); });
    } else {
      const file = new File(Paths.cache, `${id}-${format}-${Date.now()}.pdf`);
      void (batchIds.length ? expoFetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
        .then(async (response) => {
          if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? 'Could not load document.'); }
          await file.write(await response.bytes());
          return file;
        }) : File.downloadFileAsync(url, file, { headers: { Authorization: `Bearer ${session.token}` } }))
        .then((downloaded) => { if (!cancelled) setLoaded({ key: documentKey, uri: downloaded.uri }); })
        .catch((problem) => { if (!cancelled) setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not load document.' }); });
    }
    return () => {
      cancelled = true;
      webBlob.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, businessId, id, format, paper, documentKey, batchType, batchIds]);

  function downloadWeb() {
    if (!source) return;
    const link = document.createElement('a');
    link.href = source;
    link.download = `${format}-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function share() {
    if (!source || busy) return;
    setBusy(true);
    setIssue({ key: documentKey, message: '' });
    try {
      if (Platform.OS === 'web') {
        const blob = webBlob.current;
        if (!blob) throw new Error('PDF is still loading.');
        const file = new globalThis.File([blob], `${format}-${id}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file], title: `${format === 'invoice' ? 'Sales invoice' : format === 'receipt' ? 'POS receipt' : 'Sales label'} PDF` });
        } else {
          downloadWeb();
        }
      } else {
        await shareLocalFile(source, { mimeType: 'application/pdf', dialogTitle: `Share ${format} PDF` });
      }
    } catch (problem) {
      if (problem instanceof Error && problem.name !== 'AbortError') setIssue({ key: documentKey, message: problem.message || 'Could not share this PDF.' });
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    if (!source || busy) return;
    setIssue({ key: documentKey, message: '' });
    if (Platform.OS === 'web') {
      const pdfWindow = window.open(source, '_blank');
      if (!pdfWindow) setIssue({ key: documentKey, message: 'Allow pop-ups to open the PDF, then print it from the PDF viewer.' });
      return;
    }
    setBusy(true);
    try {
      await Print.printAsync({ uri: source });
    } catch (problem) {
      setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not print this PDF.' });
    } finally {
      setBusy(false);
    }
  }

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()}><Text style={styles.back}>‹</Text></Pressable>
      <View><Text style={styles.eyebrow}>{format === 'summary' ? 'INTERNAL PURCHASE SUMMARY' : format === 'invoice' ? 'SALES INVOICE' : format === 'receipt' ? 'POS RECEIPT' : 'SALES LABEL'}</Text><Text style={styles.title}>{batchIds.length ? `${batchIds.length} printable documents` : 'Printable document'}</Text></View>
    </View>
    {!batchIds.length && (format === 'invoice' || format === 'receipt') ? <View style={styles.actions}>
      {(format === 'invoice' ? ['A4', 'A5'] : ['58mm', '80mm']).map(value => <Pressable key={value} accessibilityRole="button"
        accessibilityState={{ selected: paper === value }} onPress={() => setPaper(value as typeof paper)}
        style={[styles.secondary, paper === value && { backgroundColor: '#AEE6D9' }]}><Text style={styles.secondaryText}>{value}</Text></Pressable>)}
    </View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {source ? Platform.OS === 'web'
      ? <View style={styles.preview}>{createElement('iframe', { title: 'Printable document', src: source, style: { width: '100%', height: '100%', border: 0 } })}</View>
      : <View style={styles.ready}><Text style={styles.readyTitle}>PDF ready</Text><Text style={styles.muted}>Share or print the finalized {format}.</Text></View>
      : !error ? <Text style={styles.muted}>Generating document…</Text> : null}
    {source ? <View style={styles.actions}>
      <Pressable style={styles.primary} disabled={busy} onPress={() => void share()}><Text style={styles.primaryText}>{Platform.OS === 'web' ? 'Share / download PDF' : 'Share PDF'}</Text></Pressable>
      {Platform.OS === 'web' ? <Pressable style={styles.secondary} onPress={downloadWeb}><Text style={styles.secondaryText}>Download</Text></Pressable> : null}
      <Pressable style={styles.secondary} disabled={busy} onPress={() => void print()}><Text style={styles.secondaryText}>{Platform.OS === 'web' ? 'Open PDF to print' : 'Print PDF'}</Text></Pressable>
    </View> : null}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' },
  screen: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 35, color: '#15211F' },
  eyebrow: { color: '#006D64', fontSize: 10, fontWeight: '800' },
  title: { color: '#15211F', fontSize: 22, fontWeight: '800' },
  preview: { flex: 1, minHeight: 500, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  ready: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderRadius: 12, padding: 20 },
  readyTitle: { color: '#15211F', fontSize: 18, fontWeight: '800' },
  muted: { color: '#52635E' },
  error: { color: '#B42318' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primary: { flexGrow: 1, minHeight: 50, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#006D64', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: 'white', fontWeight: '800' },
  secondary: { minHeight: 50, paddingHorizontal: 20, borderRadius: 14, backgroundColor: '#DDF3EF', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#006D64', fontWeight: '800' },
});
