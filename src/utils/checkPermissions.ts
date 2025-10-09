import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuInteraction,
} from 'discord.js';
import format from 'pg-format';
import { EmbedColor } from '../types/EmbedUtil.js';
import { pool } from '../db.js';

export type InteractionTypes =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction
  | ChatInputCommandInteraction;
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
  // console.log(hasElevatedPerms);
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

function deferInteraction(interaction: InteractionTypes, ephemeral = false) {
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    if (ephemeral) {
      return interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      return interaction.deferUpdate();
    }
  } else {
    // Slash command (ChatInputCommandInteraction)
    return interaction.deferReply({
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}

export async function checkPerms(
  interaction: InteractionTypes,
  guildId: string,
  interactionType: 'command' | 'button' | 'modal' | 'select menu',
  level: RoleLevel,
  opts: {
    hideNoPerms?: boolean; // hide 'you dont have permission' message
    deferEphemeral?: boolean; // whether valid defers should be ephemeral
    skipDefer?: boolean; // for modal buttons
  }
): Promise<boolean> {
  const { hideNoPerms = false, deferEphemeral = false, skipDefer = false } = opts;
  // 1️⃣ Fetch member & required roles FIRST (don't defer yet)
  const member = await interaction.guild?.members.fetch(interaction.user.id);

  // 1️⃣ Check implicit permissions first (owner, admin, manage guild)
  const isOwner = interaction.guild?.ownerId === interaction.user.id;
  const hasAdmin = member?.permissions.has([
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
  ]);

  if (isOwner || hasAdmin) {
    if (!skipDefer) {
      await deferInteraction(interaction, deferEphemeral);
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
      await interaction.reply({
        embeds: [embed],
        flags: hideNoPerms ? MessageFlags.Ephemeral : undefined,
      });
    } else {
      await interaction.deferReply({
        flags: hideNoPerms ? MessageFlags.Ephemeral : undefined,
      });
      await interaction.editReply({ embeds: [embed] });
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
      if (deferEphemeral) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ embeds: [permEmbed] });
      } else {
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
          await interaction.deferUpdate();
          await interaction.followUp({ embeds: [permEmbed], flags: MessageFlags.Ephemeral });
        } else {
          // slash command (ChatInputCommandInteraction)
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await interaction.editReply({ embeds: [permEmbed] });
        }
      }
    }
    return false;
  }

  // 3️⃣ Only defer if they have permission and skipDefer is false
  if (!skipDefer) {
    await deferInteraction(interaction, deferEphemeral);
  }

  return true; // ✅ Allowed
}
