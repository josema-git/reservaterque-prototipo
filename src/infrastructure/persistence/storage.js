// Adaptadores de almacenamiento con la misma interfaz que Web Storage.
export class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

// Usa localStorage cuando el navegador lo permite; si está bloqueado
// (modo privado, iframes restringidos) cae a memoria sin romper la app.
export function createBrowserStorage() {
  try {
    const probe = '__reservaterque_probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return new MemoryStorage();
  }
}
