const { sessions } = require('../sessions');
const { sendErrorResponse } = require('../utils');

/**
 * @function
 * @async
 * @name getClassInfo
 * @description Gets information about a chat using the chatId and sessionId
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {string} req.body.chatId - The ID of the chat to get information for
 * @param {string} req.params.sessionId - The ID of the session to use
 * @returns {Object} - Returns a JSON object with the success status and chat information
 * @throws {Error} - Throws an error if chat is not found or if there is a server error
 */
const getClassInfo = async (req, res) => {
  // #swagger.summary = 'Get chat info'
  // #swagger.description = 'Retrieves information about a chat by chatId.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    res.json({ success: true, chat });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Clears all messages in a chat.
 *
 * @function
 * @async
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The ID of the session.
 * @param {string} req.body.chatId - The ID of the chat to clear messages from.
 * @throws {Error} If the chat is not found or there is an internal server error.
 * @returns {Object} The success status and the cleared messages.
 */
const clearMessages = async (req, res) => {
  // #swagger.summary = 'Clear chat messages'
  // #swagger.description = 'Clears all messages in a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const clearMessages = await chat.clearMessages();
    res.json({ success: true, clearMessages });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Stops typing or recording in chat immediately.
 *
 * @function
 * @async
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {string} req.body.chatId - ID of the chat to clear the state for.
 * @param {string} req.params.sessionId - ID of the session the chat belongs to.
 * @returns {Promise<void>} - A Promise that resolves with a JSON object containing a success flag and the result of clearing the state.
 * @throws {Error} - If there was an error while clearing the state.
 */
const clearState = async (req, res) => {
  // #swagger.summary = 'Clear chat state'
  // #swagger.description = 'Stops typing or recording state in a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const clearState = await chat.clearState();
    res.json({ success: true, clearState });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Delete a chat.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {string} req.body.chatId - The ID of the chat to be deleted.
 * @returns {Object} A JSON response indicating whether the chat was deleted successfully.
 * @throws {Object} If there is an error while deleting the chat, an error response is sent with a status code of 500.
 * @throws {Object} If the chat is not found, an error response is sent with a status code of 404.
 */
const deleteChat = async (req, res) => {
  // #swagger.summary = 'Delete chat'
  // #swagger.description = 'Deletes a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const deleteChat = await chat.delete();
    res.json({ success: true, deleteChat });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Fetches messages from a specified chat.
 *
 * @function
 * @async
 *
 * @param {Object} req - The request object containing sessionId, chatId, and searchOptions.
 * @param {string} req.params.sessionId - The ID of the session associated with the chat.
 * @param {Object} req.body - The body of the request containing chatId and searchOptions.
 * @param {string} req.body.chatId - The ID of the chat from which to fetch messages.
 * @param {Object} req.body.searchOptions - The search options to use when fetching messages.
 *
 * @param {Object} res - The response object to send the fetched messages.
 * @returns {Promise<Object>} A JSON object containing the success status and fetched messages.
 *
 * @throws {Error} If the chat is not found or there is an error fetching messages.
 */
const fetchMessages = async (req, res) => {
  // #swagger.summary = 'Fetch chat messages'
  // #swagger.description = 'Fetches messages from a chat with optional searchOptions.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Unique whatsApp identifier for the given Chat (either group or personnal)',
            example: '6281288888888@c.us'
          },
          searchOptions: {
            type: 'object',
            description: 'Search options for fetching messages',
            example: '{}'
          }
        }
      }
    }
  */
    const { chatId, searchOptions } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const messages = await chat.fetchMessages(searchOptions);
    res.json({ success: true, messages });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Gets the contact for a chat
 * @async
 * @function
 * @param {Object} req - The HTTP request object
 * @param {Object} res - The HTTP response object
 * @param {string} req.params.sessionId - The ID of the current session
 * @param {string} req.body.chatId - The ID of the chat to get the contact for
 * @returns {Promise<void>} - Promise that resolves with the chat's contact information
 * @throws {Error} - Throws an error if chat is not found or if there is an error getting the contact information
 */
const getContact = async (req, res) => {
  // #swagger.summary = 'Get chat contact'
  // #swagger.description = 'Gets the contact associated with a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const contact = await chat.getContact();
    res.json({ success: true, contact });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Send a recording state to a WhatsApp chat.
 * @async
 * @function
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {object} req.body - The request body.
 * @param {string} req.body.chatId - The ID of the chat to send the recording state to.
 * @returns {object} - An object containing a success message and the result of the sendStateRecording method.
 * @throws {object} - An error object containing a status code and error message if an error occurs.
 */
const sendStateRecording = async (req, res) => {
  // #swagger.summary = 'Send recording state'
  // #swagger.description = 'Sends recording presence state to a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const sendStateRecording = await chat.sendStateRecording();
    res.json({ success: true, sendStateRecording });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Send a typing state to a WhatsApp chat.
 * @async
 * @function
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @param {string} req.params.sessionId - The session ID.
 * @param {object} req.body - The request body.
 * @param {string} req.body.chatId - The ID of the chat to send the typing state to.
 * @returns {object} - An object containing a success message and the result of the sendStateTyping method.
 * @throws {object} - An error object containing a status code and error message if an error occurs.
 */
const sendStateTyping = async (req, res) => {
  // #swagger.summary = 'Send typing state'
  // #swagger.description = 'Sends typing presence state to a chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const sendStateTyping = await chat.sendStateTyping();
    res.json({ success: true, sendStateTyping });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function
 * @async
 * @name markUnread
 * @description Marks a chat as unread
 * @param {object} req - Express request object
 * @param {string} req.body.chatId - The ID of the chat
 * @param {string} req.params.sessionId - The ID of the session
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 * @throws {Error} If the chat is not found or the operation fails
 */
const markUnread = async (req, res) => {
  // #swagger.summary = 'Mark chat as unread'
  // #swagger.description = 'Marks the chat as unread.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    await chat.markUnread();
    res.json({ success: true });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function
 * @async
 * @name sendSeen
 * @description Marks the chat messages as seen
 * @param {object} req - Express request object
 * @param {string} req.body.chatId - The ID of the chat
 * @param {string} req.params.sessionId - The ID of the session
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 * @throws {Error} If the chat is not found or the operation fails
 */
const sendSeen = async (req, res) => {
  // #swagger.summary = 'Send seen status'
  // #swagger.description = 'Marks the messages of a chat as seen (blue ticks).'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const result = await chat.sendSeen();
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function
 * @async
 * @name getLabels
 * @description Gets the labels assigned to a chat
 * @param {object} req - Express request object
 * @param {string} req.body.chatId - The ID of the chat
 * @param {string} req.params.sessionId - The ID of the session
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 * @throws {Error} If the chat is not found or the operation fails
 */
const getLabels = async (req, res) => {
  // #swagger.summary = 'Get chat labels'
  // #swagger.description = 'Gets the labels assigned to a chat (WhatsApp Business only).'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    const labels = await chat.getLabels();
    res.json({ success: true, labels });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

/**
 * @function
 * @async
 * @name changeLabels
 * @description Replaces the labels assigned to a chat
 * @param {object} req - Express request object
 * @param {string} req.body.chatId - The ID of the chat
 * @param {Array<string|number>} req.body.labelIds - The label ids to assign; an empty array clears them
 * @param {string} req.params.sessionId - The ID of the session
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 * @throws {Error} If the chat is not found or the operation fails
 */
const changeLabels = async (req, res) => {
  // #swagger.summary = 'Change chat labels'
  // #swagger.description = 'Replaces the labels assigned to a chat (WhatsApp Business only). Send an empty array to clear them.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Unique whatsApp identifier for the given Chat', example: '6281288888888@c.us' },
          labelIds: { type: 'array', description: 'Label ids to assign; an empty array clears them', example: ['0', '1'] }
        }
      }
    }
    */
    const { chatId, labelIds } = req.body;
    if (!Array.isArray(labelIds)) {
      return sendErrorResponse(res, 422, 'labelIds must be an array');
    }
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return sendErrorResponse(res, 404, 'Chat not Found');
    }
    await chat.changeLabels(labelIds);
    res.json({ success: true });
  } catch (error) {
    sendErrorResponse(res, 500, error.message);
  }
};

module.exports = {
  getClassInfo,
  clearMessages,
  clearState,
  deleteChat,
  fetchMessages,
  getContact,
  getLabels,
  changeLabels,
  markUnread,
  sendSeen,
  sendStateRecording,
  sendStateTyping,
};
