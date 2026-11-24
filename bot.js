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
const Tesseract = require('tesseract.js');

const TOKEN = 'MTU3NDg5NDE4NzUzNzQ5ODE3Mg.GvKDrI.HkSAycblX9LrmadVs3dOBH6k1Ptv80YuxONOd4';
const GUILD_ID = '1574893765590650880';
const YT_URL = 'https://www.youtube.com/@natansitesofc';

const TICKET_PANEL_CHANNEL_ID = '1574896947381272688'; // 🎫・abrir-ticket
const SUPPORT_CATEGORY_ID = '1574896939227680858';     // ╭・🎧「 𝖲𝖴𝖯𝖮𝖱𝖳𝖤 」
const ADMIN_LOGS_CHANNEL_ID = '1574896994135183400';   // 🛡️・logs-de-moderação
const LIBERAR_CHANNEL_ID = '1574909372595708017';      // 🔓・liberar-servidor

const roles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles.json'), 'utf8'));
const verificadoRoleId = roles['✅・Verificado'];
const staffRoleIds = [
  roles['👑・Fundador'],
  roles['⚡・Administrador'],
  roles['🛡️・Moderador']
].filter(Boolean);

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

// Validador OCR rigoroso anti-falso-positivo
function validateSubscription(rawText) {
  if (!rawText || rawText.trim().length === 0) {
    return { valid: false, reason: 'Nenhum texto detectado na imagem enviada.' };
  }

  // Normalizar: remover acentos, minúsculas, caracteres especiais
  const clean = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@#_]/g, '');

  console.log('[OCR Analisado]:', clean.replace(/\n+/g, ' ').substring(0, 300));

  // 1. Validar identificação do canal (@natansitesofc / Natan Sites / SpikerHak)
  const hasChannel =
    clean.includes('natansitesofc') ||
    clean.includes('natansites') ||
    (clean.includes('natan') && clean.includes('sites')) ||
    (clean.includes('spikerhak') && clean.includes('417 inscritos')) ||
    (clean.includes('spikerhak') && clean.includes('natansites'));

  if (!hasChannel) {
    return {
      valid: false,
      reason: 'O canal @natansitesofc não foi identificado na print. Certifique-se de mostrar o nome ou o @ do canal.'
    };
  }

  // 2. Se for o próprio criador/proprietário do canal logado
  const isOwner =
    clean.includes('seucanal') ||
    clean.includes('seu canal') ||
    clean.includes('seusvideos') ||
    clean.includes('seus videos') ||
    clean.includes('gerenciar videos') ||
    clean.includes('personalizar canal');

  if (isOwner) {
    return { valid: true, isOwner: true };
  }

  // 3. Validar se o botão está como NÃO inscrito (Inscrever-se / Inscreva-se / Subscribe)
  const hasUnsubscribedButton =
    clean.includes('inscrever-se') ||
    clean.includes('inscreva-se') ||
    clean.includes('inscrever') ||
    clean.includes('inscreva') ||
    /\bsubscribe\b/i.test(clean);

  // 4. Validar se o botão está como INSCRITO
  const hasSubscribedButton =
    /\b(inscrito|inscrita|subscribed|suscrito)\b/i.test(clean) ||
    (clean.includes('inscrit') && !hasUnsubscribedButton);

  if (hasUnsubscribedButton && !hasSubscribedButton) {
    return {
      valid: false,
      reason: 'Você ainda não clicou em "Inscrever-se". O status deve estar como "Inscrito"!'
    };
  }

  if (!hasSubscribedButton) {
    return {
      valid: false,
      reason: 'Status de "Inscrito" não foi encontrado na print.'
    };
  }

  return { valid: true };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// Dummy HTTP server to satisfy Render Free Web Service port check
const http = require('http');
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SpikerBot is running 24/7 on Render!\n');
});
server.listen(PORT, () => {
  console.log(`[SpikerBot] Health check HTTP server online on port ${PORT}`);
});

client.once('ready', async () => {
  console.log(`[SpikerBot] Online como ${client.user.tag}!`);

  // Garantir que o painel de tickets está publicado em 🎫・abrir-ticket
  try {
    const channel = await client.channels.fetch(TICKET_PANEL_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const messages = await channel.messages.fetch({ limit: 5 });
      const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
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
});

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

  // Verificar se há anexos de imagem
  const imageAttachment = message.attachments.find(a =>
    a.contentType && (a.contentType.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(a.name || ''))
  );

  if (!imageAttachment) {
    const errorMsg = await message.reply('⚠️ Por favor, envie uma **imagem/print** comprovando sua inscrição no canal [youtube.com/@natansitesofc](https://www.youtube.com/@natansitesofc)!');
    setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
    return;
  }

  // Adicionar reação de processando
  try {
    await message.react('⏳');
  } catch (_) {}

  console.log(`[SpikerBot OCR] Processando print enviada por ${message.author.tag} (${imageAttachment.url})...`);

  try {
    // Executar OCR com Tesseract
    const ocrResult = await Tesseract.recognize(imageAttachment.url, 'por+eng', {
      logger: m => {}
    });

    const text = ocrResult.data.text || '';
    const validation = validateSubscription(text);

    // Remover reação de ampulheta
    try {
      const userReaction = message.reactions.cache.get('⏳');
      if (userReaction) await userReaction.users.remove(client.user.id);
    } catch (_) {}

    if (validation.valid) {
      // ✅ APROVADO!
      await message.react('✅');

      // Atribuir cargos
      if (verificadoRoleId) await member.roles.add(verificadoRoleId).catch(console.error);
      if (roles['🎬・Notificações YouTube']) await member.roles.add(roles['🎬・Notificações YouTube']).catch(() => {});
      if (roles['👤・Membro']) await member.roles.add(roles['👤・Membro']).catch(() => {});

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ ┃ INSCRIÇÃO CONFIRMADA — SERVIDOR LIBERADO!')
        .setDescription(
          `Parabéns ${message.author}! Sua inscrição no canal **[@natansitesofc](${YT_URL})** foi verificada com sucesso por nossa IA!\n\n` +
          `• 🔓 **Cargo Atribuído:** <@&${verificadoRoleId}>\n` +
          `• 🚀 Todos os canais de **Provedores, Farms, Jailbreaks, Projetos e Suporte** foram liberados para você!\n\n` +
          `*Seja muito bem-vindo ao SpikerHak e aproveite os conteúdos!*`
        )
        .setColor(0x2ECC71)
        .setFooter({ text: 'SpikerHak • Verificação Concluída com Sucesso' });

      await message.reply({ embeds: [successEmbed] });
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
                  { name: '📺 Canal', value: '`@natansitesofc`', inline: true }
                )
                .setThumbnail(message.author.displayAvatarURL())
                .setTimestamp()
            ]
          });
        }
      } catch (_) {}
    } else {
      // ❌ REJEITADO (Falso positivo evitado ou print inválida)
      await message.react('❌');

      const rejectEmbed = new EmbedBuilder()
        .setTitle('❌ ┃ NÃO FOI POSSÍVEL CONFIRMAR SUA INSCRIÇÃO')
        .setDescription(
          `Olá ${message.author}, nossa IA analisou sua print mas **não encontrou a comprovação de inscrição**.\n\n` +
          `**Motivo:** ${validation.reason}\n\n` +
          `### 📌 Como resolver:\n` +
          `1. Acesse: [youtube.com/@natansitesofc](${YT_URL})\n` +
          `2. Clique em **"Inscrever-se"** (o botão deve mudar para **"Inscrito"**).\n` +
          `3. Tire uma print nítida onde apareça o nome **@natansitesofc** e o botão **"Inscrito"**.\n` +
          `4. Envie a nova print aqui neste canal.\n\n` +
          `*(Essa mensagem será apagada em 20 segundos)*`
        )
        .setColor(0xE74C3C)
        .setFooter({ text: 'SpikerHak • Validação Rigorosa Anti-Fraude' });

      const rejectMsg = await message.reply({ embeds: [rejectEmbed] });
      setTimeout(() => rejectMsg.delete().catch(() => {}), 20000);
      console.log(`[SpikerBot] Verificação recusada para ${message.author.tag}: ${validation.reason}`);
    }
  } catch (err) {
    console.error('[SpikerBot OCR Error]:', err);
    try {
      const userReaction = message.reactions.cache.get('⏳');
      if (userReaction) await userReaction.users.remove(client.user.id);
      await message.react('❌');
    } catch (_) {}

    const errReply = await message.reply('❌ Ocorreu um erro ao processar a imagem. Por favor, envie uma print em formato JPG ou PNG mais nítida!');
    setTimeout(() => errReply.delete().catch(() => {}), 15000);
  }
});

// EVENTO: SISTEMA DE TICKETS
client.on('interactionCreate', async (interaction) => {
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
