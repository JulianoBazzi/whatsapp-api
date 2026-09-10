const { MessageMedia } = require('whatsapp-web.js');
const { sessions } = require('../sessions');
const { sendErrorResponse } = require('../utils');

/**
 * Adds participants to a group chat.
 * @async
 * @function
 * @param {Object} req - The request object containing the chatId and contactIds in the body.
 * @param {string} req.body.chatId - The ID of the group chat.
 * @param {Array<string>} req.body.contactIds - An array of contact IDs to be added to the group.
 * @param {Object} res - The response object.
 * @returns {Object} Returns a JSON object containing a success flag and the updated participants list.
 * @throws {Error} Throws an error if the chat is not a group chat.
 */
const addParticipants = async (req, res) => {
  // #swagger.summary = 'Add group participants'
  // #swagger.description = 'Adds participants to a group chat.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Contact ids to add/remove/promote/demote', example: ['6281288888888@c.us'] }
        }
      }
    }
    */
    const { chatId, contactIds } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    await chat.addParticipants(contactIds);
    res.json({ success: true, participants: chat.participants });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Removes participants from a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and updated participants list
 * @throws {Error} If chat is not a group
 */
const removeParticipants = async (req, res) => {
  // #swagger.summary = 'Remove group participants'
  // #swagger.description = 'Removes participants from a group chat.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Contact ids to add/remove/promote/demote', example: ['6281288888888@c.us'] }
        }
      }
    }
    */
    const { chatId, contactIds } = req.body;
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return sendErrorResponse(res, 422, 'contactIds is required and must be a non-empty array');
    }
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    await chat.removeParticipants(contactIds);
    res.json({ success: true, participants: chat.participants });
  } catch (error) {
    // The library resolves every id against the group roster (by lid or by phone) and hands the
    // survivors straight to WhatsApp Web. When nobody matches — a number that was only invited and
    // never joined, or an id from another chat — the empty list surfaces as a protobuf complaint
    // about zero children, which tells the caller nothing about what went wrong.
    if (/at least 1 children/i.test(error?.message ?? '')) {
      return sendErrorResponse(res, 422, 'None of the given contactIds is a participant of this group');
    }
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Promotes participants in a group chat to admin
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and updated participants list
 * @throws {Error} If chat is not a group
 */
const promoteParticipants = async (req, res) => {
  // #swagger.summary = 'Promote group participants'
  // #swagger.description = 'Promotes participants to group admin.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Contact ids to add/remove/promote/demote', example: ['6281288888888@c.us'] }
        }
      }
    }
    */
    const { chatId, contactIds } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    await chat.promoteParticipants(contactIds);
    res.json({ success: true, participants: chat.participants });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Demotes admin participants in a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and updated participants list
 * @throws {Error} If chat is not a group
 */
const demoteParticipants = async (req, res) => {
  // #swagger.summary = 'Demote group participants'
  // #swagger.description = 'Demotes group admins to regular participants.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Contact ids to add/remove/promote/demote', example: ['6281288888888@c.us'] }
        }
      }
    }
    */
    const { chatId, contactIds } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    await chat.demoteParticipants(contactIds);
    res.json({ success: true, participants: chat.participants });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Gets the invite code for a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and invite code
 * @throws {Error} If chat is not a group
 */
const getInviteCode = async (req, res) => {
  // #swagger.summary = 'Get group invite code'
  // #swagger.description = 'Retrieves the invite code for a group chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const inviteCode = await chat.getInviteCode();
    res.json({ success: true, inviteCode });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Sets the subject of a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and updated chat object
 * @throws {Error} If chat is not a group
 */
const setSubject = async (req, res) => {
  // #swagger.summary = 'Set group subject'
  // #swagger.description = 'Sets the subject/title of a group chat.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          subject: { type: 'string', description: 'New group subject/title', example: 'My Group' }
        }
      }
    }
    */
    const { chatId, subject } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const success = await chat.setSubject(subject);
    res.json({ success, chat });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Sets the description of a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and updated chat object
 * @throws {Error} If chat is not a group
 */
const setDescription = async (req, res) => {
  // #swagger.summary = 'Set group description'
  // #swagger.description = 'Sets the description of a group chat.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          description: { type: 'string', description: 'New group description', example: 'Group about something' }
        }
      }
    }
    */
    const { chatId, description } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const success = await chat.setDescription(description);
    res.json({ success, chat });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Leaves a group chat
 *
 * @async
 * @function
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Returns a JSON object with success flag and outcome of leaving the chat
 * @throws {Error} If chat is not a group
 */
const leave = async (req, res) => {
  // #swagger.summary = 'Leave group'
  // #swagger.description = 'Leaves a group chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const outcome = await chat.leave();
    res.json({ success: true, outcome });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Retrieves information about a chat based on the provided chatId
 *
 * @async
 * @function getClassInfo
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @param {string} req.body.chatId - The chatId of the chat to retrieve information about
 * @param {string} req.params.sessionId - The sessionId of the client making the request
 * @throws {Error} The chat is not a group.
 * @returns {Promise<void>} - A JSON response with success true and chat object containing chat information
 */
const getClassInfo = async (req, res) => {
  // #swagger.summary = 'Get group chat info'
  // #swagger.description = 'Retrieves information about a group chat.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    res.json({ success: true, chat });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Revokes the invite link for a group chat based on the provided chatId
 *
 * @async
 * @function revokeInvite
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @param {string} req.body.chatId - The chatId of the group chat to revoke the invite for
 * @param {string} req.params.sessionId - The sessionId of the client making the request
 * @throws {Error} The chat is not a group.
 * @returns {Promise<void>} - A JSON response with success true and the new invite code for the group chat
 */
const revokeInvite = async (req, res) => {
  // #swagger.summary = 'Revoke group invite'
  // #swagger.description = 'Revokes the current invite link and returns a new code.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const newInviteCode = await chat.revokeInvite();
    res.json({ success: true, newInviteCode });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Sets admins-only status of a group chat's info or messages.
 *
 * @async
 * @function setInfoAdminsOnly
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {string} req.params.sessionId - ID of the user's session.
 * @param {Object} req.body - Request body.
 * @param {string} req.body.chatId - ID of the group chat.
 * @param {boolean} req.body.adminsOnly - Desired admins-only status.
 * @returns {Promise<void>} Promise representing the success or failure of the operation.
 * @throws {Error} If the chat is not a group.
 */
const setInfoAdminsOnly = async (req, res) => {
  // #swagger.summary = 'Set group info admins-only'
  // #swagger.description = 'Restricts group info edits to admins.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          adminsOnly: { type: 'boolean', description: 'Whether only admins can edit group info', example: true }
        }
      }
    }
    */
    const { chatId, adminsOnly } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.setInfoAdminsOnly(adminsOnly);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Sets admins-only status of a group chat's messages.
 *
 * @async
 * @function setMessagesAdminsOnly
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {string} req.params.sessionId - ID of the user's session.
 * @param {Object} req.body - Request body.
 * @param {string} req.body.chatId - ID of the group chat.
 * @param {boolean} req.body.adminsOnly - Desired admins-only status.
 * @returns {Promise<void>} Promise representing the success or failure of the operation.
 * @throws {Error} If the chat is not a group.
 */
const setMessagesAdminsOnly = async (req, res) => {
  // #swagger.summary = 'Set group messages admins-only'
  // #swagger.description = 'Restricts sending messages to admins.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          adminsOnly: { type: 'boolean', description: 'Whether only admins can send messages', example: true }
        }
      }
    }
    */
    const { chatId, adminsOnly } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.setMessagesAdminsOnly(adminsOnly);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Set the group Picture
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Object} req.body.pictureMimetype - The mimetype of the image.
 * @param {Object} req.body.pictureData - The new group picture in base64 format.
 * @param {Object} req.body.chatId - ID of the group chat.
 * @param {string} req.params.sessionId - The ID of the session for the user.
 * @returns {Object} Returns a JSON object with a success status and the result of the function.
 * @throws {Error} If there is an issue setting the group picture, an error will be thrown.
 */
const setPicture = async (req, res) => {
  // #swagger.summary = 'Set group picture'
  // #swagger.description = 'Sets the group profile picture from base64 media.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          pictureMimetype: { type: 'string', description: 'MIME type of the image', example: 'image/jpeg' },
          pictureData: { type: 'string', description: 'Base64-encoded image data', example: '...' }
        }
      }
    }
    */
    const { pictureMimetype, pictureData, chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const media = new MessageMedia(pictureMimetype, pictureData);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.setPicture(media);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Delete the group Picture
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Object} req.body.chatId - ID of the group chat.
 * @param {string} req.params.sessionId - The ID of the session for the user.
 * @returns {Object} Returns a JSON object with a success status and the result of the function.
 * @throws {Error} If there is an issue setting the group picture, an error will be thrown.
 */
const deletePicture = async (req, res) => {
  // #swagger.summary = 'Delete group picture'
  // #swagger.description = 'Removes the group profile picture.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.deletePicture();
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Lists the pending membership requests of a group.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.chatId - ID of the group chat.
 * @param {string} req.params.sessionId - The ID of the session for the user.
 * @param {Object} res - The response object.
 * @returns {Object} Returns a JSON object with a success status and the pending requests.
 * @throws {Error} If the chat is not a group or the requests cannot be retrieved.
 */
const getGroupMembershipRequests = async (req, res) => {
  // #swagger.summary = 'Get group membership requests'
  // #swagger.description = 'Lists the pending requests to join a group. Pairs with the group_membership_request webhook event.'
  try {
    const { chatId } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.getGroupMembershipRequests();
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Approves pending membership requests of a group.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.chatId - ID of the group chat.
 * @param {Object} [req.body.options] - Options, e.g. { requesterIds: [], sleep: [250, 500] }. Omit requesterIds to approve all.
 * @param {string} req.params.sessionId - The ID of the session for the user.
 * @param {Object} res - The response object.
 * @returns {Object} Returns a JSON object with a success status and the per-request result.
 * @throws {Error} If the chat is not a group or the requests cannot be approved.
 */
const approveGroupMembershipRequests = async (req, res) => {
  // #swagger.summary = 'Approve group membership requests'
  // #swagger.description = 'Approves pending requests to join a group. Omit requesterIds to approve every pending request.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          options: {
            type: 'object',
            description: 'Membership request options; omit requesterIds to act on every pending request',
            example: { requesterIds: ['6281288888888@c.us'], sleep: [250, 500] }
          }
        }
      }
    }
    */
    const { chatId, options = {} } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.approveGroupMembershipRequests(options);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

/**
 * Rejects pending membership requests of a group.
 *
 * @async
 * @function
 * @param {Object} req - The request object.
 * @param {string} req.body.chatId - ID of the group chat.
 * @param {Object} [req.body.options] - Options, e.g. { requesterIds: [], sleep: [250, 500] }. Omit requesterIds to reject all.
 * @param {string} req.params.sessionId - The ID of the session for the user.
 * @param {Object} res - The response object.
 * @returns {Object} Returns a JSON object with a success status and the per-request result.
 * @throws {Error} If the chat is not a group or the requests cannot be rejected.
 */
const rejectGroupMembershipRequests = async (req, res) => {
  // #swagger.summary = 'Reject group membership requests'
  // #swagger.description = 'Rejects pending requests to join a group. Omit requesterIds to reject every pending request.'
  try {
    /*
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Group chat id', example: '1203630...@g.us' },
          options: {
            type: 'object',
            description: 'Membership request options; omit requesterIds to act on every pending request',
            example: { requesterIds: ['6281288888888@c.us'], sleep: [250, 500] }
          }
        }
      }
    }
    */
    const { chatId, options = {} } = req.body;
    const client = sessions.get(req.params.sessionId);
    const chat = await client.getChatById(chatId);
    if (!chat.isGroup) {
      throw new Error('The chat is not a group');
    }
    const result = await chat.rejectGroupMembershipRequests(options);
    res.json({ success: true, result });
  } catch (error) {
    sendErrorResponse(res, 500, error);
  }
};

module.exports = {
  getClassInfo,
  addParticipants,
  demoteParticipants,
  getGroupMembershipRequests,
  approveGroupMembershipRequests,
  rejectGroupMembershipRequests,
  getInviteCode,
  leave,
  promoteParticipants,
  removeParticipants,
  revokeInvite,
  setDescription,
  setInfoAdminsOnly,
  setMessagesAdminsOnly,
  setSubject,
  setPicture,
  deletePicture,
};
