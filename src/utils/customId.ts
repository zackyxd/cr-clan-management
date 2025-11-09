export type CustomIdType = 'b' | 'm' | 's';
// Button | Modal | Select

interface CustomIdOpts {
  cooldown?: number;
  extra?: string[];
  ownerId?: string;
}
/**
 *
 * @param category type of interaction (button, modal, select)
 * @param action type of action taking place, or postgres column name
 * @param guildId
 * @param opts { cooldown?: int, extra?: string[], ownerId?: string }
 * @returns string separating each param by ':'
 */
export function makeCustomId(type: CustomIdType, action: string, guildId: string, opts: CustomIdOpts = {}): string {
  const cooldown = opts.cooldown ?? 0;
  const parts = [type, action, guildId, String(cooldown)];

  if (opts.ownerId) {
    parts.push(`o=${opts.ownerId}`);
  }

  if (opts.extra) {
    parts.push(...opts.extra);
  }

  return parts.join(':');
}

export function parseCustomId(customId: string) {
  const parts = customId.split(':');
  const [category, action, guildId, cooldownStr, ...rest] = parts;

  let ownerId: string | undefined;
  const extra: string[] = [];

  for (const r of rest) {
    if (r.startsWith('o=')) {
      ownerId = r.replace('o=', '');
    } else {
      extra.push(r);
    }
  }

  return {
    category: category as CustomIdType,
    action, // can be column name as well
    guildId,
    cooldown: Number(cooldownStr ?? 0),
    ownerId,
    extra,
  };
}
