import { ButtonInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { memberChannelCache } from '../../cache/memberChannelCache.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { ButtonHandler } from '../handleButtonInteraction.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { pool } from '../../db.js';
import {
  buildPermissionOverwrites,
  convertToMemberData,
  getAllPlayersSorted,
  insertMemberChannel,
} from '../../utils/memberChannelHelpers.js';

const memberChannelCreationButton: ButtonHandler = {
  customId: 'member_channel',
  async execute(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const { extra } = parsed;
    const action = extra[0]; // 'confirm' or 'cancel'

    const data = memberChannelCache.get(interaction.message.interactionMetadata?.id || '');
    if (!data) {
      await interaction.reply({ content: '❌ Session expired. Please try again.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (action !== 'confirm' && action !== 'cancel') {
      await interaction.update({ content: 'Not sure how you got this, contact Zacky' });
      return;
    }

    if (action === 'cancel') {
      memberChannelCache.delete(interaction.message.interactionMetadata?.id || '');
      const cancelledEmbed = new EmbedBuilder()
        .setDescription('❌ Channel creation has been cancelled.')
        .setColor(EmbedColor.SUCCESS);
      await interaction.update({ content: '', components: [], embeds: [cancelledEmbed] });
      return;
    }

    // Defer the reply so we can take our time creating the channel
    await interaction.deferUpdate();

    const memberSettingData = await pool.query(
      `
      SELECT category_id, pin_invite, auto_ping, logs_channel_id, channel_count
      FROM member_channel_settings
      WHERE guild_id = $1
      `,
      [interaction.guild?.id]
    );

    const res = memberSettingData.rows[0];
    const currentCount = res?.channel_count || 0;

    try {
      // Check bot permissions first
      const botMember = await interaction.guild?.members.fetchMe();
      const botPermissions = botMember?.permissions;

      console.log('Bot has permissions:', {
        ManageChannels: botPermissions?.has(PermissionFlagsBits.ManageChannels),
        ViewChannel: botPermissions?.has(PermissionFlagsBits.ViewChannel),
        SendMessages: botPermissions?.has(PermissionFlagsBits.SendMessages),
        ReadMessageHistory: botPermissions?.has(PermissionFlagsBits.ReadMessageHistory),
        ManageRoles: botPermissions?.has(PermissionFlagsBits.ManageRoles),
      });

      // Check if category exists and bot has permissions in it
      if (res?.category_id) {
        const category = await interaction.guild?.channels.fetch(res.category_id);
        if (category) {
          const categoryPerms = category.permissionsFor(botMember!);
          console.log('Bot permissions in category:', {
            ViewChannel: categoryPerms?.has(PermissionFlagsBits.ViewChannel),
            ManageChannels: categoryPerms?.has(PermissionFlagsBits.ManageChannels),
            ManageRoles: categoryPerms?.has(PermissionFlagsBits.ManageRoles),
          });
        }
      }

      // Convert finalAccountSelection to member data structure
      const finalAccounts = data?.finalAccountSelection;
      if (!finalAccounts) {
        throw new Error('No accounts selected');
      }

      const { members, discordIds } = convertToMemberData(finalAccounts);
      console.log(`Processing ${discordIds.length} users with ${members.length} member entries`);

      // Add creator if not already included
      const allDiscordIds = [...discordIds];
      if (data?.creatorId && !discordIds.includes(data.creatorId)) {
        console.log('Adding creator permissions');
        allDiscordIds.push(data.creatorId);
      }

      // Build permission overwrites (category + users)
      const permissionOverwrites = await buildPermissionOverwrites(
        interaction.guild!,
        res?.category_id || null,
        allDiscordIds
      );

      // Create the channel with all permissions set at once (single audit log entry)
      console.log(`Creating channel with ${permissionOverwrites.length} permission overwrites`);
      const channel = await interaction.guild?.channels.create({
        name: `members-${currentCount}-` + data?.channelName.trim() || 'movements',
        type: 0, // GuildText
        parent: res?.category_id || null,
        permissionOverwrites: permissionOverwrites,
      });

      if (!channel) {
        throw new Error('Channel creation returned undefined');
      }

      console.log(`✅ Channel created: ${channel.name}`);

      // Increment the channel count
      await pool.query(
        `
        UPDATE member_channel_settings
        SET channel_count = channel_count + 1
        WHERE guild_id = $1
        `,
        [interaction.guild?.id]
      );

      console.log(`✅ Channel permissions set (Total channel count: ${currentCount + 1})`);

      // Insert channel data into database
      await insertMemberChannel(interaction.guild!.id, res?.category_id || null, channel.id, data.creatorId, members);
      console.log(`✅ Channel data saved to database`);

      // Try to send welcome message to the new channel
      try {
        const allPlayers = getAllPlayersSorted(members);

        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`Players Added`)
          .setDescription(
            `${allPlayers.map((p) => `* ${p.name}`).join('\n')}\n\n` + `Use this channel to coordinate and communicate.`
          )
          .setColor(EmbedColor.SUCCESS)
          .setTimestamp();

        await channel.send({
          content: `Attention ${discordIds.map((id) => `<@${id}>`).join(', ')}`,
          embeds: [welcomeEmbed],
        });
        console.log(`✅ Welcome message sent to ${channel.name}`);
      } catch (sendError) {
        console.error('Failed to send welcome message to channel:', sendError);
        // Continue anyway, channel was still created
      }

      // Send success message to user
      const successEmbed = new EmbedBuilder()
        .setDescription(`✅ Channel ${channel} has been created successfully!`)
        .setColor(EmbedColor.SUCCESS);

      await interaction.editReply({ content: '', components: [], embeds: [successEmbed] });

      // Clean up cache
      memberChannelCache.delete(interaction.message.interactionMetadata?.id || '');
    } catch (error) {
      console.error('Error creating member channel:', error);

      const errorEmbed = new EmbedBuilder()
        .setDescription(
          `❌ Failed to create channel. Please ensure I have the correct permissions.\n\n**Error:** ${error}`
        )
        .setColor(EmbedColor.FAIL);

      await interaction.followUp({ content: '', components: [], embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};

export default memberChannelCreationButton;
