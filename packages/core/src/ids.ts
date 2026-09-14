/**
 * Identifier generation.
 *
 * `crypto.randomUUID` is intentionally avoided: this package must run
 * identically in Node, browsers, workers and (later) a server-side relay, and
 * some of those environments either lack WebCrypto or expose it only over TLS.
 * A monotonic counter plus entropy from `Math.random` is collision-safe within a
 * process and has a human-readable prefix, which makes debugging scene dumps
 * dramatically easier.
 */

let counter = 0;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Create a new id such as `obj_lz4k9c_3`.
 *
 * @param prefix short namespace, conventionally the object kind (`obj`, `cmd`, `tx`).
 */
export function newId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${randomChunk(5)}_${counter.toString(36)}`;
}

/** Reset the internal counter. Test-only; ids remain unique across resets. */
export function __resetIdCounter(): void {
  counter = 0;
}
