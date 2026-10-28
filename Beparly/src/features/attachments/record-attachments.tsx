import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { palette } from '@/constants/design-system';
import { api, type AttachmentKind, type PendingAttachment, type RecordAttachment } from '@/services/api';
import { openAttachment } from './open-attachment';

const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
  const digit = Math.floor(Math.random() * 16);
  return (character === 'x' ? digit : (digit & 3) | 8).toString(16);
});
const limit = 10 * 1024 * 1024;

function AttachmentAction({ icon, label, onPress }: { icon: AppSymbolName; label: string; onPress: () => void }) {
  return <View style={{ width: 66, alignItems: 'center', gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={attachmentActionStyle}>
      <AppSymbol name={icon} size={23} color={palette.primaryDeep} />
    </Pressable>
    <Text style={{ color: palette.secondary, fontSize: 11, textAlign: 'center' }}>{label}</Text>
  </View>;
}

export async function uploadPendingAttachments(token: string, businessId: number, kind: AttachmentKind,
  recordId: string, pending: PendingAttachment[]) {
  for (const item of pending) await api.uploadRecordAttachment(token, businessId, kind, recordId, item);
}

export function RecordAttachments({ pending, onChange, existing = [], token, businessId, kind, recordId,
  onUploaded, showUploadButton = true }: { pending: PendingAttachment[]; onChange: Dispatch<SetStateAction<PendingAttachment[]>>;
  existing?: RecordAttachment[]; token?: string; businessId?: number; kind: AttachmentKind; recordId?: string;
  onUploaded?: () => void; showUploadButton?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState('');

  function add(items: PendingAttachment[]) {
    const oversized = items.find((item) => item.size && item.size > limit);
    if (oversized) { setError(`${oversized.name} is larger than 10 MB.`); return; }
    if (existing.length + pending.length + items.length > 10) { setError('Add up to 10 documents per record.'); return; }
    onChange((current) => [...current, ...items]);
    setError('');
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      add(result.assets.map((asset) => ({ commandId: commandId(), uri: asset.uri, name: asset.name,
        contentType: asset.mimeType ?? 'application/octet-stream', size: asset.size, file: asset.file })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not choose a document.'); }
  }

  async function pickImage(camera: boolean) {
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError('Camera permission is needed.'); return; }
      }
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 }) :
        await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true });
      if (result.canceled) return;
      add(result.assets.map((asset) => ({ commandId: commandId(), uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`, contentType: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize, file: asset.file ?? undefined })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not choose a photo.'); }
  }

  async function uploadNow() {
    if (!token || !businessId || !recordId || busy) return;
    setBusy(true); setError('');
    try {
      await uploadPendingAttachments(token, businessId, kind, recordId, pending);
      onChange([]); onUploaded?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload documents.'); }
    finally { setBusy(false); }
  }

  return <View style={{ gap: 10 }}>
    <Text style={{ color: palette.ink, fontSize: 15, fontWeight: '700' }}>Documents</Text>
    <Text style={{ color: palette.secondary, fontSize: 12 }}>Receipts, invoices or other supporting files. Up to 10 images or PDFs, 10 MB each.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <AttachmentAction icon="attachFile" label="File" onPress={() => void pickFile()} />
      <AttachmentAction icon="gallery" label="Gallery" onPress={() => void pickImage(false)} />
      <AttachmentAction icon="camera" label="Camera" onPress={() => void pickImage(true)} />
    </View>
    {existing.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name}`}
      onPress={() => { if (!token || !businessId || !recordId) return; setOpening(item.id); setError('');
        void openAttachment(token, businessId, kind, recordId, item).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open document.'))
          .finally(() => setOpening('')); }}
      style={{ minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderColor: palette.border }}>
      <Text style={{ color: palette.primaryDeep, fontSize: 14 }}>{opening === item.id ? 'Opening…' : item.name}</Text>
    </Pressable>)}
    {pending.map((item) => <View key={item.commandId} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: palette.ink, fontSize: 14 }}>{item.name} · Ready to upload</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => onChange((current) => current.filter((file) => file.commandId !== item.commandId))}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <AppSymbol name="waste" size={20} color="#A62925" />
      </Pressable>
    </View>)}
    {error ? <Text accessibilityRole="alert" style={{ color: '#A62925', fontSize: 13 }}>{error}</Text> : null}
    {showUploadButton && !!recordId && !!pending.length && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void uploadNow()}
      style={[buttonStyle, { alignSelf: 'flex-start', backgroundColor: palette.primaryDeep }]}>
      <Text style={{ color: 'white', fontWeight: '700' }}>{busy ? 'Uploading…' : 'Upload documents'}</Text></Pressable>}
  </View>;
}

const buttonStyle = { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border,
  backgroundColor: palette.surface, paddingHorizontal: 14, alignItems: 'center' as const, justifyContent: 'center' as const };
const attachmentActionStyle = { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.border,
  backgroundColor: palette.surface, alignItems: 'center' as const, justifyContent: 'center' as const };
