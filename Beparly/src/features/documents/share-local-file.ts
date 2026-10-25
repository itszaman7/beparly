import * as Sharing from 'expo-sharing';

export async function canShareLocalFile() {
  return Sharing.isAvailableAsync();
}

export async function shareLocalFile(uri: string, options: { mimeType?: string; dialogTitle?: string } = {}) {
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(uri, options);
}
