# Bot FiveM Artes

Comandos: `/arte` (dono), `/loja`, `/ticket`

## Passos
1. Discord Developer Portal → crie o bot, copie TOKEN e CLIENT_ID. Convide com escopos `bot` + `applications.commands`.
2. Mercado Pago → Suas integrações → crie app → copie o Access Token (produção).
3. Edite `products.json` com seus produtos e links de download.
4. Suba tudo no GitHub (sem o .env).
5. Render → New Web Service → conecte o repo → Build: `npm install` → Start: `npm start` → adicione as variáveis do `.env.example`.
6. O bot já se auto-pinga a cada 10 min (anti-sleep). Para garantir, crie também um monitor no UptimeRobot pingando a URL do Render a cada 5 min.
