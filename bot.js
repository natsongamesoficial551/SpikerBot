const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createGiveawayService, registerGiveawayCommands } = require('./giveaways');
const { createDonationsService } = require('./donations');
const { DONOR_ROLE, ensureDonorChannels, grantDonorRole } = require('./donor-access');
const { checkVideoSupport, mediaType, verifyAttachment } = require('./subscription');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error('DISCORD_TOKEN não configurado.');
const GUILD_ID = process.env.GUILD_ID || '1574893765590650880';
const YT_URL = process.env.YT_URL || 'https://www.youtube.com/@spikerhakofc';

const TICKET_PANEL_CHANNEL_ID = '1574896947381272688'; // 🎫・abrir-ticket
const SUPPORT_CATEGORY_ID = '1574896939227680858';     // ╭・🎧「 𝖲𝖴𝖯𝖮𝖱𝖳𝖤 」
const COMUNIDADE_CATEGORY_ID = '1574896855395999940';  // ╭・💬「 𝗖𝗢𝗠𝗨𝗡𝗜𝗗𝗔𝗗𝗘 」
const ADMIN_LOGS_CHANNEL_ID = '1574896994135183400';   // 🛡️・logs-de-moderação
const LIBERAR_CHANNEL_ID = '1574909372595708017';      // 🔓・liberar-servidor
const WELCOME_CHANNEL_ID = '1574896851688357928';      // 👋・boas-vindas
const YOUTUBE_CHANNEL_ID_DISCORD = '1574896839331815554'; // 🔴・youtube-spikerhak
const YT_CHECK_INTERVAL_MS = 5 * 60 * 1000;            // 5 minutos
const READ_ONLY_FORUM_IDS = [
  '1574901749632860261', // 🎁・provedores-gratuitos
  '1574901757711093760', // 🌾・farms
  '1574901997784530974', // 🔓・jailbreak
  '1574901297268916264', // 🚀・projetos
  '1574896918608224306'  // 🛠️・tutoriais-e-guias
];

const roles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles.json'), 'utf8'));
const verificadoRoleId = roles['✅・Verificado'];
const staffRoleIds = [
  roles['👑・Fundador'],
  roles['⚡・Administrador'],
  roles['🛡️・Moderador']
].filter(Boolean);

const giveaways = createGiveawayService({
  guildId: GUILD_ID,
  testChannelId: '1574896990129496289', // 🤖・comandos-admin
  staffRoleIds,
  dataFile: process.env.GIVEAWAYS_DATA_FILE || path.join(__dirname, 'giveaways_data.json')
});

// Arquivo de persistência de dados de tickets
const DATA_FILE = path.join(__dirname, 'tickets_data.json');
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { counter: 0, tickets: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { counter: 0, tickets: {} };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Banco de hashes de prints já aprovadas (impede reutilizar print de outra pessoa)
const HASHES_FILE = path.join(__dirname, 'verified_hashes.json');
function loadHashes() {
  if (!fs.existsSync(HASHES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function saveHashes(hashes) {
  fs.writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2), 'utf8');
}

const pendingProofs = new Set();
const proofQueue = [];
let runningProofs = 0;

async function waitForProofSlot() {
  if (runningProofs >= 1) {
    await new Promise(resolve => proofQueue.push(resolve));
  } else {
    runningProofs++;
  }
}

function releaseProofSlot() {
  const next = proofQueue.shift();
  if (next) next();
  else runningProofs--;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// HTTP server + 7-minute self-ping to prevent Render Free Web Service hibernation
const http = require('http');
const PORT = process.env.PORT || 10000;
const SELF_PING_URL = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const SELF_PING_INTERVAL_MS = 7 * 60 * 1000;
const DONATIONS_CHANNEL_ID = '1574965060281966632'; // 💸・doações
const ANNOUNCEMENTS_CHANNEL_ID = '1574896835364126791'; // 📢・anúncios-oficiais
const donations = createDonationsService({
  guildId: GUILD_ID,
  channelId: DONATIONS_CHANNEL_ID,
  baseUrl: process.env.DONATIONS_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || SELF_PING_URL,
  callbackUrl: process.env.RENDER_EXTERNAL_URL || SELF_PING_URL,
  applicationSecret: TOKEN,
  grantRole: async memberId => grantDonorRole(await client.guilds.fetch(GUILD_ID), memberId)
});

const server = http.createServer(async (req, res) => {
  try {
    if (await donations.handleHttp(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SpikerBot is running 24/7 on Render!\n');
  } catch (error) {
    console.error('[SpikerBot HTTP] Falha na requisição:', error.name);
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Requisição inválida.\n');
  }
});

server.listen(PORT, () => {
  console.log(`[SpikerBot] Health check HTTP server online on port ${PORT}`);

  if (SELF_PING_URL) {
    const pingSelf = async () => {
      try {
        const res = await fetch(`${SELF_PING_URL}/health`);
        console.log(`[SpikerBot] Auto-ping (${SELF_PING_URL}/health): HTTP ${res.status}`);
      } catch (err) {
        console.error(`[SpikerBot] Auto-ping failed: ${err.message}`);
      }
    };

    setInterval(pingSelf, SELF_PING_INTERVAL_MS);
    console.log(`[SpikerBot] Auto-ping ativo a cada 7 minutos para ${SELF_PING_URL}/health`);
  } else {
    console.log('[SpikerBot] Auto-ping aguardando RENDER_EXTERNAL_URL ou KEEP_ALIVE_URL.');
  }
});

client.once('ready', async () => {
  console.log(`[SpikerBot] Online como ${client.user.tag}!`);
  client.guilds.fetch(GUILD_ID).then(registerGiveawayCommands).catch(error => {
    console.error('[Sorteio] Não foi possível registrar os comandos:', error);
  });
  giveaways.startExpiration(client);
  client.channels.fetch(DONATIONS_CHANNEL_ID).then(channel => {
    if (channel?.isSendable()) return donations.publishPanel(channel, client.user.id);
  }).catch(error => console.error('[Doações] Não foi possível atualizar o painel:', error.code || error.name));

  // Garantir que o painel de tickets está publicado em 🎫・abrir-ticket
  try {
    const channel = await client.channels.fetch(TICKET_PANEL_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const messages = await channel.messages.fetch({ limit: 5 });
      const botMsg = messages.find(m => m.author.id === client.user.id &&
        m.components.some(row => row.components?.some(component => component.customId === 'open_ticket')));
      if (!botMsg) {
        const bannerPath = path.join(__dirname, 'banner.png');
        const logoPath = path.join(__dirname, 'logo.png');
        const files = [];
        if (fs.existsSync(bannerPath)) files.push({ attachment: bannerPath, name: 'banner.png' });
        if (fs.existsSync(logoPath)) files.push({ attachment: logoPath, name: 'logo.png' });

        const panelEmbed = new EmbedBuilder()
          .setTitle('🎫 ┃ CENTRAL DE ATENDIMENTO — SPIKERHAK')
          .setDescription(
            `Precisa de suporte técnico, tirar dúvidas sobre ferramentas, reportar problemas ou falar privadamente com a equipe?\n\n` +
            `### 📌 Como funciona o atendimento:\n` +
            `• Clique no botão **"Abrir Ticket"** abaixo.\n` +
            `• Um canal exclusivo será criado imediatamente para você (ex: \`suporte-001\`).\n` +
            `• Apenas você e os administradores da equipe terão acesso à conversa.\n` +
            `• Ao final do suporte, o administrador encerrará o ticket e você receberá uma mensagem na DM para avaliar o atendimento.\n\n` +
            `*Horário de atendimento: Todos os dias com respostas o mais rápido possível!*`
          )
          .setColor(0x5865F2)
          .setImage('attachment://banner.png')
          .setThumbnail('attachment://logo.png')
          .setFooter({ text: 'SpikerHak • Sistema Oficial de Tickets' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_ticket')
            .setLabel('Abrir Ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Success)
        );

        await channel.send({ embeds: [panelEmbed], components: [row], files });
        console.log('[SpikerBot] Painel de Tickets publicado com sucesso!');
      }
    }
  } catch (err) {
    console.error('[SpikerBot] Erro ao checar painel de tickets:', err);
  }

  // Travar fóruns oficiais para somente leitura/reação (apenas Staff posta e comenta)
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const overwrites = [
      {
        id: guild.id,
        deny: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.SendMessagesInThreads,
          PermissionsBitField.Flags.CreatePublicThreads,
          PermissionsBitField.Flags.CreatePrivateThreads
        ]
      }
    ];

    if (verificadoRoleId) {
      overwrites.push({
        id: verificadoRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions
        ],
        deny: [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.SendMessagesInThreads,
          PermissionsBitField.Flags.CreatePublicThreads,
          PermissionsBitField.Flags.CreatePrivateThreads
        ]
      });
    }

    for (const rId of staffRoleIds) {
      overwrites.push({
        id: rId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.SendMessagesInThreads,
          PermissionsBitField.Flags.CreatePublicThreads,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.AttachFiles
        ]
      });
    }

    for (const forumId of READ_ONLY_FORUM_IDS) {
      const forum = await guild.channels.fetch(forumId).catch(() => null);
      if (forum) {
        await forum.permissionOverwrites.set(overwrites);
        console.log(`[SpikerBot] Fórum bloqueado para somente leitura/reação: ${forum.name}`);
      }
    }
  } catch (err) {
    console.error('[SpikerBot] Erro ao aplicar permissões nos fóruns:', err);
  }

  // Garantir cargo de Doador e canais de Doações + Boosts na categoria Comunidade
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const guildRoles = await guild.roles.fetch();
    let doadorRole = guildRoles.find(r => r.name === DONOR_ROLE);
    if (!doadorRole) {
      doadorRole = await guild.roles.create({
        name: DONOR_ROLE,
        color: 0x2ECC71,
        hoist: true,
        mentionable: false,
        reason: 'Cargo oficial de doadores do servidor SpikerHak'
      });
      console.log(`[SpikerBot] Cargo criado: ${doadorRole.name} (${doadorRole.id})`);
    }
    const donorChannels = await ensureDonorChannels(guild, doadorRole, staffRoleIds);
    console.log('[Doações] Categoria Doadores configurada com dois canais:', donorChannels.category.id);
    if (process.env.DONATIONS_ANNOUNCEMENT) {
      const announcements = await guild.channels.fetch(ANNOUNCEMENTS_CHANNEL_ID);
      if (announcements?.isSendable()) await donations.announce(announcements, client.user.id, process.env.DONATIONS_ANNOUNCEMENT);
    }

    const readOnlyOverwrites = [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      }
    ];
    if (verificadoRoleId) {
      readOnlyOverwrites.push({
        id: verificadoRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions
        ],
        deny: [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.SendMessagesInThreads,
          PermissionsBitField.Flags.CreatePublicThreads,
          PermissionsBitField.Flags.CreatePrivateThreads
        ]
      });
    }
    for (const rId of staffRoleIds) {
      readOnlyOverwrites.push({
        id: rId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions,
          PermissionsBitField.Flags.AttachFiles
        ]
      });
    }

    const guildChannels = await guild.channels.fetch();
    const bannerPath = path.join(__dirname, 'banner.png');
    const logoPath = path.join(__dirname, 'logo.png');

    // Canal 💸・doações
    let doacoesCh = guildChannels.find(c => c && c.name === '💸・doações');
    if (!doacoesCh) {
      doacoesCh = await guild.channels.create({
        name: '💸・doações',
        type: ChannelType.GuildText,
        parent: COMUNIDADE_CATEGORY_ID,
        topic: 'Apoie a comunidade SpikerHak via Pix e receba o cargo exclusivo 💸・Doador!',
        permissionOverwrites: readOnlyOverwrites
      });
      const files = [];
      if (fs.existsSync(bannerPath)) files.push({ attachment: bannerPath, name: 'banner.png' });
      if (fs.existsSync(logoPath)) files.push({ attachment: logoPath, name: 'logo.png' });

      const doacaoEmbed = new EmbedBuilder()
        .setTitle('💸 ┃ APOIE O SPIKERHAK — DOAÇÕES VIA PIX')
        .setDescription(
          `Curte os provedores gratuitos, ferramentas open-source e projetos da comunidade?\n\n` +
          `### 💖 Por que apoiar?\n` +
          `• Ajuda a manter o servidor, bots e novos projetos sempre ativos.\n` +
          `• Você recebe o cargo exclusivo **<@&${doadorRole.id}>** em destaque na lista de membros.\n\n` +
          `> ⏳ **Em breve:** o bot de doação automática via Pix será ativado diretamente aqui neste canal!`
        )
        .setColor(0x2ECC71)
        .setFooter({ text: 'SpikerHak • Obrigado por fortalecer a comunidade!' });

      if (fs.existsSync(bannerPath)) doacaoEmbed.setImage('attachment://banner.png');
      if (fs.existsSync(logoPath)) doacaoEmbed.setThumbnail('attachment://logo.png');

      await doacoesCh.send({ embeds: [doacaoEmbed], files });
      console.log(`[SpikerBot] Canal criado: ${doacoesCh.name} (${doacoesCh.id})`);
    }

    // Canal 💎・boosts
    let boostsCh = guildChannels.find(c => c && c.name === '💎・boosts');
    if (!boostsCh) {
      boostsCh = await guild.channels.create({
        name: '💎・boosts',
        type: ChannelType.GuildText,
        parent: COMUNIDADE_CATEGORY_ID,
        topic: 'Impulsione o servidor SpikerHak e desbloqueie benefícios exclusivos de Server Booster!',
        permissionOverwrites: readOnlyOverwrites
      });
      const files = [];
      if (fs.existsSync(bannerPath)) files.push({ attachment: bannerPath, name: 'banner.png' });
      if (fs.existsSync(logoPath)) files.push({ attachment: logoPath, name: 'logo.png' });

      const boosterRoleId = roles['💎・Server Booster'];
      const boostEmbed = new EmbedBuilder()
        .setTitle('💎 ┃ IMPULSOS DO SERVIDOR — SERVER BOOST')
        .setDescription(
          `Impulsionar o **SpikerHak** ajuda o servidor a liberar mais qualidade de áudio, emojis personalizados, banner animado e muito mais!\n\n` +
          `### ✨ Benefícios de quem dá Boost:\n` +
          `• Cargo exclusivo em destaque: ${boosterRoleId ? `<@&${boosterRoleId}>` : '**💎・Server Booster**'}\n` +
          `• Reconhecimento oficial da comunidade e da Staff.\n` +
          `• Ajuda direta no crescimento do servidor SpikerHak.`
        )
        .setColor(0xF47FFF)
        .setFooter({ text: 'SpikerHak • Impulsos & Benefícios' });

      if (fs.existsSync(bannerPath)) boostEmbed.setImage('attachment://banner.png');
      if (fs.existsSync(logoPath)) boostEmbed.setThumbnail('attachment://logo.png');

      await boostsCh.send({ embeds: [boostEmbed], files });
      console.log(`[SpikerBot] Canal criado: ${boostsCh.name} (${boostsCh.id})`);
    }
  } catch (err) {
    console.error('[SpikerBot] Erro ao criar cargo/canais de Doações e Boosts:', err);
  }

  // Iniciar monitor automático de novos vídeos do YouTube (@spikerhakofc)
  startYouTubeNotifier();

  // Limpar ❌ de prints cujos autores já foram aprovados manualmente pela Staff
  syncApprovedPrints();
  checkVideoSupport().then(() => console.log('[SpikerBot] Verificação de vídeos pronta.'))
    .catch(error => console.error('[SpikerBot] FFmpeg indisponível para verificar vídeos:', error.code || error.name));
});

async function syncApprovedPrints() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await client.channels.fetch(LIBERAR_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const messages = await channel.messages.fetch({ limit: 15 });
    for (const msg of messages.values()) {
      if (msg.author.bot) continue;
      const xReaction = msg.reactions.cache.get('❌');
      if (!xReaction) continue;

      const member = await guild.members.fetch(msg.author.id).catch(() => null);
      if (member && verificadoRoleId && member.roles.cache.has(verificadoRoleId)) {
        await xReaction.users.remove(client.user.id).catch(() => {});
        await msg.react('✅').catch(() => {});
        console.log(`[SpikerBot] ❌ removido e ✅ aplicado para membro já aprovado: ${msg.author.tag}`);
      }
    }
  } catch (err) {
    console.error('[SpikerBot] Erro ao sincronizar prints aprovadas:', err.message);
  }
}

// Se um Staff reagir com ✅ manualmente em uma print, o bot remove o ❌ automaticamente
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const msg = reaction.message;
    if (msg.channel.id !== LIBERAR_CHANNEL_ID) return;
    if (reaction.emoji.name !== '✅') return;

    const guild = msg.guild;
    if (!guild) return;

    const staffMember = await guild.members.fetch(user.id).catch(() => null);
    const isStaff = staffMember && (
      staffMember.permissions.has(PermissionsBitField.Flags.Administrator) ||
      staffMember.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      staffRoleIds.some(rId => staffMember.roles.cache.has(rId))
    );
    if (!isStaff) return;

    const targetMember = await guild.members.fetch(msg.author.id).catch(() => null);
    if (!targetMember || !verificadoRoleId) return;
    if (!targetMember.roles.cache.has(verificadoRoleId)) {
      await grantVerifiedAccess(targetMember);
    }
    await msg.reactions.cache.get('❌')?.users.remove(client.user.id).catch(() => {});
    console.log(`[SpikerBot] Aprovação manual por ${user.tag}: ❌ removido na print de ${msg.author.tag}`);
  } catch (err) {
    console.error('[SpikerBot] Erro ao processar aprovação manual por reação:', err.message);
  }
});

// MONITOR AUTOMÁTICO DE NOVOS VÍDEOS DO YOUTUBE
let cachedYtChannelId = process.env.YT_CHANNEL_ID || null;
let lastNotifiedVideoId = null;

async function resolveYouTubeChannelId() {
  if (cachedYtChannelId) return cachedYtChannelId;
  try {
    const res = await fetch(YT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    const html = await res.text();
    const patterns = [
      /feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})/,
      /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/,
      /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
      /"browseId":"(UC[A-Za-z0-9_-]{22})"/,
      /"channelId":"(UC[A-Za-z0-9_-]{22})"/
    ];
    for (const re of patterns) {
      const match = html.match(re);
      if (match) {
        cachedYtChannelId = match[1];
        console.log(`[SpikerBot YT] Channel ID resolvido: ${cachedYtChannelId}`);
        return cachedYtChannelId;
      }
    }
    console.warn('[SpikerBot YT] Não foi possível extrair o channelId automaticamente. Defina YT_CHANNEL_ID no Render se persistir.');
  } catch (err) {
    console.error('[SpikerBot YT] Erro ao resolver channelId:', err.message);
  }
  return null;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function checkLatestYouTubeVideo(isInitialRun = false) {
  try {
    const ytChannelId = await resolveYouTubeChannelId();
    if (!ytChannelId) return;

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ytChannelId}`;
    const res = await fetch(rssUrl);
    if (!res.ok) return;

    const xml = await res.text();
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) return;

    const entry = entryMatch[1];
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const titleRaw = entry.match(/<title>([^<]+)<\/title>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!videoId || !titleRaw) return;

    const title = decodeXmlEntities(titleRaw);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Na inicialização, apenas registra o último vídeo atual sem reenviar vídeos antigos
    if (isInitialRun && !lastNotifiedVideoId) {
      lastNotifiedVideoId = videoId;
      console.log(`[SpikerBot YT] Monitor iniciado. Último vídeo registrado: ${videoId}`);
      return;
    }

    if (videoId === lastNotifiedVideoId) return;

    const discordChannel = await client.channels.fetch(YOUTUBE_CHANNEL_ID_DISCORD).catch(() => null);
    if (!discordChannel || !discordChannel.isTextBased()) return;

    // Evita duplicar vídeo após reinício no Render checando histórico recente do canal
    const recentMsgs = await discordChannel.messages.fetch({ limit: 15 });
    const alreadyPosted = recentMsgs.some(m =>
      m.content.includes(videoId) ||
      m.embeds.some(e => (e.url && e.url.includes(videoId)) || (e.description && e.description.includes(videoId)))
    );

    lastNotifiedVideoId = videoId;
    if (alreadyPosted) return;

    const logoPath = path.join(__dirname, 'logo.png');
    const files = fs.existsSync(logoPath)
      ? [{ attachment: logoPath, name: 'logo.png' }]
      : [];

    const ytRoleId = roles['🎬・Notificações YouTube'];
    const videoEmbed = new EmbedBuilder()
      .setAuthor({
        name: 'SpikerHak • Novo Vídeo no YouTube!',
        url: YT_URL,
        iconURL: files.length > 0 ? 'attachment://logo.png' : undefined
      })
      .setTitle(`🎬 ┃ ${title}`)
      .setURL(videoUrl)
      .setDescription(
        `Acabou de sair vídeo novo no canal **[@spikerhakofc](${YT_URL})**!\n\n` +
        `👉 **[Clique aqui para assistir agora](${videoUrl})**\n` +
        `Deixe o like e comente o que achou!`
      )
      .setColor(0xFF0000)
      .setImage(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)
      .setFooter({ text: 'YouTube Oficial • SpikerHak' })
      .setTimestamp(published ? new Date(published) : new Date());

    if (files.length > 0) {
      videoEmbed.setThumbnail('attachment://logo.png');
    }

    const watchRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Assistir no YouTube')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Link)
        .setURL(videoUrl)
    );

    await discordChannel.send({
      content: `${ytRoleId ? `<@&${ytRoleId}> ` : ''}🚨 **VÍDEO NOVO NO CANAL!**`,
      embeds: [videoEmbed],
      components: [watchRow],
      files
    });

    console.log(`[SpikerBot YT] Novo vídeo anunciado: ${title} (${videoUrl})`);
  } catch (err) {
    console.error('[SpikerBot YT] Erro ao checar vídeos:', err.message);
  }
}

function startYouTubeNotifier() {
  checkLatestYouTubeVideo(true);
  setInterval(() => checkLatestYouTubeVideo(false), YT_CHECK_INTERVAL_MS);
  console.log('[SpikerBot YT] Monitor de novos vídeos ativo (checagem a cada 5 minutos).');
}

// EVENTO: BOAS-VINDAS COM BANNER DO SERVIDOR E AVATAR DO MEMBRO
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const bannerPath = path.join(__dirname, 'banner.png');
    const files = fs.existsSync(bannerPath)
      ? [{ attachment: bannerPath, name: 'banner.png' }]
      : [];

    const welcomeEmbed = new EmbedBuilder()
      .setTitle('👋 ┃ BEM-VINDO AO SPIKERHAK!')
      .setDescription(
        `Fala ${member}! Seja bem-vindo ao **SpikerHak**.\n` +
        `Envie um print ou vídeo da sua inscrição em <#${LIBERAR_CHANNEL_ID}> para liberar o servidor completo!`
      )
      .setColor(0x00FFCC)
      .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .setFooter({ text: `SpikerHak • Membro #${member.guild.memberCount}` })
      .setTimestamp();

    if (files.length > 0) {
      welcomeEmbed.setImage('attachment://banner.png');
    }

    await channel.send({ content: `${member}`, embeds: [welcomeEmbed], files });
    console.log(`[SpikerBot] Boas-vindas enviado para ${member.user.tag}`);
  } catch (err) {
    console.error('[SpikerBot] Erro ao enviar boas-vindas:', err);
  }
});

async function grantVerifiedAccess(member) {
  if (!verificadoRoleId) throw new Error('Cargo Verificado não configurado.');
  await member.roles.add(verificadoRoleId);
  for (const role of [roles['🎬・Notificações YouTube'], roles['👤・Membro']]) {
    if (role) await member.roles.add(role).catch(() => {});
  }
}

// EVENTO: OCR DE VERIFICAÇÃO EM 🔓・liberar-servidor
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== LIBERAR_CHANNEL_ID) return;

  const member = message.member;
  if (!member) return;

  // Se já tiver o cargo verificado
  if (verificadoRoleId && member.roles.cache.has(verificadoRoleId)) {
    const reply = await message.reply('ℹ️ Você já possui o cargo **Verificado** e tem acesso completo ao servidor!');
    setTimeout(() => reply.delete().catch(() => {}), 8000);
    return;
  }

  const proofs = [...message.attachments.values()].filter(mediaType);
  if (!proofs.length) {
    const errorMsg = await message.reply('⚠️ Envie uma imagem ou um vídeo mostrando sua inscrição no canal [@spikerhakofc](https://www.youtube.com/@spikerhakofc).');
    setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
    return;
  }

  if (pendingProofs.has(message.author.id)) {
    const busyReply = await message.reply('⏳ Seu comprovante anterior ainda está na fila de verificação.');
    setTimeout(() => busyReply.delete().catch(() => {}), 10000);
    return;
  }
  pendingProofs.add(message.author.id);

  await message.react('⏳').catch(() => {});
  await waitForProofSlot();
  let proofConfirmed = false;
  try {
    const belongsToAnotherMember = hash => {
      const owner = loadHashes()[hash];
      return Boolean(owner && owner !== message.author.id);
    };
    let validation;
    let processingError;
    for (const proof of proofs) {
      try {
        validation = await verifyAttachment(proof, belongsToAnotherMember);
        if (!validation.valid) continue;

        // Conferir novamente porque outro membro pode ter enviado o arquivo durante a análise.
        const hashes = loadHashes();
        const owner = hashes[validation.hash];
        if (owner && owner !== message.author.id) {
          validation = { valid: false, reason: 'Esse arquivo já foi usado por outro membro. Envie um comprovante da sua própria tela.' };
          continue;
        }
        hashes[validation.hash] = message.author.id;
        saveHashes(hashes);
        break;
      } catch (error) {
        if (validation?.valid) throw error;
        processingError = error;
      }
    }
    if (!validation) throw processingError;

    if (validation.valid) {
      proofConfirmed = true;
      await grantVerifiedAccess(member);
      await message.react('✅').catch(() => {});

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ ┃ INSCRIÇÃO CONFIRMADA — SERVIDOR LIBERADO!')
        .setDescription(
          `Parabéns ${message.author}! Sua inscrição no canal **[@spikerhakofc](${YT_URL})** foi verificada com sucesso por nossa IA!\n\n` +
          `• 🔓 **Cargo Atribuído:** <@&${verificadoRoleId}>\n` +
          `• 🚀 Todos os canais de **Provedores, Farms, Jailbreaks, Projetos e Suporte** foram liberados para você!\n\n` +
          `*Seja muito bem-vindo ao SpikerHak e aproveite os conteúdos!*`
        )
        .setColor(0x2ECC71)
        .setFooter({ text: 'SpikerHak • Verificação Concluída com Sucesso' });

      await message.reply({ embeds: [successEmbed] }).catch(error => {
        console.error('[SpikerBot] Cargo atribuído, mas o aviso falhou:', error.code || error.name);
      });
      console.log(`[SpikerBot] Usuário ${message.author.tag} VERIFICADO com sucesso!`);

      // Logar aprovação no canal admin
      try {
        const logsChannel = await client.channels.fetch(ADMIN_LOGS_CHANNEL_ID);
        if (logsChannel && logsChannel.isTextBased()) {
          await logsChannel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('🔓 ┃ NOVO MEMBRO VERIFICADO POR OCR')
                .setColor(0x2ECC71)
                .addFields(
                  { name: '👤 Membro', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                  { name: '🆔 ID', value: `\`${message.author.id}\``, inline: true },
                  { name: '📺 Canal', value: '`@spikerhakofc`', inline: true }
                )
                .setThumbnail(message.author.displayAvatarURL())
                .setTimestamp()
            ]
          });
        }
      } catch (_) {}
    } else {
      // ❌ REJEITADO (Falso positivo evitado ou print inválida)
      await message.react('❌').catch(() => {});

      const rejectEmbed = new EmbedBuilder()
        .setTitle('❌ ┃ NÃO FOI POSSÍVEL CONFIRMAR SUA INSCRIÇÃO')
        .setDescription(
          `Olá ${message.author}, não consegui confirmar sua inscrição pelo comprovante enviado.\n\n` +
          `**Motivo:** ${validation.reason}\n\n` +
          `### 📌 Como resolver:\n` +
          `1. Acesse: [youtube.com/@spikerhakofc](${YT_URL})\n` +
          `2. Clique em **"Inscrever-se"** (o botão deve mudar para **"Inscrito"**).\n` +
          `3. Mostre o canal **SpikerHak** com o botão **"Inscrito"** ou o sininho da inscrição.\n` +
          `4. Envie um novo print ou vídeo aqui neste canal.\n\n` +
          `*(Essa mensagem será apagada em 1 minuto)*`
        )
        .setColor(0xE74C3C)
        .setFooter({ text: 'SpikerHak • Validação Rigorosa Anti-Fraude' });

      const rejectMsg = await message.reply({ embeds: [rejectEmbed] });
      setTimeout(() => rejectMsg.delete().catch(() => {}), 60000);
      console.log(`[SpikerBot] Verificação recusada para ${message.author.tag}: ${validation.reason}`);
    }
  } catch (err) {
    console.error('[SpikerBot OCR Error]:', err);
    const detail = err?.userMessage || 'Tente reenviar o comprovante.';
    const response = proofConfirmed
      ? '⚠️ Confirmei a inscrição, mas o Discord não liberou o cargo. Tente reenviar o comprovante ou fale com a equipe.'
      : '⚠️ Não consegui processar o comprovante. ' + detail;
    const errReply = await message.reply(response).catch(() => null);
    if (errReply) setTimeout(() => errReply.delete().catch(() => {}), 60000);
  } finally {
    await message.reactions.cache.get('⏳')?.users.remove(client.user.id).catch(() => {});
    pendingProofs.delete(message.author.id);
    releaseProofSlot();
  }
});

// EVENTO: SISTEMA DE TICKETS
client.on('interactionCreate', async (interaction) => {
  try {
    if (await donations.handleInteraction(interaction)) return;
  } catch (error) {
    console.error('[Doações] Não foi possível abrir o checkout:', error.code || error.name);
    return;
  }
  if (await giveaways.handleInteraction(interaction)) return;
  if (!interaction.isButton()) return;

  const data = loadData();

  // 1. ABRIR TICKET
  if (interaction.customId === 'open_ticket') {
    const guild = interaction.guild;
    if (!guild) return;

    // Verificar se usuário já possui canal de ticket aberto
    const existingTicket = Object.values(data.tickets).find(
      t => t.userId === interaction.user.id && !t.closed
    );
    if (existingTicket) {
      const existingChannel = guild.channels.cache.get(existingTicket.channelId);
      if (existingChannel) {
        return interaction.reply({
          content: `⚠️ Você já possui um ticket em andamento em ${existingChannel}!`,
          ephemeral: true
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    // Incrementar contador
    data.counter = (data.counter || 0) + 1;
    const ticketNumberStr = String(data.counter).padStart(3, '0');
    const channelName = `suporte-${ticketNumberStr}`;

    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ];

    for (const rId of staffRoleIds) {
      permissionOverwrites.push({
        id: rId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AddReactions
        ]
      });
    }

    try {
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: SUPPORT_CATEGORY_ID,
        topic: `Ticket de Suporte #${ticketNumberStr} | Usuário: ${interaction.user.tag} (${interaction.user.id})`,
        permissionOverwrites
      });

      data.tickets[ticketChannel.id] = {
        ticketId: channelName,
        ticketNumber: data.counter,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        channelId: ticketChannel.id,
        createdAt: Date.now(),
        closed: false
      };
      saveData(data);

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 ┃ ATENDIMENTO: ${channelName.toUpperCase()}`)
        .setDescription(
          `Olá ${interaction.user}, seja bem-vindo ao seu ticket de suporte!\n\n` +
          `• Descreva detalhadamente a sua dúvida, erro ou o motivo do seu contato.\n` +
          `• Envie prints, logs ou links se necessário.\n` +
          `• Um membro da nossa equipe de **Administração / Suporte** irá lhe responder em breve.\n\n` +
          `*(Apenas Administradores e Moderadores podem encerrar este ticket)*`
        )
        .setColor(0x00FFCC)
        .setFooter({ text: 'SpikerHak Support • Clique abaixo quando o atendimento for concluído' });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Fechar Ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${interaction.user} | <@&${roles['⚡・Administrador'] || guild.id}>`,
        embeds: [ticketEmbed],
        components: [closeRow]
      });

      await interaction.editReply({
        content: `✅ Seu ticket foi aberto com sucesso em ${ticketChannel}!`
      });
      console.log(`[SpikerBot] Ticket ${channelName} criado para ${interaction.user.tag}`);
    } catch (err) {
      console.error('[SpikerBot] Erro ao criar canal de ticket:', err);
      await interaction.editReply({
        content: '❌ Ocorreu um erro ao criar seu ticket. Tente novamente mais tarde.'
      });
    }
    return;
  }

  // 2. FECHAR TICKET
  if (interaction.customId === 'close_ticket') {
    const member = interaction.member;
    const guild = interaction.guild;
    if (!guild || !member) return;

    const isStaff =
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      staffRoleIds.some(rId => member.roles.cache.has(rId));

    if (!isStaff) {
      return interaction.reply({
        content: '❌ Apenas Administradores e Moderadores da equipe podem fechar este ticket!',
        ephemeral: true
      });
    }

    const ticketInfo = data.tickets[interaction.channel.id];
    const ticketId = ticketInfo ? ticketInfo.ticketId : interaction.channel.name;
    const targetUserId = ticketInfo ? ticketInfo.userId : null;

    await interaction.reply({
      content: `🔒 **Ticket encerrado por ${interaction.user}.** Este canal será excluído em alguns segundos...`
    });

    if (ticketInfo) {
      ticketInfo.closed = true;
      ticketInfo.closedBy = interaction.user.id;
      ticketInfo.closedByTag = interaction.user.tag;
      ticketInfo.closedAt = Date.now();
      saveData(data);
    }

    // Enviar mensagem de avaliação na DM do usuário
    if (targetUserId) {
      try {
        const targetUser = await client.users.fetch(targetUserId);
        if (targetUser) {
          const dmEmbed = new EmbedBuilder()
            .setTitle('⭐ ┃ AVALIE SEU ATENDIMENTO — SPIKERHAK')
            .setDescription(
              `Olá **${targetUser.username}**!\n\n` +
              `Seu atendimento no ticket **\`${ticketId}\`** foi finalizado com sucesso por **${interaction.user.tag}**.\n\n` +
              `Por favor, avalie a qualidade do suporte recebido selecionando uma nota de 1 a 5 estrelas abaixo:`
            )
            .setColor(0xF1C40F)
            .setFooter({ text: 'Sua opinião é fundamental para melhorarmos nosso atendimento!' });

          const ratingRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rate_1_${ticketId}_${interaction.user.id}`).setLabel('1 ⭐').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rate_2_${ticketId}_${interaction.user.id}`).setLabel('2 ⭐').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rate_3_${ticketId}_${interaction.user.id}`).setLabel('3 ⭐').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rate_4_${ticketId}_${interaction.user.id}`).setLabel('4 ⭐').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rate_5_${ticketId}_${interaction.user.id}`).setLabel('5 ⭐').setStyle(ButtonStyle.Success)
          );

          await targetUser.send({ embeds: [dmEmbed], components: [ratingRow] });
          console.log(`[SpikerBot] DM de avaliação enviada para ${targetUser.tag}`);
        }
      } catch (dmErr) {
        console.log(`[SpikerBot] DM fechada para o usuário: ${dmErr.message}`);
        try {
          const logsChannel = await client.channels.fetch(ADMIN_LOGS_CHANNEL_ID);
          if (logsChannel && logsChannel.isTextBased()) {
            await logsChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('ℹ️ ┃ TICKET ENCERRADO (DM FECHADA)')
                  .setDescription(`O ticket **\`${ticketId}\`** foi fechado por ${interaction.user}, mas o usuário possui as DMs bloqueadas para avaliação.`)
                  .setColor(0x95A5A6)
                  .setTimestamp()
              ]
            });
          }
        } catch (_) {}
      }
    }

    setTimeout(async () => {
      try {
        await interaction.channel.delete('Ticket encerrado pelo administrador.');
        console.log(`[SpikerBot] Canal ${ticketId} deletado com sucesso.`);
      } catch (delErr) {
        console.error('[SpikerBot] Erro ao deletar canal do ticket:', delErr);
      }
    }, 3000);

    return;
  }

  // 3. AVALIAÇÃO DE ATENDIMENTO
  if (interaction.customId.startsWith('rate_')) {
    const parts = interaction.customId.split('_'); // rate, stars, ticketId, adminId
    const stars = parseInt(parts[1], 10) || 5;
    const ticketId = parts[2] || 'Suporte';
    const adminId = parts[3] || 'Desconhecido';

    const starString = '⭐'.repeat(stars);

    await interaction.update({
      content: `✅ **Muito obrigado pelo seu feedback!** Sua nota (**${starString} - ${stars}/5**) foi registrada com sucesso pela equipe SpikerHak.`,
      embeds: [],
      components: []
    });

    try {
      const logsChannel = await client.channels.fetch(ADMIN_LOGS_CHANNEL_ID);
      if (logsChannel && logsChannel.isTextBased()) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📊 ┃ AVALIAÇÃO DE SUPORTE RECEBIDA')
          .setColor(stars >= 4 ? 0x2ECC71 : stars === 3 ? 0xF1C40F : 0xE74C3C)
          .addFields(
            { name: '🎫 Ticket', value: `\`${ticketId}\``, inline: true },
            { name: '👤 Membro', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
            { name: '🛡️ Fechado por', value: `<@${adminId}>`, inline: true },
            { name: '⭐ Avaliação', value: `**${starString}** (${stars}/5 estrelas)`, inline: false }
          )
          .setFooter({ text: 'SpikerHak Logs • Avaliação de Atendimento' })
          .setTimestamp();

        await logsChannel.send({ embeds: [logEmbed] });
        console.log(`[SpikerBot] Avaliação do ticket ${ticketId} enviada para o canal de logs admin!`);
      }
    } catch (logErr) {
      console.error('[SpikerBot] Erro ao enviar log de avaliação:', logErr);
    }
  }
});

client.login(TOKEN).catch(err => {
  console.error('[SpikerBot] Erro fatal no login:', err);
});
