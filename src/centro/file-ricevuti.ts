/**
 * I file che il proprietario manda alla Home da Telegram: si salvano nella cartella dell'argomento
 * aperto, senza mai sovrascrivere un file che c'è già, e la Home riceve un messaggio che li descrive.
 */

import { open } from "node:fs/promises";
import { extname, join } from "node:path";
import type { FileRicevuto } from "../protocollo/telegram.ts";

/** La dimensione di un file in breve: "820 byte", "12 kB", "3,4 MB". */
function pesoInBreve(byte: number): string {
  if (byte < 1000) return `${byte} byte`;
  if (byte < 1_000_000) return `${Math.round(byte / 1000)} kB`;
  const mega = byte / 1_000_000;
  return `${(mega < 10 ? mega.toFixed(1) : String(Math.round(mega))).replace(".", ",")} MB`;
}

/** Un nome di file che va bene su Windows e su Linux: senza cartelle e senza caratteri vietati. */
export function nomeSicuro(nome: string): string {
  const pulito = (nome.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f<>:"|?*\u007f]/g, "")
    .replace(/[. ]+$/g, "")
    .trim();
  // I nomi che Windows riserva ai dispositivi non si possono usare, nemmeno con un'estensione.
  const base = pulito.split(".")[0]?.toLowerCase() ?? "";
  if (pulito === "" || pulito.startsWith(".") || /^(con|prn|aux|nul|com\d|lpt\d)$/.test(base)) return `file-${pulito.replace(/^\.+/, "") || "ricevuto"}`;
  return pulito.length <= 150 ? pulito : `${pulito.slice(0, 150 - extname(pulito).length)}${extname(pulito)}`;
}

/** Scrive il file con il suo nome, o con "nome (2).ext" e così via se il nome è già preso. */
export async function salvaSenzaSovrascrivere(cartella: string, nome: string, dati: Buffer): Promise<string> {
  const sicuro = nomeSicuro(nome);
  const estensione = extname(sicuro);
  const radice = sicuro.slice(0, sicuro.length - estensione.length);
  for (let n = 1; n < 1000; n += 1) {
    const candidato = n === 1 ? sicuro : `${radice} (${n})${estensione}`;
    try {
      // "wx": fallisce se il file c'è già, anche se due arrivano insieme.
      const file = await open(join(cartella, candidato), "wx");
      try {
        await file.writeFile(dati);
      } finally {
        await file.close();
      }
      return candidato;
    } catch (errore) {
      if (errore instanceof Error && "code" in errore && errore.code === "EEXIST") continue;
      throw errore;
    }
  }
  throw new Error(`Troppi file si chiamano già ${sicuro}.`);
}

/** Il tipo di un file in parole brevi. */
export function tipoInBreve(mime: string): string {
  const noti: Record<string, string> = {
    "application/pdf": "PDF",
    "image/jpeg": "immagine JPEG",
    "image/png": "immagine PNG",
    "image/webp": "immagine WebP",
    "image/heic": "foto HEIC",
    "text/plain": "testo",
    "text/csv": "CSV",
    "application/zip": "archivio ZIP",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documento Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "foglio Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentazione PowerPoint",
    "audio/ogg": "nota vocale",
    "video/mp4": "video",
  };
  return noti[mime] ?? mime;
}

export interface FileSalvato {
  file: FileRicevuto;
  /** Il nome con cui è stato salvato nella cartella dell'argomento. */
  nome: string;
  byte: number;
}

/** Il messaggio con cui il proprietario passa alla Home i file mandati da Telegram. */
export function messaggioDeiFile(salvati: FileSalvato[], cartella: string, didascalie: string[]): string {
  const voce = (salvato: FileSalvato): string =>
    `«${salvato.file.nome}» (${tipoInBreve(salvato.file.mime)}, ${pesoInBreve(salvato.byte)}), salvato come \`${salvato.nome}\``;
  const intestazione =
    salvati.length === 1
      ? `📎 Ti mando un file da Telegram: ${voce(salvati[0] as FileSalvato)}.`
      : `📎 Ti mando ${salvati.length} file da Telegram:\n${salvati.map((salvato) => `- ${voce(salvato)}`).join("\n")}`;
  const dove = `Sono nella cartella di questo argomento, ${cartella}.`;
  const scritto = didascalie.length === 0 ? "" : `\n${didascalie.join("\n")}`;
  return `${intestazione}\n${dove}${scritto}`;
}
