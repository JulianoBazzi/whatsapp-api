# WhatsApp REST API

REST API wrapper for the [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) library, providing an easy-to-use interface to interact with the WhatsApp Web platform. 
It is designed to be used as a docker container, scalable, secure, and easy to integrate with other non-NodeJs projects.

This project is a work in progress: star it, create issues, features or pull requests ❣️

**NOTE**: I can't guarantee you will not be blocked by using this method, although it has worked for me. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.

## Prerequisites

- [Node.js](https://nodejs.org) 24+
- [pnpm](https://pnpm.io) — comes with Node.js via Corepack:

```bash
corepack enable
```

The pnpm version is pinned in `package.json` (`packageManager` field).

## Local Development

1. Clone the repository

```bash
git clone https://github.com/JulianoBazzi/whatsapp-api.git
cd whatsapp-api
```

2. Install dependencies

```bash
pnpm install
```

3. Set up the environment (`BASE_WEBHOOK_URL` is required)

```bash
cp .env.example .env
```

4. Start the server (defaults to port 3000)

```bash
pnpm start
```

Other useful scripts:

```bash
pnpm test      # run the test suite (Vitest)
pnpm lint      # lint with Biome
pnpm format    # format with Biome
pnpm swagger   # regenerate swagger.json after changing routes
```

## Session management

| Endpoint | Description |
| --- | --- |
| `GET /session/getSessions` | Lists the IDs of every session loaded in memory |
| `GET /session/start/:id` | Starts a session |
| `POST /session/start/:id` | Starts a session, optionally with `{ "webhookUrl": "..." }` |
| `GET /session/qr/:id` | Current QR code (stops being served once the session authenticates) |
| `POST /session/requestPairingCode/:id` | Authenticates by phone number instead of a QR code, with `{ "phoneNumber": "5551999998888" }` |
| `GET /session/stop/:id` | Stops the session **keeping** its credentials, so it resumes without a new QR code |
| `GET /session/terminate/:id` | Logs out and **deletes** the credentials |
| `GET /session/getWebhook/:id` | Current webhook URL and its source |
| `PUT /session/setWebhook/:id` | Sets the webhook URL at runtime; send an empty value to clear it |

### Webhooks

Each event is sent to the most specific webhook configured, resolved at delivery time — changing it
through the API takes effect immediately, with no restart:

1. the runtime URL set via `PUT /session/setWebhook/:id` or `POST /session/start/:id`
2. the `<SESSIONID>_WEBHOOK_URL` environment variable
3. `BASE_WEBHOOK_URL`

A runtime URL is persisted to `sessions/session-<id>/webhook_config.json` and restored on the next
boot. Setting one for a session that was never started is kept in memory only, until the session
starts for the first time.

Failed deliveries are retried with exponential backoff (`WEBHOOK_RETRIES`, `WEBHOOK_RETRY_DELAY_MS`)
on network errors, timeouts and `5xx` responses; a `4xx` is treated as a rejected payload and is not
repeated. **Retries mean the receiver can see events out of order** — use the payload itself, not the
arrival order, to reconstruct the sequence. Requests give up after `WEBHOOK_TIMEOUT_MS`.

### Logs

Logs are structured JSON (pino) on stdout, with `LOG_LEVEL` controlling verbosity
(`trace|debug|info|warn|error|fatal`, default `info`). To read them in a terminal:

```bash
pnpm start | npx pino-pretty
```

## Generate new build


1. Clone the repository
```bash
git clone https://github.com/JulianoBazzi/whatsapp-api.git
cd whatsapp-api
```

2. Update whatsapp-web.js version in package.json

3. Install libs
```bash
pnpm install
```

3. Build new version
```bash
docker build --platform=linux/amd64 -t julibazzi/whatsapp-api:$WHATSAPP_WEB_JS_VERSION .
```

3. Tag latest version
```bash
docker tag julibazzi/whatsapp-api:$WHATSAPP_WEB_JS_VERSION julibazzi/whatsapp-api:latest
```

4. Push version
```bash
docker push julibazzi/whatsapp-api:$WHATSAPP_WEB_JS_VERSION
docker push julibazzi/whatsapp-api:latest
```

> The `Dockerfile` is plain OCI (no BuildKit-specific syntax), so `podman build/tag/push` accepts the
> exact same commands. Official builds are still made with Docker: on Apple Silicon the cross-arch
> `--platform=linux/amd64` build works out of the box with `buildx`, while Podman requires the
> `podman machine` VM to have binfmt/qemu emulation configured.

## Quick Start with Docker

[![dockeri.co](https://dockerico.blankenship.io/image/julibazzi/whatsapp-api)](https://hub.docker.com/r/julibazzi/whatsapp-api)


1. Clone the repository
```bash
git clone https://github.com/JulianoBazzi/whatsapp-api.git
cd whatsapp-api
```

2. Install Google Chrome
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb
```

3. Configure docker-compose.yml
```bash
cd whatsapp-api
vim docker-compose.yml
```

3. Update Running Container
```bash
cd whatsapp-api
docker compose down && docker pull julibazzi/whatsapp-api:latest && docker compose up -d
```

3. Run the Docker Compose
```bash
docker compose pull && docker compose up
```

## Quick Start with Podman

Docker is the default and fully supported path. The image is OCI, and the same `docker-compose.yml`
works with Podman as well — no separate file needed:

```bash
podman compose pull && podman compose up -d
```

> `podman compose` is only a wrapper: it delegates to whichever `docker-compose` or `podman-compose`
> is installed on the system, and fails if neither is present.

The container runs as root internally (the `Dockerfile` sets no `USER`), so under rootless Podman the
container's UID 0 maps back to your host user — the WhatsApp session files under `./sessions` stay
readable and removable as usual, with no files stranded in a subuid range.

### Running as a systemd service (Quadlet)

On a Linux server, Quadlet replaces `restart: always` with a native systemd unit — no daemon, logs in
journald, and proper ordering at boot.

Create `~/.config/containers/systemd/whatsapp-api.container`:

```ini
[Unit]
Description=WhatsApp REST API

[Container]
Image=docker.io/julibazzi/whatsapp-api:latest
PublishPort=3000:3000
Volume=%h/whatsapp-api/sessions:/usr/src/app/sessions:Z
EnvironmentFile=%h/whatsapp-api/.env

[Service]
Restart=always
TimeoutStartSec=900

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user daemon-reload
systemctl --user start whatsapp-api.service
loginctl enable-linger $USER   # keeps the service running after you log out
```

Notes:

- `EnvironmentFile` works because the app reads its configuration from environment variables via
  `dotenv`; variables already present in the environment take precedence over the `.env` file.
  `BASE_WEBHOOK_URL` is still required — the server aborts on boot if it is missing or invalid.
- `loginctl enable-linger` is mandatory, otherwise the rootless service is killed when your SSH
  session ends.
- For a rootful setup, place the same unit in `/etc/containers/systemd/` and run
  `sudo systemctl daemon-reload` instead.