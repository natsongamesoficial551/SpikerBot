const { randomInt } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');

const COMMAND = 'sorteio';
const TEST_COMMAND = 'sorte-test';
const FORM = 'giveaway:create';
const TEST_FORM = 'giveaway:create-test';
const BUTTON = /^giveaway:(join|leave|draw|cancel):(\d{17,20})$/;
const DEADLINE_BUTTON = /^giveaway:deadline:(\d{17,20})$/;
const DEADLINE_FORM = /^giveaway:deadline-form:(\d{17,20})$/;
const DRAFT_LIFETIME = 15 * 60_000;
const DEADLINE_CHECK_INTERVAL = 5_000;
const durationUnits = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const noMentions = { parse: [] };

async function registerGiveawayCommands(guild) {
  const commands = [
    [COMMAND, 'Abra o formulário para criar um sorteio personalizado.'],
    [TEST_COMMAND, 'Crie um sorteio identificado como teste no canal da equipe.']
  ];
  await Promise.all(commands.map(([name, description]) => guild.commands.create(
    new SlashCommandBuilder().setName(name).setDescription(description)
  )));
}

function field(id, label, { max, style = TextInputStyle.Short, initial, placeholder }) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(true);
  if (initial !== undefined) input.setValue(initial);
  if (placeholder) input.setPlaceholder(placeholder);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function createForm(test) {
  return new ModalBuilder().setCustomId(test ? TEST_FORM : FORM)
    .setTitle(test ? 'Criar sorteio de teste' : 'Criar sorteio').addLabelComponents(
    field('name', 'Nome do sorteio', { max: 100 }),
    field('description', 'Descrição e regras', { max: 1500, style: TextInputStyle.Paragraph }),
    field('entryPrice', 'Valor da participação (R$)', { max: 15, initial: '0', placeholder: '0 para participação gratuita' }),
    field('limit', 'Limite de pessoas (0 = ilimitado)', { max: 16, initial: '0' }),
    field('prizeValue', 'Valor do produto (R$)', { max: 15, initial: '0', placeholder: 'Ex.: 149,90' })
  );
}

function durationForm(id) {
  return new ModalBuilder().setCustomId(`giveaway:deadline-form:${id}`).setTitle('Definir duração')
    .addLabelComponents(field('duration', 'Quanto tempo o sorteio fica aberto?', {
      max: 32, placeholder: 'Ex.: 30m, 2h, 1h 30m ou 3d'
    }));
}

function readDuration(raw) {
  const value = raw.trim().toLowerCase();
  if (!/^(?:\d+\s*[smhd]\s*)+$/.test(value)) return 0;
  let milliseconds = 0;
  for (const [, amount, unit] of value.matchAll(/(\d+)\s*([smhd])/g)) {
    milliseconds += Number(amount) * durationUnits[unit];
  }
  return Number.isSafeInteger(milliseconds) && Number.isFinite(new Date(Date.now() + milliseconds).getTime())
    ? milliseconds : 0;
}

function moneyInCents(raw) {
  const value = raw.replace(/^R\$\s*/i, '').trim();
  const brazilian = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  const decimalPoint = /^\d+(?:\.\d{1,2})?$/;
  const parts = brazilian.test(value) ? value.replace(/\./g, '').split(',')
    : decimalPoint.test(value) ? value.split('.') : [];
  if (!parts.length) return null;
  const cents = Number(parts[0] + (parts[1] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function readForm(fields) {
  const read = id => fields.getTextInputValue(id).trim();
  const name = read('name');
  const description = read('description');
  const entryPrice = moneyInCents(read('entryPrice'));
  const prizeValue = moneyInCents(read('prizeValue'));
  const limitInput = read('limit');
  const limit = Number(limitInput);

  if (!name || !description || name.length > 100 || description.length > 1500) {
    return { error: 'Preencha o nome e a descrição do sorteio.' };
  }
  if (!/^\d+$/.test(limitInput) || !Number.isSafeInteger(limit)) {
    return { error: 'Use um número inteiro no limite de pessoas. Digite 0 para deixar ilimitado.' };
  }
  if (entryPrice === null || prizeValue === null) {
    return { error: 'Use valores em reais a partir de 0, com até duas casas decimais. Exemplo: 49,90.' };
  }
  return { name, description, entryPrice, limit, prizeValue };
}

function readGiveaways(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function saveGiveaways(file, giveaways) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(giveaways), 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function renderPanel(giveaway) {
  const open = giveaway.status === 'open';
  const count = giveaway.participants.length;
  const status = open ? 'Aberto' : giveaway.status === 'cancelled' ? 'Cancelado' : 'Encerrado';
  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${giveaway.test ? '[TESTE] ' : ''}${giveaway.name}`)
    .setDescription(giveaway.description)
    .setColor(open ? 0x5865F2 : giveaway.winnerId ? 0x2ECC71 : 0x747F8D)
    .addFields(
      { name: 'Participação', value: giveaway.entryPrice ? currency.format(giveaway.entryPrice / 100) : 'Gratuita', inline: true },
      { name: 'Valor do produto', value: currency.format(giveaway.prizeValue / 100), inline: true },
      { name: 'Participantes', value: giveaway.limit ? `${count} / ${giveaway.limit}` : `${count} / ilimitado`, inline: true },
      { name: 'Status', value: status, inline: true }
    );
  if (giveaway.endsAt) {
    const timestamp = Math.floor(giveaway.endsAt / 1000);
    embed.addFields({ name: 'Encerramento previsto', value: `<t:${timestamp}:F>${open ? ` · <t:${timestamp}:R>` : ''}` });
  }
  if (giveaway.winnerId) embed.addFields({ name: '🏆 Ganhador', value: `<@${giveaway.winnerId}>` });
  else if (giveaway.status === 'ended') embed.addFields({ name: 'Resultado', value: 'O sorteio terminou sem participantes.' });
  if (giveaway.entryPrice) embed.setFooter({ text: 'Valor informativo. O botão de participação não cobra pagamentos.' });

  const button = (action, label, style, disabled = false) => new ButtonBuilder()
    .setCustomId(`giveaway:${action}:${giveaway.id}`)
    .setLabel(label).setStyle(style).setDisabled(disabled);

  const components = open ? [new ActionRowBuilder().addComponents(
    button('join', 'Participar', ButtonStyle.Success, giveaway.limit > 0 && count >= giveaway.limit),
    button('leave', 'Sair', ButtonStyle.Secondary),
    button('draw', 'Sortear ganhador', ButtonStyle.Primary),
    button('cancel', 'Cancelar sorteio', ButtonStyle.Danger)
  )] : [];
  return { embeds: [embed], components, allowedMentions: noMentions };
}

function canManage(interaction, staffRoleIds) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  return staffRoleIds.some(id => Array.isArray(roles) ? roles.includes(id) : roles?.cache?.has(id));
}

function finishDraw(giveaway) {
  const { participants } = giveaway;
  giveaway.winnerId = participants.length ? participants[randomInt(participants.length)] : null;
  giveaway.status = giveaway.winnerId ? 'drawn' : 'ended';
}

function isDue(giveaway, now) {
  return giveaway.status === 'open' && giveaway.endsAt && giveaway.endsAt <= now;
}

function applyAction(giveaway, action, userId) {
  if (giveaway.status !== 'open') return { message: 'Este sorteio já foi encerrado ou cancelado.' };

  const participants = giveaway.participants;
  const index = participants.indexOf(userId);
  switch (action) {
    case 'join':
      if (index !== -1) return { message: 'Você já está participando deste sorteio.' };
      if (giveaway.limit && participants.length >= giveaway.limit) return { message: 'Todas as vagas foram preenchidas.' };
      participants.push(userId);
      return { changed: true, message: 'Sua participação foi registrada.' };
    case 'leave':
      if (index === -1) return { message: 'Você ainda não está participando deste sorteio.' };
      participants.splice(index, 1);
      return { changed: true, message: 'Você saiu do sorteio.' };
    case 'draw':
      if (!participants.length) return { message: 'É preciso ter pelo menos uma pessoa inscrita para sortear.' };
      finishDraw(giveaway);
      return { changed: true, message: `Ganhador sorteado: <@${giveaway.winnerId}>.` };
    case 'cancel':
      giveaway.status = 'cancelled';
      return { changed: true, message: 'O sorteio foi cancelado.' };
  }
}

function createGiveawayService({ guildId, staffRoleIds, dataFile, testChannelId }) {
  const updates = new Map();
  const drafts = new Map();
  const managerOnly = 'Apenas a equipe do servidor pode gerenciar sorteios.';
  const reply = (interaction, content, components = []) =>
    interaction.reply({ content, components, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
  const defer = interaction => interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const edit = (interaction, content) => interaction.editReply({ content, allowedMentions: noMentions });

  async function prepareDraft(interaction, test) {
    const values = readForm(interaction.fields);
    if (values.error) return reply(interaction, values.error);
    if (!test && !interaction.channel?.isSendable()) {
      return reply(interaction, 'Abra o formulário em um canal onde o bot possa publicar.');
    }
    const id = interaction.id;
    const button = new ButtonBuilder()
      .setCustomId(`giveaway:deadline:${id}`).setLabel('Definir duração').setStyle(ButtonStyle.Primary);
    drafts.set(id, {
      values, test, channelId: interaction.channelId, userId: interaction.user.id,
      expiresAt: Date.now() + DRAFT_LIFETIME
    });
    return reply(interaction, 'Falta definir por quanto tempo o sorteio vai ficar aberto.', [
      new ActionRowBuilder().addComponents(button)
    ]);
  }

  async function setDuration(interaction, id, showForm) {
    const draft = drafts.get(id);
    if (!draft || draft.expiresAt <= Date.now() ||
        draft.userId !== interaction.user.id || draft.channelId !== interaction.channelId) {
      return reply(interaction, 'Este formulário expirou ou pertence a outra pessoa. Abra o comando novamente.');
    }
    if (showForm) return interaction.showModal(durationForm(id));

    const duration = readDuration(interaction.fields.getTextInputValue('duration'));
    if (!duration) return reply(interaction, 'Informe uma duração maior que zero, como 30m, 2h ou 3d.');

    drafts.delete(id);
    await defer(interaction);
    const channel = draft.test ? await interaction.guild.channels.fetch(testChannelId) : interaction.channel;
    if (!channel?.isSendable()) return edit(interaction, 'O canal de destino está indisponível para publicar o sorteio.');

    const giveaway = {
      ...draft.values, id, guildId, channelId: channel.id, messageId: null,
      test: draft.test, endsAt: Date.now() + duration, status: 'open', participants: [], winnerId: null
    };
    saveGiveaways(dataFile, { ...readGiveaways(dataFile), [id]: giveaway });

    const message = await channel.send({ ...renderPanel(giveaway), nonce: id, enforceNonce: true });
    const giveaways = readGiveaways(dataFile);
    giveaways[id].messageId = message.id;
    saveGiveaways(dataFile, giveaways);
    return edit(interaction, `Sorteio publicado. ${message.url}`);
  }

  async function enqueue(id, run) {
    const pending = updates.get(id) || Promise.resolve();
    const update = pending.catch(() => {}).then(run);
    updates.set(id, update);
    try {
      return await update;
    } finally {
      if (updates.get(id) === update) updates.delete(id);
    }
  }

  async function syncPanel(giveaway, message) {
    await message.edit(renderPanel(giveaway));
    if (!giveaway.panelPending) return;
    const giveaways = readGiveaways(dataFile);
    delete giveaways[giveaway.id].panelPending;
    saveGiveaways(dataFile, giveaways);
  }

  async function handleButton(interaction, action, id) {
    if ((action === 'draw' || action === 'cancel') && !canManage(interaction, staffRoleIds)) {
      return reply(interaction, managerOnly);
    }
    await defer(interaction);
    await enqueue(id, async () => {
      const giveaways = readGiveaways(dataFile);
      const giveaway = giveaways[id];
      if (!giveaway || giveaway.guildId !== guildId || giveaway.channelId !== interaction.channelId ||
          (giveaway.messageId && giveaway.messageId !== interaction.message.id)) {
        return edit(interaction, 'Este painel de sorteio não está disponível.');
      }

      const expired = isDue(giveaway, Date.now());
      if (expired) finishDraw(giveaway);
      const { changed, message } = expired ? { changed: true, message: 'O prazo deste sorteio já terminou.' }
        : applyAction(giveaway, action, interaction.user.id);
      if (changed || !giveaway.messageId) {
        giveaway.messageId = interaction.message.id;
        if (changed && giveaway.status !== 'open') giveaway.panelPending = true;
        saveGiveaways(dataFile, giveaways);
      }
      try {
        await syncPanel(giveaway, interaction.message);
      } catch (error) {
        console.error('[Sorteio] Falha ao atualizar o painel:', error);
        return edit(interaction, `${message} Não consegui atualizar o painel agora.`);
      }
      return edit(interaction, message);
    });
  }

  async function expireDue(client) {
    const now = Date.now();
    for (const [id, draft] of drafts) {
      if (draft.expiresAt <= now) drafts.delete(id);
    }
    const due = Object.values(readGiveaways(dataFile)).filter(giveaway =>
      giveaway.guildId === guildId && giveaway.messageId && !updates.has(giveaway.id) &&
      (giveaway.panelPending || isDue(giveaway, now)));
    await Promise.all(due.map(({ id }) => enqueue(id, async () => {
      const giveaways = readGiveaways(dataFile);
      const giveaway = giveaways[id];
      if (!giveaway) return;
      if (isDue(giveaway, Date.now())) {
        finishDraw(giveaway);
        giveaway.panelPending = true;
        saveGiveaways(dataFile, giveaways);
      }
      if (!giveaway.panelPending) return;
      try {
        const channel = await client.channels.fetch(giveaway.channelId);
        if (!channel?.isTextBased()) return;
        const message = await channel.messages.fetch(giveaway.messageId);
        await syncPanel(giveaway, message);
      } catch (error) {
        // Deleted messages and channels cannot be refreshed.
        if (error.code !== 10003 && error.code !== 10008) throw error;
        const current = readGiveaways(dataFile);
        delete current[id].panelPending;
        saveGiveaways(dataFile, current);
      }
    })));
  }

  function startExpiration(client) {
    const check = () => expireDue(client).catch(error => console.error('[Sorteio] Falha ao encerrar sorteios:', error));
    const interval = setInterval(check, DEADLINE_CHECK_INTERVAL);
    interval.unref();
    void check();
  }

  async function handleInteraction(interaction) {
    const command = interaction.isChatInputCommand() && [COMMAND, TEST_COMMAND].includes(interaction.commandName);
    const form = interaction.isModalSubmit() && [FORM, TEST_FORM].includes(interaction.customId);
    const match = interaction.isButton() && BUTTON.exec(interaction.customId);
    const deadlineButton = interaction.isButton() && DEADLINE_BUTTON.exec(interaction.customId);
    const deadlineForm = interaction.isModalSubmit() && DEADLINE_FORM.exec(interaction.customId);
    if (!command && !form && !match && !deadlineButton && !deadlineForm) return false;

    try {
      if (interaction.guildId !== guildId) {
        await reply(interaction, 'Este sorteio está disponível apenas no servidor SpikerHak.');
      } else if (match) {
        await handleButton(interaction, match[1], match[2]);
      } else if (!canManage(interaction, staffRoleIds)) {
        await reply(interaction, managerOnly);
      } else if (command) {
        await interaction.showModal(createForm(interaction.commandName === TEST_COMMAND));
      } else if (form) {
        await prepareDraft(interaction, interaction.customId === TEST_FORM);
      } else {
        await setDuration(interaction, (deadlineButton || deadlineForm)[1], Boolean(deadlineButton));
      }
    } catch (error) {
      console.error('[Sorteio] Falha na interação:', error);
      const failure = 'Não consegui concluir a ação do sorteio agora.';
      if (interaction.deferred || interaction.replied) await edit(interaction, failure).catch(() => {});
      else await reply(interaction, failure).catch(() => {});
    }
    return true;
  }

  return { handleInteraction, startExpiration, expireDue };
}

module.exports = { createGiveawayService, registerGiveawayCommands };
