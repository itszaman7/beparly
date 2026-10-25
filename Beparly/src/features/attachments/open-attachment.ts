import { File, Paths } from 'expo-file-system';
import { canShareLocalFile, shareLocalFile } from '@/features/documents/share-local-file';

import { api, type AttachmentKind, type RecordAttachment } from '@/services/api';

export async function openAttachment(token: string, businessId: number, kind: AttachmentKind,
  recordId: string, item: RecordAttachment) {
  const response = await api.downloadRecordAttachment(token, businessId, kind, recordId, item.id);
  const extension = item.content_type === 'application/pdf' ? 'pdf' :
    item.content_type === 'image/png' ? 'png' : item.content_type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File(Paths.cache, `${item.id}.${extension}`);
  await file.write(await response.arrayBuffer());
  if (await File.canPreview(file)) await File.preview(file, { title: item.name, mimeType: item.content_type });
  else if (await canShareLocalFile()) await shareLocalFile(file.uri, { mimeType: item.content_type });
  else throw new Error('No app is available to open this document.');
}
