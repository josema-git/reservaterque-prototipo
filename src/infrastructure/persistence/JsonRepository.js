// Patrón Repository: los servicios trabajan con entidades y no saben dónde
// se guardan. Cambiar localStorage por una API REST o una base de datos solo
// implica escribir otro repositorio con los mismos métodos.
const identity = { toJSON: (e) => e, fromJSON: (o) => o };

export class JsonRepository {
  #storage;
  #key;
  #mapper;
  #cache = null;

  constructor(storage, collection, mapper = identity) {
    this.#storage = storage;
    this.#key = `reservaterque:${collection}`;
    this.#mapper = mapper;
  }

  #load() {
    if (this.#cache) return this.#cache;
    let rows = [];
    try { rows = JSON.parse(this.#storage.getItem(this.#key) ?? '[]'); } catch { rows = []; }
    this.#cache = new Map(rows.map((row) => [row.id, row]));
    return this.#cache;
  }

  #flush() {
    try { this.#storage.setItem(this.#key, JSON.stringify([...this.#load().values()])); } catch { /* cuota llena: se conserva en memoria */ }
  }

  // Se devuelven copias para que nadie modifique el estado guardado por accidente.
  #hydrate(row) { return this.#mapper.fromJSON(structuredClone(row)); }

  async findById(id) {
    const row = this.#load().get(id);
    return row ? this.#hydrate(row) : null;
  }

  async findAll(predicate = () => true) {
    return [...this.#load().values()].map((row) => this.#hydrate(row)).filter(predicate);
  }

  async save(entity) {
    const json = structuredClone(this.#mapper.toJSON(entity));
    this.#load().set(json.id, json);
    this.#flush();
    return entity;
  }

  async delete(id) {
    this.#load().delete(id);
    this.#flush();
  }

  async count() { return this.#load().size; }
}

export const mapperFor = (Entity) => ({ toJSON: (e) => e.toJSON(), fromJSON: (o) => Entity.fromJSON(o) });
