import {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { buildSettingsView } from '../../commands/settings_commands/serverSettings.js';
import { buildFeatureEmbedAndComponents } from '../../config/serverSettingsBuilder.js';
import { FeatureRegistry } from '../../config/featureRegistry.js';
import logger from '../../logger.js';
import { getServerSettingsData, ServerSettingsData } from '../../cache/serverSettingsDataCache.js';
import { makeCustomId } from '../../utils/customId.js';
import { serverSettingsService } from './service.js';
import { pool } from '../../db.js';
import { invalidateGuildMessageContext } from '../../cache/guildMessageContextCache.js';
import { deleteRoleTier, parseThresholdsSettingKey, upsertRoleTier, type ThresholdKind } from '../stats/roleThresholds.js';

export class ServerSettingsInteractionRouter {
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra, guildId } = parsed;

    const isModalAction = action === 'serverSettingOpenModal';
    const allowed = await checkPerms(interaction, 'button', 'higher', {
      hideNoPerms: true,
      skipDefer: isModalAction,
    });
    if (!allowed) return;

    const cacheKey = extra[0];

    switch (action) {
      case 'serverSettings': {
        if (!cacheKey) break;
        const cacheData = getServerSettingsData(cacheKey);
        if (!cacheData) {
          await interaction.editReply({
            content: 'Settings data expired. Please try again.',
            embeds: [],
            components: [],
          });
          return;
        }
        if (cacheData.ownerId !== interaction.user.id) {
          await interaction.followUp({ content: 'You can only interact with settings you opened.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (cacheData.featureName) {
          await this.handleFeatureSelection(interaction, guildId, cacheData.ownerId, cacheData.featureName);
        } else {
          logger.warn('Invalid cache data for server settings:', cacheData);
          await interaction.editReply({ content: 'Invalid settings data.' });
        }
        break;
      }

      case 'serverSettingsReturn': {
        if (!cacheKey) break;
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData) return;
        await this.handleReturnToMain(interaction, guildId, cacheData.ownerId);
        break;
      }

      case 'serverSettingToggleFeature': {
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData?.featureName || !cacheData?.tableName) return;
        await this.handleFeatureToggle(interaction, guildId, cacheData.ownerId, cacheData.featureName, cacheData.tableName);
        break;
      }

      case 'serverSettingToggle': {
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData?.settingKey || !cacheData?.tableName) return;
        await this.handleToggleAction(interaction, guildId, cacheData);
        break;
      }

      case 'serverSettingOpenModal': {
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData?.settingKey || !cacheData?.tableName) return;
        await this.handleOpenModal(interaction, guildId, cacheData);
        break;
      }

      case 'serverSettingSwap': {
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData?.settingKey) return;
        await this.handleSwapAction(interaction, guildId, cacheData);
        break;
      }

      case 'serverSettingAction': {
        const cacheData = await this.resolveCacheData(interaction, cacheKey);
        if (!cacheData?.settingKey || !cacheData?.tableName) return;
        await this.handleCustomAction(interaction, guildId, cacheData);
        break;
      }

      default:
        logger.warn('Unknown server setting button action:', action, extra);
        await interaction.editReply({ content: 'Unknown server settings action.' });
    }
  }

  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra, guildId } = parsed;

    const allowed = await checkPerms(interaction, 'modal', 'higher', { skipDefer: true });
    if (!allowed) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [tableName, featureName] = extra;
    const settingKey = action.startsWith('serverSetting_') ? action.replace('serverSetting_', '') : action;

    await this.processModalSubmit(interaction, guildId, settingKey, tableName, featureName, interaction.user.id);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static async handleSelectMenu(_interaction: StringSelectMenuInteraction, _parsed: ParsedCustomId): Promise<void> {}

  /**
   * Resolve cache data and validate ownership in one step.
   * Returns null and sends an error reply if the data is missing or the user doesn't own it.
   */
  private static async resolveCacheData(
    interaction: ButtonInteraction,
    cacheKey: string,
  ): Promise<ServerSettingsData | null> {
    const cacheData = getServerSettingsData(cacheKey);
    if (!cacheData) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Settings data expired. Please try again.' });
      } else {
        await interaction.reply({ content: 'Settings data expired. Please try again.', flags: MessageFlags.Ephemeral });
      }
      return null;
    }
    if (cacheData.ownerId !== interaction.user.id) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'You can only interact with settings you opened.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'You can only interact with settings you opened.', flags: MessageFlags.Ephemeral });
      }
      return null;
    }
    return cacheData;
  }

  private static async handleFeatureSelection(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string,
  ): Promise<void> {
    try {
      if (!FeatureRegistry[featureName]) {
        logger.warn(`Unknown feature: ${featureName}`);
        await interaction.editReply({ content: `Unknown feature: ${featureName}` });
        return;
      }
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      logger.error(`Error handling feature selection for ${featureName}:`, error);
      await interaction.editReply({ content: 'Error loading feature settings. Please try again.' });
    }
  }

  private static async handleReturnToMain(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const { embed, components } = await buildSettingsView(guildId, ownerId);
      await interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      logger.error(`Error showing server settings: ${error}`);
      await interaction.editReply({ content: 'Error showing settings.' });
    }
  }

  private static async handleFeatureToggle(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _tableName: string,
  ): Promise<void> {
    const result = await serverSettingsService.toggleFeature(
      interaction.client,
      guildId,
      featureName,
      interaction.user.id,
    );
    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Error toggling feature. Please try again.' });
      return;
    }
    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
    await interaction.editReply({ embeds: [embed], components });
  }

  private static async handleToggleAction(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey, tableName, featureName, ownerId } = cacheData;

    if (!settingKey || !tableName) {
      await interaction.editReply({ content: 'Invalid settings data.' });
      return;
    }

    const result = await serverSettingsService.toggleSetting({
      guildId,
      settingKey,
      tableName,
      featureName: featureName || 'unknown',
      client: interaction.client,
      userId: interaction.user.id,
    });

    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Error toggling setting. Please try again.' });
      return;
    }

    if (result.requiresInviteUpdate && result.inviteData) {
      serverSettingsService
        .updateInviteMessageAfterToggle(guildId, interaction.client, result.inviteData)
        .catch((error) => logger.error('Failed to update invite message:', error));
    }

    if (featureName) {
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });
    }
  }

  private static async handleOpenModal(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey, tableName, featureName } = cacheData;
    const customId = makeCustomId('m', `serverSetting_${settingKey}`, guildId, {
      extra: [tableName || '', featureName || ''],
    });

    try {
      const ladder = settingKey ? parseThresholdsSettingKey(settingKey) : null;
      if (ladder) {
        const label = FeatureRegistry[featureName || '']?.settings.find((s) => s.key === settingKey)?.label || 'Role Tier';
        return interaction.showModal(this.buildThresholdTierModal(label, customId, ladder.kind));
      }

      switch (settingKey) {
        case 'logs_channel_id':
          return interaction.showModal(this.buildChannelSelectModal('Set Logs Channel', customId));

        case 'colosseum_5k_channel_id':
          return interaction.showModal(this.buildChannelSelectModal('Set 5k Colosseum Channel', customId));

        case 'colosseum_4k_channel_id':
          return interaction.showModal(this.buildChannelSelectModal('Set 4k Colosseum Channel', customId));

        case 'category_id':
          return interaction.showModal(this.buildChannelSelectModal('Set Category', customId));

        case 'replace_me_role_id':
          return interaction.showModal(
            this.buildRoleSelectModal(
              'Set Replace Me Role',
              'Select the role for players who want to be replaced',
              customId,
            ),
          );

        case 'attacking_late_role_id':
          return interaction.showModal(
            this.buildRoleSelectModal(
              'Set Attacking Late Role',
              'Select the role for players attacking late',
              customId,
            ),
          );

        case 'clan_roles_required_role_id':
          return interaction.showModal(
            this.buildRoleSelectModal(
              'Set Required Role for Clan Roles',
              'Select the role required before users can receive clan roles. None if no role is required.',
              customId,
            ),
          );

        case 'staff_roles':
          return interaction.showModal(
            new ModalBuilder()
              .setTitle('Leadership Roles')
              .setCustomId(customId)
              .addLabelComponents(
                new LabelBuilder()
                  .setLabel('Higher Leadership Roles')
                  .setDescription('Full access to all bot management commands')
                  .setRoleSelectMenuComponent(
                    new RoleSelectMenuBuilder()
                      .setCustomId('higher_roles')
                      .setMinValues(0)
                      .setMaxValues(10)
                      .setRequired(false),
                  ),
                new LabelBuilder()
                  .setLabel('Lower Leadership Roles')
                  .setDescription('Access to staff-level bot commands')
                  .setRoleSelectMenuComponent(
                    new RoleSelectMenuBuilder()
                      .setCustomId('lower_roles')
                      .setMinValues(0)
                      .setMaxValues(10)
                      .setRequired(false),
                  ),
              ),
          );

        case 'delete_confirm_count':
          return interaction.showModal(
            this.buildTextInputModal(
              'Set Delete Confirm Count',
              customId,
              'Number of confirmations required',
              'Enter a number (minimum: 1)',
              1,
              2,
            ),
          );

        case 'max_player_links':
          return interaction.showModal(
            this.buildTextInputModal(
              'Set Max Player Links',
              customId,
              'Maximum number of player links per user',
              'Enter a number (minimum: 1)',
              1,
              2,
            ),
          );

        case 'opened_identifier':
          return interaction.showModal(
            this.buildTextInputModal(
              'Set Ticket Opened Text',
              customId,
              'Text for opened tickets',
              'e.g., ticket',
              1,
              20,
            ),
          );

        case 'closed_identifier':
          return interaction.showModal(
            this.buildTextInputModal(
              'Set Ticket Closed Text',
              customId,
              'Text for closed tickets',
              'e.g., closed-ticket',
              1,
              20,
            ),
          );

        case 'welcome_message': {
          const currentMsg = await pool.query(
            `SELECT welcome_message FROM ${tableName} WHERE guild_id = $1`,
            [guildId],
          );
          const textInput = new TextInputBuilder()
            .setCustomId('input')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the welcome message shown when a user clicks the info button... use {user} to mention them')
            .setMinLength(1)
            .setMaxLength(2000)
            .setRequired(true);

          const existing = currentMsg.rows[0]?.welcome_message;
          if (existing) {
            textInput.setValue(existing);
          }

          return interaction.showModal(
            new ModalBuilder()
              .setTitle('Set Welcome Message')
              .setCustomId(customId)
              .addLabelComponents(
                new LabelBuilder().setLabel('Welcome message (use {user} to mention them)').setTextInputComponent(textInput),
              ),
          );
        }
      }
    } catch (error) {
      logger.error(`Error opening modal for ${settingKey}:`, error);
      await interaction.editReply({ content: 'Error opening settings modal. Please try again.' });
    }
  }

  private static buildThresholdTierModal(title: string, customId: string, kind: ThresholdKind): ModalBuilder {
    const isColosseum = kind === 'colosseum';
    const thresholdDescription = isColosseum
      ? 'Minimum colosseum week score to earn the role, e.g. 3300'
      : 'Minimum fame/attack average to earn the role, e.g. 210';
    const thresholdPlaceholder = isColosseum ? 'e.g. 3300' : 'e.g. 210';

    return new ModalBuilder()
      .setTitle(title.slice(0, 45))
      .setCustomId(customId)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Threshold')
          .setDescription(thresholdDescription)
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('threshold')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(thresholdPlaceholder)
              .setMinLength(1)
              .setMaxLength(6)
              .setRequired(true),
          ),
        new LabelBuilder()
          .setLabel('Role')
          .setDescription('Role given at this threshold. Leave empty to remove the tier at this threshold.')
          .setRoleSelectMenuComponent(
            new RoleSelectMenuBuilder().setCustomId('role').setMinValues(0).setMaxValues(1).setRequired(false),
          ),
      );
  }

  private static buildChannelSelectModal(title: string, customId: string): ModalBuilder {
    return new ModalBuilder()
      .setTitle(title)
      .setCustomId(customId)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Category Select')
          .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1)),
      );
  }

  private static buildRoleSelectModal(title: string, description: string, customId: string): ModalBuilder {
    return new ModalBuilder()
      .setTitle(title)
      .setCustomId(customId)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Role Select')
          .setDescription(description)
          .setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId('input').setMaxValues(1)),
      );
  }

  private static buildTextInputModal(
    title: string,
    customId: string,
    label: string,
    placeholder: string,
    minLength: number,
    maxLength: number,
  ): ModalBuilder {
    return new ModalBuilder()
      .setTitle(title)
      .setCustomId(customId)
      .addLabelComponents(
        new LabelBuilder().setLabel(label).setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('input')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(placeholder)
            .setMinLength(minLength)
            .setMaxLength(maxLength)
            .setRequired(true),
        ),
      );
  }

  private static async handleSwapAction(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey, tableName, featureName, ownerId } = cacheData;

    if (!settingKey || !tableName) {
      await interaction.editReply({ content: 'Invalid settings data.' });
      return;
    }

    const result = await serverSettingsService.swapSetting({
      guildId,
      settingKey,
      tableName,
      featureName: featureName || 'unknown',
      client: interaction.client,
      userId: interaction.user.id,
    });

    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Error swapping setting.' });
      return;
    }

    if (featureName) {
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });
    }
  }

  private static async handleCustomAction(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey } = cacheData;

    switch (settingKey) {
      case 'delete_all_channels': {
        const userId = interaction.user.id;

        const settingsRes = await pool.query(
          `SELECT delete_confirm_count FROM member_channel_settings WHERE guild_id = $1`,
          [guildId],
        );
        const requiredConfirms = settingsRes.rows[0]?.delete_confirm_count || 1;

        const updateRes = await pool.query(
          `UPDATE member_channels
           SET current_bulk_delete_count = current_bulk_delete_count + 1,
               bulk_delete_confirmed_by = array_append(bulk_delete_confirmed_by, $2)
           WHERE guild_id = $1
             AND is_locked = false
             AND NOT ($2 = ANY(bulk_delete_confirmed_by))
           RETURNING channel_id, current_bulk_delete_count`,
          [guildId, userId],
        );

        const newConfirmationCount = updateRes.rowCount || 0;
        if (newConfirmationCount === 0) {
          await interaction.followUp({
            content: '❌ No unlocked channels found or all channels already confirmed by you.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const toDeleteRes = await pool.query(
          `UPDATE member_channels
           SET is_deleted = true, deleted_at = NOW()
           WHERE guild_id = $1
             AND is_locked = false
             AND current_bulk_delete_count >= $2
             AND is_deleted = false
           RETURNING channel_id`,
          [guildId, requiredConfirms],
        );

        const deletedCount = toDeleteRes.rowCount || 0;

        for (const row of toDeleteRes.rows) {
          setTimeout(async () => {
            try {
              const discordChannel = await interaction.client.channels.fetch(row.channel_id);
              if (discordChannel && 'delete' in discordChannel) {
                await discordChannel.delete('Bulk delete from server settings');
              }
            } catch (error) {
              logger.error(`Failed to delete channel ${row.channel_id}:`, error);
            }
          }, 5000);
        }

        let responseMessage = '';
        if (deletedCount > 0) {
          responseMessage += `✅ **Marked for deletion:** ${deletedCount} channel(s) (deleting in 5 seconds)\n`;
        }
        if (newConfirmationCount > 0) {
          responseMessage += `⚠️ **Confirmation added to:** ${newConfirmationCount} channel(s) (${requiredConfirms} confirmations needed per channel)\n`;
        }

        await interaction.followUp({
          content: responseMessage || '✅ Bulk delete operation complete.',
          flags: MessageFlags.Ephemeral,
        });
        break;
      }
    }
  }

  private static async processModalSubmit(
    interaction: ModalSubmitInteraction,
    guildId: string,
    settingKey: string,
    tableName: string,
    featureName: string,
    ownerId: string,
  ): Promise<void> {
    const messageId = interaction.message?.id;
    if (!messageId) {
      await interaction.editReply({ content: 'Could not find original message.' });
      return;
    }

    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) {
      await interaction.editReply({ content: 'Could not find original message.' });
      return;
    }

    const thresholdsLadder = parseThresholdsSettingKey(settingKey);
    if (thresholdsLadder) {
      const thresholdRaw = interaction.fields.getTextInputValue('threshold');
      const threshold = parseInt(thresholdRaw, 10);
      if (isNaN(threshold) || threshold <= 0) {
        await interaction.editReply({ content: '❌ Please enter a valid threshold number (minimum: 1).' });
        return;
      }

      const roleField = interaction.fields.getSelectedRoles('role');
      const selectedRole = roleField?.first();

      if (selectedRole) {
        await upsertRoleTier(guildId, thresholdsLadder.league, thresholdsLadder.kind, threshold, selectedRole.id);
        await interaction.editReply({ content: `✅ Tier set: **${threshold}+** → <@&${selectedRole.id}>` });
      } else {
        const removed = await deleteRoleTier(guildId, thresholdsLadder.league, thresholdsLadder.kind, threshold);
        await interaction.editReply({
          content: removed
            ? `✅ Removed the tier at **${threshold}+**.`
            : `❌ There is no tier at **${threshold}+** to remove. To add one, select a role.`,
        });
      }

      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      return;
    }

    const isTextChannelSetting =
      settingKey === 'logs_channel_id' ||
      settingKey === 'colosseum_5k_channel_id' ||
      settingKey === 'colosseum_4k_channel_id';

    if (isTextChannelSetting || settingKey === 'category_id') {
      const channelField = interaction.fields.getSelectedChannels('input');
      if (!channelField || channelField.size === 0) {
        await interaction.editReply({
          content: `No ${isTextChannelSetting ? 'channel' : 'category'} selected.`,
        });
        return;
      }

      const selectedChannel = channelField.first();

      if (isTextChannelSetting && selectedChannel && selectedChannel.type !== 0 && selectedChannel.type !== 5) {
        await interaction.editReply({ content: 'Please select a text channel.' });
        return;
      }
      if (settingKey === 'category_id' && selectedChannel && selectedChannel.type !== 4) {
        await interaction.editReply({ content: 'Please select a category channel.' });
        return;
      }

      const result = await serverSettingsService.updateChannelSetting({
        guildId,
        settingKey,
        tableName,
        featureName,
        channelId: selectedChannel!.id,
        client: interaction.client,
        userId: interaction.user.id,
      });

      if (!result.success) {
        await interaction.editReply({ content: result.error || 'Failed to update channel setting.' });
        return;
      }

      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      await interaction.editReply({
        content: `✅ ${isTextChannelSetting ? 'Channel' : 'Category'} updated successfully`,
      });
      return;
    }

    if (settingKey === 'staff_roles') {
      const higherRoles = interaction.fields.getSelectedRoles('higher_roles');
      const lowerRoles = interaction.fields.getSelectedRoles('lower_roles');

      const higherRoleIds = higherRoles ? Array.from(higherRoles.values()).map((r) => r!.id) : [];
      const lowerRoleIds = lowerRoles ? Array.from(lowerRoles.values()).map((r) => r!.id) : [];

      await pool.query(
        `UPDATE server_settings SET higher_leader_role_id = $1, lower_leader_role_id = $2 WHERE guild_id = $3`,
        [higherRoleIds, lowerRoleIds, guildId],
      );
      invalidateGuildMessageContext(guildId);

      logger.info(`[Staff Roles] Updated for guild:${guildId} by user:${interaction.user.id}`);

      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      await interaction.editReply({ content: '✅ Leadership roles updated successfully' });
      return;
    }

    if (
      settingKey === 'replace_me_role_id' ||
      settingKey === 'attacking_late_role_id' ||
      settingKey === 'clan_roles_required_role_id'
    ) {
      const roleField = interaction.fields.getSelectedRoles('input');
      if (!roleField || roleField.size === 0) {
        await interaction.editReply({ content: 'No role selected.' });
        return;
      }

      const selectedRole = roleField.first();

      const result = await serverSettingsService.updateRoleSetting({
        guildId,
        settingKey,
        tableName,
        featureName,
        roleId: selectedRole!.id,
        client: interaction.client,
        userId: interaction.user.id,
      });

      if (!result.success) {
        await interaction.editReply({ content: result.error || 'Failed to update role setting.' });
        return;
      }

      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      await interaction.editReply({
        content: `✅ ${settingKey === 'replace_me_role_id' ? 'Replace Me role' : 'Attacking Late role'} updated successfully`,
      });
      return;
    }

    const inputValue = interaction.fields.getTextInputValue('input');
    if (!inputValue) {
      await interaction.editReply({ content: 'No value provided.' });
      return;
    }

    if (settingKey === 'delete_confirm_count') {
      const numValue = parseInt(inputValue, 10);
      if (isNaN(numValue) || numValue < 1) {
        await interaction.editReply({ content: '❌ Please enter a valid number (minimum: 1).' });
        return;
      }
    }

    if (settingKey === 'max_player_links') {
      const numValue = parseInt(inputValue, 10);
      if (isNaN(numValue) || numValue < 1 || numValue > 10) {
        await interaction.editReply({ content: '❌ Please enter a valid number (minimum: 1, maximum: 10).' });
        return;
      }
    }

    let finalValue = inputValue;
    if (settingKey === 'opened_identifier' || settingKey === 'closed_identifier') {
      finalValue = inputValue.toLowerCase();
    }

    const result = await serverSettingsService.updateTextSetting({
      guildId,
      settingKey,
      tableName,
      featureName,
      value: finalValue,
      client: interaction.client,
      userId: interaction.user.id,
    });

    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Failed to update setting.' });
      return;
    }

    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
    await message.edit({ embeds: [embed], components });
    await interaction.editReply({ content: `✅ ${settingKey} updated successfully` });
  }
}
