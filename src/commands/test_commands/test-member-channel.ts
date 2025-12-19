import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { CommandInteraction } from 'discord.js';
import { makeCustomId } from '../../utils/customId.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

export const data = new SlashCommandBuilder()
  .setName('test-feature-routing')
  .setDescription('Test the new feature-based interaction routing system');

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🧪 Member Channel Feature Test')
    .setDescription('Click the buttons below to test the new feature-based interaction system:')
    .setColor(EmbedColor.SUCCESS)
    .addFields(
      { name: '🔘 Any Account Button', value: 'Tests the "any X accounts" modal flow', inline: true },
      { name: '➡️ Continue Button', value: 'Tests the continue workflow', inline: true },
      { name: '✅ Create Button', value: 'Tests the final creation step', inline: true }
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        makeCustomId('b', 'member_channel_any_account', interaction.guild.id, {
          ownerId: interaction.user.id,
          extra: ['5'], // maxAccounts = 5 for testing
        })
      )
      .setLabel('Test Any Account')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(
        makeCustomId('b', 'member_channel_continue', interaction.guild.id, {
          ownerId: interaction.user.id,
        })
      )
      .setLabel('Test Continue')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(
        makeCustomId('b', 'member_channel_create', interaction.guild.id, {
          ownerId: interaction.user.id,
        })
      )
      .setLabel('Test Create')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(
        makeCustomId('b', 'member_channel_cancel', interaction.guild.id, {
          ownerId: interaction.user.id,
        })
      )
      .setLabel('Test Cancel')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    embeds: [embed],
    components: [buttons],
    ephemeral: true,
  });
}

export const cooldown = 5; // 5 second cooldown

// Export as default for the command loader
export default {
  data,
  execute,
  cooldown,
};
