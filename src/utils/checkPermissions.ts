import {
  ButtonInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuInteraction,
} from 'discord.js';
import format from 'pg-format';
import { EmbedColor } from '../types/EmbedUtil.js';
import pool from '../db.js';

export type InteractionTypes = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
type RoleLevel = 'lower' | 'higher' | 'either';

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
  console.log(hasElevatedPerms);
  if (hasRole || hasElevatedPerms) return;
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

export async function checkPerms(
  interaction: InteractionTypes,
  guildId: string,
  interactionType: 'button' | 'modal' | 'select menu',
  level: RoleLevel,
  ephemeral: boolean = true,
  skipDefer: boolean = false // if for a button that opens a modal
): Promise<boolean> {
  // 1️⃣ Fetch member & required roles FIRST (don't defer yet)
  const member = await interaction.guild?.members.fetch(interaction.user.id);

  // 1️⃣ Check implicit permissions first (owner, admin, manage guild)
  const isOwner = interaction.guild?.ownerId === interaction.user.id;
  const hasAdmin = member?.permissions.has([
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
  ]);

  if (isOwner || hasAdmin) {
    // ✅ Immediately allow — don't care about staff roles at all
    if (!skipDefer) {
      if (ephemeral) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } else {
        await interaction.deferUpdate();
      }
    }
    return true;
  }

  const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
  const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? {};

  let requiredRoleIds: string[] = [];
  if (level === 'lower') requiredRoleIds = lower_leader_role_id ? [lower_leader_role_id] : [];
  else if (level === 'higher') requiredRoleIds = higher_leader_role_id ? [higher_leader_role_id] : [];
  else if (level === 'either')
    requiredRoleIds = [lower_leader_role_id, higher_leader_role_id].filter(Boolean) as string[];

  console.log(requiredRoleIds.flat().filter(Boolean));
  if (requiredRoleIds.flat().filter(Boolean).length === 0) {
    const embed = new EmbedBuilder().setColor(EmbedColor.WARNING);

    if (level === 'either') {
      embed.setDescription(
        'One of the server admins needs to set up staff roles with `/set-staff-roles` before you can use this.'
      );
    } else {
      const label = level === 'higher' ? 'higher' : 'lower';
      embed.setDescription(
        `The **${label}** leadership role has not been configured yet. Please ask a server admin to run \`/set-staff-roles\` to configure it.`
      );
    }
    // respond appropriately depending on skipDefer & ephemeral
    if (skipDefer) {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      if (ephemeral) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.deferUpdate();
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }
    return false;
  }

  const permEmbed: EmbedBuilder | void = checkPermissions(interactionType, member!, requiredRoleIds);

  // 2️⃣ If no permission -> reply immediately (don't defer)
  if (permEmbed) {
    // Special case: if we skipped defer (modal button), we must reply, not followUp
    if (skipDefer) {
      await interaction.reply({ embeds: [permEmbed], flags: MessageFlags.Ephemeral });
    } else {
      if (ephemeral) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ embeds: [permEmbed] });
      } else {
        await interaction.deferUpdate();
        await interaction.followUp({ embeds: [permEmbed], flags: MessageFlags.Ephemeral });
      }
    }
    return false;
  }

  // 3️⃣ Only defer if they have permission and skipDefer is false
  if (!skipDefer) {
    if (ephemeral) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferUpdate(); // keeps original message visible
    }
  }

  return true; // ✅ Allowed
}
