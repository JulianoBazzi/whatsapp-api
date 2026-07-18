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

- `server.js` → valida `BASE_WEBHOOK_URL` (aborta se inválida) e sobe o Express de `src/app.js`.
- `src/app.js` → monta parsers e rotas, e chama `restoreSessions()` no import (restaura sessões do disco).
- `src/routes.js` → sub-routers por domínio (`/session`, `/client`, `/chat`, `/groupChat`, `/message`, `/contact`), todos com `apikey` + `rateLimiter`; `/ping` é público; `/api-docs` só com `ENABLE_SWAGGER_ENDPOINT=true`.
- `src/controllers/` → um controller por domínio; erros sempre via `sendErrorResponse` (`{ success: false, error }`).
- `src/sessions.js` → coração do projeto: `Map` de sessões em memória, persistência via `LocalAuth` em `./sessions/session-<id>`, ~28 eventos do whatsapp-web.js encaminhados por `triggerWebhook` para `BASE_WEBHOOK_URL` (ou `<SESSIONID>_WEBHOOK_URL`).
- `src/utils.js` → `phoneToChatId` (telefone BR → `55...@c.us`), `isEventEnabled` (gate por `DISABLED_CALLBACKS`), `triggerWebhook`, `waitForNestedObject`.
- Configuração 100% por env vars, lida em `src/config.js` no import — referência completa em `.env.example`.

## Convenções

- **Versões de dependências sempre exatas** no package.json — nunca usar `^` ou `~`.
- **pnpm** (postinstalls aprovados via `allowBuilds` no `pnpm-workspace.yaml`).
- **Biome** para lint e formatação (não ESLint/Prettier) — config em `biome.json`; `swagger.json` é gerado e fica fora do lint.
- **@julianobazzi/utils** para validação/formatação (telefone BR, URLs, bytes, mascaramento de segredos).
- Testes em `tests/`: `api.test.js` (integração, abre chromium de verdade, usa `./sessions_test` e porta 3987), `utils.test.js` (unitários), `ratelimit.test.js` (arquivo separado por precisar de env própria). Env vars precisam ser definidas **antes** do `await import('../src/app')` — imports estáticos são içados. `vi.mock` não intercepta `require` CJS do código de `src/`; testar sem mocks (servidor HTTP local, subprocess `node -e`).

## Avisos

- Sem `API_KEY` definida a API roda **sem autenticação** (loga warning no boot).
- Build/publicação Docker é **manual** (ver README; imagem `julibazzi/whatsapp-api`); o CI (`pull_request.yml`) roda lint + testes em PRs para `master`.
- WhatsApp pode bloquear números usando clientes não oficiais — projeto para uso próprio/consciente.
