const app = require('./src/app')
const { baseWebhookURL, globalApiKey } = require('./src/config')
const { isValidUrl, maskSecret } = require('@julianobazzi/utils')
require('dotenv').config()

// Start the server
const port = process.env.PORT || 3000

// Check if BASE_WEBHOOK_URL environment variable is available
if (!baseWebhookURL) {
  console.error('BASE_WEBHOOK_URL environment variable is not available. Exiting...')
  process.exit(1) // Terminate the application with an error code
}

// Check if BASE_WEBHOOK_URL is a valid http(s) URL
if (!isValidUrl(baseWebhookURL)) {
  console.error(`BASE_WEBHOOK_URL is not a valid URL: ${baseWebhookURL}. Exiting...`)
  process.exit(1)
}

if (globalApiKey) {
  console.log(`API key configured: ${maskSecret(globalApiKey)}`)
} else {
  console.warn('WARNING: API_KEY is not set - the API is running WITHOUT authentication')
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
