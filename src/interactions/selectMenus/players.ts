import { StringSelectMenuInteraction } from 'discord.js';
import { playerEmbedCache } from '../../cache/playerEmbedCache.js';

// Players from players.ts command
export async function players(interaction: StringSelectMenuInteraction) {
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
