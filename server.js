const app = require('./src/app');
const { baseWebhookURL, globalApiKey, autoStartSessions } = require('./src/config');
const { isValidUrl, maskSecret } = require('@julianobazzi/utils');
const { logger } = require('./src/logger');
const { restoreSessions, shutdownSessions } = require('./src/sessions');
require('dotenv').config({ quiet: true });

// puppeteer subscribes to SIGINT/SIGTERM/SIGHUP per browser to know when to close it;
// this keeps Node from warning about listener leaks once more than 10 sessions are running.
process.setMaxListeners(0);

// Start the server
const port = process.env.PORT || 3000;

// Check if BASE_WEBHOOK_URL environment variable is available
if (!baseWebhookURL) {
  logger.error('BASE_WEBHOOK_URL environment variable is not available. Exiting...');
  process.exit(1); // Terminate the application with an error code
}

// Check if BASE_WEBHOOK_URL is a valid http(s) URL
if (!isValidUrl(baseWebhookURL)) {
  logger.error(`BASE_WEBHOOK_URL is not a valid URL: ${baseWebhookURL}. Exiting...`);
  process.exit(1);
}

if (globalApiKey) {
  logger.info(`API key configured: ${maskSecret(globalApiKey)}`);
} else {
  logger.warn('API_KEY is not set - the API is running WITHOUT authentication');
}

const server = app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  if (autoStartSessions) {
    restoreSessions();
  }
});

// Chromium does not go away on its own: without this, a `docker restart` leaves orphan browsers behind.
let shuttingDown = false;
const shutdown = async signal => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  server.close();
  await shutdownSessions();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
