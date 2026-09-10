const swaggerAutogen = require('swagger-autogen')({ openapi: '3.0.0', autoBody: false });

const outputFile = './swagger.json';
const endpointsFiles = ['./src/routes.js'];

const doc = {
  info: {
    title: 'WhatsApp API',
    version: require('./package.json').version,
    description: 'API Wrapper for WhatsAppWebJS',
  },
  servers: [
    {
      url: '',
      description: '',
    },
    {
      url: 'http://localhost:3000',
      description: 'localhost',
    },
  ],
  securityDefinitions: {
    apiKeyAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
    },
  },
  produces: ['application/json'],
  tags: [
    {
      name: 'Session',
      description: 'Handling multiple sessions logic, creation and deletion',
    },
    {
      name: 'Client',
      description: 'All functions related to the client',
    },
    {
      name: 'Chat',
      description: 'Operations on individual chats',
    },
    {
      name: 'Group Chat',
      description: 'Operations on group chats',
    },
    {
      name: 'Message',
      description: 'May fail if the message is too old (Only from the last 100 Messages of the given chat)',
    },
    {
      name: 'Contact',
      description: 'Operations on contacts',
    },
    {
      name: 'Various',
      description: 'Health checks and miscellaneous endpoints',
    },
  ],
  definitions: {
    StartSessionResponse: {
      success: true,
      message: 'Session initiated successfully',
    },
    StatusSessionResponse: {
      success: true,
      state: 'CONNECTED',
      message: 'session_connected',
    },
    QrCodeResponse: {
      success: true,
      qr: 'data',
    },
    QrCodeNotReadyResponse: {
      success: false,
      message: 'qr code not ready or already scanned',
    },
    RestartSessionResponse: {
      success: true,
      message: 'Restarted successfully',
    },
    TerminateSessionResponse: {
      success: true,
      message: 'Logged out successfully',
    },
    TerminateSessionsResponse: {
      success: true,
      message: 'Flush completed successfully',
    },
    StopSessionResponse: {
      success: true,
      message: 'Session stopped successfully',
    },
    GetSessionsResponse: {
      success: true,
      result: ['session-1', 'session-2'],
    },
    PairingCodeResponse: {
      success: true,
      result: 'ABCD1234',
    },
    SetWebhookResponse: {
      success: true,
      message: 'Webhook updated',
      webhookUrl: 'https://your-server.com/webhook/my-session',
      source: 'runtime',
    },
    GetWebhookResponse: {
      success: true,
      webhookUrl: 'https://your-server.com/webhook/my-session',
      source: 'runtime',
    },
    PingResponse: {
      success: true,
      message: 'pong',
    },
    ErrorResponse: {
      success: false,
      error: 'Some server error',
    },
    NotFoundResponse: {
      success: false,
      error: 'session_not_connected',
    },
    ForbiddenResponse: {
      success: false,
      error: 'Invalid API key',
    },
  },
};

swaggerAutogen(outputFile, endpointsFiles, doc);
