// types/discord.d.ts
import "discord.js";
import type { Command } from "./Command.js";
import type { Collection } from "discord.js";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}
