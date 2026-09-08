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

const PORT = parsePort(process.env.PORT);
const NODE_ENV = parseNodeEnv(process.env.NODE_ENV);
const LOG_LEVEL = parseLogLevel(process.env.LOG_LEVEL);

export const env: Env = Object.freeze({
  PORT,
  NODE_ENV,
  LOG_LEVEL,
  isDevelopment: NODE_ENV === 'development',
});
