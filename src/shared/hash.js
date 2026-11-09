// SHA-256 con la Web Crypto API (disponible en navegadores y en Node 18+).
export async function sha256Hex(text) {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
