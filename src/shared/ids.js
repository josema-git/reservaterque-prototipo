export function newId(prefix) {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
