export async function canShareLocalFile() {
  return false;
}

export async function shareLocalFile(_uri: string, _options: { mimeType?: string; dialogTitle?: string } = {}) {
  throw new Error('Local file sharing is unavailable in the browser.');
}
