# Use the official Node.js Alpine image as the base image
FROM node:24-alpine

# Set the working directory
WORKDIR /usr/src/app

# Use the distro Chromium. PUPPETEER_SKIP_DOWNLOAD is the name puppeteer >= 19 reads (the old
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is ignored and the install would fetch a Chrome that never runs).
ENV CHROME_BIN="/usr/bin/chromium-browser" \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_DOWNLOAD="true" \
    NODE_ENV="production"

# Install system dependencies
RUN set -x \
    && apk update \
    && apk upgrade \
    && apk add --no-cache \
       udev \
       ttf-freefont \
       chromium \
       ffmpeg

# Enable pnpm via corepack (version pinned by the packageManager field)
RUN corepack enable

# Copy the manifest and lockfile to the working directory
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install the dependencies, then drop the pnpm store and the corepack caches: node_modules is
# already linked, and the leftovers are ~120 MB of dead weight in the image
RUN pnpm install --prod --frozen-lockfile \
    && rm -rf /root/.local/share/pnpm /root/.cache /root/.npm

# Copy the rest of the source code to the working directory
COPY . .

# Expose the port the API will run on
EXPOSE 3000

# /ping is public by design; wget ships with Alpine's BusyBox
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ping || exit 1

# Start the API
CMD ["node", "server.js"]
