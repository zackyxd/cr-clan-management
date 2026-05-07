export class RaceTrackingInteractionRouter {
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    console.log(action);
  }
}
