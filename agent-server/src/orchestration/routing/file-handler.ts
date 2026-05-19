// input:  PlatformAdapter, PlatformFileRef, temp directory
// output: downloadFiles / IMAGE_MIMES / VIDEO_MIMES
// pos:    Platform-agnostic file download and mimetype classification
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import type { PlatformAdapter } from '@platform/adapter.js';
import type { PlatformFileRef, DownloadedFile } from '@platform/types.js';

const log = createLogger('file-handler');

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']);

async function downloadFiles(
  files: PlatformFileRef[] | undefined,
  adapter: PlatformAdapter,
  tempDir: string,
): Promise<DownloadedFile[]> {
  if (!files?.length) return [];
  const results: DownloadedFile[] = [];
  for (const file of files) {
    try {
      results.push(await adapter.downloadFile(file, tempDir));
    } catch (e) {
      log.error('Failed to download file:', file.name, (e as Error).message);
    }
  }
  return results;
}

export { downloadFiles, IMAGE_MIMES, VIDEO_MIMES };
