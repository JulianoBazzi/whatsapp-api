const express = require('express');
const { restoreSessions } = require('./sessions');
const { routes } = require('./routes');
const { maxAttachmentSize, trustProxy } = require('./config');

const app = express();

// Initialize Express app
app.disable('x-powered-by');
if (trustProxy !== false) {
  app.set('trust proxy', trustProxy);
}
app.use(express.json({ limit: maxAttachmentSize + 1000000 }));
app.use(express.urlencoded({ limit: maxAttachmentSize + 1000000, extended: true }));
app.use('/', routes);

restoreSessions();

module.exports = app;
