import {
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  LabelBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  RadioGroupBuilder,
  MessageFlags,
} from 'discord.js';
import { pool } from '../../../db.js';
import { ClanSettingsData } from '../types.js';
import logger from '../../../logger.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { clanSettingsService } from '../service.js';

export class ClanLogsHandler {
  /**
   * Show the clan logs settings modal
   *
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async showModal(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag } = settingsData;

    try {
      const currentResult = await pool.query(
        `SELECT clan_logs_enabled, clan_logs_channel_id, clan_logs_manage_roles, clan_logs_add_role, clan_logs_remove_role 
        FROM clans 
        WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      const row = currentResult.rows[0];
      const clanLogsEnabled = row?.clan_logs_enabled ?? false;
      const clanLogsChannelId = row?.clan_logs_channel_id ?? '';
      const clanLogsAddRole = row?.clan_logs_add_role ?? false;
      const clanLogsRemoveRole = row?.clan_logs_remove_role ?? false;

      // Show the modal with the current settings
      const modal = new ModalBuilder()
        .setTitle('Clan Logs Settings')
        .setCustomId(makeCustomId('m', 'clanSettings_clan_logs_settings', guildId, { extra: [clantag] }))
        .addLabelComponents(
          // Enable Clan Logs
          new LabelBuilder()
            .setLabel('Enable Clan Logs')
            .setDescription('Enable/Disable clan logs for this clan.')
            .setCheckboxComponent(new CheckboxBuilder().setCustomId('clan_logs_enabled').setDefault(clanLogsEnabled)),
          // Channel Id
          new LabelBuilder()
            .setLabel('Clan Logs Channel')
            .setDescription('Channel for clan logs')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId('clan_logs_channel_id')
                .setMaxValues(1)
                .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
                .setDefaultChannels(clanLogsChannelId ? [clanLogsChannelId] : [])
                .setRequired(false),
            ),
          // Role behavior (manage_roles is derived from this)
          new LabelBuilder()
            .setLabel('Role Behavior')
            .setDescription('Automatic role management.')
            .setRadioGroupComponent(
              new RadioGroupBuilder()
                .setOptions([
                  { label: 'Disable', value: 'neither', default: !clanLogsAddRole && !clanLogsRemoveRole },
                  { label: 'Add Role Only', value: 'add_role', default: clanLogsAddRole && !clanLogsRemoveRole },
                  {
                    label: 'Remove Role Only',
                    value: 'remove_role',
                    default: !clanLogsAddRole && clanLogsRemoveRole,
                  },
                  { label: 'Both Add & Remove', value: 'both', default: clanLogsAddRole && clanLogsRemoveRole },
                ])
                .setCustomId('clan_log_roles'),
            ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('[Clan Logs] Error showing modal:', error);
      await interaction.reply({
        content: '❌ Failed to show clan logs settings modal.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle clan logs settings modal submission
   *
   * @param interaction - Modal submission from Discord
   */
  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    if (!clantag) {
      await interaction.reply({
        content: 'Missing clan tag. Please try again.',
        ephemeral: true,
      });
      return;
    }

    try {
      // Get values from modal
      const clanLogsEnabled = interaction.fields.getCheckbox('clan_logs_enabled');
      const channelIds = interaction.fields.getSelectedChannels('clan_logs_channel_id');
      const channelId = channelIds?.first()?.id || null;
      const roleBehavior = interaction.fields.getRadioGroup('clan_log_roles');

      // Parse role behavior and derive manage_roles from it
      let addRole = false;
      let removeRole = false;
      let clanLogsManageRoles = false;

      if (roleBehavior === 'both') {
        addRole = true;
        removeRole = true;
        clanLogsManageRoles = true;
      } else if (roleBehavior === 'add_role') {
        addRole = true;
        clanLogsManageRoles = true;
      } else if (roleBehavior === 'remove_role') {
        removeRole = true;
        clanLogsManageRoles = true;
      }
      // If 'neither' is selected, all remain false

      // Check permissions (defers interaction if hideNoPerms is true)
      const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
      if (!allowed) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get old values and clan name for audit log
        const oldResult = await client.query(
          `SELECT clan_logs_enabled, clan_logs_channel_id, clan_logs_manage_roles, 
                  clan_logs_add_role, clan_logs_remove_role, clan_name
           FROM clans WHERE guild_id = $1 AND clantag = $2`,
          [guildId, clantag],
        );
        const oldValues = oldResult.rows[0];
        const clanName = oldValues?.clan_name;

        // Track what changed for the log
        const changes: string[] = [];

        // Update all settings
        await client.query(
          `UPDATE clans 
           SET clan_logs_enabled = $1,
               clan_logs_channel_id = $2,
               clan_logs_manage_roles = $3,
               clan_logs_add_role = $4,
               clan_logs_remove_role = $5
           WHERE guild_id = $6 AND clantag = $7`,
          [clanLogsEnabled, channelId, clanLogsManageRoles, addRole, removeRole, guildId, clantag],
        );

        // Track changes
        if (oldValues.clan_logs_enabled !== clanLogsEnabled) {
          changes.push(
            `Clan Logs: ${oldValues.clan_logs_enabled ? '✅ Enabled' : '❌ Disabled'} → ${clanLogsEnabled ? '✅ Enabled' : '❌ Disabled'}`,
          );
        }

        if (oldValues.clan_logs_channel_id !== channelId) {
          const oldChannel = oldValues.clan_logs_channel_id ? `<#${oldValues.clan_logs_channel_id}>` : 'None';
          const newChannel = channelId ? `<#${channelId}>` : 'None';
          changes.push(`Logs Channel: ${oldChannel} → ${newChannel}`);
        }

        if (oldValues.clan_logs_manage_roles !== clanLogsManageRoles) {
          changes.push(
            `Role Management: ${oldValues.clan_logs_manage_roles ? '✅ Enabled' : '❌ Disabled'} → ${clanLogsManageRoles ? '✅ Enabled' : '❌ Disabled'}`,
          );
        }

        if (oldValues.clan_logs_add_role !== addRole || oldValues.clan_logs_remove_role !== removeRole) {
          const oldBehavior =
            oldValues.clan_logs_add_role && oldValues.clan_logs_remove_role
              ? 'Both'
              : oldValues.clan_logs_add_role
                ? 'Add Only'
                : oldValues.clan_logs_remove_role
                  ? 'Remove Only'
                  : 'Neither';
          const newBehavior =
            addRole && removeRole ? 'Both' : addRole ? 'Add Only' : removeRole ? 'Remove Only' : 'Neither';
          changes.push(`Role Behavior: ${oldBehavior} → ${newBehavior}`);
        }

        await client.query('COMMIT');

        // Send audit log if any changes were made
        if (changes.length > 0) {
          clanSettingsService
            .sendLog(
              interaction.client,
              guildId,
              `📋 Clan Logs Settings Changed`,
              `**Clan:** ${clanName}\n${changes.join('\n')}\n**Changed by:** <@${interaction.user.id}>`,
            )
            .catch((err) => logger.error('Error sending clan logs settings update log:', err));
        }

        await interaction.followUp({
          content: '✅ Clan logs settings updated successfully!',
          flags: MessageFlags.Ephemeral,
        });

        // Update the original clan settings message
        const messageId = interaction.message?.id;
        if (messageId && interaction.channel) {
          try {
            const message = await interaction.channel.messages.fetch(messageId);
            const { embed, components: newButtonRows } = await (
              await import('../config.js')
            ).buildClanSettingsView(guildId, clanName, clantag, interaction.user.id);
            const selectMenuRowBuilder = (await import('../config.js')).getSelectMenuRowBuilder(message.components);

            await message.edit({
              embeds: [embed],
              components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
            });
            logger.debug(`[ClanLogs] Updated clan settings message for ${clanName}`);
          } catch (error) {
            logger.warn('[ClanLogs] Could not update clan settings message:', error);
            // Non-critical - user can refresh manually
          }
        }

        logger.info(`[ClanLogs] ${interaction.user.tag} updated clan logs settings for ${clantag} in guild ${guildId}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('[ClanLogs] Error updating clan logs settings:', error);

      // Use followUp if already deferred, reply otherwise
      const response = {
        content: '❌ Failed to update clan logs settings.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
}
