import { EmbedBuilder } from 'discord.js';
import pool from '../db.js';
import { EmbedColor } from '../types/EmbedUtil.js';

export async function checkFeatureEnabled(
  guildId: string,
  featureName: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  const checkEnabledSQL = await pool.query(
    `
    SELECT is_enabled
    FROM guild_features
    WHERE guild_id = $1 AND feature_name = $2
    `,
    [guildId, featureName]
  );
  const res = checkEnabledSQL.rows[0]?.is_enabled ?? false;
  if (!res) {
    // TODO show command they use to enable a feature
    const embed = new EmbedBuilder()
      .setDescription(
        `**The \`${featureName}\` feature has not been enabled for this guild.**\nPlease ask one of the server admins to enable it in TODO`
      )
      .setColor(EmbedColor.FAIL);
    return { enabled: false, embed: embed };
  }
  return { enabled: true };
}
