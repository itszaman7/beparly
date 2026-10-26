import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';

export function BarcodeScanner({ onClose, onScan }: { onClose: () => void; onScan: (code: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  const [cameraError, setCameraError] = useState('');
  const insecureWeb = Platform.OS === 'web' && !globalThis.isSecureContext;
  return <SafeAreaView style={styles.root}>
    <View style={styles.row}><Text style={styles.title}>Scan product</Text><Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.action}>Close</Text></Pressable></View>
    {insecureWeb ? <View style={styles.message}><Text>Camera scanning needs HTTPS or localhost. Open this POS on a secure address to use a phone camera.</Text></View> :
      !permission?.granted ? <View style={styles.message}><Text>Allow camera access to scan product barcodes.</Text>
      <Pressable accessibilityRole="button" onPress={() => void requestPermission().catch(problem => setCameraError(problem instanceof Error ? problem.message : 'Could not access camera.'))}><Text style={styles.action}>Allow camera</Text></Pressable></View> :
      <CameraView style={styles.camera} facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'] }}
        onMountError={({ message }) => setCameraError(message)}
        onBarcodeScanned={({ data }) => { if (locked.current) return; locked.current = true; onScan(data); }} />}
    {cameraError ? <Text>{cameraError}</Text> : null}
    <Text>Point the camera at a product or package barcode.</Text>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F9F7', padding: 20, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '800' }, action: { color: '#006D64', fontWeight: '700' },
  message: { flex: 1, justifyContent: 'center', gap: 18 }, camera: { flex: 1, borderRadius: 12, overflow: 'hidden' },
});
