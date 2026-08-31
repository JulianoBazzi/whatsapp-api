const axios = require('axios');
const { isValidPhone, onlyNumbers } = require('@julianobazzi/utils');
const { globalApiKey, disabledCallbacks, webhookTimeoutMs, webhookRetries, webhookRetryDelayMs, ownMessageCaptureTimeoutMs } = require('./config');
const { logger } = require('./logger');

// Pause execution for the given number of milliseconds
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A webhook attempt is worth repeating only when the receiver never answered (network/timeout) or failed on its side (5xx).
// A 4xx means the payload was rejected: repeating it would just fail again.
const isRetryableWebhookError = error => !error.response || error.response.status >= 500;

// Trigger webhook endpoint. Fire-and-forget for callers; retries happen in the background.
const triggerWebhook = (webhookURL, sessionId, dataType, data) => {
  const payload = { dataType, data, sessionId };

  const deliver = async () => {
    for (let attempt = 0; attempt <= webhookRetries; attempt++) {
      try {
        await axios.post(webhookURL, payload, { headers: { 'x-api-key': globalApiKey }, timeout: webhookTimeoutMs });
        return;
      } catch (error) {
        const hasAttemptsLeft = attempt < webhookRetries;
        if (!hasAttemptsLeft || !isRetryableWebhookError(error)) {
          // Only the useful fields: an axios error carries the whole request/response/config graph,
          // which would put several KB of noise in the log on every failed event.
          const err = { message: error.message, code: error.code, status: error.response?.status };
          logger.error({ sessionId, dataType, err, attempts: attempt + 1 }, `Failed to send webhook message to ${webhookURL}`);
          return;
        }
        // Exponential backoff: 1s, 2s, 4s...
        await sleep(webhookRetryDelayMs * 2 ** attempt);
      }
    }
  };

  deliver();
};

// Function to send a response with error status and message
const sendErrorResponse = (res, status, error) => {
  const message = error instanceof Error ? error.message : error;
  if (error instanceof Error) {
    logger.error({ err: error }, message);
  }
  res.status(status).json({ success: false, error: message });
};

// Function to wait for a specific item not to be null
const waitForNestedObject = (rootObj, nestedPath, maxWaitTime = 10000, interval = 100) => {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const checkObject = () => {
      const nestedObj = nestedPath.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), rootObj);
      if (nestedObj) {
        // Nested object exists, resolve the promise
        resolve();
      } else if (Date.now() - start > maxWaitTime) {
        // Maximum wait time exceeded, reject the promise
        logger.error(`Timed out waiting for ${nestedPath}`);
        reject(new Error('Timeout waiting for nested object'));
      } else {
        // Nested object not yet created, continue waiting
        setTimeout(checkObject, interval);
      }
    };
    checkObject();
  });
};

// Check if a callback event is enabled (not listed in DISABLED_CALLBACKS)
const isEventEnabled = event => !disabledCallbacks.includes(event);

// Mark the chat of a given message as seen
const sendMessageSeenStatus = async message => {
  try {
    const chat = await message.getChat();
    await chat.sendSeen();
  } catch (error) {
    logger.error({ err: error }, 'Failed to send seen status');
  }
};

// Expose a function to the page only once — re-exposing the same name throws in puppeteer
const exposeFunctionIfAbsent = async (page, name, fn) => {
  const exists = await page.evaluate(fnName => !!window[fnName], name);
  if (exists) {
    return;
  }
  await page.exposeFunction(name, fn);
};

// Convert a Brazilian phone number into a WhatsApp chat id (55DDDNUMBER@c.us)
const phoneToChatId = phone => {
  const digits = onlyNumbers(String(phone ?? ''));
  const localNumber = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (!isValidPhone(localNumber)) {
    return null;
  }
  return `55${localNumber}@c.us`;
};

// Qualify a contact id: keep @c.us / @lid / other servers; append @c.us only for bare digits
const toContactId = contactId => {
  if (contactId == null || contactId === '') {
    return null;
  }
  const value = String(contactId);
  if (value.includes('@')) {
    return value;
  }
  return `${value}@c.us`;
};

// On WhatsApp Web builds that renamed `_serialized`, the library loses the message it has just sent
// and hands back nothing. The message did go out though, and it comes back on `message_create` — so
// watch that event and recover it from there. Matching is on the chat plus, for text, the body.
// `expectQuoted` narrows a reply to messages that actually carry a quote, so a plain message sent in
// the same instant with the same text is not mistaken for it.
const matchesOwnMessage = (message, chatId, content, contentType, expectQuoted = false) => {
  if (!message?.id?.fromMe) {
    return false;
  }
  if (message.id.remote !== chatId && message.to !== chatId) {
    return false;
  }
  if (expectQuoted && !message.hasQuotedMsg) {
    return false;
  }
  if (contentType === 'string' && typeof content === 'string') {
    return message.body === content;
  }
  return true;
};

// Returns { promise, cancel }. The caller MUST call cancel() in a finally, or the listener and the
// timer outlive the request.
const captureOwnMessage = (client, chatId, content, contentType, expectQuoted = false) => {
  let settle;
  let timer = null;

  const onMessageCreate = message => {
    if (matchesOwnMessage(message, chatId, content, contentType, expectQuoted)) {
      settle(message);
    }
  };

  const promise = new Promise(resolve => {
    settle = message => {
      clearTimeout(timer);
      client.off('message_create', onMessageCreate);
      resolve(message);
    };
  });

  timer = setTimeout(() => settle(undefined), ownMessageCaptureTimeoutMs);
  client.on('message_create', onMessageCreate);

  return { promise, cancel: () => settle(undefined) };
};

module.exports = {
  triggerWebhook,
  sendErrorResponse,
  waitForNestedObject,
  isEventEnabled,
  sendMessageSeenStatus,
  exposeFunctionIfAbsent,
  sleep,
  phoneToChatId,
  toContactId,
  matchesOwnMessage,
  captureOwnMessage,
};
