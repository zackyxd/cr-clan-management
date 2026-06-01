import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';

function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();

  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  const candidate = fromUrl ?? trimmed;

  if (!/^[a-zA-Z0-9-_]{20,}$/.test(candidate)) return null;
  return candidate;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-spreadsheet-id')
    .setDescription('Set Google Spreadsheet ID used by stats commands for this server')
    .addStringOption((option) =>
      option.setName('spreadsheet-id').setDescription('Spreadsheet ID or full Google Sheets URL').setRequired(true),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'upper', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const rawInput = interaction.options.getString('spreadsheet-id', true);
    const spreadsheetId = parseSpreadsheetId(rawInput);
    if (!spreadsheetId) {
      await interaction.editReply({
        content: '❌ Invalid spreadsheet ID. Provide a valid Google Sheets ID or URL.',
      });
      return;
    }

    await pool.query(
      `
			INSERT INTO server_settings (guild_id, stats_spreadsheetid)
			VALUES ($1, $2)
			ON CONFLICT (guild_id)
			DO UPDATE SET stats_spreadsheetid = EXCLUDED.stats_spreadsheetid
			`,
      [guild.id, spreadsheetId],
    );

    await interaction.editReply({
      content: `✅ Spreadsheet ID saved for this server: \`${spreadsheetId}\``,
    });
  },
};

export default command;
