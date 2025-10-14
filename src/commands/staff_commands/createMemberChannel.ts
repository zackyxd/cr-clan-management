import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('create-member-channel')
    .setDescription('(Coleader+) Create a member channel'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'member-channels');
    if (!featureCheck) {
      return;
    }
  },
};

export default command;
