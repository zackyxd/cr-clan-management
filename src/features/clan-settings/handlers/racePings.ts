import {
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxGroupBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { ClanSettingsData } from '../types.js';
import logger from '../../../logger.js';
import { pool } from '../../../db.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';

export class RacePingsHandler {
  static async showModal(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag } = settingsData;

    try {
      const currentResult = await pool.query(
        `
        SELECT ss.replace_me_role_id, ss.attacking_late_role_id, c.race_ping_channel_id, c.ping_attacking_late, c.ping_replace_me, c.ping_replace_me_role_id
        FROM clans c
        LEFT JOIN server_settings ss ON c.guild_id = ss.guild_id
        WHERE c.guild_id = $1 AND c.clantag = $2
        `,
        [guildId, clantag],
      );

      const currentSettings = currentResult.rows[0];
      const pingChannelId = currentSettings.race_ping_channel_id;

      const modal = new ModalBuilder()
        .setTitle('Race Ping Settings')
        .setCustomId(makeCustomId('m', 'clanSettings_race_ping_settings', guildId, { extra: [clantag] }))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Channel for Pings')
            .setDescription('Channel where pings will be sent.')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId('channel_id')
                .setChannelTypes(ChannelType.GuildText)
                .setDefaultChannels(pingChannelId ? [pingChannelId] : [])
                .setMaxValues(1)
                .setRequired(false),
            ),

          new LabelBuilder()
            .setLabel('Attacking Late / Replace Me Pings')
            .setDescription('Send a message for these pings.')
            .setCheckboxGroupComponent(
              new CheckboxGroupBuilder()
                .setCustomId('checkbox_group')
                .addOptions(
                  {
                    label: 'Ping Attacking Late',
                    value: 'ping_attacking_late',
                    default: currentSettings.ping_attacking_late ?? false,
                  },
                  {
                    label: 'Ping Replace Me',
                    value: 'ping_replace_me',
                    default: currentSettings.ping_replace_me ?? false,
                  },
                )
                .setRequired(false),
            ),
          new LabelBuilder()
            .setLabel('Role for replace me pings')
            .setDescription('Ping special role for people that want replacement.')
            .setRoleSelectMenuComponent(
              new RoleSelectMenuBuilder()
                .setCustomId('ping_replace_me_role_id')
                .setDefaultRoles(
                  currentSettings.ping_replace_me_role_id ? [currentSettings.ping_replace_me_role_id] : [],
                )
                .setMaxValues(1)
                .setRequired(false),
            ),
        );
      await interaction.showModal(modal);
    } catch (error) {
      logger.error('[RacePings] Error showing modal:', error);
      await interaction.reply({
        content: '❌ Failed to show race pings modal.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!clantag) {
      await interaction.reply({
        content: 'Missing clan tag. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // Get values from modal
      const channelIds = interaction.fields.getSelectedChannels('channel_id');
      const channelId = channelIds?.first()?.id || null;
      const pingAttackingLate = interaction.fields.getCheckboxGroup('checkbox_group').includes('ping_attacking_late');
      const pingReplaceMe = interaction.fields.getCheckboxGroup('checkbox_group').includes('ping_replace_me');

      // Check if role select field exists before accessing (optional fields may not be present)
      let pingReplaceMeRoleId: string | null = null;
      try {
        const roles = interaction.fields.getSelectedRoles('ping_replace_me_role_id');
        pingReplaceMeRoleId = roles?.first()?.id || null;
      } catch (error) {
        // Field not present (nothing selected in optional role menu)
        pingReplaceMeRoleId = null;
      }

      // Check permissions (defers interaction if hideNoPerms is true)
      const allowed = await checkPerms(interaction, 'modal', 'either', { hideNoPerms: true });
      if (!allowed) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get old values and clan name for audit log
        const oldResult = await client.query(
          `
          SELECT c.clan_name, c.race_ping_channel_id, c.ping_attacking_late, c.ping_replace_me, c.ping_replace_me_role_id
          FROM clans c
          WHERE c.guild_id = $1 AND c.clantag = $2
          `,
          [guildId, clantag],
        );

        const clanName = oldResult.rows[0]?.clan_name || clantag;
        const oldChannelId = oldResult.rows[0]?.race_ping_channel_id;
        const oldPingAttackingLate = oldResult.rows[0]?.ping_attacking_late || false;
        const oldPingReplaceMe = oldResult.rows[0]?.ping_replace_me || false;
        const oldPingReplaceMeRoleId = oldResult.rows[0]?.ping_replace_me_role_id || null;
        // Track what changed for the log
        const changes: string[] = [];

        // Update channel if changed
        if (channelId !== oldChannelId) {
          await client.query(`UPDATE clans SET race_ping_channel_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
            channelId,
            guildId,
            clantag,
          ]);
          const oldDisplay = oldChannelId ? `<#${oldChannelId}>` : 'None';
          const newDisplay = channelId ? `<#${channelId}>` : 'None';
          changes.push(`Ping Channel: ${oldDisplay} → ${newDisplay}`);
        }

        // Update ping_attacking_late if changed
        if (pingAttackingLate !== oldPingAttackingLate) {
          await client.query(`UPDATE clans SET ping_attacking_late = $1 WHERE guild_id = $2 AND clantag = $3`, [
            pingAttackingLate,
            guildId,
            clantag,
          ]);
          changes.push(
            `Ping Attacking Late: ${oldPingAttackingLate ? 'Enabled' : 'Disabled'} → ${pingAttackingLate ? 'Enabled' : 'Disabled'}`,
          );
        }

        // Update ping_replace_me if changed
        if (pingReplaceMe !== oldPingReplaceMe) {
          await client.query(`UPDATE clans SET ping_replace_me = $1 WHERE guild_id = $2 AND clantag = $3`, [
            pingReplaceMe,
            guildId,
            clantag,
          ]);
          changes.push(
            `Ping Replace Me: ${oldPingReplaceMe ? 'Enabled' : 'Disabled'} → ${pingReplaceMe ? 'Enabled' : 'Disabled'}`,
          );
        }

        if (pingReplaceMeRoleId !== oldPingReplaceMeRoleId) {
          await client.query(`UPDATE clans SET ping_replace_me_role_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
            pingReplaceMeRoleId,
            guildId,
            clantag,
          ]);
          const oldDisplay = oldPingReplaceMeRoleId ? `<@&${oldPingReplaceMeRoleId}>` : 'None';
          const newDisplay = pingReplaceMeRoleId ? `<@&${pingReplaceMeRoleId}>` : 'None';
          changes.push(`Ping Replace Me Role: ${oldDisplay} → ${newDisplay}`);
        }

        await client.query('COMMIT');

        // Send audit log if any changes were made
        if (changes.length > 0) {
          const { clanSettingsService } = await import('../service.js');
          clanSettingsService
            .sendLog(
              interaction.client,
              guildId,
              `📢 Race Ping Settings Changed`,
              `**Clan:** ${clanName}\n${changes.join('\n')}\n**Changed by:** <@${interaction.user.id}>`,
            )
            .catch((err) => logger.error('Error sending race ping settings update log:', err));
        }

        await interaction.followUp({
          content: '✅ Race ping settings updated successfully!',
          flags: MessageFlags.Ephemeral,
        });

        // Update the original clan settings message
        if (interaction.message) {
          try {
            const { embed, components: newButtonRows } = await (
              await import('../config.js')
            ).buildClanSettingsView(guildId, clanName, clantag, interaction.user.id);
            const selectMenuRowBuilder = (await import('../config.js')).getSelectMenuRowBuilder(
              interaction.message.components,
            );

            await interaction.editReply({
              embeds: [embed],
              components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
            });
          } catch (error) {
            logger.warn('[Race Pings] Could not update clan settings message:', error);
          }
        }

        logger.info(
          `[Race Pings] ${interaction.user.tag} updated race ping settings for ${clantag} in guild ${guildId}`,
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('[Race Pings] Error updating race ping settings:', error);

      // Use followUp if already deferred, reply otherwise
      if (interaction.deferred || interaction.replied) {
        await interaction
          .followUp({
            content: '❌ Failed to update race ping settings.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content: '❌ Failed to update race ping settings.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
  }
}
