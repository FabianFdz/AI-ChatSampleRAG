/**
 * The one in-memory session-state registry (ADR-15, E3-T02).
 *
 * A single module-level map from session id to one `SessionState` record,
 * holding every per-session concern E3 has — the vector index today; chat
 * history (E3-T05) and usage budgets (E3-T06) extend the same record later.
 * A session clear is therefore one operation that cannot leave any of them
 * out of sync.
 *
 * Framework-free (sprint-1's layering rule): no `express`, no `req`/`res`.
 * E4 calls this from route handlers; this module never imports E4. E3 has no
 * notion of a session being "valid" — an unknown session id simply behaves
 * as one with empty state; lifecycle (creation, existence, 404s) is E4's.
 */

import type { SessionState } from './rag.types.js';

const sessions = new Map<string, SessionState>();

function createEmptySessionState(sessionId: string): SessionState {
  return {
    sessionId,
    vectorIndex: [],
  };
}

/**
 * Returns the `SessionState` for `sessionId`, creating and storing an empty
 * one on first access. The returned record is the live, stored object —
 * mutating it (e.g. pushing into `vectorIndex`) persists across calls. Use
 * this from a write path.
 */
export function getOrCreateSessionState(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) {
    return existing;
  }
  const created = createEmptySessionState(sessionId);
  sessions.set(sessionId, created);
  return created;
}

/**
 * Returns the `SessionState` for `sessionId` without creating one —
 * `null` for a session never seen before. **Never allocates**, so an
 * unauthenticated caller cannot grow the map by inventing session ids
 * (ADR-15). Use this from a read path (a search, a usage snapshot, ...).
 */
export function readSessionState(sessionId: string): SessionState | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Drops `sessionId`'s entire record in one operation, so the vector index,
 * chat history and usage counters (once added) can never diverge.
 */
export function clearSessionState(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Test affordance (ADR-15): resets the whole registry. The registry is a
 * module-level singleton, so tests that exercise it must be able to reset it
 * between runs.
 */
export function clearAllSessionState(): void {
  sessions.clear();
}
