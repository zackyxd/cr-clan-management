export type SheetsColor = {
  red: number;
  green: number;
  blue: number;
};

export type ClanHeaderTheme = {
  backgroundHex: string;
  textHex: string;
  backgroundColor: SheetsColor;
  textColor: SheetsColor;
};

export const DEFAULT_CLAN_HEADER_PALETTE = [
  '#457FB5',
  '#2E8C57',
  '#B33838',
  '#8C4DB3',
  '#BF7A1A',
  '#2E8C8C',
  '#9E8026',
  '#73338C',
  '#337347',
  '#A62E61',
  '#4061AD',
  '#855433',
] as const;

export const L2W_HEADER_BG_HEX = '#595959';
export const L2W_HEADER_TEXT_HEX = '#FFFFFF';

export function normalizeHexColor(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  const candidate = trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : null;
}

export function hexToSheetsColor(hex: string): SheetsColor {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;

  return { red, green, blue };
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function getReadableTextHex(backgroundHex: string): string {
  const background = hexToSheetsColor(backgroundHex);
  const luminance =
    0.2126 * srgbToLinear(background.red) +
    0.7152 * srgbToLinear(background.green) +
    0.0722 * srgbToLinear(background.blue);

  return luminance > 0.45 ? '#000000' : '#FFFFFF';
}

export function buildClanHeaderTheme(backgroundHex: string, textHex?: string | null): ClanHeaderTheme {
  const normalizedBg = normalizeHexColor(backgroundHex);
  if (!normalizedBg) {
    throw new Error(`Invalid background hex color: ${backgroundHex}`);
  }

  const normalizedText = normalizeHexColor(textHex) ?? getReadableTextHex(normalizedBg);
  return {
    backgroundHex: normalizedBg,
    textHex: normalizedText,
    backgroundColor: hexToSheetsColor(normalizedBg),
    textColor: hexToSheetsColor(normalizedText),
  };
}

export function buildL2WHeaderTheme(): ClanHeaderTheme {
  return buildClanHeaderTheme(L2W_HEADER_BG_HEX, L2W_HEADER_TEXT_HEX);
}

export function resolveClanHeaderThemes(
  resolvedOrder: string[],
  clanRows: Array<{ abbreviation: string; header_bg_hex: string | null; header_text_hex: string | null }>,
): ClanHeaderTheme[] {
  const usedBackgrounds = new Set<string>();
  let paletteCursor = 0;

  const pickFallbackHex = (): string => {
    for (let attempts = 0; attempts < DEFAULT_CLAN_HEADER_PALETTE.length; attempts++) {
      const hex = DEFAULT_CLAN_HEADER_PALETTE[paletteCursor % DEFAULT_CLAN_HEADER_PALETTE.length];
      paletteCursor++;
      if (!usedBackgrounds.has(hex)) {
        usedBackgrounds.add(hex);
        return hex;
      }
    }

    const hex = DEFAULT_CLAN_HEADER_PALETTE[paletteCursor % DEFAULT_CLAN_HEADER_PALETTE.length];
    paletteCursor++;
    return hex;
  };

  for (const row of clanRows) {
    const manualBg = normalizeHexColor(row.header_bg_hex);
    if (manualBg) usedBackgrounds.add(manualBg);
  }

  return resolvedOrder.map((clan) => {
    if (clan === 'L2W') return buildL2WHeaderTheme();

    const match = clanRows.find((row) => row.abbreviation.toUpperCase() === clan);
    const manualBg = normalizeHexColor(match?.header_bg_hex);
    const manualText = normalizeHexColor(match?.header_text_hex);
    const backgroundHex = manualBg ?? pickFallbackHex();

    if (manualBg) usedBackgrounds.add(manualBg);
    return buildClanHeaderTheme(backgroundHex, manualText);
  });
}
