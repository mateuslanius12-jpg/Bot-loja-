require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const products = require('./products.json');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  StringSelectMenuBuilder, EmbedBuilder, AttachmentBuilder,
  ChannelType, PermissionFlagsBits,
} = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID, STAFF_ROLE_ID, MP_ACCESS_TOKEN } = process.env;

// Servidor HTTP simples pra Render manter o serviço vivo (use UptimeRobot pingando a URL)
http.createServer((_, res) => res.end('Bot online')).listen(process.env.PORT || 3000);

// Anti-sleep: o bot pinga a própria URL pública a cada 10 min (Render define RENDER_EXTERNAL_URL sozinho)
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
if (SELF_URL && process.env.KEEP_ALIVE !== 'false') {
  setInterval(() => {
    fetch(SELF_URL).then(() => console.log('keep-alive ok')).catch((e) => console.error('keep-alive erro', e.message));
  }, 10 * 60 * 1000);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('arte').setDescription('Gerar uma arte (somente dono)'),
  new SlashCommandBuilder().setName('loja').setDescription('Ver o catálogo de artes'),
  new SlashCommandBuilder().setName('ticket').setDescription('Abrir um ticket de pedido'),
].map((c) => c.toJSON());

// Não deixa o bot cair por erro solto
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
client.on('error', (e) => console.error('client error:', e));

client.once('clientReady', async () => {
  console.log(`Online como ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Comandos registrados com sucesso');
  } catch (e) {
    console.error('ERRO AO REGISTRAR COMANDOS (confira CLIENT_ID, GUILD_ID e se o bot está no servidor):', e.message);
  }
});

// ---------- GERADOR DE ARTE ----------
function campo(id, label, placeholder, obrigatorio = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
      .setStyle(TextInputStyle.Short).setRequired(obrigatorio)
  );
}

GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'BigShoulders-Bold.ttf'), 'BigShoulders');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Poppins-Bold.ttf'), 'Poppins');

const CORES = {
  vermelho: '#ff1e1e', 'azul escuro': '#0a2a8f', 'azul claro': '#4db8ff', 'azul neon': '#00d4ff',
  azul: '#1e6bff', verde: '#16d44a', 'verde neon': '#39ff14', amarelo: '#ffd500', laranja: '#ff7a00',
  roxo: '#9b30ff', rosa: '#ff3fa4', 'rosa neon': '#ff2bd6', ciano: '#00e5ff', dourado: '#ffc400',
  prata: '#c0c0c0', branco: '#ffffff', preto: '#111111', cinza: '#888888', marrom: '#8b4513',
};

function corParaHex(txt) {
  const t = txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hex = t.match(/#[0-9a-f]{6}\b/);
  if (hex) return hex[0];
  const nomes = Object.keys(CORES).sort((a, b) => b.length - a.length);
  const achado = nomes.find((n) => t.includes(n));
  return achado ? CORES[achado] : '#ff1e1e';
}

async function gerarImagem({ cor, nome, estilo, extra }) {
  const W = 1344, H = 720;
  const hex = corParaHex(cor);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 1) Fundo gerado por IA (sem texto). Se falhar, usa degradê da cor.
  try {
    const prompt = `${estilo} style, ${cor} color palette, ${extra || ''}, GTA V roleplay city atmosphere, cinematic wide background, no text, no letters, no words, no logo`;
    const seed = Math.floor(Math.random() * 1e6);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${W}&height=756&nologo=true&seed=${seed}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('fundo falhou');
    const img = await loadImage(Buffer.from(await r.arrayBuffer()));
    // corta a parte de baixo pra esconder a marca d'água
    ctx.drawImage(img, 0, 0, img.width, img.height * 0.95, 0, 0, W, H);
  } catch (e) {
    console.error('Fundo IA falhou, usando degradê:', e.message);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, hex);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 2) Escurece pra o texto aparecer
  const ov = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
  ov.addColorStop(0, 'rgba(0,0,0,0.25)');
  ov.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = ov;
  ctx.fillRect(0, 0, W, H);

  // 3) Moldura na cor escolhida
  ctx.strokeStyle = hex;
  ctx.lineWidth = 8;
  ctx.shadowColor = hex;
  ctx.shadowBlur = 25;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // 4) Nome (sempre escrito certo)
  const texto = nome.toUpperCase();
  let size = 260;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `${size}px BigShoulders, Poppins`;
    size -= 6;
  } while (ctx.measureText(texto).width > W * 0.82 && size > 40);

  ctx.shadowColor = hex;
  ctx.shadowBlur = 50;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(texto, W / 2, H / 2 - 20);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(texto, W / 2, H / 2 - 20);

  // 5) Linha e estilo embaixo do nome
  ctx.shadowBlur = 20;
  ctx.fillStyle = hex;
  ctx.fillRect(W / 2 - 220, H / 2 + size * 0.55 + 20, 440, 8);
  ctx.shadowBlur = 0;
  ctx.font = '38px Poppins';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(estilo.toUpperCase(), W / 2, H / 2 + size * 0.55 + 80);

  return canvas.toBuffer('image/png');
}

// ---------- PIX (MERCADO PAGO) ----------
async function criarPix(produto, userId) {
  const r = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      transaction_amount: produto.preco,
      description: produto.nome,
      payment_method_id: 'pix',
      payer: { email: `cliente${userId}@email.com` },
    }),
  });
  const d = await r.json();
  if (!d.id) throw new Error(JSON.stringify(d));
  return {
    id: d.id,
    copiaECola: d.point_of_interaction.transaction_data.qr_code,
    qrBase64: d.point_of_interaction.transaction_data.qr_code_base64,
  };
}

async function pagamentoAprovado(id) {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  const d = await r.json();
  return d.status === 'approved';
}

function aguardarPagamento(id, user, produto) {
  let tentativas = 0;
  const timer = setInterval(async () => {
    tentativas++;
    try {
      if (await pagamentoAprovado(id)) {
        clearInterval(timer);
        await user.send(`✅ Pagamento confirmado!\n**${produto.nome}**\nDownload: ${produto.link}`)
          .catch(() => {});
      }
    } catch (e) { console.error(e); }
    if (tentativas > 90) clearInterval(timer); // ~15 min
  }, 10000);
}

// ---------- INTERAÇÕES ----------
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'arte') {
        if (i.user.id !== OWNER_ID)
          return i.reply({ content: 'Só o dono pode usar.', flags: 64 });
        const modal = new ModalBuilder().setCustomId('arte_modal').setTitle('Gerar arte')
          .addComponents(
            campo('cor', 'Cor', 'Ex: vermelho e preto'),
            campo('nome', 'Nome', 'Ex: Cidade Alta RP'),
            campo('estilo', 'Estilo', 'Ex: neon, grafite, realista'),
            campo('extra', 'Algo adicional', 'Ex: carros, personagens, fumaça', false),
          );
        return i.showModal(modal);
      }

      if (i.commandName === 'loja') {
        const embed = new EmbedBuilder().setTitle('🎨 Catálogo de Artes FiveM').setColor(0x5865f2)
          .setDescription(products.map((p) => `**${p.nome}** — R$ ${p.preco.toFixed(2)}\n${p.descricao}`).join('\n\n'));
        const menu = new StringSelectMenuBuilder().setCustomId('comprar').setPlaceholder('Escolha para comprar')
          .addOptions(products.map((p) => ({ label: p.nome, description: `R$ ${p.preco.toFixed(2)}`, value: p.id })));
        return i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
      }

      if (i.commandName === 'ticket') {
        const canal = await i.guild.channels.create({
          name: `pedido-${i.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ...(STAFF_ROLE_ID ? [{ id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
          ],
        });
        await canal.send(`Olá ${i.user}, descreva seu pedido de arte. Nossa equipe já vai te atender!`);
        return i.reply({ content: `Ticket criado: ${canal}`, flags: 64 });
      }
    }

    if (i.isModalSubmit() && i.customId === 'arte_modal') {
      await i.deferReply();
      const dados = {
        cor: i.fields.getTextInputValue('cor'),
        nome: i.fields.getTextInputValue('nome'),
        estilo: i.fields.getTextInputValue('estilo'),
        extra: i.fields.getTextInputValue('extra'),
      };
      const img = await gerarImagem(dados);
      return i.editReply({
        content: `🎨 **${dados.nome}** — ${dados.cor} / ${dados.estilo}`,
        files: [new AttachmentBuilder(img, { name: 'arte.png' })],
      });
    }

    if (i.isStringSelectMenu() && i.customId === 'comprar') {
      await i.deferReply({ flags: 64 });
      const produto = products.find((p) => p.id === i.values[0]);
      const pix = await criarPix(produto, i.user.id);
      const qr = new AttachmentBuilder(Buffer.from(pix.qrBase64, 'base64'), { name: 'pix.png' });
      await i.editReply({
        content: `💸 **${produto.nome}** — R$ ${produto.preco.toFixed(2)}\nPix copia e cola:\n\`\`\`${pix.copiaECola}\`\`\`\nApós pagar, o produto chega na sua DM automaticamente (deixe a DM aberta).`,
        files: [qr],
      });
      aguardarPagamento(pix.id, i.user, produto);
    }
  } catch (err) {
    console.error(err);
    const msg = '❌ Deu erro, tenta de novo.';
    if (i.deferred || i.replied) i.editReply({ content: msg }).catch(() => {});
    else i.reply({ content: msg, flags: 64 }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN).catch((e) => console.error('ERRO NO LOGIN (token errado?):', e.message));
