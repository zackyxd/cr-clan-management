import {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextChannel,
  NewsChannel,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
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
import { pool } from '../../../db.js';
import { updateInviteMessage, repostInviteMessage } from '../../../commands/staff_commands/updateClanInvite.js';
import { makeCustomId } from '../../../utils/customId.js';

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
    const settingKey = action; // action is the settingKey (e.g., 'logs_channel_id')

    await this.handleModalSubmit(interaction, guildId, settingKey, tableName, featureName, interaction.user.id);
  }

  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
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
    featureName: string
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
    action: string
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
    tableName: string
  ): Promise<void> {
    try {
      // Get current feature status
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        featureName,
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      // Toggle the feature
      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, featureName, newValue]
      );

      // Update the UI with fresh data
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await interaction.editReply({ embeds: [embed], components });

      logger.info(`Feature '${featureName}' ${newValue ? 'enabled' : 'disabled'} for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error toggling feature ${featureName}:`, error);
      await interaction.editReply({
        content: `Error toggling feature. Please try again.`,
      });
    }
  }
  /**
   * Handle toggle actions (enable/disable features or settings)
   */
  private static async handleToggleAction(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData
  ): Promise<void> {
    const { settingKey, tableName, featureName, ownerId } = cacheData;

    try {
      // Handle special cases that need custom logic
      if (settingKey === 'show_inactive') {
        await this.handleShowInactiveToggle(interaction, guildId, ownerId, featureName);
        return;
      }

      if (settingKey === 'pin_message') {
        await this.handlePinMessageToggle(interaction, guildId, ownerId, featureName);
        return;
      }

      // Generic toggle for most settings
      await pool.query(
        `UPDATE ${tableName}
         SET ${settingKey} = NOT ${settingKey}
         WHERE guild_id = $1
         RETURNING ${settingKey}`,
        [guildId]
      );

      // Update the UI with fresh data
      if (featureName) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await interaction.editReply({ embeds: [embed], components });
      }

      logger.info(`Setting '${settingKey}' toggled in table '${tableName}' for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error toggling setting ${settingKey}:`, error);
      await interaction.editReply({
        content: `Error toggling setting. Please try again.`,
      });
    }
  }

  /**
   * Handle opening modals for text/number inputs
   */
  private static async handleOpenModal(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData
  ): Promise<void> {
    const { settingKey, tableName, featureName } = cacheData;

    try {
      // Handle logs_channel_id - channel selector modal
      if (settingKey === 'logs_channel_id') {
        const modal = new ModalBuilder()
          .setTitle('Set Logs Channel')
          .setCustomId(makeCustomId('m', settingKey, guildId, { extra: [tableName || '', featureName || ''] }))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Channel Select')
              .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1))
          );

        return interaction.showModal(modal);
      } else if (settingKey === 'category_id') {
        const modal = new ModalBuilder()
          .setTitle('Set Category')
          .setCustomId(makeCustomId('m', settingKey, guildId, { extra: [tableName || '', featureName || ''] }))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Category Select')
              .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1))
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
    cacheData: ServerSettingsData
  ): Promise<void> {
    const { settingKey, tableName, featureName, ownerId } = cacheData;

    try {
      // Handle delete_method swap (enum toggle between 'delete' and 'update')
      if (settingKey === 'delete_method') {
        await pool.query(
          `UPDATE ${tableName}
           SET delete_method = CASE
               WHEN delete_method = 'update' THEN 'delete'::delete_method_type
               ELSE 'update'::delete_method_type
             END
           WHERE guild_id = $1
           RETURNING delete_method`,
          [guildId]
        );
      } else {
        // Generic swap handler for other swap types can be added here
        logger.warn(`Unhandled swap action for setting: ${settingKey}`);
        await interaction.editReply({ content: `Swap action for ${settingKey} not implemented yet.` });
        return;
      }

      // Update the UI with fresh data
      if (featureName) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await interaction.editReply({ embeds: [embed], components });
      }

      logger.info(`Setting '${settingKey}' swapped in table '${tableName}' for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error swapping setting ${settingKey}:`, error);
      await interaction.editReply({
        content: `Error swapping setting. Please try again.`,
      });
    }
  }

  /**
   * Handle custom actions (like destructive operations)
   */
  private static async handleCustomAction(
    interaction: ButtonInteraction,
    guildId: string,
    cacheData: ServerSettingsData
  ): Promise<void> {
    const { settingKey, tableName } = cacheData;
    console.log('Custom action:', settingKey, 'in table:', tableName);
    // TODO: Implement custom action logic
  }

  /**
   * Handle show_inactive toggle with special invite message update logic
   */
  private static async handleShowInactiveToggle(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string
  ): Promise<void> {
    try {
      // Toggle the setting
      await pool.query(
        `UPDATE clan_invite_settings
         SET show_inactive = NOT show_inactive
         WHERE guild_id = $1
         RETURNING show_inactive`,
        [guildId]
      );

      // Update the invite message immediately
      const { embeds, components: inviteComponents } = await updateInviteMessage(pool, guildId);

      const { rows } = await pool.query(
        `SELECT cis.channel_id,
          cis.message_id,
          cis.pin_message
        FROM clan_invite_settings cis
        WHERE cis.guild_id = $1
        LIMIT 1`,
        [guildId]
      );

      if (rows.length) {
        const { channel_id, message_id, pin_message } = rows[0];

        await repostInviteMessage({
          client: interaction.client,
          channelId: channel_id,
          messageId: message_id,
          embeds,
          components: inviteComponents,
          pin: pin_message,
          pool: pool,
          guildId,
        });
      }

      // Update the UI
      if (featureName) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await interaction.editReply({ embeds: [embed], components });
      }

      logger.info(`show_inactive toggled for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error toggling show_inactive:`, error);
      await interaction.editReply({
        content: `Error toggling setting. Please try again.`,
      });
    }
  }

  /**
   * Handle pin_message toggle with Discord pin/unpin logic
   */
  private static async handlePinMessageToggle(
    interaction: ButtonInteraction,
    guildId: string,
    ownerId: string,
    featureName: string
  ): Promise<void> {
    try {
      // Toggle the setting and get the new value
      const { rows } = await pool.query(
        `UPDATE clan_invite_settings
         SET pin_message = NOT pin_message
         WHERE guild_id = $1
         RETURNING pin_message, channel_id, message_id`,
        [guildId]
      );

      if (rows.length === 0) {
        await interaction.editReply({ content: 'No invite settings found.' });
        return;
      }

      const { pin_message: isNowPinned, channel_id, message_id } = rows[0];

      // Handle Discord pin/unpin
      try {
        const channel = await interaction.client.channels.fetch(channel_id);

        if (channel && channel.isTextBased() && (channel instanceof TextChannel || channel instanceof NewsChannel)) {
          const message = await channel.messages.fetch(message_id);

          if (isNowPinned) {
            await message.pin();
          } else {
            await message.unpin();
          }

          // Optionally delete the system pin message
          const recent = await channel.messages.fetch({ limit: 5 });
          const systemMessage = recent.find((msg) => msg.type === 6);
          if (systemMessage) await systemMessage.delete().catch(console.error);
        }
      } catch (err) {
        logger.error('Failed to pin/unpin message:', err);
      }

      // Update the UI
      if (featureName) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await interaction.editReply({ embeds: [embed], components });
      }

      logger.info(`pin_message ${isNowPinned ? 'enabled' : 'disabled'} for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error toggling pin_message:`, error);
      await interaction.editReply({
        content: `Error toggling setting. Please try again.`,
      });
    }
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
    ownerId: string
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

    try {
      // Handle channel selection (for logs_channel_id)
      if (settingKey === 'logs_channel_id') {
        const channelField = interaction.fields.getSelectedChannels('input');
        if (!channelField || channelField.size === 0) {
          await interaction.editReply({ content: 'No channel selected.' });
          return;
        }

        const selectedChannel = channelField.first();

        // Validate it's a text channel
        if (selectedChannel && selectedChannel.type !== 0 && selectedChannel.type !== 5) {
          await interaction.editReply({ content: 'Please select a text channel.' });
          return;
        }

        // Update the database
        await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [
          selectedChannel?.id,
          guildId,
        ]);

        // Update the UI
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await message.edit({ embeds: [embed], components });
        await interaction.editReply({ content: '✅ Logs channel updated successfully' });

        logger.info(`logs_channel_id updated to ${selectedChannel?.id} for guild ${guildId}`);
        return;
      } else if (settingKey === 'category_id') {
        const channelField = interaction.fields.getSelectedChannels('input');
        if (!channelField || channelField.size === 0) {
          await interaction.editReply({ content: 'No category selected.' });
          return;
        }

        const selectedCategory = channelField.first();

        // Validate it's a category channel
        if (selectedCategory && selectedCategory.type !== 4) {
          await interaction.editReply({ content: 'Please select a category channel.' });
          return;
        }

        // Update the database
        await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [
          selectedCategory?.id,
          guildId,
        ]);

        // Update the UI
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
        await message.edit({ embeds: [embed], components });
        await interaction.editReply({ content: '✅ Category updated successfully' });

        logger.info(`category_id updated to ${selectedCategory?.id} for guild ${guildId}`);
        return;
      }

      // Handle text input (for other settings)
      const inputValue = interaction.fields.getTextInputValue('input');
      if (!inputValue) {
        await interaction.editReply({ content: 'No value provided.' });
        return;
      }

      // Update the database
      await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [inputValue, guildId]);

      // Update the UI
      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, ownerId, featureName);
      await message.edit({ embeds: [embed], components });
      await interaction.editReply({ content: `✅ ${settingKey} updated successfully` });

      logger.info(`${settingKey} updated to '${inputValue}' for guild ${guildId}`);
    } catch (error) {
      logger.error(`Error handling modal submit for ${settingKey}:`, error);
      await interaction.editReply({
        content: `Error updating setting. Please try again.`,
      });
    }
  }
}
