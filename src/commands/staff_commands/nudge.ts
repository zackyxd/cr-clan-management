import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { getRaceAttacks, initializeOrUpdateRace } from '../../features/race-tracking/service.js';
import { getNudgeMessage, trackNudge, buildNudgeComponents } from '../../features/race-tracking/nudgeHelper.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nudge')
    .setDescription('Send a nudge to all members with attacks remaining in a clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    // const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    const clanRes = await pool.query(
      `SELECT clantag, clan_name, nudge_enabled, race_custom_nudge_message, race_nudge_channel_id 
       FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput], // userInput catches if abbreviation is used
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;
    const customMessage = clanRes.rows[0]?.race_custom_nudge_message;
    const nudgeChannelId = clanRes.rows[0]?.race_nudge_channel_id;
    const nudgeEnabled = clanRes.rows[0]?.nudge_enabled;

    if (!nudgeEnabled) {
      await interaction.editReply({
        content: `❌ Nudges are disabled for this clan. Enable them in \`/clan-settings\`.`,
      });
      return;
    }

    const result = await initializeOrUpdateRace(guild.id, fixedClantag);
    if (!result) {
      await interaction.editReply('❌ Failed to fetch race data. Please try again later.');
      return;
    }

    const nudgeMessage =
      (await getNudgeMessage(guild.id, fixedClantag, clanRes.rows[0]?.clan_name, result.warDay, customMessage)) +
      ` (Sent by <@${interaction.user.id}>)`;

    const attacksData = await getRaceAttacks(guild.id, result.raceId, result.raceData, result.seasonId, result.warWeek);
    if (!attacksData) {
      await interaction.editReply('❌ Failed to fetch attacks data. Please try again later.');
      return;
    }

    // Build nudge components using shared helper
    const nudgeComponents = await buildNudgeComponents(guild, attacksData, nudgeMessage, nudgeChannelId);

    if (!nudgeComponents) {
      await interaction.editReply('✅ Everyone has completed their attacks!');
      return;
    }

    // Send nudge to channel
    if (!nudgeChannelId) {
      await interaction.editReply('❌ No nudge channel configured for this clan. Set one in `/clan-settings`.');
      return;
    }

    try {
      const nudgeChannel = await guild.channels.fetch(nudgeChannelId);
      if (!nudgeChannel?.isTextBased()) {
        await interaction.editReply('❌ Nudge channel not found or is not a text channel.');
        return;
      }

      // Send message with Components v2
      await nudgeChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: nudgeComponents.components,
      });

      trackNudge(
        attacksData.raceId,
        fixedClantag,
        result.warWeek,
        result.warDay,
        'manual',
        nudgeMessage,
        nudgeComponents.enrichedParticipants,
      ).catch((err) => console.error('Error tracking nudge:', err));

      await interaction.editReply(`✅ Nudge sent to <#${nudgeChannelId}>!`);
    } catch (error) {
      console.error('Error sending nudge:', error);
      await interaction.editReply('❌ Failed to send nudge. Check bot permissions and channel configuration.');
    }
  },
};

export default command;
