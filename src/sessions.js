const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('node:fs');
const path = require('node:path');
const { formatBytes, isValidUrl } = require('@julianobazzi/utils');
const sessions = new Map();
const {
  baseWebhookURL,
  sessionFolderPath,
  maxAttachmentSize,
  setMessagesAsSeen,
  webVersion,
  webVersionCacheType,
  recoverSessions,
  chromeBin,
  headless,
  releaseBrowserLock,
} = require('./config');
const { triggerWebhook, waitForNestedObject, isEventEnabled, sendMessageSeenStatus, sleep } = require('./utils');
const { applyPagePatches } = require('./patches');
const { logger } = require('./logger');

// Webhook overrides set at runtime (API) or restored from disk, keyed by session id
const sessionWebhooks = new Map();
// Memoized <SESSIONID>_WEBHOOK_URL lookups, so an invalid value is only reported once per session
const envWebhooks = new Map();

const webhookConfigPath = sessionId => path.join(sessionFolderPath, `session-${sessionId}`, 'webhook_config.json');

// Read the <SESSIONID>_WEBHOOK_URL env var, ignoring it when it is not a usable URL
const getEnvWebhook = sessionId => {
  if (envWebhooks.has(sessionId)) {
    return envWebhooks.get(sessionId);
  }
  const envName = `${sessionId.toUpperCase()}_WEBHOOK_URL`;
  const customWebhook = process.env[envName];
  let resolved = null;
  if (customWebhook) {
    if (isValidUrl(customWebhook)) {
      resolved = customWebhook;
    } else {
      logger.error({ sessionId }, `Invalid ${envName} (${customWebhook}), falling back to BASE_WEBHOOK_URL`);
    }
  }
  envWebhooks.set(sessionId, resolved);
  return resolved;
};

// Resolve which webhook a session should notify, most specific first.
// Resolved per event (not cached at setup) so an API change takes effect without a restart.
const resolveWebhook = sessionId => {
  const runtime = sessionWebhooks.get(sessionId);
  if (runtime) {
    return { webhookUrl: runtime, source: 'runtime' };
  }
  const envWebhook = getEnvWebhook(sessionId);
  if (envWebhook) {
    return { webhookUrl: envWebhook, source: 'env_session' };
  }
  if (baseWebhookURL) {
    return { webhookUrl: baseWebhookURL, source: 'env_global' };
  }
  return { webhookUrl: null, source: 'none' };
};

// Persist the runtime webhook next to the session credentials.
// Only for sessions that were started at least once: creating the folder for an unknown session
// would make restoreSessions() boot a session that never existed.
const saveWebhookConfig = async (sessionId, webhookUrl) => {
  if (!sessions.has(sessionId)) {
    return;
  }
  const configPath = webhookConfigPath(sessionId);
  try {
    if (webhookUrl) {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ webhookUrl }, null, 2));
    } else {
      await fs.promises.rm(configPath, { force: true });
    }
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to persist webhook config');
  }
};

const loadWebhookConfig = sessionId => {
  try {
    const configPath = webhookConfigPath(sessionId);
    if (!fs.existsSync(configPath)) {
      return;
    }
    const { webhookUrl } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (webhookUrl && isValidUrl(webhookUrl)) {
      sessionWebhooks.set(sessionId, webhookUrl);
      logger.info({ sessionId }, 'Webhook config restored from disk');
    }
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to load webhook config');
  }
};

// Set (or clear, with an empty value) the runtime webhook for a session
const setSessionWebhook = (sessionId, webhookUrl) => {
  if (!webhookUrl) {
    sessionWebhooks.delete(sessionId);
    saveWebhookConfig(sessionId, null);
    return { success: true, message: 'Webhook cleared', ...resolveWebhook(sessionId) };
  }
  if (!isValidUrl(webhookUrl)) {
    return { success: false, message: `Invalid webhook URL: ${webhookUrl}` };
  }
  sessionWebhooks.set(sessionId, webhookUrl);
  saveWebhookConfig(sessionId, webhookUrl);
  return { success: true, message: 'Webhook updated', ...resolveWebhook(sessionId) };
};

const getSessionWebhook = sessionId => ({ success: true, ...resolveWebhook(sessionId) });

// Function to validate if the session is ready
const validateSession = async sessionId => {
  try {
    const returnData = { success: false, state: null, message: '' };

    // Session not Connected 😢
    if (!sessions.has(sessionId) || !sessions.get(sessionId)) {
      returnData.message = 'session_not_found';
      return returnData;
    }

    const client = sessions.get(sessionId);
    if (!client.pupPage) {
      return { success: false, state: null, message: 'session_not_ready' };
    }

    // Wait for client.pupPage to be evaluable
    let maxRetry = 0;
    while (true) {
      try {
        if (client.pupPage.isClosed()) {
          return { success: false, state: null, message: 'browser tab closed' };
        }
        await Promise.race([client.pupPage.evaluate('1'), new Promise(resolve => setTimeout(resolve, 1000))]);
        break;
      } catch (_error) {
        if (maxRetry === 2) {
          return { success: false, state: null, message: 'session closed' };
        }
        maxRetry++;
      }
    }

    const state = await client.getState();
    returnData.state = state;
    if (state !== 'CONNECTED') {
      returnData.message = 'session_not_connected';
      return returnData;
    }

    // Session Connected 🎉
    returnData.success = true;
    returnData.message = 'session_connected';
    return returnData;
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to validate session');
    return { success: false, state: null, message: error.message };
  }
};

// Create the sessions folder. Called on import so endpoints that write there work before any session exists.
const ensureSessionFolder = () => {
  fs.mkdirSync(sessionFolderPath, { recursive: true });
};

// Function to handle client session restoration
const restoreSessions = async () => {
  try {
    ensureSessionFolder();
    const files = await fs.promises.readdir(sessionFolderPath);
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/);
      if (match) {
        const sessionId = match[1];
        logger.info({ sessionId }, 'Existing session detected');
        const { success, client } = setupSession(sessionId);
        // Launch browsers one at a time: starting every session at once spikes memory
        // proportionally to the session count.
        if (success) {
          await waitForNestedObject(client, 'pupPage').catch(() => {});
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to restore sessions');
  }
};

// Chromium leaves a SingletonLock behind on an unclean exit (container kill, OOM) and then refuses to
// reuse the profile, so the session never comes back. The leftover is a dangling symlink at that point,
// which existsSync() reports as absent — lstat is what actually sees it.
const releaseSessionBrowserLock = sessionId => {
  const lockPath = path.join(sessionFolderPath, `session-${sessionId}`, 'SingletonLock');
  try {
    fs.lstatSync(lockPath);
  } catch {
    return;
  }
  try {
    fs.rmSync(lockPath, { force: true });
    logger.warn({ sessionId }, 'Stale browser lock file removed');
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to remove browser lock file');
  }
};

// Setup Session
const setupSession = sessionId => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) };
    }

    if (releaseBrowserLock) {
      releaseSessionBrowserLock(sessionId);
    }
    loadWebhookConfig(sessionId);

    // Disable the delete folder from the logout function (will be handled separately)
    const localAuth = new LocalAuth({ clientId: sessionId, dataPath: sessionFolderPath });
    localAuth.logout = () => {};

    const clientOptions = {
      puppeteer: {
        executablePath: chromeBin,
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-accelerated-2d-canvas',
          // Keep background sessions from burning CPU: WhatsApp Web keeps working while throttled.
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-hang-monitor',
          '--disable-notifications',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-pings',
          '--no-zygote',
          '--password-store=basic',
          '--use-mock-keychain',
          '--disable-blink-features=AutomationControlled',
        ],
      },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
      authStrategy: localAuth,
    };

    if (webVersion) {
      clientOptions.webVersion = webVersion;
      switch (webVersionCacheType.toLowerCase()) {
        case 'local':
          clientOptions.webVersionCache = {
            type: 'local',
          };
          break;
        case 'remote':
          clientOptions.webVersionCache = {
            type: 'remote',
            remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${webVersion}.html`,
          };
          break;
        default:
          clientOptions.webVersionCache = {
            type: 'none',
          };
      }
    }

    const client = new Client(clientOptions);

    initializeEvents(client, sessionId);

    // Save the session to the Map
    sessions.set(sessionId, client);

    // Flush the runtime webhook now that the session exists: a URL set before the first start
    // (or passed on POST /session/start) is only kept in memory until this point.
    saveWebhookConfig(sessionId, sessionWebhooks.get(sessionId) ?? null);

    client.initialize().catch(error => {
      logger.error({ sessionId, err: error }, 'Initialize error');
      // A half-initialized client left in the Map makes every later start answer
      // "Session already exists" and pins the status at session_not_ready until a restart.
      if (sessions.get(sessionId) === client) {
        sessions.delete(sessionId);
      }
      client.destroy().catch(() => {});
    });

    return { success: true, message: 'Session initiated successfully', client };
  } catch (error) {
    return { success: false, message: error.message, client: null };
  }
};

const initializeEvents = (client, sessionId) => {
  // Resolve the target webhook at emit time so /session/setWebhook applies without a restart
  const emit = (dataType, data) => {
    const { webhookUrl } = resolveWebhook(sessionId);
    if (webhookUrl) {
      triggerWebhook(webhookUrl, sessionId, dataType, data);
    }
  };

  waitForNestedObject(client, 'pupPage')
    .then(() => {
      // Always attached: when WhatsApp Web breaks its own internals, the page console is where it
      // says so first — a minified DataError out of IndexedDB never reaches us any other way.
      // `debug` because WhatsApp Web is chatty; raise LOG_LEVEL when something is being diagnosed.
      client.pupPage
        .on('console', message => logger.debug({ sessionId, type: message.type() }, `Page console: ${message.text()}`))
        .on('pageerror', ({ message }) => logger.error({ sessionId, message }, 'Page error occurred'));

      if (!recoverSessions) {
        return;
      }
      // A renderer crash emits both `error` and `close`, so the listeners go first: a second run
      // would tear down the replacement client and leave its Chromium orphaned. The identity guard
      // covers a /session/stop or /terminate that already replaced the slot meanwhile.
      const restartSession = async () => {
        client.pupPage.removeAllListeners('close');
        client.pupPage.removeAllListeners('error');
        if (sessions.get(sessionId) !== client) {
          return;
        }
        sessions.delete(sessionId);
        await client.destroy().catch(() => {});
        // setupSession removes the SingletonLock unconditionally; launching while the crashed
        // Chromium is still alive would put two browsers on the same profile.
        await waitForBrowserToClose(client);
        setupSession(sessionId);
      };
      const restore = () => restartSession().catch(error => logger.error({ sessionId, err: error }, 'Failed to restore session'));
      client.pupPage.once('close', () => {
        // emitted when the page closes
        logger.warn({ sessionId }, 'Browser page closed. Restoring');
        restore();
      });
      client.pupPage.once('error', () => {
        // emitted when the page crashes
        logger.warn({ sessionId }, 'Error occurred on browser page. Restoring');
        restore();
      });
    })
    .catch(_e => {});

  if (isEventEnabled('auth_failure')) {
    client.on('auth_failure', msg => {
      emit('status', { msg });
    });
  }

  // Always registered: a scanned QR must stop being served even when the callback is disabled
  client.on('authenticated', () => {
    client.qr = null;
    if (isEventEnabled('authenticated')) {
      emit('authenticated');
    }
  });

  if (isEventEnabled('call')) {
    client.on('call', async call => {
      emit('call', { call });
    });
  }

  if (isEventEnabled('change_state')) {
    client.on('change_state', state => {
      emit('change_state', { state });
    });
  }

  if (isEventEnabled('disconnected')) {
    client.on('disconnected', reason => {
      emit('disconnected', { reason });
    });
  }

  if (isEventEnabled('group_join')) {
    client.on('group_join', notification => {
      emit('group_join', { notification });
    });
  }

  if (isEventEnabled('group_leave')) {
    client.on('group_leave', notification => {
      emit('group_leave', { notification });
    });
  }

  if (isEventEnabled('group_admin_changed')) {
    client.on('group_admin_changed', notification => {
      emit('group_admin_changed', { notification });
    });
  }

  if (isEventEnabled('group_membership_request')) {
    client.on('group_membership_request', notification => {
      emit('group_membership_request', { notification });
    });
  }

  if (isEventEnabled('group_update')) {
    client.on('group_update', notification => {
      emit('group_update', { notification });
    });
  }

  if (isEventEnabled('loading_screen')) {
    client.on('loading_screen', (percent, message) => {
      emit('loading_screen', { percent, message });
    });
  }

  if (isEventEnabled('media_uploaded')) {
    client.on('media_uploaded', message => {
      emit('media_uploaded', { message });
    });
  }

  client.on('message', async message => {
    if (isEventEnabled('message')) {
      emit('message', { message });
      if (message.hasMedia) {
        const attachmentSize = message._data?.size;
        if (typeof attachmentSize === 'number' && attachmentSize < maxAttachmentSize) {
          // custom service event
          if (isEventEnabled('media')) {
            message
              .downloadMedia()
              .then(messageMedia => {
                emit('media', { messageMedia, message });
              })
              .catch(error => {
                logger.error({ sessionId, err: error }, 'Failed to download media');
              });
          }
        } else if (typeof attachmentSize === 'number') {
          logger.info({ sessionId }, `Skipping media download: attachment of ${formatBytes(attachmentSize)} exceeds the ${formatBytes(maxAttachmentSize)} limit`);
        }
      }
    }
    if (setMessagesAsSeen) {
      // Small delay so the message is committed before the read receipt goes out
      await sleep(1000);
      sendMessageSeenStatus(message);
    }
  });

  if (isEventEnabled('message_ack')) {
    client.on('message_ack', (message, ack) => {
      emit('message_ack', { message, ack });
    });
  }

  if (isEventEnabled('message_create')) {
    client.on('message_create', message => {
      emit('message_create', { message });
    });
  }

  if (isEventEnabled('message_reaction')) {
    client.on('message_reaction', reaction => {
      emit('message_reaction', { reaction });
    });
  }

  if (isEventEnabled('message_edit')) {
    client.on('message_edit', (message, newBody, prevBody) => {
      emit('message_edit', { message, newBody, prevBody });
    });
  }

  if (isEventEnabled('message_ciphertext')) {
    client.on('message_ciphertext', message => {
      emit('message_ciphertext', { message });
    });
  }

  if (isEventEnabled('message_revoke_everyone')) {
    client.on('message_revoke_everyone', async message => {
      emit('message_revoke_everyone', { message });
    });
  }

  if (isEventEnabled('message_revoke_me')) {
    client.on('message_revoke_me', async (message, revokedMsg) => {
      emit('message_revoke_me', { message, revokedMsg });
    });
  }

  client.on('qr', qr => {
    // inject qr code into session
    client.qr = qr;
    if (isEventEnabled('qr')) {
      emit('qr', { qr });
    }
  });

  if (isEventEnabled('code')) {
    client.on('code', code => {
      emit('code', { code });
    });
  }

  // Always registered, and `on` rather than `once`: the page-side half of the patches lives on
  // WhatsApp Web's own prototypes, and `ready` fires again on every reconnect — a reload wipes them.
  // The webhook stays gated, the patch does not: a session with `ready` in DISABLED_CALLBACKS still
  // needs its ids back. Awaited before the emit so a consumer that reacts to `ready` by sending a
  // message right away does not race the patch.
  client.on('ready', async () => {
    await applyPagePatches(client, sessionId);
    if (isEventEnabled('ready')) {
      emit('ready');
    }
  });

  if (isEventEnabled('contact_changed')) {
    client.on('contact_changed', async (message, oldId, newId, isContact) => {
      emit('contact_changed', { message, oldId, newId, isContact });
    });
  }

  if (isEventEnabled('chat_removed')) {
    client.on('chat_removed', async chat => {
      emit('chat_removed', { chat });
    });
  }

  if (isEventEnabled('chat_archived')) {
    client.on('chat_archived', async (chat, currState, prevState) => {
      emit('chat_archived', { chat, currState, prevState });
    });
  }

  if (isEventEnabled('unread_count')) {
    client.on('unread_count', async chat => {
      emit('unread_count', { chat });
    });
  }

  if (isEventEnabled('vote_update')) {
    client.on('vote_update', vote => {
      emit('vote_update', { vote });
    });
  }
};

// Function to delete client session folder
const deleteSessionFolder = async sessionId => {
  try {
    const targetDirPath = path.join(sessionFolderPath, `session-${sessionId}`);
    const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath);
    const resolvedSessionPath = await fs.promises.realpath(sessionFolderPath);

    // Ensure the target directory path ends with a path separator
    const safeSessionPath = `${resolvedSessionPath}${path.sep}`;

    // Validate the resolved target directory path is a subdirectory of the session folder path
    if (!resolvedTargetDirPath.startsWith(safeSessionPath)) {
      throw new Error('Invalid path: Directory traversal detected');
    }
    await fs.promises.rm(resolvedTargetDirPath, { recursive: true, force: true });
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Folder deletion error');
    throw error;
  }
};

// Wait for the browser to disconnect, then force it down if it refuses to
const waitForBrowserToClose = async (client, maxSeconds = 10) => {
  let elapsed = 0;
  while (client.pupBrowser?.isConnected() && elapsed < maxSeconds) {
    await sleep(1000);
    elapsed++;
  }
  if (client.pupBrowser?.isConnected()) {
    client.pupBrowser.process()?.kill(9);
  }
};

// Function to reload client session without removing browser cache
const reloadSession = async sessionId => {
  try {
    const client = sessions.get(sessionId);
    if (!client) {
      return;
    }
    if (client.pupPage) {
      client.pupPage.removeAllListeners('close');
      client.pupPage.removeAllListeners('error');
    }
    try {
      if (client.pupBrowser) {
        const pages = await client.pupBrowser.pages();
        await Promise.all(pages.map(page => page.close()));
        await Promise.race([client.pupBrowser.close(), sleep(5000)]);
      }
    } catch {
      const childProcess = client.pupBrowser?.process?.();
      if (childProcess) {
        childProcess.kill(9);
      }
    }
    // The race above is only a first attempt: the profile must be released before setupSession
    // removes the SingletonLock, or the new browser fails to launch and the session is simply gone
    await waitForBrowserToClose(client);
    sessions.delete(sessionId);
    setupSession(sessionId);
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to reload session');
    throw error;
  }
};

// Stop a session without touching its credentials, so it can be started again later
const destroySession = async sessionId => {
  try {
    const client = sessions.get(sessionId);
    if (!client) {
      return;
    }
    if (client.pupPage) {
      client.pupPage.removeAllListeners('close');
      client.pupPage.removeAllListeners('error');
    }
    logger.info({ sessionId }, 'Stopping session');
    await client.destroy();
    await waitForBrowserToClose(client);
    sessions.delete(sessionId);
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to stop session');
    throw error;
  }
};

const deleteSession = async (sessionId, validation) => {
  const client = sessions.get(sessionId);
  if (!client) {
    // Not running, but the credentials may still be on disk (AUTO_START_SESSIONS=FALSE, /session/stop)
    await deleteSessionFolder(sessionId);
    sessionWebhooks.delete(sessionId);
    envWebhooks.delete(sessionId);
    return;
  }
  if (client.pupPage) {
    client.pupPage.removeAllListeners('close');
    client.pupPage.removeAllListeners('error');
  }
  try {
    if (validation.success) {
      // Client Connected, request logout
      logger.info({ sessionId }, 'Logging out session');
      await client.logout();
    } else if (validation.message === 'session_not_connected') {
      // Client not Connected, request destroy
      logger.info({ sessionId }, 'Destroying session');
      await client.destroy();
    }
  } catch (error) {
    // The page is usually already gone here; the browser is forced down below either way
    logger.error({ sessionId, err: error }, 'Failed to log out session, forcing the browser down');
  }
  // Wait for client.pupBrowser to be disconnected before deleting the folder: dropping the Map entry
  // earlier would let a /session/start launch a second browser on a profile that is being removed
  await waitForBrowserToClose(client);
  // Drop the entry even when the browser refused to die: a dead client left in the Map makes
  // /session/start answer "already exists" and pins the status at session_not_ready
  sessions.delete(sessionId);
  sessionWebhooks.delete(sessionId);
  envWebhooks.delete(sessionId);
  await deleteSessionFolder(sessionId);
};

// Function to handle session flush
const flushSessions = async deleteOnlyInactive => {
  try {
    // Read the contents of the sessions folder
    const files = await fs.promises.readdir(sessionFolderPath);
    // Iterate through the files in the parent folder
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/);
      if (match) {
        const sessionId = match[1];
        const validation = await validateSession(sessionId);
        // A session that is only on disk (stopped, or never auto-started) is not "inactive": its
        // credentials are meant to survive, so only terminateAll reaches it
        if (deleteOnlyInactive && (validation.success || validation.message === 'session_not_found')) {
          continue;
        }
        await deleteSession(sessionId, validation);
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to flush sessions');
    throw error;
  }
};

// Close every browser on process shutdown so Docker restarts do not leave Chromium orphans
const shutdownSessions = async () => {
  await Promise.all(
    Array.from(sessions.entries()).map(async ([sessionId, client]) => {
      try {
        if (client.pupPage) {
          client.pupPage.removeAllListeners('close');
          client.pupPage.removeAllListeners('error');
        }
        await Promise.race([client.destroy(), sleep(5000)]);
        if (client.pupBrowser?.isConnected()) {
          client.pupBrowser.process()?.kill(9);
        }
      } catch (error) {
        logger.error({ sessionId, err: error }, 'Failed to close session on shutdown');
      }
      sessions.delete(sessionId);
    }),
  );
};

module.exports = {
  sessions,
  setupSession,
  initializeEvents,
  ensureSessionFolder,
  restoreSessions,
  validateSession,
  deleteSession,
  destroySession,
  reloadSession,
  flushSessions,
  shutdownSessions,
  setSessionWebhook,
  getSessionWebhook,
};
