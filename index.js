require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
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

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`Online como ${client.user.tag}`);
});

// ---------- GERADOR DE ARTE ----------
function campo(id, label, placeholder, obrigatorio = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
      .setStyle(TextInputStyle.Short).setRequired(obrigatorio)
  );
}

async function gerarImagem({ cor, nome, estilo, extra }) {
  const prompt = `FiveM GTA RP server banner art, text "${nome}", main color ${cor}, style ${estilo}, ${extra || ''}, high quality, cinematic, detailed`;
  const seed = Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&nologo=true&seed=${seed}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Falha ao gerar imagem');
  return Buffer.from(await r.arrayBuffer());
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
          return i.reply({ content: 'Só o dono pode usar.', ephemeral: true });
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
        return i.reply({ content: `Ticket criado: ${canal}`, ephemeral: true });
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
      await i.deferReply({ ephemeral: true });
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
    else i.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
