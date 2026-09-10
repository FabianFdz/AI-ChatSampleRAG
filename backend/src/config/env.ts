import 'dotenv/config';

type NodeEnv = 'development' | 'production' | 'test';
type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';

interface Env {
  readonly PORT: number;
  readonly NODE_ENV: NodeEnv;
  readonly LOG_LEVEL: LogLevel;
  readonly isDevelopment: boolean;
  readonly VOYAGE_API_KEY: string;
  readonly VOYAGE_EMBEDDING_MODEL: string;
  readonly ANTHROPIC_API_KEY: string;
  readonly ANTHROPIC_MODEL: string;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return 3001;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid PORT: "${raw}" — must be an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw === '') {
    return 'development';
  }
  if (!NODE_ENVS.includes(raw as NodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV: "${raw}" — must be one of ${NODE_ENVS.join(', ')}.`,
    );
  }
  return raw as NodeEnv;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') {
    return 'info';
  }
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL: "${raw}" — must be one of ${LOG_LEVELS.join(', ')}.`,
    );
  }
  return raw as LogLevel;
}

/**
 * Voyage's own default model id (docs.voyageai.com/docs/embeddings, verified
 * 2026-09-10): `voyage-4-lite` — the cheapest of Voyage's recommended
 * models, sitting on its 200M-free-token tier, satisfying `CLAUDE.md`'s
 * cost-consciousness decision for this PoC.
 */
const DEFAULT_VOYAGE_EMBEDDING_MODEL = 'voyage-4-lite';

// Cheapest Claude tier per CLAUDE.md; verified against Anthropic's docs 2026-09-10.
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

/**
 * A required secret: absent or blank throws at import time so the process
 * dies at startup rather than on the first embedding call.
 */
function parseRequiredSecret(raw: string | undefined, name: string): string {
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env (see .env.example).`,
    );
  }
  return raw;
}

/**
 * Unset or blank falls back to the default model constant. A provided value
 * is trimmed and accepted with no allow-list — Voyage's model list changes
 * over time and hard-coding one here would go stale.
 */
function parseVoyageEmbeddingModel(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_VOYAGE_EMBEDDING_MODEL;
  }
  return raw.trim();
}

// Opposite of parseVoyageEmbeddingModel: unset falls back to the default,
// but a set-but-blank value fails fast (likely a typo'd override).
function parseAnthropicModel(raw: string | undefined): string {
  if (raw === undefined) {
    return DEFAULT_ANTHROPIC_MODEL;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(
      'Invalid ANTHROPIC_MODEL: set it to a non-empty model id, or omit the variable entirely to use the default.',
    );
  }
  return trimmed;
}

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const PORT = parsePort(source.PORT);
  const NODE_ENV = parseNodeEnv(source.NODE_ENV);
  const LOG_LEVEL = parseLogLevel(source.LOG_LEVEL);
  const VOYAGE_API_KEY = parseRequiredSecret(
    source.VOYAGE_API_KEY,
    'VOYAGE_API_KEY',
  );
  const VOYAGE_EMBEDDING_MODEL = parseVoyageEmbeddingModel(
    source.VOYAGE_EMBEDDING_MODEL,
  );
  const ANTHROPIC_API_KEY = parseRequiredSecret(
    source.ANTHROPIC_API_KEY,
    'ANTHROPIC_API_KEY',
  );
  const ANTHROPIC_MODEL = parseAnthropicModel(source.ANTHROPIC_MODEL);

  return Object.freeze({
    PORT,
    NODE_ENV,
    LOG_LEVEL,
    isDevelopment: NODE_ENV === 'development',
    VOYAGE_API_KEY,
    VOYAGE_EMBEDDING_MODEL,
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
  });
}

export const env: Env = loadEnv(process.env);
