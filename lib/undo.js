// Ephemeral undo stash. Keys are short tokens, values are snapshots of deleted
// rows. Expires after 10 minutes or on restart.

const TTL_MS = 10 * 60 * 1000;
const store = new Map();

function put(snapshot) {
  const token = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set(token, { snapshot, expiresAt: Date.now() + TTL_MS });
  return token;
}

function take(token) {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry.snapshot;
}

// Soft cleanup — runs on every put. O(n) but n is tiny.
function gc() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}
setInterval(gc, 60_000).unref?.();

module.exports = { put, take };
