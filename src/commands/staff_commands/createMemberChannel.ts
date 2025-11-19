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
import { pool } from '../../db.js';

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

    // Check if member channel settings are properly configured
    try {
      const settingsCheck = await pool.query(
        `
        SELECT category_id, pin_invite, auto_ping, logs_channel_id, channel_count
        FROM member_channel_settings
        WHERE guild_id = $1
        `,
        [guild.id]
      );

      if (settingsCheck.rows.length === 0) {
        await interaction.reply({
          content:
            '❌ Member channel settings are not configured for this server. Please contact an administrator to set up the member channel category first.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const settings = settingsCheck.rows[0];

      // Check if category_id is set
      if (!settings.category_id) {
        await interaction.reply({
          content:
            '❌ No category has been set for member channels. Please contact an administrator to configure the member channel category first.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Verify the category still exists
      try {
        const category = await guild.channels.fetch(settings.category_id);
        if (!category || category.type !== 4) {
          // 4 = CategoryChannel
          await interaction.reply({
            content:
              '❌ The configured member channel category no longer exists or is invalid. Please contact an administrator to reconfigure the settings.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } catch (error) {
        console.log(error);
        await interaction.reply({
          content:
            '❌ Unable to access the configured member channel category. Please contact an administrator to check the settings.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (dbError) {
      console.error('Error checking member channel settings:', dbError);
      await interaction.reply({
        content: '❌ Unable to verify member channel settings. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
