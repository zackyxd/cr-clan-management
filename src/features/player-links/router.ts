import { ButtonInteraction, EmbedBuilder, GuildMember, StringSelectMenuInteraction } from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import logger from '../../logger.js';
import { playerEmbedCache } from '../../cache/playerEmbedCache.js';

/**
 * Links Feature Interaction Router
 * Handles all interactions related to player linking
 */
export class PlayerLinksInteractionRouter {
  /**
   * Handle button interactions
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    if (action === 'link_rename') {
      await this.handleRenameButton(interaction, parsed);
    }
  }

  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const playertag = interaction.values[0];
    const metadata = interaction.message.interactionMetadata;
    const interactionId = metadata?.id;
    const embedMap = interactionId ? playerEmbedCache.get(interactionId) : undefined;
    if (!embedMap) {
      await interaction.reply({ content: 'Session expired. Please run the command again.', ephemeral: true });
      return;
    }
    const embed = embedMap.get(playertag);
    if (!embed) {
      await interaction.reply({ content: 'Could not find player data.', ephemeral: true });
      return;
    }
    // Update the original message with the selected embed
    await interaction.update({ embeds: [embed] });
  }

  /**
   * Handle the rename button after linking a player
   */
  private static async handleRenameButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    await interaction.deferUpdate();

    const { extra } = parsed;
    if (!extra || extra.length < 2) {
      await interaction.followUp({
        content: '❌ Invalid button data.',
        ephemeral: true,
      });
      return;
    }

    const [userId, playerName] = extra;

    try {
      // Fetch the member from the guild
      const member: GuildMember | null = (await interaction.guild?.members.fetch(userId).catch(() => null)) ?? null;

      if (!member) {
        await interaction.followUp({
          embeds: [new EmbedBuilder().setDescription('**This user is not in this server.**').setColor(EmbedColor.FAIL)],
          ephemeral: true,
        });
        return;
      }

      // Rename the member
      await member.setNickname(playerName);

      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setDescription(`✅ Successfully renamed <@${userId}> to **${playerName}**`)
            .setColor(EmbedColor.SUCCESS),
        ],
        ephemeral: true,
      });
    } catch (error) {
      logger.error('[handleRenameButton] Error renaming user:', error);
      await interaction.followUp({
        content: '❌ Could not rename this player. Likely missing permissions.',
        ephemeral: true,
      });
    }
  }
}
