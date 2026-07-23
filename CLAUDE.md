# CLAUDE.md

REST API wrapper em Node.js (CommonJS) sobre o [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), para integrar WhatsApp em sistemas não-Node via HTTP + webhooks. Fork de `chrishubert/whatsapp-api` (descontinuado), mantido em `JulianoBazzi/whatsapp-api`.

## Comandos

```bash
pnpm start          # sobe o servidor (exige BASE_WEBHOOK_URL válida no ambiente/.env)
pnpm test           # Vitest (integração real com puppeteer/chromium — ~30s)
pnpm test:watch     # Vitest em watch
pnpm test:coverage  # coverage v8 (text + html/lcov em coverage/)
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
pnpm swagger        # regenera swagger.json (swagger-autogen) — rodar após mudar rotas
```

## Arquitetura

- `server.js` → valida `BASE_WEBHOOK_URL` (aborta se inválida), sobe o Express de `src/app.js`, chama `restoreSessions()` **depois** do `listen` (se `AUTO_START_SESSIONS`) e trata `SIGTERM`/`SIGINT` fechando os browsers.
- `src/app.js` → monta parsers e rotas e chama `ensureSessionFolder()` no import — **só a pasta**: importar o app nunca sobe Chromium.
- `src/routes.js` → sub-routers por domínio (`/session`, `/client`, `/chat`, `/groupChat`, `/message`, `/contact`), todos com `apikey` + `rateLimiter`; `/ping` é público; `/api-docs` só com `ENABLE_SWAGGER_ENDPOINT=true` (o `swagger.json` é `require`d lazy dentro do `if`).
- `src/controllers/` → um controller por domínio; erros sempre via `sendErrorResponse` (`{ success: false, error }`), que aceita `Error` ou string e loga quando recebe `Error`.
- `src/sessions.js` → coração do projeto: `Map` de sessões em memória, persistência via `LocalAuth` em `./sessions/session-<id>`, ~32 eventos do whatsapp-web.js encaminhados por `triggerWebhook`. O destino é resolvido **a cada evento** por `resolveWebhook`: runtime (API, persistido em `session-<id>/webhook_config.json`) → `<SESSIONID>_WEBHOOK_URL` → `BASE_WEBHOOK_URL`.
- `src/logger.js` → pino em stdout, nível por `LOG_LEVEL`. Não usar `console.*` em código novo.
- `src/utils.js` → `phoneToChatId` (telefone BR → `55...@c.us`), `isEventEnabled` (gate por `DISABLED_CALLBACKS`), `triggerWebhook` (fire-and-forget com timeout + retry/backoff), `waitForNestedObject`, `exposeFunctionIfAbsent`, `sendMessageSeenStatus`, `sleep`.
- Configuração 100% por env vars, lida em `src/config.js` no import — referência completa em `.env.example`.

## Convenções

- **Versões de dependências sempre exatas** no package.json — nunca usar `^` ou `~`.
- **pnpm** (postinstalls aprovados via `allowBuilds` no `pnpm-workspace.yaml`).
- **Biome** para lint e formatação (não ESLint/Prettier) — config em `biome.json`; `swagger.json` é gerado e fica fora do lint.
- **@julianobazzi/utils** para validação/formatação (telefone BR, URLs, bytes, mascaramento de segredos).
- Testes em `tests/`: `api.test.js` (integração, abre chromium de verdade, usa `./sessions_test` e porta 3987), `utils.test.js` (unitários), `ratelimit.test.js` e `webhook.test.js` (arquivos separados por precisarem de env própria; o de webhook usa um receptor HTTP local na porta 3988). Env vars precisam ser definidas **antes** do `await import('../src/app')` — imports estáticos são içados. `vi.mock` não intercepta `require` CJS do código de `src/`; testar sem mocks (servidor HTTP local, subprocess `node -e`).
- `setupSession` é **síncrona** de propósito (responde assim que `pupPage` existe, sem esperar o `initialize`) e `validateSession` retorna `session_not_ready` de imediato quando não há `pupPage` — os dois contratos são cobertos por teste, não trocar por `async`/espera.

## Avisos

- `API_KEY` é **obrigatória**: `server.js` aborta no boot sem ela, e o middleware `apikey` falha fechado (403) se `globalApiKey` estiver vazia — importar `src/app.js` direto nunca serve API sem autenticação. Testes precisam definir `process.env.API_KEY` antes do import.
- Build/publicação Docker é **manual** (ver README; imagem `julibazzi/whatsapp-api`); o CI (`pull_request.yml`) roda lint + testes em PRs para `master`.
- A imagem é OCI: o mesmo `Dockerfile` e o mesmo `docker-compose.yml` servem Docker e Podman (rootless). O `:Z` no volume de `sessions` existe para hosts com SELinux (Podman rootless em Fedora/RHEL) e é no-op no Docker — **não remover**. O `.dockerignore` é lido pelo Podman como fallback do `.containerignore`, então não precisa duplicar.
- WhatsApp pode bloquear números usando clientes não oficiais — projeto para uso próprio/consciente.
