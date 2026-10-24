import { router, useLocalSearchParams, type Href } from 'expo-router';
import { createElement, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/services/api';

export default function QuotationDocument() {
  const { session } = useAuth(); const { id, size, print } = useLocalSearchParams<{ id: string; size?: string; print?: string }>();
  const businessId = session?.account?.business.id; const paper = size === 'a5' ? 'a5' : 'a4';
  const [source, setSource] = useState(''); const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement | null>(null); const autoPrinted = useRef(false);
  useEffect(() => { if (!session || !businessId || !id) return;
    let active = true; let objectUrl = '';
    const url = api.quotationDocumentUrl(businessId, id, paper);
    if (Platform.OS === 'web') void fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
      .then(response => response.ok ? response.blob() : Promise.reject(new Error('Could not load quotation PDF.')))
      .then(blob => { objectUrl = URL.createObjectURL(blob); if (active) setSource(objectUrl); else URL.revokeObjectURL(objectUrl); })
      .catch(problem => { if (active) setError(problem.message); });
    else void File.downloadFileAsync(url, new File(Paths.cache, `${id}-${paper}.pdf`), { headers: { Authorization: `Bearer ${session.token}` } })
      .then(file => { if (active) setSource(file.uri); }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [session, businessId, id, paper]);
  async function printPdf() {
    if (!source) return;
    try {
      if (Platform.OS === 'web') {
        const pdfWindow = frame.current?.contentWindow;
        if (pdfWindow) pdfWindow.print();
        else throw new Error('PDF preview is not ready.');
      } else await Print.printAsync({ uri: source });
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not print quotation.'); }
  }
  useEffect(() => {
    if (!source || print !== '1' || Platform.OS === 'web' || autoPrinted.current) return;
    autoPrinted.current = true; void printPdf();
  // Print once when a requested native PDF has finished downloading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, print]);
  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><View style={styles.page}>
    <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace(`/sales/quotations/${id}` as Href)}><Text style={styles.link}>‹ Quotation</Text></Pressable>
    <Text style={styles.title}>{paper.toUpperCase()} quotation</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!source && !error ? <Text>Loading PDF…</Text> : null}
    {source ? (Platform.OS === 'web' ? <View style={styles.preview}>{createElement('iframe', { ref: frame, src: source, title: 'Quotation PDF', onLoad: () => { if (print === '1' && !autoPrinted.current) { autoPrinted.current = true; void printPdf(); } }, style: { width: '100%', height: '100%', border: 0 } })}</View> : <Text style={styles.ready}>PDF ready to print or share.</Text>) : null}
    {source ? <View style={styles.actions}><Pressable style={styles.button} onPress={() => void printPdf()}><Text style={styles.buttonText}>Print {paper.toUpperCase()}</Text></Pressable><Pressable style={styles.button} onPress={() => void Share.share({ title: 'Quotation', url: source })}><Text style={styles.buttonText}>Share PDF</Text></Pressable></View> : null}
  </View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F6F8F7' }, page: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, gap: 12 }, title: { fontSize: 22, fontWeight: '800' }, link: { color: '#006D64', fontWeight: '700' }, error: { color: '#B42318' }, preview: { flex: 1, minHeight: 400, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' }, ready: { flex: 1, textAlign: 'center', textAlignVertical: 'center' }, actions: { flexDirection: 'row', gap: 8 }, button: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#006D64', borderRadius: 12 }, buttonText: { color: 'white', fontWeight: '800' } });
