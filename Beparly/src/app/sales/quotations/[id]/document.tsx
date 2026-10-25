import { router, useLocalSearchParams, type Href } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { shareLocalFile } from '@/features/documents/share-local-file';
import { api } from '@/services/api';

export default function QuotationDocument() {
  const { session } = useAuth();
  const { id, size, print: printRequested } = useLocalSearchParams<{ id: string; size?: string; print?: string }>();
  const businessId = session?.account?.business.id;
  const paper = size === 'a5' ? 'a5' : 'a4';
  const documentKey = `${businessId}:${id}:${paper}`;
  const [loaded, setLoaded] = useState({ key: '', uri: '' });
  const [issue, setIssue] = useState({ key: '', message: '' });
  const [busy, setBusy] = useState(false);
  const autoPrinted = useRef(false);
  const webBlob = useRef<Blob | null>(null);
  const source = loaded.key === documentKey ? loaded.uri : '';
  const error = issue.key === documentKey ? issue.message : '';

  useEffect(() => {
    if (!session || !businessId || !id) return;
    let cancelled = false;
    let objectUrl = '';
    autoPrinted.current = false;
    webBlob.current = null;
    const url = api.quotationDocumentUrl(businessId, id, paper);
    if (Platform.OS === 'web') {
      void fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
        .then((response) => response.ok ? response.blob() : Promise.reject(new Error('Could not load quotation PDF.')))
        .then((blob) => {
          if (cancelled) return;
          webBlob.current = blob;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ key: documentKey, uri: objectUrl });
        })
        .catch((problem) => { if (!cancelled) setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not load quotation PDF.' }); });
    } else {
      const file = new File(Paths.cache, `${id}-${paper}-${Date.now()}.pdf`);
      void File.downloadFileAsync(url, file, { headers: { Authorization: `Bearer ${session.token}` } })
        .then((downloaded) => { if (!cancelled) setLoaded({ key: documentKey, uri: downloaded.uri }); })
        .catch((problem) => { if (!cancelled) setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not load quotation PDF.' }); });
    }
    return () => {
      cancelled = true;
      webBlob.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, businessId, id, paper, documentKey]);

  function downloadWeb() {
    if (!source) return;
    const link = document.createElement('a');
    link.href = source;
    link.download = `quotation-${id}-${paper}.pdf`;
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
        const file = new globalThis.File([blob], `quotation-${id}-${paper}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file], title: 'Quotation PDF' });
        } else {
          downloadWeb();
        }
      } else {
        await shareLocalFile(source, { mimeType: 'application/pdf', dialogTitle: 'Share quotation PDF' });
      }
    } catch (problem) {
      if (problem instanceof Error && problem.name !== 'AbortError') {
        setIssue({ key: documentKey, message: problem.message || 'Could not share quotation PDF.' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function printPdf() {
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
      setIssue({ key: documentKey, message: problem instanceof Error ? problem.message : 'Could not print quotation PDF.' });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!source || printRequested !== '1' || Platform.OS === 'web' || autoPrinted.current) return;
    autoPrinted.current = true;
    void printPdf();
  // Print once when a requested native PDF has finished downloading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, printRequested]);

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><View style={styles.page}>
    <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace(`/sales/quotations/${id}` as Href)}><Text style={styles.link}>‹ Quotation</Text></Pressable>
    <Text style={styles.title}>{paper.toUpperCase()} quotation</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!source && !error ? <Text>Loading PDF…</Text> : null}
    {source ? (Platform.OS === 'web' ? <View style={styles.preview}>{createElement('iframe', { src: source, title: 'Quotation PDF', style: { width: '100%', height: '100%', border: 0 } })}</View> : <Text style={styles.ready}>PDF ready to print or share.</Text>) : null}
    {source ? <View style={styles.actions}><Pressable accessibilityRole="button" style={styles.button} onPress={() => void printPdf()} disabled={busy}><Text style={styles.buttonText}>{Platform.OS === 'web' ? 'Open PDF to print' : `Print ${paper.toUpperCase()}`}</Text></Pressable><Pressable accessibilityRole="button" style={styles.button} onPress={() => void share()} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Working…' : 'Share PDF'}</Text></Pressable></View> : null}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' },
  page: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  link: { color: '#006D64', fontWeight: '700' },
  error: { color: '#B42318' },
  preview: { flex: 1, minHeight: 400, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  ready: { flex: 1, textAlign: 'center', textAlignVertical: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#006D64', borderRadius: 12 },
  buttonText: { color: 'white', fontWeight: '800' },
});
