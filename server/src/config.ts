// All runtime configuration comes from environment variables.
// Every integration is optional: when its variables are missing, the app uses a local fallback.

const env = process.env;

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

const isProduction = env.NODE_ENV === 'production';

const auth0 =
  env.AUTH0_DOMAIN && env.AUTH0_AUDIENCE ? { domain: env.AUTH0_DOMAIN, audience: env.AUTH0_AUDIENCE } : null;

if (isProduction && !auth0) {
  throw new Error('AUTH0_DOMAIN and AUTH0_AUDIENCE are required when NODE_ENV=production');
}
if (isProduction && !env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required when NODE_ENV=production');
}

const twilio =
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
    ? {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        fromNumber: env.TWILIO_FROM_NUMBER,
      }
    : null;

const hedera =
  env.HEDERA_ACCOUNT_ID && env.HEDERA_PRIVATE_KEY
    ? {
        accountId: env.HEDERA_ACCOUNT_ID,
        privateKey: env.HEDERA_PRIVATE_KEY,
        topicId: env.HEDERA_TOPIC_ID ?? '',
        network: env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
      }
    : null;

// "+16135550101:user-id,+16135550102:other-id" -> Map(phone -> user id)
function phoneMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of list(value)) {
    const i = entry.indexOf(':');
    if (i > 0) map.set(entry.slice(0, i), entry.slice(i + 1));
  }
  return map;
}

export const config = {
  isProduction,
  port: num(env.PORT, 8080),
  mongodbUri: env.MONGODB_URI || null,
  dbName: env.MONGODB_DB || 'coldgrid',
  corsOrigins: list(env.CORS_ORIGINS),
  // Public base URL of this API, needed to validate Twilio webhook signatures.
  publicApiUrl: (env.PUBLIC_API_URL ?? '').replace(/\/$/, ''),

  auth0,
  devAuth: !auth0,

  googleServerKey: env.GOOGLE_MAPS_SERVER_KEY || null,

  // Tiger Data (TimescaleDB) connection string for time-series history. Optional.
  tigerDatabaseUrl: env.TIGER_DATABASE_URL || null,
  historySampleMs: num(env.HISTORY_SAMPLE_SECONDS, 60) * 1000,

  twilio,
  // In dev the simulated on-call phone lets the dashboard "reply" to Code Frost.
  oncallNumbers: list(env.ONCALL_NUMBERS).length ? list(env.ONCALL_NUMBERS) : twilio ? [] : ['+15550000001'],
  fieldNumbers: phoneMap(env.FIELD_NUMBERS),

  hedera,
  hederaMirrorUrl:
    env.HEDERA_MIRROR_URL ??
    (hedera?.network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com'),

  weather: {
    cityId: env.WEATHER_CITY_ID || 'on-118', // Ottawa (Kanata - Orleans)
    pollMs: num(env.WEATHER_POLL_MINUTES, 15) * 60_000,
  },
  codeFrost: {
    availablePctBelow: num(env.CODE_FROST_CAPACITY_PCT, 1),
    effectiveTempBelowC: num(env.CODE_FROST_TEMP_C, -15),
    overflowSpaces: 100,
  },

  holdMinutes: num(env.HOLD_MINUTES, 45),
  matchMaxDistanceM: 15_000,
  matchRouteLimit: 10,
  responderRadiusM: num(env.RESPONDER_RADIUS_M, 1000),
  presenceTtlS: 300,

  demoControls: env.DEMO_CONTROLS !== 'false',
};

export type Config = typeof config;

export function integrationStatus() {
  return {
    database: !config.mongodbUri ? 'memory' : config.mongodbUri.includes('.mongodb.net') ? 'atlas' : 'mongodb',
    auth: config.auth0 ? 'auth0' : 'dev',
    routing: config.googleServerKey ? 'google' : 'estimate',
    sms: config.twilio ? 'twilio' : 'simulated',
    ledger: config.hedera?.topicId ? 'hedera' : 'local',
    weather: 'environment-canada',
    history: !config.tigerDatabaseUrl ? 'off' : config.tigerDatabaseUrl.includes('.tsdb.cloud.timescale.com') ? 'tiger' : 'timescaledb',
  } as const;
}
