import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('view-snapshot')
    .setDescription('[Test] View a race day snapshot')
    .addStringOption((option) =>
      option.setName('clantag').setDescription('Clan tag (with or without #)').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('day').setDescription('Race day to view (0-4)').setRequired(true).setMinValue(0).setMaxValue(4),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const clantagInput = interaction.options.getString('clantag', true);
    const clantag = clantagInput.startsWith('#') ? clantagInput : `#${clantagInput}`;
    const day = interaction.options.getInteger('day', true);
    const guildId = interaction.guildId!;

    try {
      // Get snapshot
      const snapshotQuery = await pool.query(
        `
      SELECT 
        rds.snapshot_id,
        rds.snapshot_time,
        rds.snapshot_data
      FROM race_day_snapshots rds
      JOIN river_races rr ON rds.race_id = rr.race_id
      WHERE rr.guild_id = $1 
        AND rr.clantag = $2 
        AND rds.race_day = $3
      ORDER BY rds.snapshot_time DESC
      LIMIT 1
      `,
        [guildId, clantag, day],
      );

      if (snapshotQuery.rows.length === 0) {
        await interaction.editReply({
          content: `❌ No snapshot found for ${clantag} Day ${day}.\n\nUse \`/test-snapshot\` to create one.`,
        });
        return;
      }

      const snapshot = snapshotQuery.rows[0];
      // JSONB columns are auto-parsed by pg, no need to JSON.parse
      const snapshotData = snapshot.snapshot_data;
      const attacks = snapshotData.embedData.attacks; // Access nested embedData

      const embed = new EmbedBuilder()
        .setTitle(`📸 Snapshot: ${attacks.clanName}`)
        .setDescription(
          `**Day ${day}** | Season ${attacks.seasonId || 'Unknown'} | Week ${attacks.warWeek}\n` +
            `Captured: <t:${Math.floor(new Date(snapshot.snapshot_time).getTime() / 1000)}:R>`,
        )
        .setColor(0x3498db);

      // Stats
      const totalPlayers = attacks.groups.reduce((sum: number, g: any) => sum + g.count, 0);

      embed.addFields({
        name: '📊 Statistics',
        value:
          `Players Shown: ${totalPlayers}\n` +
          `Available Attackers: ${attacks.availableAttackers}\n` +
          `Total Attacks Remaining: ${attacks.totalAttacksRemaining}`,
        inline: false,
      });

      // Show groups (limit to first 3 to avoid hitting field limits)
      for (const group of attacks.groups.slice(0, 3)) {
        const memberList = group.players
          .map((p: any) => {
            const ind = p.emojis.length > 0 ? ` ${p.emojis.join('')}` : '';
            const clans = p.clansAttackedIn ? `\n  → Attacked in: ${p.clansAttackedIn.join(', ')}` : '';
            return `• ${p.name}${ind}${clans}`;
          })
          .slice(0, 10) // Max 10 per group
          .join('\n');

        const more = group.players.length > 10 ? `\n_...and ${group.players.length - 10} more_` : '';

        embed.addFields({
          name: `**${group.attacksRemaining} Attacks** (${group.count})`,
          value: memberList + more || 'None',
          inline: false,
        });
      }

      if (attacks.groups.length > 3) {
        embed.addFields({
          name: '➕ More Groups',
          value: `_...and ${attacks.groups.length - 3} more attack groups_`,
          inline: false,
        });
      }

      // Legend
      if (attacks.legend.length > 0) {
        embed.setFooter({ text: attacks.legend.join(' • ') });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[View Snapshot] Error:', error);
      await interaction.editReply({
        content: `❌ Error viewing snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  },
};

export default command;
