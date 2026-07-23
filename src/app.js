const express = require('express');
const { ensureSessionFolder } = require('./sessions');
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

// Only the folder: restoring the sessions themselves is the server's job (see server.js),
// so importing this module never launches browsers.
ensureSessionFolder();

module.exports = app;
