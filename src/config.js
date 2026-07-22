// Load environment variables from .env file
require('dotenv').config({ quiet: true });

// setup global const
const sessionFolderPath = process.env.SESSIONS_PATH || './sessions';
const enableLocalCallbackExample = (process.env.ENABLE_LOCAL_CALLBACK_EXAMPLE || '').toLowerCase() === 'true';
const globalApiKey = process.env.API_KEY;
const baseWebhookURL = process.env.BASE_WEBHOOK_URL;
const maxAttachmentSize = parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || 10000000;
const setMessagesAsSeen = (process.env.SET_MESSAGES_AS_SEEN || '').toLowerCase() === 'true';
const disabledCallbacks = process.env.DISABLED_CALLBACKS ? process.env.DISABLED_CALLBACKS.split('|') : [];
const enableSwaggerEndpoint = (process.env.ENABLE_SWAGGER_ENDPOINT || '').toLowerCase() === 'true';
const webVersion = process.env.WEB_VERSION;
const webVersionCacheType = process.env.WEB_VERSION_CACHE_TYPE || 'none';
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000;
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 1000;
const recoverSessions = (process.env.RECOVER_SESSIONS || '').toLowerCase() === 'true';
const chromeBin = process.env.CHROME_BIN || null;
const headless = process.env.HEADLESS ? process.env.HEADLESS.toLowerCase() === 'true' : true;

// Express "trust proxy": needed behind nginx/Docker so rate-limit sees the real client IP.
// Examples: "1" (one hop), "true" (same as 1), "false"/unset (direct access).
const parseTrustProxy = value => {
  if (value == null || value === '') {
    return false;
  }
  const normalized = String(value).toLowerCase();
  if (normalized === 'true') {
    return 1;
  }
  if (normalized === 'false') {
    return false;
  }
  const hops = parseInt(value, 10);
  if (!Number.isNaN(hops)) {
    return hops;
  }
  return value;
};
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

module.exports = {
  sessionFolderPath,
  enableLocalCallbackExample,
  globalApiKey,
  baseWebhookURL,
  maxAttachmentSize,
  setMessagesAsSeen,
  disabledCallbacks,
  enableSwaggerEndpoint,
  webVersion,
  webVersionCacheType,
  rateLimitMax,
  rateLimitWindowMs,
  recoverSessions,
  chromeBin,
  headless,
  trustProxy,
};
