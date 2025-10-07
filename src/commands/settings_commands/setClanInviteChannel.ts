import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  NewsChannel,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import pool from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { Command } from '../../types/Command.js';
import { updateInviteMessage } from '../staff_commands/updateClanInvite.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-clan-invite-channel')
    .setDescription('Channel for clan invites to go to (must enable in settings)')
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel to use for clan invites').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('channel');
    if (!channel || !channel.id || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ The selected channel is an invalid channel.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let messageId = '';
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `
        SELECT pin_message
        FROM clan_invite_settings
        WHERE guild_id = $1
        `,
        [guild.id]
      );
      if (!rows.length) return;
      const pinMessage = rows[0].pin_message;
      const editableMessage = await channel.send({ content: 'This message will be used for clan invites.' });

      if (pinMessage) {
        await editableMessage.pin(); // pin returns Promise<Message>, but we already have the message
        // Delete the system pin message
        const fetched = await channel.messages.fetch({ limit: 5 });
        const systemMessage = fetched.find((msg) => msg.type === 6);
        if (systemMessage) await systemMessage.delete().catch(console.error);
      }

      // Now editableMessage is still a Message object, safe to access .id
      messageId = editableMessage.id;
      await client.query(`UPDATE clan_invite_settings SET channel_id=$1, message_id=$2 WHERE guild_id=$3`, [
        channel.id,
        editableMessage.id,
        guild.id,
      ]);
      const { embeds, components } = await updateInviteMessage(client, guild.id);
      await editableMessage.edit({ content: null, embeds, components });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      const description = `Error making ${channel} the channel for clan invites. ${err}`;
      const embed = new EmbedBuilder().setDescription(description).setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });

      return;
    } finally {
      client.release();
    }

    const checkAdded = await pool.query(
      `
      SELECT channel_id, message_id
      FROM clan_invite_settings
      WHERE guild_id = $1
      `,
      [guild.id]
    );

    let successfullyAdded = false;
    if (checkAdded.rows[0]['channel_id'] === channel?.id && checkAdded.rows[0]['message_id'] === messageId) {
      successfullyAdded = true;
    }

    let description: string = '';
    let embedColor: EmbedColor = EmbedColor.WARNING;
    if (successfullyAdded) {
      description = `Successfully added ${channel} to be used as the invite channel for clan invites.`;
      embedColor = EmbedColor.SUCCESS;
    } else {
      description = `Error making ${channel} the channel for clan invites.`;
      embedColor = EmbedColor.FAIL;
    }

    const embed = new EmbedBuilder().setDescription(description).setColor(embedColor);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
