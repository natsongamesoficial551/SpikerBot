const { ChannelType, PermissionsBitField } = require('discord.js');

const DONOR_ROLE = '💸・Doador';
const DONOR_CATEGORY = '╭・💎「 𝗗𝗢𝗔𝗗𝗢𝗥𝗘𝗦 」';
const DONOR_CHAT = '💬・chat-elonmusk';
const PREVIEW_CHAT = '🧪・pré-lançamento';
const reason = 'Benefícios de doadores da comunidade SpikerHak';
const flags = PermissionsBitField.Flags;

const read = { ViewChannel: true, ReadMessageHistory: true, AddReactions: true };
const noPosts = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  SendPolls: false,
  UseApplicationCommands: false,
  UseExternalApps: false
};

function masks(permissions) {
  return Object.entries(permissions).reduce((sets, [key, allow]) => {
    sets[allow ? 'allow' : 'deny'].push(flags[key]);
    return sets;
  }, { allow: [], deny: [] });
}

async function ensureChannel(guild, existing, { name, previousName, type, parent, topic, overrides }) {
  const find = candidate => existing.find(channel => channel && channel.type === type &&
    channel.name.toLocaleLowerCase('pt-BR') === candidate.toLocaleLowerCase('pt-BR') && channel.parentId === (parent || null));
  const found = find(name) || find(previousName);
  if (!found) {
    return guild.channels.create({
      name, type, parent, topic, reason,
      permissionOverwrites: overrides.map(([id, permissions]) => ({ id, ...masks(permissions) }))
    });
  }
  if (found.name !== name) await found.setName(name, reason);
  for (const [id, permissions] of overrides) {
    const current = found.permissionOverwrites.cache.get(id);
    const alreadySet = current && Object.entries(permissions).every(([key, allow]) =>
      (allow ? current.allow : current.deny).has(flags[key], false));
    if (!alreadySet) await found.permissionOverwrites.edit(id, permissions, { reason });
  }
  return found;
}

async function ensureDonorChannels(guild, donorRole, staffRoleIds) {
  const existing = await guild.channels.fetch();
  const staff = staffRoleIds.filter(id => guild.roles.cache.has(id));
  const staffAccess = staff.map(id => [id, { ...read, SendMessages: true }]);
  const privateAccess = [[guild.id, { ViewChannel: false }], [donorRole.id, read], ...staffAccess];
  const category = await ensureChannel(guild, existing, {
    name: DONOR_CATEGORY, previousName: 'Doadores', type: ChannelType.GuildCategory, overrides: privateAccess
  });
  const common = { type: ChannelType.GuildText, parent: category.id };
  const chat = await ensureChannel(guild, existing, {
    ...common, name: DONOR_CHAT, previousName: 'chat-elonmusk', topic: 'Espaço de conversa entre doadores do SpikerHak.',
    overrides: [[guild.id, { ViewChannel: false }], [donorRole.id, { ...read, SendMessages: true }], ...staffAccess]
  });
  const preview = await ensureChannel(guild, existing, {
    ...common, name: PREVIEW_CHAT, previousName: 'pré-lançamento',
    topic: 'Pré-lançamentos de ferramentas para doadores. A equipe publica e os doadores podem reagir com emojis.',
    overrides: [
      [guild.id, { ViewChannel: false, ...noPosts }],
      [donorRole.id, { ...read, ...noPosts }],
      ...staffAccess
    ]
  });
  return { category, chat, preview };
}

async function grantDonorRole(guild, memberId) {
  const roles = await guild.roles.fetch();
  const donorRole = roles.find(role => role.name === DONOR_ROLE);
  if (!donorRole?.editable) throw new Error('O cargo Doador está indisponível para o SpikerBot.');
  const member = await guild.members.fetch(memberId);
  if (!member.roles.cache.has(donorRole.id)) await member.roles.add(donorRole, 'Doação Pix confirmada pela PromissePay');
}

module.exports = { DONOR_ROLE, ensureDonorChannels, grantDonorRole };
