// Modal goes to src/interactions/modals/memberChannelCreate.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { makeCustomId } from '../../utils/customId.js';

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

    const featureCheck = await checkFeature(interaction, guild.id, 'member_channels');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      skipDefer: true,
    });

    if (!allowed) return;

    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'create_member_channel', guild.id))
      .setTitle('Create Member Channel')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Channel Name')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('channel_name_input')
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(25)
          )
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Playertags (space separated)')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('playertags_input')
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(0)
              .setMaxLength(1000)
              .setPlaceholder('#111 #222')
              .setRequired(false)
          )
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Discord Ids (space separated)')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('discord_ids_input')
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(0)
              .setMaxLength(3000)
              .setRequired(false)
          )
      );
    // .addLabelComponents(
    //   new LabelBuilder()
    //     .setLabel('Custom Message (optional)')
    //     .setTextInputComponent(
    //       new TextInputBuilder()
    //         .setCustomId('custom_message_input')
    //         .setStyle(TextInputStyle.Paragraph)
    //         .setMinLength(0)
    //         .setMaxLength(800)
    //         .setRequired(false)
    //     )
    // );

    await interaction.showModal(modal);
  },
};

export default command;
