const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('node:fs');
const path = require('node:path');
const { formatBytes, isValidUrl } = require('@julianobazzi/utils');
const sessions = new Map();
const { baseWebhookURL, sessionFolderPath, maxAttachmentSize, setMessagesAsSeen, webVersion, webVersionCacheType, recoverSessions } = require('./config');
const { triggerWebhook, waitForNestedObject, isEventEnabled } = require('./utils');

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
    // wait until the client is created
    try {
      await waitForNestedObject(client, 'pupPage');
    } catch (err) {
      return { success: false, state: null, message: err.message };
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
    console.log(error);
    return { success: false, state: null, message: error.message };
  }
};

// Function to handle client session restoration
const restoreSessions = () => {
  try {
    if (!fs.existsSync(sessionFolderPath)) {
      fs.mkdirSync(sessionFolderPath); // Create the session directory if it doesn't exist
    }
    // Read the contents of the folder
    fs.readdir(sessionFolderPath, (error, files) => {
      if (error) {
        console.error('Failed to read sessions folder:', error);
        return;
      }
      // Iterate through the files in the parent folder
      for (const file of files) {
        // Use regular expression to extract the string from the folder name
        const match = file.match(/^session-(.+)$/);
        if (match) {
          const sessionId = match[1];
          console.log('existing session detected', sessionId);
          setupSession(sessionId);
        }
      }
    });
  } catch (error) {
    console.log(error);
    console.error('Failed to restore sessions:', error);
  }
};

// Setup Session
const setupSession = sessionId => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) };
    }

    // Disable the delete folder from the logout function (will be handled separately)
    const localAuth = new LocalAuth({ clientId: sessionId, dataPath: sessionFolderPath });
    localAuth.logout = () => {};

    const clientOptions = {
      puppeteer: {
        executablePath: process.env.CHROME_BIN || null,
        // headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
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

    client.initialize().catch(err => console.log('Initialize error:', err.message));

    initializeEvents(client, sessionId);

    // Save the session to the Map
    sessions.set(sessionId, client);
    return { success: true, message: 'Session initiated successfully', client };
  } catch (error) {
    return { success: false, message: error.message, client: null };
  }
};

const initializeEvents = (client, sessionId) => {
  // check if the session webhook is overridden
  const customWebhook = process.env[`${sessionId.toUpperCase()}_WEBHOOK_URL`];
  let sessionWebhook = baseWebhookURL;
  if (customWebhook) {
    if (isValidUrl(customWebhook)) {
      sessionWebhook = customWebhook;
    } else {
      console.error(`Invalid ${sessionId.toUpperCase()}_WEBHOOK_URL (${customWebhook}), falling back to BASE_WEBHOOK_URL`);
    }
  }

  if (recoverSessions) {
    waitForNestedObject(client, 'pupPage')
      .then(() => {
        const restartSession = async sessionId => {
          sessions.delete(sessionId);
          await client.destroy().catch(_e => {});
          setupSession(sessionId);
        };
        client.pupPage.once('close', () => {
          // emitted when the page closes
          console.log(`Browser page closed for ${sessionId}. Restoring`);
          restartSession(sessionId);
        });
        client.pupPage.once('error', () => {
          // emitted when the page crashes
          console.log(`Error occurred on browser page for ${sessionId}. Restoring`);
          restartSession(sessionId);
        });
      })
      .catch(_e => {});
  }

  if (isEventEnabled('auth_failure')) {
    client.on('auth_failure', msg => {
      triggerWebhook(sessionWebhook, sessionId, 'status', { msg });
    });
  }

  if (isEventEnabled('authenticated')) {
    client.on('authenticated', () => {
      triggerWebhook(sessionWebhook, sessionId, 'authenticated');
    });
  }

  if (isEventEnabled('call')) {
    client.on('call', async call => {
      triggerWebhook(sessionWebhook, sessionId, 'call', { call });
    });
  }

  if (isEventEnabled('change_state')) {
    client.on('change_state', state => {
      triggerWebhook(sessionWebhook, sessionId, 'change_state', { state });
    });
  }

  if (isEventEnabled('disconnected')) {
    client.on('disconnected', reason => {
      triggerWebhook(sessionWebhook, sessionId, 'disconnected', { reason });
    });
  }

  if (isEventEnabled('group_join')) {
    client.on('group_join', notification => {
      triggerWebhook(sessionWebhook, sessionId, 'group_join', { notification });
    });
  }

  if (isEventEnabled('group_leave')) {
    client.on('group_leave', notification => {
      triggerWebhook(sessionWebhook, sessionId, 'group_leave', { notification });
    });
  }

  if (isEventEnabled('group_update')) {
    client.on('group_update', notification => {
      triggerWebhook(sessionWebhook, sessionId, 'group_update', { notification });
    });
  }

  if (isEventEnabled('loading_screen')) {
    client.on('loading_screen', (percent, message) => {
      triggerWebhook(sessionWebhook, sessionId, 'loading_screen', { percent, message });
    });
  }

  if (isEventEnabled('media_uploaded')) {
    client.on('media_uploaded', message => {
      triggerWebhook(sessionWebhook, sessionId, 'media_uploaded', { message });
    });
  }

  if (isEventEnabled('message')) {
    client.on('message', async message => {
      triggerWebhook(sessionWebhook, sessionId, 'message', { message });
      if (message.hasMedia) {
        const attachmentSize = message._data?.size;
        if (typeof attachmentSize === 'number' && attachmentSize < maxAttachmentSize) {
          // custom service event
          if (isEventEnabled('media')) {
            message
              .downloadMedia()
              .then(messageMedia => {
                triggerWebhook(sessionWebhook, sessionId, 'media', { messageMedia, message });
              })
              .catch(e => {
                console.log('Download media error:', e.message);
              });
          }
        } else if (typeof attachmentSize === 'number') {
          console.log(`Skipping media download for ${sessionId}: attachment of ${formatBytes(attachmentSize)} exceeds the ${formatBytes(maxAttachmentSize)} limit`);
        }
      }
      if (setMessagesAsSeen) {
        try {
          const chat = await message.getChat();
          await chat.sendSeen();
        } catch (e) {
          console.log('sendSeen error:', e.message);
        }
      }
    });
  }

  if (isEventEnabled('message_ack')) {
    client.on('message_ack', async (message, ack) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_ack', { message, ack });
      if (setMessagesAsSeen) {
        try {
          const chat = await message.getChat();
          await chat.sendSeen();
        } catch (e) {
          console.log('sendSeen error:', e.message);
        }
      }
    });
  }

  if (isEventEnabled('message_create')) {
    client.on('message_create', async message => {
      triggerWebhook(sessionWebhook, sessionId, 'message_create', { message });
      if (setMessagesAsSeen) {
        try {
          const chat = await message.getChat();
          await chat.sendSeen();
        } catch (e) {
          console.log('sendSeen error:', e.message);
        }
      }
    });
  }

  if (isEventEnabled('message_reaction')) {
    client.on('message_reaction', reaction => {
      triggerWebhook(sessionWebhook, sessionId, 'message_reaction', { reaction });
    });
  }

  if (isEventEnabled('message_edit')) {
    client.on('message_edit', (message, newBody, prevBody) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_edit', { message, newBody, prevBody });
    });
  }

  if (isEventEnabled('message_ciphertext')) {
    client.on('message_ciphertext', message => {
      triggerWebhook(sessionWebhook, sessionId, 'message_ciphertext', { message });
    });
  }

  if (isEventEnabled('message_revoke_everyone')) {
    // eslint-disable-next-line camelcase
    client.on('message_revoke_everyone', async message => {
      // eslint-disable-next-line camelcase
      triggerWebhook(sessionWebhook, sessionId, 'message_revoke_everyone', { message });
    });
  }

  if (isEventEnabled('message_revoke_me')) {
    client.on('message_revoke_me', async message => {
      triggerWebhook(sessionWebhook, sessionId, 'message_revoke_me', { message });
    });
  }

  client.on('qr', qr => {
    // inject qr code into session
    client.qr = qr;
    if (isEventEnabled('qr')) {
      triggerWebhook(sessionWebhook, sessionId, 'qr', { qr });
    }
  });

  if (isEventEnabled('ready')) {
    client.on('ready', () => {
      triggerWebhook(sessionWebhook, sessionId, 'ready');
    });
  }

  if (isEventEnabled('contact_changed')) {
    client.on('contact_changed', async (message, oldId, newId, isContact) => {
      triggerWebhook(sessionWebhook, sessionId, 'contact_changed', { message, oldId, newId, isContact });
    });
  }

  if (isEventEnabled('chat_removed')) {
    client.on('chat_removed', async chat => {
      triggerWebhook(sessionWebhook, sessionId, 'chat_removed', { chat });
    });
  }

  if (isEventEnabled('chat_archived')) {
    client.on('chat_archived', async (chat, currState, prevState) => {
      triggerWebhook(sessionWebhook, sessionId, 'chat_archived', { chat, currState, prevState });
    });
  }

  if (isEventEnabled('unread_count')) {
    client.on('unread_count', async chat => {
      triggerWebhook(sessionWebhook, sessionId, 'unread_count', { chat });
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
    console.log('Folder deletion error', error);
    throw error;
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
        await Promise.race([client.pupBrowser.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
      }
    } catch (_e) {
      const childProcess = client.pupBrowser?.process?.();
      if (childProcess) {
        childProcess.kill(9);
      }
    }
    sessions.delete(sessionId);
    setupSession(sessionId);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const deleteSession = async (sessionId, validation) => {
  try {
    const client = sessions.get(sessionId);
    if (!client) {
      return;
    }
    if (client.pupPage) {
      client.pupPage.removeAllListeners('close');
      client.pupPage.removeAllListeners('error');
    }
    if (validation.success) {
      // Client Connected, request logout
      console.log(`Logging out session ${sessionId}`);
      await client.logout();
    } else if (validation.message === 'session_not_connected') {
      // Client not Connected, request destroy
      console.log(`Destroying session ${sessionId}`);
      await client.destroy();
    }
    // Wait 10 secs for client.pupBrowser to be disconnected before deleting the folder
    let maxDelay = 0;
    while (client.pupBrowser?.isConnected() && maxDelay < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      maxDelay++;
    }
    await deleteSessionFolder(sessionId);
    sessions.delete(sessionId);
  } catch (error) {
    console.log(error);
    throw error;
  }
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
        if (!deleteOnlyInactive || !validation.success) {
          await deleteSession(sessionId, validation);
        }
      }
    }
  } catch (error) {
    console.log(error);
    throw error;
  }
};

module.exports = {
  sessions,
  setupSession,
  restoreSessions,
  validateSession,
  deleteSession,
  reloadSession,
  flushSessions,
};
