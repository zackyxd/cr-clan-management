import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { pool } from '../db.js';
import { BOTCOLOR } from '../types/EmbedUtil.js';
import { makeCustomId } from '../utils/customId.js';
import { Feature, FeatureRegistry, isFeatureEnabled } from './featureRegistry.js';

/**
 * Builds the server settings embed and components for a feature
 * This function centralizes UI generation for all features
 */
export async function buildFeatureEmbedAndComponents(
  guildId: string,
  ownerId: string,
  featureName: string
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  // Validate feature exists
  const feature = FeatureRegistry[featureName];
  if (!feature) {
    throw new Error(`Unknown feature: ${featureName}`);
  }

  // Check if feature is enabled
  const isEnabled = await isFeatureEnabled(guildId, featureName);

  // Get settings for the feature
  const settingRes = await pool.query(`SELECT * FROM ${feature.tableName} WHERE guild_id = $1`, [guildId]);
  const settings = settingRes.rows[0] ?? {};

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle(`${feature.displayName} Features: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}`)
    .setColor(BOTCOLOR);

  // Build action rows for buttons
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  // Add main control buttons
  const toggleFeature = new ButtonBuilder()
    .setLabel(`${isEnabled ? 'Disable Feature' : 'Enable Feature'}`)
    .setCustomId(
      makeCustomId('b', `toggle`, guildId, { cooldown: 1, extra: [`${featureName}_feature`, feature.tableName] })
    )
    .setStyle(ButtonStyle.Primary);

  const returnToSettings = new ButtonBuilder()
    .setEmoji('↩')
    .setStyle(ButtonStyle.Primary)
    .setCustomId(makeCustomId(`b`, 'settings', guildId, { cooldown: 1, extra: ['return'] }));

  currentRow.addComponents(returnToSettings, toggleFeature);

  // Build description with settings
  let description = `*${feature.description}*\n\n\n`;

  // Add settings to the description and create buttons
  for (const [i, setting] of feature.settings.entries()) {
    const value = settings[setting.key];
    let displayValue = '';

    // Format display value based on setting type
    if (setting.type === 'text' || setting.type === 'modal' || setting.type === 'swap') {
      displayValue = `__${value || '*None*'}__`;
    } else if (setting.type === 'toggle') {
      displayValue = value ? '✅ Enabled' : '❌ Disabled';
    } else if (setting.type === 'channel') {
      displayValue = value ? `<#${value}>` : '*None*';
    } else if (setting.type === 'number') {
      displayValue = String(value);
    } else if (setting.type === 'role') {
      displayValue = value ? `<@&${value}>` : '*None*';
    }

    // Add setting to description
    description += `* **${setting.label}: ${displayValue}**\n`;
    description += `  * ${setting.description}\n\n`;

    // Create button based on setting type
    let button: ButtonBuilder | null = null;

    if (setting.type === 'toggle') {
      button = new ButtonBuilder()
        .setLabel(`${value ? 'Disable' : 'Enable'} ${setting.label}`)
        .setCustomId(
          makeCustomId('b', `toggle`, guildId, {
            cooldown: 1,
            extra: [setting.key, feature.tableName],
            ownerId: ownerId,
          })
        )
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'modal' || setting.type === 'channel') {
      button = new ButtonBuilder()
        .setLabel(`Change ${setting.label}`)
        .setCustomId(
          makeCustomId('b', 'open_modal', guildId, {
            cooldown: 1,
            extra: [setting.key, `${feature.tableName}`],
            ownerId: ownerId,
          })
        )
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'swap') {
      button = new ButtonBuilder()
        .setLabel(`Swap ${setting.label}`)
        .setCustomId(
          makeCustomId('b', 'swap', guildId, {
            cooldown: 1,
            extra: [setting.key],
            ownerId: ownerId,
          })
        )
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'action') {
      button = new ButtonBuilder()
        .setLabel(`${setting.label}`)
        .setCustomId(
          makeCustomId('b', 'action', guildId, {
            cooldown: 1,
            extra: [setting.key, feature.tableName],
            ownerId: ownerId,
          })
        )
        .setStyle(ButtonStyle.Danger); // Actions are usually destructive
    }

    // Add button to current row
    if (button) {
      currentRow.addComponents(button);
    }

    // Create a new row if current is full or this is the last setting
    if (currentRow.components.length === 5 || i === feature.settings.length - 1) {
      if (currentRow.components.length > 0) {
        actionRows.push(currentRow);
      }
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  embed.setDescription(description);
  return { embed, components: actionRows };
}

/**
 * Builds the main server settings overview embed and components
 */
export async function buildSettingsOverview(
  guildId: string,
  ownerId: string
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  // Get all features and their enabled status for this guild
  const settingsRes = await pool.query(
    `SELECT feature_name, is_enabled
     FROM guild_features
     WHERE guild_id = $1`,
    [guildId]
  );

  const guildFeatures = settingsRes.rows;
  guildFeatures.sort((a, b) => a.feature_name.localeCompare(b.feature_name));

  // Build embed
  const embed = new EmbedBuilder().setTitle('Features List').setColor(BOTCOLOR);
  let description = '';

  // Build action rows
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  // Add each feature to description and create button
  for (const [i, feature] of guildFeatures.entries()) {
    const { feature_name, is_enabled } = feature;

    // Get display name from registry if available, otherwise format it
    const formatted_name =
      FeatureRegistry[feature_name]?.displayName ||
      feature_name
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Add to description
    description += `${formatted_name} ${is_enabled ? '✅' : '❌'}\n`;

    // Create button
    const button = new ButtonBuilder()
      .setCustomId(makeCustomId('b', 'settings', guildId, { cooldown: 1, extra: [feature_name], ownerId: ownerId }))
      .setLabel(`${formatted_name}`)
      .setStyle(ButtonStyle.Primary);

    // Add button to row
    currentRow.addComponents(button);

    // Create new row if current is full or this is the last feature
    if (currentRow.components.length === 5 || i === guildFeatures.length - 1) {
      actionRows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  embed.setDescription(description);
  return { embed, components: actionRows };
}
