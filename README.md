# WhatsApp REST API

REST API wrapper for the [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) library, providing an easy-to-use interface to interact with the WhatsApp Web platform. 
It is designed to be used as a docker container, scalable, secure, and easy to integrate with other non-NodeJs projects.

This project is a work in progress: star it, create issues, features or pull requests ❣️

**NOTE**: I can't guarantee you will not be blocked by using this method, although it has worked for me. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.

## Generate new build


1. Clone the repository
```bash
git clone https://github.com/JulianoBazzi/whatsapp-api.git
cd whatsapp-api
```

2. Update whatsapp-web.js version in package.json

3. Install libs
```bash
npm install
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