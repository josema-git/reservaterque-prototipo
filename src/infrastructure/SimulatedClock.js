// Reloj inyectable. En la demo permite adelantar el tiempo para ver vencer
// un bloqueo sin esperar diez minutos reales; en las pruebas da control total.
export class SimulatedClock {
  #offset;
  #storage;
  static KEY = 'reservaterque:clockOffset';

  constructor(storage = null) {
    this.#storage = storage;
    this.#offset = Number(storage?.getItem(SimulatedClock.KEY)) || 0;
  }

  now() { return Date.now() + this.#offset; }

  advance(ms) {
    this.#offset += ms;
    this.#storage?.setItem(SimulatedClock.KEY, String(this.#offset));
  }

  reset() {
    this.#offset = 0;
    this.#storage?.removeItem(SimulatedClock.KEY);
  }
}

export class FixedClock {
  #time;
  constructor(time) { this.#time = time; }
  now() { return this.#time; }
  advance(ms) { this.#time += ms; }
}
