const fs = require('node:fs');
const qrcode = require('qrcode-terminal');
const pkg = require('../../package.json');
const { sessionFolderPath } = require('../config');
const { sendErrorResponse } = require('../utils');

const apiVersion = pkg.version;
const waWebJsVersion = pkg.dependencies['whatsapp-web.js'];
const repoUrl = pkg.homepage;

/**
 * Serves a simple HTML landing page with API and engine versions
 *
 * @function index
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const index = async (req, res) => {
  /*
    #swagger.ignore = true
  */
  try {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp REST API</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: system-ui, sans-serif;
      max-width: 36rem;
      margin: 3rem auto;
      padding: 0 1.25rem;
      line-height: 1.5;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { margin: 0.75rem 0; color: #444; }
    @media (prefers-color-scheme: dark) {
      p { color: #bbb; }
    }
    a { color: inherit; }
    code { font-size: 0.95em; }
    ul { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>WhatsApp REST API</h1>
  <p>
    Running version <strong>${apiVersion}</strong> of
    <a href="${repoUrl}">JulianoBazzi/whatsapp-api</a>.
  </p>
  <p>
    Engine: <strong>whatsapp-web.js</strong> <code>${waWebJsVersion}</code>
  </p>
  <ul>
    <li><a href="/ping"><code>/ping</code></a> — health check</li>
  </ul>
</body>
</html>`);
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Responds to ping request with 'pong'
 *
 * @function ping
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const ping = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Health check'
    #swagger.description = 'Returns pong when the server is alive.'
  */
  try {
    /* #swagger.responses[200] = {
      description: "Server is alive.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/PingResponse" }
        }
      }
    }
    */
    res.json({ success: true, message: 'pong' });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Example local callback function that generates a QR code and writes a log file
 *
 * @function localCallbackExample
 * @async
 * @param {Object} req - Express request object containing a body object with dataType and data
 * @param {string} req.body.dataType - Type of data (in this case, 'qr')
 * @param {Object} req.body.data - Data to generate a QR code from
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const localCallbackExample = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Local callback example'
    #swagger.description = 'Example webhook receiver that logs payloads and prints QR codes to the terminal.'
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          dataType: {
            type: 'string',
            description: 'Event type from the session webhook',
            example: 'qr'
          },
          data: {
            type: 'object',
            description: 'Event payload',
            example: { qr: '...' }
          },
          sessionId: {
            type: 'string',
            description: 'Session that emitted the event',
            example: 'mysession'
          }
        }
      }
    }
  */
  try {
    const { dataType, data } = req.body;
    if (dataType === 'qr') {
      qrcode.generate(data.qr, { small: true });
    }
    fs.writeFile(`${sessionFolderPath}/message_log.txt`, `${JSON.stringify(req.body)}\r\n`, { flag: 'a+' }, _ => _);
    res.json({ success: true });
  } catch (error) {
    fs.writeFile(`${sessionFolderPath}/message_log.txt`, `(ERROR) ${JSON.stringify(error)}\r\n`, { flag: 'a+' }, _ => _);
    sendErrorResponse(res, 500, error);
  }
};

module.exports = { index, ping, localCallbackExample };
