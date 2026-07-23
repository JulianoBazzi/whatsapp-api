const pino = require('pino');
const { logLevel } = require('./config');

// Structured logger. Writes to stdout asynchronously so a slow/blocked pipe never stalls the event loop.
const logger = pino({ level: logLevel }, pino.destination(1, { sync: false }));

module.exports = { logger };
