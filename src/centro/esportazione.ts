/**
 * Una conversazione esportata in Markdown: i messaggi del proprietario, le risposte di Claude e,
 * in una riga, le azioni. Ciò che una modifica ha tolto dalla conversazione non c'è, come nella chat.
 */

import { dettaglioDi, etichettaDi } from "../protocollo/azioni-in-parole.ts";
import type { EventoArchiviato } from "../protocollo/eventi.ts";

interface Blocco {
  /** Il messaggio del proprietario che apre questo blocco, se lo è: da lì si può riavvolgere. */
  idMessaggio?: string;
  testo: string;
}

function ora(quando: string): string {
  const data = new Date(quando);
  return Number.isNaN(data.getTime()) ? "" : data.toISOString().slice(0, 16).replace("T", " ");
}

export function esportaInMarkdown(titolo: string, storia: readonly EventoArchiviato[], adesso: Date = new Date()): string {
  const blocchi: Blocco[] = [];
  for (const { quando, evento } of storia) {
    switch (evento.tipo) {
      case "messaggio-proprietario": {
        const file = evento.file === undefined || evento.file.length === 0 ? "" : `\n\n_Allegati: ${evento.file.join(", ")}_`;
        blocchi.push({ idMessaggio: evento.id, testo: `### Tu · ${ora(quando)}\n\n${evento.testo}${file}` });
        break;
      }
      case "testo-concluso":
        if (evento.testo.trim() !== "") blocchi.push({ testo: `### Claude\n\n${evento.testo}` });
        break;
      case "azione-iniziata": {
        const dettaglio = dettaglioDi(evento.strumento, evento.ingresso);
        blocchi.push({ testo: `> ${etichettaDi(evento.strumento)}${dettaglio === "" ? "" : `: \`${dettaglio.replace(/`/g, "'")}\``}` });
        break;
      }
      case "riavvolto": {
        const da = blocchi.findIndex((blocco) => blocco.idMessaggio === evento.idMessaggio);
        if (da >= 0) blocchi.splice(da);
        break;
      }
      default:
        break;
    }
  }
  const testa = `# ${titolo}\n\n_Esportata da Shinka il ${ora(adesso.toISOString())} (UTC)._`;
  return `${[testa, ...blocchi.map((blocco) => blocco.testo)].join("\n\n")}\n`;
}

/** Un nome di file sicuro per l'esportazione, dal titolo. */
export function nomeDellEsportazione(titolo: string, adesso: Date = new Date()): string {
  const pulito =
    titolo
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conversazione";
  return `${pulito}-${adesso.toISOString().slice(0, 10)}.md`;
}
