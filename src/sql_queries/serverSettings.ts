import format from 'pg-format';

export function buildGetRequiredRoles(guildId: string) {
  return format(
    `
    SELECT lower_leader_role_id, higher_leader_role 
    FROM server_settings
    WHERE guild_id = (%L)
    `,
    guildId
  );
}
