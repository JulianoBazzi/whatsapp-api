// Load environment variables from .env file
require('dotenv').config({ quiet: true });

// setup global const
const sessionFolderPath = process.env.SESSIONS_PATH || './sessions';
const enableLocalCallbackExample = (process.env.ENABLE_LOCAL_CALLBACK_EXAMPLE || '').toLowerCase() === 'true';
const globalApiKey = process.env.API_KEY;
const baseWebhookURL = process.env.BASE_WEBHOOK_URL;
const maxAttachmentSize = parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || 10000000;
// How long sendMessage waits on `message_create` when the library returns nothing. The request is
// held open for that long, so it is worth being able to tune it without a code change.
const ownMessageCaptureTimeoutMs = parseInt(process.env.OWN_MESSAGE_CAPTURE_TIMEOUT_MS, 10) || 8000;
// How long the page is given to decrypt an attachment before downloadMedia gives up.
const mediaResolveTimeoutMs = parseInt(process.env.MEDIA_RESOLVE_TIMEOUT_MS, 10) || 10000;
// How many automatic media downloads (the `media` webhook) may run at once per process.
const mediaDownloadConcurrency = parseInt(process.env.MEDIA_DOWNLOAD_CONCURRENCY, 10) || 3;
// Controls the downloadMedia override in src/patches.js. Unlike the serialized-id patch, which is a
// no-op on a healthy build, this one replaces the library's own implementation for every session in
// the process: `true` (default) only engages it on a build that renamed the ids, `force` engages it
// everywhere (to exercise it before the build flips), `false` never.
const parsePatchMediaDownloadMode = value => {
  const normalized = (value || 'true').toLowerCase();
  return normalized === 'false' || normalized === 'force' ? normalized : 'true';
};
const patchMediaDownloadMode = parsePatchMediaDownloadMode(process.env.PATCH_MEDIA_DOWNLOAD);
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
const releaseBrowserLock = process.env.RELEASE_BROWSER_LOCK ? process.env.RELEASE_BROWSER_LOCK.toLowerCase() === 'true' : true;
const autoStartSessions = process.env.AUTO_START_SESSIONS ? process.env.AUTO_START_SESSIONS.toLowerCase() === 'true' : true;
const logLevel = process.env.LOG_LEVEL || 'info';

// Webhook delivery: a receiver that never answers must not hold a socket forever.
const webhookTimeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS, 10) || 10000;
const webhookRetries = Number.isNaN(parseInt(process.env.WEBHOOK_RETRIES, 10)) ? 2 : parseInt(process.env.WEBHOOK_RETRIES, 10);
const webhookRetryDelayMs = parseInt(process.env.WEBHOOK_RETRY_DELAY_MS, 10) || 1000;

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
  ownMessageCaptureTimeoutMs,
  mediaResolveTimeoutMs,
  mediaDownloadConcurrency,
  patchMediaDownloadMode,
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
  releaseBrowserLock,
  autoStartSessions,
  logLevel,
  webhookTimeoutMs,
  webhookRetries,
  webhookRetryDelayMs,
  trustProxy,
};
