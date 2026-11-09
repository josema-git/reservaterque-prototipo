// Exclusión mutua por clave. Serializa las operaciones que tocan el mismo
// recurso (por ejemplo, un horario) para que dos reservas simultáneas no
// puedan apartar el mismo espacio. En producción este papel lo cumple un
// bloqueo a nivel de base de datos (SELECT ... FOR UPDATE o una restricción única).
export class KeyedMutex {
  #tails = new Map();

  async run(key, task) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  // Toma varias claves en orden alfabético para evitar interbloqueos.
  async runAll(keys, task) {
    const ordered = [...new Set(keys)].sort();
    const acquire = (i) => (i === ordered.length ? task() : this.run(ordered[i], () => acquire(i + 1)));
    return acquire(0);
  }
}
