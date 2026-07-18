const axios = require('axios');
const { isValidPhone, onlyNumbers } = require('@julianobazzi/utils');
const { globalApiKey, disabledCallbacks } = require('./config');

// Trigger webhook endpoint
const triggerWebhook = (webhookURL, sessionId, dataType, data) => {
  axios
    .post(webhookURL, { dataType, data, sessionId }, { headers: { 'x-api-key': globalApiKey } })
    .catch(error => console.error('Failed to send new message webhook:', sessionId, dataType, error.message, data || ''));
};

// Function to send a response with error status and message
const sendErrorResponse = (res, status, message) => {
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
        console.log('Timed out waiting for nested object');
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

// Convert a Brazilian phone number into a WhatsApp chat id (55DDDNUMBER@c.us)
const phoneToChatId = phone => {
  const digits = onlyNumbers(String(phone ?? ''));
  const localNumber = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (!isValidPhone(localNumber)) {
    return null;
  }
  return `55${localNumber}@c.us`;
};

module.exports = {
  triggerWebhook,
  sendErrorResponse,
  waitForNestedObject,
  isEventEnabled,
  phoneToChatId,
};
