import { api, type AttachmentKind, type RecordAttachment } from '@/services/api';

export async function openAttachment(token: string, businessId: number, kind: AttachmentKind,
  recordId: string, item: RecordAttachment) {
  const response = await api.downloadRecordAttachment(token, businessId, kind, recordId, item.id);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = item.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
