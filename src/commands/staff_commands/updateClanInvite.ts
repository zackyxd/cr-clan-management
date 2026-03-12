import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { parseInviteLink } from '../../features/clan-invites/utils.js';
import { normalizeTag } from '../../api/CR_API.js';
import { processInviteLinkUpdate } from '../../features/clan-invites/messageManager.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('update-clan-invite')
    .setDescription('Update clan invites with new links')
    .addStringOption((option) =>
      option.setName('invite-link').setDescription('Copy and paste the clan invite here').setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'clan_invites');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const inviteLink = interaction.options.getString('invite-link')?.trim();
    if (!inviteLink) return;

    const parsed = parseInviteLink(inviteLink);
    if (!parsed) {
      const embed = new EmbedBuilder()
        .setDescription('❌ Invalid invite link format. Please provide a valid Clash Royale invite link.')
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    // match
    //  [
    // '/invite/clan/du?tag=V2GQU',
    // 'V2GQU',
    // index: 36,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //  ]

    // apiLink
    //   [
    // 'https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS',
    // 'iOS',
    // index: 8,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //   ]

    const givenClantag = normalizeTag(parsed.clantag);

    // Use shared logic from messageManager
    const result = await processInviteLinkUpdate(
      guild.id,
      givenClantag,
      parsed.fullLink,
      interaction.user.id,
      interaction.client,
    );

    await interaction.editReply({ embeds: [result.embed] });
  },
};

export default command;
