import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { EmbedColor } from '../types/EmbedUtil.js';
import { checkFeatureSetting, isFeatureEnabled } from '../config/featureRegistry.js';

export async function checkFeature(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  featureType: string
): Promise<boolean> {
  const check = await checkFeatureEnabled(guildId, featureType);
  if (!check.enabled) {
    // If not enabled, show embed and return false
    if (check.embed) {
      await interaction.reply({ embeds: [check.embed], flags: MessageFlags.Ephemeral });
      return false;
    } else {
      await interaction.reply({
        content: 'Error showing embed for feature not enabled. Contact @Zacky',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
  }
  return true;
}

export async function checkFeatureEnabled(
  guildId: string,
  featureName: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  // Use centralized feature registry function
  const enabled = await isFeatureEnabled(guildId, featureName);

  if (!enabled) {
    // Create error embed
    const embed = new EmbedBuilder()
      .setDescription(
        `**The \`${featureName}\` feature has not been enabled for this guild.**\nPlease ask one of the server admins to enable it in \`/server-settings\``
      )
      .setColor(EmbedColor.FAIL);
    return { enabled: false, embed: embed };
  }
  return { enabled: true };
}

export async function checkTicketFeatureEnabled(
  guildId: string,
  settingKey: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  // Use centralized feature registry check setting function
  return await checkFeatureSetting(guildId, 'tickets', settingKey);
}

export async function checkLinkFeatureEnabled(
  guildId: string,
  settingKey: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  // Use centralized feature registry check setting function
  return await checkFeatureSetting(guildId, 'links', settingKey);
}

export async function checkMemberChannelsFeatureEnabled(
  guildId: string,
  settingKey: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  // Use centralized feature registry check setting function
  return await checkFeatureSetting(guildId, 'member_channels', settingKey);
}
