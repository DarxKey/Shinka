import { release, type } from "node:os";

/** Il sistema operativo di questa macchina, in una forma breve da mostrare al proprietario. */
export function sistemaDiQuestaMacchina(): string {
  switch (process.platform) {
    case "win32":
      // Windows 11 dichiara ancora la versione 10.0: lo si riconosce dal numero di build.
      return Number(release().split(".")[2]) >= 22000 ? "Windows 11" : "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return type();
  }
}
