import "discord.js";
import { Collection } from "discord.js";
import { Command } from "../commands/Command";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}
