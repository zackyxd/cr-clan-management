export type InteractionCategory = 'button' | 'modal' | 'select';

/**
 *
 * @param category type of interaction (button, modal, select)
 * @param action type of action taking place, or postgres column name
 * @param guildId
 * @param opts { cooldown: int }
 * @returns string separating each param by ':'
 */
export function makeCustomId(
  category: InteractionCategory,
  action: string,
  guildId: string,
  opts: { cooldown?: number; extra?: string[] } = {}
): string {
  const cooldown = opts.cooldown ?? 0;
  const parts = [category, action, guildId, String(cooldown)];
  if (opts.extra) parts.push(...opts.extra);
  return parts.join(':');
}

export function parseCustomId(customId: string) {
  const parts = customId.split(':');
  const [category, action, guildId, cooldownStr, ...extra] = parts;
  return {
    category: category as InteractionCategory,
    action, // can be column name as well
    guildId,
    cooldown: Number(cooldownStr ?? 0),
    extra,
  };
}
