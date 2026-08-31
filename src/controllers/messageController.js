const { MessageMedia, Location, Poll } = require('whatsapp-web.js');
const { sessions } = require('../sessions');
const { sendErrorResponse, toContactId } = require('../utils');
const { logger } = require('../logger');

/**
 * Get message by its ID from a given chat using the provided client.
 * @async
 * @function
 * @param {object} client - The chat client.
 * @param {string} messageId - The ID of the message to get.
 * @param {string} chatId - The ID of the chat to search in.
 * @returns {Promise<object>} - A Promise that resolves with the message object that matches the provided ID, or undefined if no such message exists.
 * @throws {Error} - Throws an error if the provided client, message ID or chat ID is invalid.
 */
const _serializedMessageIds = (messageId, chatId) => {
  if (String(messageId).includes('_')) {
    return [messageId];
  }
  // The `false_` candidates are what incoming messages serialize to. Without them every inbound
  // media lookup fell through to the fetchMessages scan below, which is the slow path and the only
  // one left when Msg.get misses. New candidates go last so the outgoing ones keep winning first.
  return [`true_${chatId}_${messageId}_out`, `true_${chatId}_${messageId}`, `false_${chatId}_${messageId}`, `false_${chatId}_${messageId}_in`];
};

const _getMessageBySerializedId = async (client, messageId, chatId) => {
  for (const serializedId of _serializedMessageIds(messageId, chatId)) {
    try {
      const message = await client.getMessageById(serializedId);
      if (message) {
        return message;
      }
    } catch (error) {
      logger.warn({ err: error, serializedId }, 'getMessageById failed');
    }
  }
  return undefined;
};

const _getMessageById = async (client, messageId, chatId) => {
  const messageById = await _getMessageBySerializedId(client, messageId, chatId);
  if (messageById) {
    return messageById;
  }

  try {
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    return messages.find(message => {
      return message.id.id === messageId;
    });
  } catch (error) {
    logger.warn({ err: error, chatId }, 'fetchMessages lookup failed');
    return undefined;
  }
};

/**
 * Gets information about a message's class.
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID.
 * @param {string} req.body.chatId - The chat ID.
 * @returns {Promise<void>} - A Promise that resolves with no value when the function completes.
 */
const getClassInfo = async (req, res) => {
  // #swagger.summary = 'Get message class info'
  // #swagger.description = 'Gets information about a message by chatId and messageId.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    res.json({ success: true, message });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Deletes a message.
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID.
 * @param {string} req.body.chatId - The chat ID.
 * @param {boolean} req.body.everyone - Whether to delete the message for everyone or just the sender.
 * @returns {Promise<void>} - A Promise that resolves with no value when the function completes.
 */
const deleteMessage = async (req, res) => {
  // #swagger.summary = 'Delete message'
  // #swagger.description = 'Deletes a message. Optionally delete for everyone.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'The Chat id which contains the message', example: '6281288888888@c.us' },
          messageId: { type: 'string', description: 'Unique whatsApp identifier for the message', example: 'ABCDEF999999999' },
          everyone: { type: 'boolean', description: 'If true, delete for everyone when supported', example: true }
        }
      }
    }
    */
    const { messageId, chatId, everyone } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const result = await message.delete(everyone);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Downloads media from a message.
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID.
 * @param {string} req.body.chatId - The chat ID.
 * @returns {Promise<void>} - A Promise that resolves with no value when the function completes.
 */
const downloadMedia = async (req, res) => {
  // #swagger.summary = 'Download message media'
  // #swagger.description = 'Downloads media from a message.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'The Chat id which contains the message', example: '6281288888888@c.us' },
          messageId: { type: 'string', description: 'Unique whatsApp identifier for the message', example: 'ABCDEF999999999' }
        }
      }
    }
    */
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const messageMedia = await message.downloadMedia();
    res.json({ success: true, messageMedia });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Forwards a message to a destination chat.
 * @async
 * @function forward
 * @param {Object} req - The request object received by the server.
 * @param {Object} req.body - The body of the request object.
 * @param {string} req.body.messageId - The ID of the message to forward.
 * @param {string} req.body.chatId - The ID of the chat that contains the message to forward.
 * @param {string} req.body.destinationChatId - The ID of the chat to forward the message to.
 * @param {string} req.params.sessionId - The ID of the session to use the Telegram API with.
 * @param {Object} res - The response object to be sent back to the client.
 * @returns {Object} - The response object with a JSON body containing the result of the forward operation.
 * @throws Will throw an error if the message is not found or if there is an error during the forward operation.
 */
const forward = async (req, res) => {
  // #swagger.summary = 'Forward message'
  // #swagger.description = 'Forwards a message to another chat.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'The Chat id which contains the message', example: '6281288888888@c.us' },
          messageId: { type: 'string', description: 'Unique whatsApp identifier for the message', example: 'ABCDEF999999999' },
          destinationChatId: { type: 'string', description: 'Chat id to forward the message to', example: '6281288888889@c.us' }
        }
      }
    }
    */
    const { messageId, chatId, destinationChatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const result = await message.forward(destinationChatId);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Gets information about a message.
 * @async
 * @function getInfo
 * @param {Object} req - The request object received by the server.
 * @param {Object} req.body - The body of the request object.
 * @param {string} req.body.messageId - The ID of the message to get information about.
 * @param {string} req.body.chatId - The ID of the chat that contains the message to get information about.
 * @param {string} req.params.sessionId - The ID of the session to use the Telegram API with.
 * @param {Object} res - The response object to be sent back to the client.
 * @returns {Object} - The response object with a JSON body containing the information about the message.
 * @throws Will throw an error if the message is not found or if there is an error during the get info operation.
 */
const getInfo = async (req, res) => {
  // #swagger.summary = 'Get message info'
  // #swagger.description = 'Gets delivery/read info for a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const info = await message.getInfo();
    res.json({ success: true, info });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves a list of contacts mentioned in a specific message
 *
 * @async
 * @function
 * @param {Object} req - The HTTP request object
 * @param {Object} req.body - The request body
 * @param {string} req.body.messageId - The ID of the message to retrieve mentions from
 * @param {string} req.body.chatId - The ID of the chat where the message was sent
 * @param {string} req.params.sessionId - The ID of the session for the client making the request
 * @param {Object} res - The HTTP response object
 * @returns {Promise<void>} - The JSON response with the list of contacts
 * @throws {Error} - If there's an error retrieving the message or mentions
 */
const getMentions = async (req, res) => {
  // #swagger.summary = 'Get message mentions'
  // #swagger.description = 'Retrieves contacts mentioned in a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const contacts = await message.getMentions();
    res.json({ success: true, contacts });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the order information contained in a specific message
 *
 * @async
 * @function
 * @param {Object} req - The HTTP request object
 * @param {Object} req.body - The request body
 * @param {string} req.body.messageId - The ID of the message to retrieve the order from
 * @param {string} req.body.chatId - The ID of the chat where the message was sent
 * @param {string} req.params.sessionId - The ID of the session for the client making the request
 * @param {Object} res - The HTTP response object
 * @returns {Promise<void>} - The JSON response with the order information
 * @throws {Error} - If there's an error retrieving the message or order information
 */
const getOrder = async (req, res) => {
  // #swagger.summary = 'Get message order'
  // #swagger.description = 'Retrieves order information from a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const order = await message.getOrder();
    res.json({ success: true, order });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the payment information from a specific message identified by its ID.
 *
 * @async
 * @function getPayment
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID associated with the client making the request.
 * @param {Object} req.body - The message ID and chat ID associated with the message to retrieve payment information from.
 * @param {string} req.body.messageId - The ID of the message to retrieve payment information from.
 * @param {string} req.body.chatId - The ID of the chat the message is associated with.
 * @returns {Object} An object containing a success status and the payment information for the specified message.
 * @throws {Object} If the specified message is not found or if an error occurs during the retrieval process.
 */
const getPayment = async (req, res) => {
  // #swagger.summary = 'Get message payment'
  // #swagger.description = 'Retrieves payment information from a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const payment = await message.getPayment();
    res.json({ success: true, payment });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the quoted message information from a specific message identified by its ID.
 *
 * @async
 * @function getQuotedMessage
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID associated with the client making the request.
 * @param {Object} req.body - The message ID and chat ID associated with the message to retrieve quoted message information from.
 * @param {string} req.body.messageId - The ID of the message to retrieve quoted message information from.
 * @param {string} req.body.chatId - The ID of the chat the message is associated with.
 * @returns {Object} An object containing a success status and the quoted message information for the specified message.
 * @throws {Object} If the specified message is not found or if an error occurs during the retrieval process.
 */
const getQuotedMessage = async (req, res) => {
  // #swagger.summary = 'Get quoted message'
  // #swagger.description = 'Retrieves the quoted/replied-to message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const quotedMessage = await message.getQuotedMessage();
    res.json({ success: true, quotedMessage });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * React to a specific message in a chat
 *
 * @async
 * @function react
 * @param {Object} req - The HTTP request object containing the request parameters and body.
 * @param {Object} res - The HTTP response object to send the result.
 * @param {string} req.params.sessionId - The ID of the session to use.
 * @param {string} req.body.messageId - The ID of the message to react to.
 * @param {string} req.body.chatId - The ID of the chat the message is in.
 * @param {string} req.body.reaction - The reaction to add to the message.
 * @returns {Object} The HTTP response containing the result of the operation.
 * @throws {Error} If there was an error during the operation.
 */
const react = async (req, res) => {
  // #swagger.summary = 'React to message'
  // #swagger.description = 'Adds a reaction emoji to a message.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'The Chat id which contains the message', example: '6281288888888@c.us' },
          messageId: { type: 'string', description: 'Unique whatsApp identifier for the message', example: 'ABCDEF999999999' },
          reaction: { type: 'string', description: 'Emoji reaction to apply (empty string clears)', example: '👍' }
        }
      }
    }
    */
    const { messageId, chatId, reaction } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const result = await message.react(reaction);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Reply to a specific message in a chat
 *
 * @async
 * @function reply
 * @param {Object} req - The HTTP request object containing the request parameters and body.
 * @param {Object} res - The HTTP response object to send the result.
 * @param {string} req.params.sessionId - The ID of the session to use.
 * @param {string} req.body.messageId - The ID of the message to reply to.
 * @param {string} req.body.chatId - The ID of the chat the message is in.
 * @param {string} req.body.content - The content of the message to send.
 * @param {string} [req.body.contentType='string'] - Content type: string, MessageMedia, MessageMediaFromURL, Location, Contact, or Poll.
 * @param {string} req.body.destinationChatId - The ID of the chat to send the reply to.
 * @param {Object} req.body.options - Additional options for sending the message.
 * @returns {Object} The HTTP response containing the result of the operation.
 * @throws {Error} If there was an error during the operation.
 */
const reply = async (req, res) => {
  // #swagger.summary = 'Reply to message'
  // #swagger.description = 'Replies to a message with string, media, location, contact, or poll content.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      '@content': {
        "application/json": {
          schema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'Chat that contains the message to reply to' },
              messageId: { type: 'string', description: 'Message id to reply to' },
              contentType: { type: 'string', description: 'string, MessageMedia, MessageMediaFromURL, Location, Contact, or Poll (defaults to string)' },
              content: { type: 'object', description: 'Reply content (string or object depending on contentType)' },
              destinationChatId: { type: 'string', description: 'Optional destination chat for the reply' },
              options: { type: 'object', description: 'Additional send options' }
            }
          },
          examples: {
            string: { value: { chatId: '6281288888888@c.us', messageId: 'ABCDEF999999999', contentType: 'string', content: 'Hello!' } }
          }
        }
      }
    }
    */
    const { messageId, chatId, content, destinationChatId, options } = req.body;
    const contentType = req.body.contentType || 'string';
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }

    let messageOut;
    switch (contentType) {
      case 'string':
        if (options?.media) {
          const media = options.media;
          media.filename = media.filename || null;
          media.filesize = media.filesize || null;
          options.media = new MessageMedia(media.mimetype, media.data, media.filename, media.filesize);
        }
        messageOut = await message.reply(content, destinationChatId, options);
        break;
      case 'MessageMediaFromURL': {
        const messageMediaFromURL = await MessageMedia.fromUrl(content, { unsafeMime: true });
        if (options?.filename) {
          messageMediaFromURL.filename = options.filename;
        }
        messageOut = await message.reply(messageMediaFromURL, destinationChatId, options);
        break;
      }
      case 'MessageMedia': {
        const messageMedia = new MessageMedia(content.mimetype, content.data, content.filename, content.filesize);
        messageOut = await message.reply(messageMedia, destinationChatId, options);
        break;
      }
      case 'Location': {
        const location = new Location(content.latitude, content.longitude, {
          name: content.name || content.description,
          address: content.address,
          url: content.url,
        });
        messageOut = await message.reply(location, destinationChatId, options);
        break;
      }
      case 'Contact': {
        const contactId = toContactId(content.contactId);
        if (!contactId) {
          return sendErrorResponse(res, 422, 'contactId is required');
        }
        const contact = await client.getContactById(contactId);
        messageOut = await message.reply(contact, destinationChatId, options);
        break;
      }
      case 'Poll': {
        const poll = new Poll(content.pollName, content.pollOptions, content.options);
        messageOut = await message.reply(poll, destinationChatId, options);
        break;
      }
      default:
        return sendErrorResponse(res, 404, 'contentType invalid, must be string, MessageMedia, MessageMediaFromURL, Location, Contact or Poll');
    }

    // Same contract as sendMessage: the library only looks the message up after handing it to the
    // chat, so nothing coming back is not a failed send. Report the gap instead of an empty success.
    if (!messageOut) {
      logger.warn({ chatId, contentType }, 'Reply sent but the client did not return it');
      return res.json({ success: true, repliedMessage: null, warning: 'whatsapp-web.js did not return the sent message; it may still have been delivered' });
    }

    res.json({ success: true, repliedMessage: messageOut });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Edit a specific message in a chat
 *
 * @async
 * @function edit
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID to edit.
 * @param {string} req.body.chatId - The chat ID.
 * @param {string} req.body.content - The new message content.
 * @param {Object} [req.body.options] - Additional edit options.
 * @returns {Promise<void>}
 */
const edit = async (req, res) => {
  // #swagger.summary = 'Edit message'
  // #swagger.description = 'Edits the content of a message.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'The Chat id which contains the message', example: '6281288888888@c.us' },
          messageId: { type: 'string', description: 'Unique whatsApp identifier for the message', example: 'ABCDEF999999999' },
          content: { type: 'string', description: 'New message content', example: 'Updated text' },
          options: { type: 'object', description: 'Optional edit options', example: {} }
        }
      }
    }
    */
    const { messageId, chatId, content, options } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const editedMessage = await message.edit(content, options);
    res.json({ success: true, editedMessage });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function star
 * @async
 * @description Stars a message by message ID and chat ID.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID.
 * @param {string} req.body.chatId - The chat ID.
 * @returns {Promise} A Promise that resolves with the result of the message.star() call.
 * @throws {Error} If message is not found, it throws an error with the message "Message not Found".
 */
const star = async (req, res) => {
  // #swagger.summary = 'Star message'
  // #swagger.description = 'Stars a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const result = await message.star();
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function unstar
 * @async
 * @description Unstars a message by message ID and chat ID.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.messageId - The message ID.
 * @param {string} req.body.chatId - The chat ID.
 * @returns {Promise} A Promise that resolves with the result of the message.unstar() call.
 * @throws {Error} If message is not found, it throws an error with the message "Message not Found".
 */
const unstar = async (req, res) => {
  // #swagger.summary = 'Unstar message'
  // #swagger.description = 'Removes the star from a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const result = await message.unstar();
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Downloads the media of a message as raw binary instead of base64 inside JSON.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.messageId - The ID of the message.
 * @param {string} req.body.chatId - The ID of the chat containing the message.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 * @throws {Error} If the message or its media is not found.
 */
const downloadMediaAsData = async (req, res) => {
  // #swagger.summary = 'Download message media as binary'
  // #swagger.description = 'Downloads media from a message as raw binary. Preferred over downloadMedia for large attachments, since base64 inside JSON inflates the payload by about a third.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    if (!message.hasMedia) {
      throw new Error('Message media not Found');
    }
    // downloadMedia() answers undefined for media the server no longer holds, so destructuring the
    // result straight through turned an expired attachment into a TypeError instead of a 500 body.
    const messageMedia = await message.downloadMedia();
    if (!messageMedia) {
      throw new Error('Message media not Found');
    }
    const { data, mimetype, filename } = messageMedia;
    const media = Buffer.from(data, 'base64');
    /* #swagger.responses[200] = {
        description: "Raw media binary.",
        content: {
          "application/octet-stream": {}
        }
      }
    */
    // Content-Length comes from the decoded buffer, not from the media's `filesize`: the latter is
    // the size WhatsApp reports for the original file and does not always match what we decoded.
    res.writeHead(200, {
      'Content-Type': mimetype || 'application/octet-stream',
      'Content-Length': media.length,
      ...(filename && { 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"` }),
    });
    return res.end(media);
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the contact that sent a message.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.messageId - The ID of the message.
 * @param {string} req.body.chatId - The ID of the chat containing the message.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 * @throws {Error} If the message is not found.
 */
const getContact = async (req, res) => {
  // #swagger.summary = 'Get message contact'
  // #swagger.description = 'Retrieves the contact that sent the message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const contact = await message.getContact();
    res.json({ success: true, contact });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the groups mentioned in a message.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.messageId - The ID of the message.
 * @param {string} req.body.chatId - The ID of the chat containing the message.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 * @throws {Error} If the message is not found.
 */
const getGroupMentions = async (req, res) => {
  // #swagger.summary = 'Get message group mentions'
  // #swagger.description = 'Retrieves the groups mentioned in a message (as opposed to getMentions, which returns contacts).'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const groups = await message.getGroupMentions();
    res.json({ success: true, groups });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the reactions of a message.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.messageId - The ID of the message.
 * @param {string} req.body.chatId - The ID of the chat containing the message.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 * @throws {Error} If the message is not found.
 */
const getReactions = async (req, res) => {
  // #swagger.summary = 'Get message reactions'
  // #swagger.description = 'Retrieves the reactions of a message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const reactions = await message.getReactions();
    res.json({ success: true, reactions });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Retrieves the votes of a poll message.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.messageId - The ID of the poll message.
 * @param {string} req.body.chatId - The ID of the chat containing the message.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {Object} res - The response object.
 * @returns {Promise<void>}
 * @throws {Error} If the message is not found.
 */
const getPollVotes = async (req, res) => {
  // #swagger.summary = 'Get poll votes'
  // #swagger.description = 'Retrieves the votes of a poll message.'
  try {
    const { messageId, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const message = await _getMessageById(client, messageId, chatId);
    if (!message) {
      throw new Error('Message not Found');
    }
    const votes = await message.getPollVotes();
    res.json({ success: true, votes });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

module.exports = {
  getClassInfo,
  deleteMessage,
  downloadMedia,
  downloadMediaAsData,
  getContact,
  getGroupMentions,
  getReactions,
  getPollVotes,
  forward,
  getInfo,
  getMentions,
  getOrder,
  getPayment,
  getQuotedMessage,
  react,
  reply,
  edit,
  star,
  unstar,
};
