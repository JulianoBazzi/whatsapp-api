# Use the official Node.js Alpine image as the base image
FROM node:24-alpine

# Set the working directory
WORKDIR /usr/src/app

# Install Chromium
ENV CHROME_BIN="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    NODE_ENV="production"

# Install system dependencies (git is REQUIRED for github dependencies)
RUN set -x \
    && apk update \
    && apk upgrade \
    && apk add --no-cache \
       git \
       udev \
       ttf-freefont \
       chromium \
       ffmpeg

# Enable pnpm via corepack (version pinned by the packageManager field)
RUN corepack enable

# Copy the manifest and lockfile to the working directory
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install the dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy the rest of the source code to the working directory
COPY . .

# Expose the port the API will run on
EXPOSE 3000

# Start the API
CMD ["node", "server.js"]
