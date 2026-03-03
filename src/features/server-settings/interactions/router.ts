import {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  ChannelSelectMenuBuilder,
  LabelBuilder,
} from 'discord.js';
import { ParsedCustomId } from '../../../types/ParsedCustomId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { buildSettingsView } from '../../../commands/settings_commands/serverSettings.js';
import { buildFeatureEmbedAndComponents } from '../../../config/serverSettingsBuilder.js';
import { FeatureRegistry } from '../../../config/featureRegistry.js';
import logger from '../../../logger.js';
import { getServerSettingsData, ServerSettingsData } from '../../../cache/serverSettingsDataCache.js';
import { makeCustomId } from '../../../utils/customId.js';
import { serverSettingsService } from '../service.js';

export class ServerSettingsInteractionRouter {
  /**
   * Handle server settings button interactions
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra, guildId } = parsed;
    console.log(parsed);

    // Check if this is a modal button - if so, we need to skip defer
    const isModalAction = action === 'serverSettingOpenModal';

    // Check permissions for all server settings interactions
    const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
      hideNoPerms: true,
      skipDefer: isModalAction,
    });
    if (!allowed) return;

    // Extract cache key for more readable code
    const cacheKey = extra[0];

    console.log('action:', action);
    console.log('cacheKey:', cacheKey);
    switch (action) {
      case 'serverSettings':
        if (cacheKey) {
          const cacheData = getServerSettingsData(cacheKey);
          if (!cacheData) {
            await interaction.editReply({ content: 'Settings data expired. Please try again.' });
            return;
          }

          // Check ownership
          if (cacheData.ownerId !== interaction.user.id) {
            await interaction.editReply({ content: 'You can only interact with settings you opened.' });
            return;
          }

          if (cacheData.featureName) {
            await this.handleFeatureSelection(interaction, guildId, cacheData.ownerId, cacheData.featureName);
          } else {
            logger.warn('Invalid cache data for server settings:', cacheData);
            await interaction.editReply({ content: 'Invalid settings data.' });
          }
        }
        break;

      case 'serverSettingsReturn':
        if (cacheKey) {
          // For return action, we don't need ownership validation since it just goes back to main menu
          await this.handleSettingsAction(interaction, guildId, interaction.user.id, cacheKey);
        }
        break;

      case 'serverSettingToggleFeature':
        if (extra.length >= 2) {
          // Handle feature enable/disable - extra[0] should be feature name + "_feature", extra[1] should be table name
          const featureName = extra[0].replace('_feature', '');
          const tableName = extra[1];
          // For toggle feature, we don't have cache data, so we'll use the interaction user as owner
          await this.handleFeatureToggle(interaction, guildId, interaction.user.id, featureName, tableName);
        } else {
          logger.warn('Invalid feature toggle data - missing extra parameters');
          await interaction.editReply({ content: 'Invalid feature data.' });
        }
        break;

      case 'serverSettingToggle':
        if (cacheKey) {
          const cacheData = getServerSettingsData(cacheKey);
          if (!cacheData) {
            await interaction.editReply({ content: 'Settings data expired. Please try again.' });
            return;
          }

          // Check ownership
          if (cacheData.ownerId !== interaction.user.id) {
            await interaction.editReply({ content: 'You can only interact with settings you opened.' });
            return;
          }

          if (cacheData.settingKey && cacheData.tableName) {
            await this.handleToggleAction(interaction, guildId, cacheData);
          }
        }
        break;

      case 'serverSettingOpenModal':
        if (cacheKey) {
          const cacheData = getServerSettingsData(cacheKey);
          console.log(cacheData);
          if (!cacheData) {
            await interaction.editReply({ content: 'Settings data expired. Please try again.' });
            return;
          }

          // Check ownership
          if (cacheData.ownerId !== interaction.user.id) {
            await interaction.editReply({ content: 'You can only interact with settings you opened.' });
            return;
          }

          if (cacheData.settingKey && cacheData.tableName) {
            await this.handleOpenModal(interaction, guildId, cacheData);
          }
        }
        break;

      case 'serverSettingSwap':
        if (cacheKey) {
          const cacheData = getServerSettingsData(cacheKey);
          if (!cacheData) {
            await interaction.editReply({ content: 'Settings data expired. Please try again.' });
            return;
          }

          // Check ownership
          if (cacheData.ownerId !== interaction.user.id) {
            await interaction.editReply({ content: 'You can only interact with settings you opened.' });
            return;
          }

          if (cacheData.settingKey) {
            await this.handleSwapAction(interaction, guildId, cacheData);
          }
        }
        break;

      case 'serverSettingAction':
        if (cacheKey) {
          const cacheData = getServerSettingsData(cacheKey);
          if (!cacheData) {
            await interaction.editReply({ content: 'Settings data expired. Please try again.' });
            return;
          }

          // Check ownership
          if (cacheData.ownerId !== interaction.user.id) {
            await interaction.editReply({ content: 'You can only interact with settings you opened.' });
            return;
          }

          if (cacheData.settingKey && cacheData.tableName) {
            await this.handleCustomAction(interaction, guildId, cacheData);
          }
        }
        break;

      default:
        console.log('Unknown server setting button action:', action, extra);
        await interaction.editReply({
          content: 'Unknown server settings action.',
        });
    }
  }

  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra, guildId } = parsed;
    console.log('server setting modal router action', action);

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'higher', { skipDefer: true });
    if (!allowed) return;

    await interaction.deferReply({ ephemeral: true });

    // Extract data from extra: [tableName, featureName]
    const [tableName, featureName] = extra;
    // Extract settingKey from action (remove 'serverSetting_' prefix if present)
    const settingKey = action.startsWith('serverSetting_') ? action.replace('serverSetting_', '') : action;

    await this.handleModalSubmit(interaction, guildId, settingKey, tableName, featureName, interaction.user.id);
  }

  static async handleSelectMenu(_interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    console.log('server setting select router action', action);
  }

  /**
   * Handle feature selection from main server settings (e.g., clicking "Links", "Tickets", etc.)
   */
  private static async handleFeatureSelection(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string,
  ): Promise<void> {
    try {
      if (FeatureRegistry[featureName]) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await interaction.editReply({ embeds: [embed], components });
      } else {
        logger.warn(`Unknown feature: ${featureName}`);
        await interaction.editReply({ content: `Unknown feature: ${featureName}` });
      }
    } catch (error) {
      logger.error(`Error handling feature selection for ${featureName}:`, error);
      await interaction.editReply({
        content: `Error loading feature settings. Please try again.`,
      });
    }
  }

  /**
   * Handle settings actions (like "return" to main settings)
   */
  private static async handleSettingsAction(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    action: string,
  ): Promise<void> {
    if (action === 'return') {
      try {
        const { embed, components } = await buildSettingsView(guildId, ownerId);
        await interaction.editReply({
          embeds: [embed],
          components: components,
        });
      } catch (error) {
        logger.error(`Error showing server settings: ${error}`);
        await interaction.editReply({ content: `Error showing settings.` });
      }
    }
  }

  /**
   * Handle feature toggle (enable/disable entire features)
   */
  private static async handleFeatureToggle(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _tableName: string,
  ): Promise<void> {
    const result = await serverSettingsService.toggleFeature(guildId, featureName);

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Error toggling feature. Please try again.',
      });
      return;
    }

    // Update the UI with fresh data
    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
    await interaction.editReply({ embeds: [embed], components });
  }
  /**
   * Handle toggle actions (enable/disable features or settings)
   */
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
      client: interaction.client,
    });

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Error toggling setting. Please try again.',
      });
      return;
    }

    // Handle invite message update if needed
    if (result.requiresInviteUpdate && result.inviteData) {
      try {
        await serverSettingsService.updateInviteMessageAfterToggle(guildId, interaction.client, result.inviteData);
      } catch (error) {
        logger.error('Failed to update invite message:', error);
      }
    }

    // Update the UI with fresh data
    if (featureName) {
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });
    }
  }

  /**
   * Handle opening modals for text/number inputs
   */
  private static async handleOpenModal(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey, tableName, featureName } = cacheData;

    try {
      // Handle logs_channel_id - channel selector modal
      if (settingKey === 'logs_channel_id') {
        const modal = new ModalBuilder()
          .setTitle('Set Logs Channel')
          .setCustomId(
            makeCustomId('m', `serverSetting_${settingKey}`, guildId, { extra: [tableName || '', featureName || ''] }),
          )
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Channel Select')
              .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1)),
          );

        return interaction.showModal(modal);
      } else if (settingKey === 'category_id') {
        const modal = new ModalBuilder()
          .setTitle('Set Category')
          .setCustomId(
            makeCustomId('m', `serverSetting_${settingKey}`, guildId, { extra: [tableName || '', featureName || ''] }),
          )
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Category Select')
              .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1)),
          );
        return interaction.showModal(modal);
      }

      // // Generic text input modal for other settings
      // const modal = new ModalBuilder()
      //   .setTitle(`Edit ${settingKey}`)
      //   .setCustomId(makeCustomId('m', settingKey, guildId, { extra: [tableName || '', featureName || ''] }))
      //   .addComponents(
      //     new ActionRowBuilder<TextInputBuilder>().addComponents(
      //       new TextInputBuilder().setCustomId('input').setLabel('Enter new value').setStyle(TextInputStyle.Short)
      //     )
      //   );

      // await interaction.showModal(modal);
    } catch (error) {
      logger.error(`Error opening modal for ${settingKey}:`, error);
      await interaction.editReply({
        content: `Error opening settings modal. Please try again.`,
      });
    }
  }

  /**
   * Handle swap actions (like switching between delete/edit modes)
   */
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
    });

    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Error swapping setting.' });
      return;
    }

    // Update the UI with fresh data
    if (featureName) {
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });
    }
  }

  /**
   * Handle custom actions (like destructive operations)
   */
  private static async handleCustomAction(
    _interaction: ButtonInteraction,
    _guildId: string,
    cacheData: ServerSettingsData,
  ): Promise<void> {
    const { settingKey, tableName } = cacheData;
    console.log('Custom action:', settingKey, 'in table:', tableName);
    // TODO: Implement custom action logic
  }

  /**
   * Handle modal submission for server settings
   */
  private static async handleModalSubmit(
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

    // Handle channel selection (for logs_channel_id and category_id)
    if (settingKey === 'logs_channel_id' || settingKey === 'category_id') {
      const channelField = interaction.fields.getSelectedChannels('input');
      if (!channelField || channelField.size === 0) {
        await interaction.editReply({
          content: `No ${settingKey === 'logs_channel_id' ? 'channel' : 'category'} selected.`,
        });
        return;
      }

      const selectedChannel = channelField.first();

      // Validate channel type
      if (settingKey === 'logs_channel_id') {
        if (selectedChannel && selectedChannel.type !== 0 && selectedChannel.type !== 5) {
          await interaction.editReply({ content: 'Please select a text channel.' });
          return;
        }
      } else if (settingKey === 'category_id') {
        if (selectedChannel && selectedChannel.type !== 4) {
          await interaction.editReply({ content: 'Please select a category channel.' });
          return;
        }
      }

      // Update via service
      const result = await serverSettingsService.updateChannelSetting({
        guildId,
        settingKey,
        tableName,
        channelId: selectedChannel!.id,
      });

      if (!result.success) {
        await interaction.editReply({ content: result.error || 'Failed to update channel setting.' });
        return;
      }

      // Update the UI
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      await interaction.editReply({
        content: `✅ ${settingKey === 'logs_channel_id' ? 'Logs channel' : 'Category'} updated successfully`,
      });
      return;
    }

    // Handle text input (for other settings)
    const inputValue = interaction.fields.getTextInputValue('input');
    if (!inputValue) {
      await interaction.editReply({ content: 'No value provided.' });
      return;
    }

    // Update via service
    const result = await serverSettingsService.updateTextSetting({
      guildId,
      settingKey,
      tableName,
      value: inputValue,
    });

    if (!result.success) {
      await interaction.editReply({ content: result.error || 'Failed to update setting.' });
      return;
    }

    // Update the UI
    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
    await message.edit({ embeds: [embed], components });
    await interaction.editReply({ content: `✅ ${settingKey} updated successfully` });
  }
}
