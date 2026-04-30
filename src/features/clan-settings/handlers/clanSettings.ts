/**
 * Consolidated Clan Settings Handler
 *
 * Handles the grouped clan settings modal for:
 * - Family clan toggle (checkbox)
 * - Abbreviation (text input)
 * - Clan role (role selector)
 * - Staff channel (channel selector)
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  CheckboxBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { clanSettingsService } from '../service.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { ClanSettingsData } from '../types.js';

export class ClanSettingsHandler {
  /**
   * Show grouped clan settings modal with all settings in one place
   */
  static async showModal(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    try {
      // Fetch current values
      const result = await pool.query(
        `SELECT family_clan, abbreviation, clan_role_id, staff_channel_id 
         FROM clans 
         WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      if (result.rows.length === 0) {
        await interaction.reply({
          content: '❌ Clan not found.',
          ephemeral: true,
        });
        return;
      }

      const currentSettings = result.rows[0];
      const familyClan = currentSettings.family_clan || false;
      const abbreviation = currentSettings.abbreviation || '';
      const clanRoleId = currentSettings.clan_role_id || '';
      const staffChannelId = currentSettings.staff_channel_id || '';

      const modal = new ModalBuilder()
        .setTitle(`${clanName} Info`)
        .setCustomId(makeCustomId('m', 'clanSettings_clan_settings', guildId, { extra: [clantag] }))
        .addLabelComponents(
          // Family clan checkbox
          new LabelBuilder()
            .setLabel('Family Clan')
            .setDescription('Mark as family clan (subject to server limit)')
            .setCheckboxComponent(new CheckboxBuilder().setCustomId('family_clan').setDefault(familyClan)),

          // Abbreviation text input
          new LabelBuilder()
            .setLabel('Abbreviation')
            .setDescription('Short clan identifier (1-10 chars, must be unique)')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('abbreviation')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(10)
                .setValue(abbreviation)
                .setRequired(false),
            ),

          // Clan role selector
          new LabelBuilder()
            .setLabel('Clan Role')
            .setDescription('Role to assign to clan members')
            .setRoleSelectMenuComponent(
              new RoleSelectMenuBuilder()
                .setCustomId('clan_role_id')
                .setMaxValues(1)
                .setDefaultRoles(clanRoleId ? [clanRoleId] : []),
            ),

          // Staff channel selector
          new LabelBuilder()
            .setLabel('Staff Channel')
            .setDescription('Channel for staff notifications and logs')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId('staff_channel_id')
                .setMaxValues(1)
                .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
                .setDefaultChannels(staffChannelId ? [staffChannelId] : []),
            ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('[ClanSettings] Error showing modal:', error);
      await interaction.reply({
        content: '❌ Failed to load clan settings modal.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle grouped clan settings modal submission
   */
  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!clantag) {
      await interaction.reply({
        content: 'Missing clan tag. Please try again.',
        ephemeral: true,
      });
      return;
    }

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
    if (!allowed) return;

    try {
      // Extract all field values
      const familyClan = interaction.fields.getCheckbox('family_clan');
      const abbreviation = interaction.fields.getTextInputValue('abbreviation')?.trim() || '';
      const roleIds = interaction.fields.getSelectedRoles('clan_role_id');
      const roleId = roleIds?.first()?.id || '';
      const channelIds = interaction.fields.getSelectedChannels('staff_channel_id');
      const channelId = channelIds?.first()?.id || '';

      // Fetch old values for comparison
      const oldValues = await pool.query(
        `SELECT family_clan, abbreviation, clan_role_id, staff_channel_id, clan_name 
         FROM clans 
         WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      if (oldValues.rows.length === 0) {
        await interaction.followUp({
          content: '❌ Clan not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const old = oldValues.rows[0];
      const clanName = old.clan_name;
      const changes: string[] = [];

      // Update family clan if changed (set to specific value, not toggle)
      if (familyClan !== (old.family_clan || false)) {
        const result = await clanSettingsService.setFamilyClan(
          interaction.client,
          guildId,
          clantag,
          familyClan,
          interaction.user.id,
        );

        if (!result.success) {
          // If failed (e.g., max family clans), show error and stop
          const embed = new EmbedBuilder()
            .setDescription(result.error || 'Failed to update family clan setting')
            .setColor(EmbedColor.FAIL);
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }

        changes.push(`**Family Clan:** ${old.family_clan ? 'Enabled → Disabled' : 'Disabled → Enabled'}`);
      }

      // Update abbreviation if changed
      if (abbreviation && abbreviation !== (old.abbreviation || '')) {
        const result = await clanSettingsService.updateAbbreviation(
          interaction.client,
          guildId,
          clantag,
          abbreviation,
          interaction.user.id,
        );

        if (!result.success) {
          await interaction.followUp({
            content: result.error || '❌ Failed to update abbreviation.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        changes.push(`**Abbreviation:** ${old.abbreviation || 'None'} → ${abbreviation}`);
      } else if (!abbreviation && old.abbreviation) {
        // Clear abbreviation
        await pool.query(`UPDATE clans SET abbreviation = NULL WHERE guild_id = $1 AND clantag = $2`, [
          guildId,
          clantag,
        ]);
        changes.push(`**Abbreviation:** ${old.abbreviation} → None`);
      }

      // Update clan role if changed
      if (roleId !== (old.clan_role_id || '')) {
        const result = await clanSettingsService.updateClanRole(
          interaction.client,
          guildId,
          clantag,
          roleId,
          interaction.user.id,
        );

        if (!result.success) {
          await interaction.followUp({
            content: result.error || '❌ Failed to update clan role.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const oldRole = old.clan_role_id ? `<@&${old.clan_role_id}>` : 'None';
        const newRole = roleId ? `<@&${roleId}>` : 'None';
        changes.push(`**Clan Role:** ${oldRole} → ${newRole}`);
      }

      // Update staff channel if changed
      if (channelId !== (old.staff_channel_id || '')) {
        const result = await clanSettingsService.updateClanSetting(
          interaction.client,
          guildId,
          clantag,
          'staff_channel_id',
          channelId,
          interaction.user.id,
        );

        if (!result.success) {
          await interaction.followUp({
            content: result.error || '❌ Failed to update staff channel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const oldChannel = old.staff_channel_id ? `<#${old.staff_channel_id}>` : 'None';
        const newChannel = channelId ? `<#${channelId}>` : 'None';
        changes.push(`**Staff Channel:** ${oldChannel} → ${newChannel}`);
      }

      // If no changes were made
      if (changes.length === 0) {
        await interaction.followUp({
          content: 'ℹ️ No changes detected.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Send audit log for all changes
      await clanSettingsService.sendLog(
        interaction.client,
        guildId,
        `⚙️ Clan Settings Updated`,
        `**Clan:** ${clanName}\n${changes.join('\n')}\n**Changed by:** <@${interaction.user.id}>`,
      );

      // Update the original clan settings message
      const messageId = interaction.message?.id;
      if (messageId && interaction.channel) {
        try {
          const message = await interaction.channel.messages.fetch(messageId);
          const { embed, components: newButtonRows } = await buildClanSettingsView(
            guildId,
            clanName,
            clantag,
            interaction.user.id,
          );
          const selectMenuRowBuilder = getSelectMenuRowBuilder(message.components);

          await message.edit({
            embeds: [embed],
            components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
          });
          logger.debug(`[ClanSettings] Updated clan settings message for ${clanName}`);
        } catch (error) {
          logger.warn('[ClanSettings] Could not update clan settings message:', error);
          // Non-critical - user can refresh manually
        }
      }

      logger.info(
        `[ClanSettings] ${interaction.user.tag} updated clan settings for ${clanName} (${clantag}) in guild ${guildId}`,
      );

      await interaction.followUp({
        content: '✅ Clan settings updated successfully!',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('[ClanSettings] Error handling modal:', error);
      await interaction.followUp({
        content: '❌ An error occurred while updating settings.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
