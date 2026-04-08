import { readFileAsBase64 } from '../config/tls-encoding';

function getArg(index: number, name: string): string {
  const value = process.argv[index];
  if (!value) {
    throw new Error(`Missing ${name}. Usage: npm run tls:encode -- <cert-path> <key-path>`);
  }
  return value;
}

function main(): void {
  const certPath = getArg(2, 'cert path');
  const keyPath = getArg(3, 'key path');

  const certB64 = readFileAsBase64(certPath);
  const keyB64 = readFileAsBase64(keyPath);

  console.log('MKCERT_TLS_CERT_B64=' + certB64);
  console.log('MKCERT_TLS_KEY_B64=' + keyB64);
}

main();

