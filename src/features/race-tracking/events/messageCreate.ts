import { Message } from 'discord.js';
import type { GuildMessageContext } from '../../../cache/guildMessageContextCache.js';
import { pool } from '../../../db.js';
import { postRacePingsToChannels } from '../service.js';
import { getEmojiObject } from '../../../utils/emoji.js';
import logger from '../../../logger.js';

type RoleMentionType = 'late' | 'replace';

interface MarkResult {
  ok: boolean; // false only if the user has no linked playertags (reply already sent in that case)
  alreadySentToday: boolean;
}

/** Same marking logic as /attacking-late and /replace-me, triggered by @-mentioning the role instead. */
async function markFromRoleMention(message: Message, guildId: string, type: RoleMentionType): Promise<MarkResult> {
  const sentTodayColumn = type === 'late' ? 'attacking_late_ping_sent_today' : 'replace_me_ping_sent_today';
  const statusColumn = type === 'late' ? 'is_attacking_late' : 'is_replace_me';

  const userLinkedTags = await pool.query(
    `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
    [guildId, message.author.id],
  );

  if (userLinkedTags.rows.length === 0) {
    await message.reply('❌ You do not have any linked playertags.');
    return { ok: false, alreadySentToday: false };
  }

  const playertags = userLinkedTags.rows.map((row) => row.playertag);

  const userCheck = await pool.query(`SELECT ${sentTodayColumn} FROM users WHERE guild_id = $1 AND discord_id = $2`, [
    guildId,
    message.author.id,
  ]);
  const alreadySentToday = userCheck.rows[0]?.[sentTodayColumn] || false;

  await pool.query(
    `UPDATE users
     SET ${statusColumn} = true${!alreadySentToday ? `, ${sentTodayColumn} = true` : ''}
     WHERE guild_id = $1 AND discord_id = $2`,
    [guildId, message.author.id],
  );

  if (!alreadySentToday) {
    await postRacePingsToChannels(guildId, playertags, type, undefined, message.url);
  }

  return { ok: true, alreadySentToday };
}

/** Lets members mark themselves attacking-late/replace-me by @-mentioning the configured role instead of using the slash command. */
export async function handleRaceRoleMention(message: Message, ctx: GuildMessageContext): Promise<boolean> {
  if (!ctx.attackingLateRoleId && !ctx.replaceMeRoleId) return false;

  const mentionsLate = !!ctx.attackingLateRoleId && message.mentions.roles.has(ctx.attackingLateRoleId);
  const mentionsReplace = !!ctx.replaceMeRoleId && message.mentions.roles.has(ctx.replaceMeRoleId);

  if (!mentionsLate && !mentionsReplace) return false;

  const guildId = message.guild!.id;

  if (mentionsLate) {
    const { ok } = await markFromRoleMention(message, guildId, 'late');
    if (ok) {
      const pepesalute = getEmojiObject('pepesalute');
      if (pepesalute) {
        await message
          .react(pepesalute)
          .catch((err) => logger.error('Failed to react to attacking-late message: %O', err));
      }
    }
  }

  if (mentionsReplace) {
    const { ok, alreadySentToday } = await markFromRoleMention(message, guildId, 'replace');
    if (ok) {
      await message.react('⚠️').catch((err) => logger.error('Failed to react to replace-me message: %O', err));
      if (!alreadySentToday) {
        await message.reply(
          '✅ **You are now marked as "Replace Me"** and accounts have been posted to the staff channel.\n\nYou will be excluded from nudges and will be listed as needing a replacement.\n\n**If possible**\n* Leave a message why you need replacement\n * Leave the clan to make room for a replacement.',
        );
      }
    }
  }

  return true;
}
