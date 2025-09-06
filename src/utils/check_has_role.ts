import { EmbedBuilder, GuildMember, PermissionsBitField } from 'discord.js';
import format from 'pg-format';
import { EmbedColor } from '../types/EmbedUtil.js';

export function buildCheckHasRoleQuery(guildId: string): string {
  return format(
    `
    SELECT lower_leader_role_id, higher_leader_role_id
    FROM server_settings
    WHERE guild_id = (%L)
    `,
    guildId
  );
}

export function checkPermissions(item: string, member: GuildMember, requiredRoles: string[]): EmbedBuilder | void {
  const hasRole = requiredRoles.some((roleId: string) => member?.roles.cache.has(roleId));
  const hasElevatedPerms = member?.permissions.has([
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
  ]);
  const flatRoles = requiredRoles.flat().filter(Boolean); // remove empty strings/undefined
  if (hasRole || hasElevatedPerms) return;
  console.log(flatRoles);
  let rolesNeeded: string;
  if (flatRoles.length === 0) {
    rolesNeeded = `One of the server admins need to set up the following \`/set-staff-roles\` roles for you to use this command.`;
  } else {
    rolesNeeded = `You need one of the following roles: ` + flatRoles.map((id) => `<@&${id}>`).join(', ');
  }
  return new EmbedBuilder()
    .setDescription(`**You do not have permission to use this ${item}.**\n${rolesNeeded}`)
    .setColor(EmbedColor.WARNING);
}
