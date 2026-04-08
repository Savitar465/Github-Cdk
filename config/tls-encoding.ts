import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Converts a file to base64 using UTF-8 safe byte reads.
 */
export function readFileAsBase64(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`TLS file not found: ${resolvedPath}`);
  }

  const fileBytes = fs.readFileSync(resolvedPath);
  return fileBytes.toString('base64');
}

