const qr = require('qr-image');
const { onlyNumbers, isValidUrl } = require('@julianobazzi/utils');
const { setupSession, deleteSession, destroySession, reloadSession, validateSession, flushSessions, sessions, setSessionWebhook, getSessionWebhook } = require('../sessions');
const { sendErrorResponse, waitForNestedObject, exposeFunctionIfAbsent } = require('../utils');
const { logger } = require('../logger');

/**
 * Starts a session for the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @param {string} [req.body.webhookUrl] - Optional webhook URL for this session (POST only).
 * @returns {Promise<void>}
 * @throws {Error} If there was an error starting the session.
 */
const startSession = async (req, res) => {
  // #swagger.summary = 'Start new session'
  // #swagger.description = 'Starts a session for the given session ID. On POST, accepts an optional webhookUrl in the body to override BASE_WEBHOOK_URL for this session.'
  /*
    #swagger.requestBody = {
      required: false,
      schema: {
        type: 'object',
        properties: {
          webhookUrl: {
            type: 'string',
            description: 'Optional webhook URL for this session. Overrides BASE_WEBHOOK_URL and <SESSIONID>_WEBHOOK_URL.',
            example: 'https://your-server.com/webhook/my-session'
          }
        }
      }
    }
  */
  try {
    const sessionId = req.params.sessionId;
    const { webhookUrl } = req.body || {};
    // Rejected before setup, so a bad URL never leaves a browser running behind a 422
    if (webhookUrl && !isValidUrl(webhookUrl)) {
      return sendErrorResponse(res, 422, `Invalid webhook URL: ${webhookUrl}`);
    }
    const setupSessionReturn = setupSession(sessionId);
    if (setupSessionReturn.success && webhookUrl) {
      // Applied after setup so the session already exists and the override reaches disk
      setSessionWebhook(sessionId, webhookUrl);
    }
    if (!setupSessionReturn.success) {
      /* #swagger.responses[422] = {
        description: "Unprocessable Entity.",
        content: {
          "application/json": {
            schema: { "$ref": "#/definitions/ErrorResponse" }
          }
        }
      }
      */
      sendErrorResponse(res, 422, setupSessionReturn.message);
      return;
    }
    /* #swagger.responses[200] = {
      description: "Status of the initiated session.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/StartSessionResponse" }
        }
      }
    }
    */
    // wait until the client is created
    waitForNestedObject(setupSessionReturn.client, 'pupPage')
      .then(() => res.json({ success: true, message: setupSessionReturn.message }))
      .catch(err => {
        sendErrorResponse(res, 500, err.message);
      });
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ sessionId: req.params.sessionId, err: error }, 'startSession failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Status of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const statusSession = async (req, res) => {
  // #swagger.summary = 'Get session status'
  // #swagger.description = 'Status of the session with the given session ID.'
  try {
    const sessionId = req.params.sessionId;
    const sessionData = await validateSession(sessionId);
    /* #swagger.responses[200] = {
      description: "Status of the session.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/StatusSessionResponse" }
        }
      }
    }
    */
    res.json(sessionData);
  } catch (error) {
    logger.error({ sessionId: req.params.sessionId, err: error }, 'statusSession failed');
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * QR code of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const sessionQrCode = async (req, res) => {
  // #swagger.summary = 'Get session QR code'
  // #swagger.description = 'QR code of the session with the given session ID.'
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    /* #swagger.responses[200] = {
      description: "QR code string, or a message when unavailable.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/QrCodeResponse" }
        }
      }
    }
    */
    if (!session) {
      return res.json({ success: false, message: 'session_not_found' });
    }
    if (session.qr) {
      return res.json({ success: true, qr: session.qr });
    }
    return res.json({ success: false, message: 'qr code not ready or already scanned' });
  } catch (error) {
    logger.error({ sessionId: req.params.sessionId, err: error }, 'sessionQrCode failed');
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * QR code as image of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const sessionQrCodeImage = async (req, res) => {
  // #swagger.summary = 'Get session QR code as image'
  // #swagger.description = 'QR code as image of the session with the given session ID.'
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    if (!session) {
      return res.json({ success: false, message: 'session_not_found' });
    }
    /* #swagger.responses[200] = {
        description: "QR image (PNG), or JSON when the session/QR is unavailable.",
        content: {
          "image/png": {},
          "application/json": {
            schema: { "$ref": "#/definitions/QrCodeNotReadyResponse" }
          }
        }
      }
    */
    if (session.qr) {
      const qrImage = qr.image(session.qr);
      res.writeHead(200, {
        'Content-Type': 'image/png',
      });
      return qrImage.pipe(res);
    }
    return res.json({ success: false, message: 'qr code not ready or already scanned' });
  } catch (error) {
    logger.error({ sessionId: req.params.sessionId, err: error }, 'sessionQrCodeImage failed');
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Restarts the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to terminate.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the session.
 */
const restartSession = async (req, res) => {
  // #swagger.summary = 'Restart session'
  // #swagger.description = 'Restarts the session with the given session ID.'
  try {
    const sessionId = req.params.sessionId;
    const validation = await validateSession(sessionId);
    if (validation.message === 'session_not_found') {
      return res.json(validation);
    }
    await reloadSession(sessionId);
    /* #swagger.responses[200] = {
      description: "Sessions restarted.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/RestartSessionResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'Restarted successfully' });
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ sessionId: req.params.sessionId, err: error }, 'restartSession failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to terminate.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the session.
 */
const terminateSession = async (req, res) => {
  // #swagger.summary = 'Terminate session'
  // #swagger.description = 'Terminates the session with the given session ID.'
  try {
    const sessionId = req.params.sessionId;
    const validation = await validateSession(sessionId);
    if (validation.message === 'session_not_found') {
      return res.json(validation);
    }
    await deleteSession(sessionId, validation);
    /* #swagger.responses[200] = {
      description: "Sessions terminated.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/TerminateSessionResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ sessionId: req.params.sessionId, err: error }, 'terminateSession failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates all inactive sessions.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the sessions.
 */
const terminateInactiveSessions = async (req, res) => {
  // #swagger.summary = 'Terminate inactive sessions'
  // #swagger.description = 'Terminates all inactive sessions.'
  try {
    await flushSessions(true);
    /* #swagger.responses[200] = {
      description: "Sessions terminated.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/TerminateSessionsResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'Flush completed successfully' });
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ sessionId: req.params.sessionId, err: error }, 'terminateInactiveSessions failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates all sessions.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the sessions.
 */
const terminateAllSessions = async (req, res) => {
  // #swagger.summary = 'Terminate all sessions'
  // #swagger.description = 'Terminates all sessions.'
  try {
    await flushSessions(false);
    /* #swagger.responses[200] = {
      description: "Sessions terminated.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/TerminateSessionsResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'Flush completed successfully' });
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ sessionId: req.params.sessionId, err: error }, 'terminateAllSessions failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Lists the sessions currently loaded in memory.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {Promise<void>}
 */
const getSessions = async (req, res) => {
  // #swagger.summary = 'Get all sessions'
  // #swagger.description = 'Lists the IDs of every session currently loaded in memory.'
  /* #swagger.responses[200] = {
    description: "Retrieved all sessions.",
    content: {
      "application/json": {
        schema: { "$ref": "#/definitions/GetSessionsResponse" }
      }
    }
  }
  */
  res.json({ success: true, result: Array.from(sessions.keys()) });
};

/**
 * Stops the session with the given session ID, keeping its credentials on disk.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to stop.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error stopping the session.
 */
const stopSession = async (req, res) => {
  // #swagger.summary = 'Stop session'
  // #swagger.description = 'Stops the session without deleting its credentials, so it can be started again without scanning a new QR code.'
  try {
    const sessionId = req.params.sessionId;
    if (!sessions.has(sessionId)) {
      return res.json({ success: false, message: 'session_not_found' });
    }
    await destroySession(sessionId);
    /* #swagger.responses[200] = {
      description: "Session stopped.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/StopSessionResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'Session stopped successfully' });
  } catch (error) {
    logger.error({ sessionId: req.params.sessionId, err: error }, 'stopSession failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Requests a pairing code, so a session can be authenticated by phone number instead of a QR code.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.phoneNumber - Phone number in international, symbol-free format.
 * @param {boolean} [req.body.showNotification] - Show the pairing notification on the phone.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error requesting the pairing code.
 */
const requestPairingCode = async (req, res) => {
  // #swagger.summary = 'Request authentication via pairing code'
  // #swagger.description = 'Requests a pairing code for the session, as an alternative to scanning the QR code. The session must be started and waiting for authentication.'
  /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number in international, symbol-free format',
            example: '5551999998888'
          },
          showNotification: {
            type: 'boolean',
            description: 'Show the pairing notification on the phone',
            example: true
          }
        }
      }
    }
  */
  const sessionId = req.params.sessionId;
  try {
    const { phoneNumber, showNotification = true } = req.body || {};
    const digits = onlyNumbers(String(phoneNumber ?? ''));
    if (!digits) {
      return sendErrorResponse(res, 422, 'phoneNumber is required');
    }
    const client = sessions.get(sessionId);
    if (!client) {
      return res.json({ success: false, message: 'session_not_found' });
    }
    if (!client.pupPage) {
      return res.json({ success: false, message: 'session_not_ready' });
    }
    // whatsapp-web.js re-exposes onCodeReceivedEvent on every call and throws if it already exists
    // (see pedroslopez/whatsapp-web.js#3706); expose it ourselves so the 'code' event still fires.
    await exposeFunctionIfAbsent(client.pupPage, 'onCodeReceivedEvent', async code => {
      client.emit('code', code);
      return code;
    });
    const result = await client.requestPairingCode(digits, showNotification);
    /* #swagger.responses[200] = {
      description: "Pairing code generated.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/PairingCodeResponse" }
        }
      }
    }
    */
    res.json({ success: true, result });
  } catch (error) {
    logger.error({ sessionId, err: error }, 'requestPairingCode failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Sets or clears the webhook URL of a session at runtime.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.webhookUrl - The webhook URL, or an empty value to clear it.
 * @returns {Promise<void>}
 */
const setWebhook = async (req, res) => {
  // #swagger.summary = 'Set session webhook URL'
  // #swagger.description = 'Sets the webhook URL of a session at runtime, taking precedence over <SESSIONID>_WEBHOOK_URL and BASE_WEBHOOK_URL. Send an empty webhookUrl to clear it and fall back to the environment. Persisted on disk for sessions that were already started.'
  /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          webhookUrl: {
            type: 'string',
            description: 'The webhook URL for this session. Send an empty string or null to clear it.',
            example: 'https://your-server.com/webhook/my-session'
          }
        }
      }
    }
  */
  const sessionId = req.params.sessionId;
  try {
    const { webhookUrl } = req.body || {};
    const result = setSessionWebhook(sessionId, webhookUrl);
    if (!result.success) {
      return sendErrorResponse(res, 422, result.message);
    }
    /* #swagger.responses[200] = {
      description: "Webhook URL updated.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/SetWebhookResponse" }
        }
      }
    }
    */
    res.json(result);
  } catch (error) {
    logger.error({ sessionId, err: error }, 'setWebhook failed');
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Returns the webhook URL a session notifies, and where that value came from.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID.
 * @returns {Promise<void>}
 */
const getWebhook = async (req, res) => {
  // #swagger.summary = 'Get session webhook URL'
  // #swagger.description = 'Returns the webhook URL a session notifies and its source: runtime (set via API), env_session (<SESSIONID>_WEBHOOK_URL), env_global (BASE_WEBHOOK_URL) or none.'
  const sessionId = req.params.sessionId;
  try {
    /* #swagger.responses[200] = {
      description: "Current webhook URL and source.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/GetWebhookResponse" }
        }
      }
    }
    */
    res.json(getSessionWebhook(sessionId));
  } catch (error) {
    logger.error({ sessionId, err: error }, 'getWebhook failed');
    sendErrorResponse(res, 500, error.message);
  }
};

module.exports = {
  startSession,
  statusSession,
  sessionQrCode,
  sessionQrCodeImage,
  restartSession,
  terminateSession,
  terminateInactiveSessions,
  terminateAllSessions,
  getSessions,
  stopSession,
  requestPairingCode,
  setWebhook,
  getWebhook,
};
