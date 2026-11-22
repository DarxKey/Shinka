/**
 * Il diff di un turno di Codex (`turn/diff/updated`): un diff unificato nel formato di git, dal
 * file com'era la prima volta che il turno lo ha toccato a com'è adesso. Shinka non vede i file
 * prima che Codex li cambi, perché l'app-server li cambia senza aspettarla: la versione di prima
 * la ricostruisce a fine turno da quella di adesso, togliendo il diff al contrario.
 */

export interface RigaDiPezzo {
  tipo: " " | "+" | "-";
  testo: string;
}

export interface PezzoDelDiff {
  /** La riga, contata da 1, a cui comincia il pezzo nel file di adesso. */
  inizioDopo: number;
  righe: RigaDiPezzo[];
}

export interface FileDelDiff {
  /** Il percorso come lo scrive il diff, senza a/ e b/: relativo alla cartella di Codex o al suo repository. */
  percorso: string;
  /** Il file prima non c'era. */
  nuovo: boolean;
  /** Il file adesso non c'è più. */
  tolto: boolean;
  /** L'ultima riga del file di prima, o di quello di adesso, non finiva con un a capo. */
  senzaACapoPrima: boolean;
  senzaACapoDopo: boolean;
  pezzi: PezzoDelDiff[];
}

/** Un percorso del diff senza il prefisso a/ o b/; null per /dev/null. */
function percorsoDi(riga: string): string | null {
  const scritto = riga.slice(4).replace(/\t.*$/, "");
  if (scritto === "/dev/null") return null;
  const tolto = /^"(.*)"$/.exec(scritto)?.[1] ?? scritto;
  return tolto.replace(/^[ab]\//, "");
}

/** Legge il diff di un turno, file per file. Ciò che non capisce lo salta. */
export function leggiDiffDelTurno(diff: string): FileDelDiff[] {
  const file: FileDelDiff[] = [];
  let corrente: FileDelDiff | undefined;
  let pezzo: PezzoDelDiff | undefined;
  let ultimo: " " | "+" | "-" | undefined;
  const righe = diff.split("\n");
  if (righe.at(-1) === "") righe.pop();
  for (const riga of righe) {
    if (riga.startsWith("diff --git ")) {
      corrente = { percorso: "", nuovo: false, tolto: false, senzaACapoPrima: false, senzaACapoDopo: false, pezzi: [] };
      file.push(corrente);
      pezzo = undefined;
      continue;
    }
    if (corrente === undefined) continue;
    if (pezzo === undefined) {
      if (riga.startsWith("--- ")) {
        const prima = percorsoDi(riga);
        if (prima === null) corrente.nuovo = true;
        else corrente.percorso = prima;
      } else if (riga.startsWith("+++ ")) {
        const dopo = percorsoDi(riga);
        if (dopo === null) corrente.tolto = true;
        else corrente.percorso = dopo;
      }
    }
    const intestazione = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(riga);
    if (intestazione !== null) {
      const inizio = Number(intestazione[1]);
      const quante = intestazione[2] === undefined ? 1 : Number(intestazione[2]);
      // Un pezzo senza righe nel file di adesso comincia dopo la riga indicata.
      pezzo = { inizioDopo: quante === 0 ? inizio + 1 : inizio, righe: [] };
      corrente.pezzi.push(pezzo);
      ultimo = undefined;
      continue;
    }
    if (pezzo === undefined) continue;
    if (riga.startsWith("\\")) {
      // "\ No newline at end of file": vale per la riga appena letta.
      if (ultimo === "-" || ultimo === " ") corrente.senzaACapoPrima = true;
      if (ultimo === "+" || ultimo === " ") corrente.senzaACapoDopo = true;
      continue;
    }
    const tipo = riga[0];
    if (tipo === " " || tipo === "+" || tipo === "-") {
      pezzo.righe.push({ tipo, testo: riga.slice(1) });
      ultimo = tipo;
    } else if (riga === "") {
      // Alcuni diff tolgono lo spazio delle righe vuote di contesto.
      pezzo.righe.push({ tipo: " ", testo: "" });
      ultimo = " ";
    }
  }
  return file.filter((voce) => voce.percorso !== "");
}

function righeDel(testo: string): { righe: string[]; aCapoFinale: boolean } {
  if (testo === "") return { righe: [], aCapoFinale: true };
  const aCapoFinale = testo.endsWith("\n");
  const righe = (aCapoFinale ? testo.slice(0, -1) : testo).split("\n");
  return { righe, aCapoFinale };
}

/**
 * Il file com'era prima del turno, dato com'è adesso: null se prima non c'era. Undefined se il
 * diff non torna con il file di adesso, per esempio perché un comando lo ha cambiato ancora.
 */
export function versionePrima(adesso: string | null, voce: FileDelDiff): string | null | undefined {
  if (voce.nuovo) return adesso === null ? undefined : null;
  if (voce.tolto) {
    if (adesso !== null) return undefined;
    const righe = voce.pezzi.flatMap((pezzo) => pezzo.righe.filter((riga) => riga.tipo !== "+").map((riga) => riga.testo));
    return righe.length === 0 ? "" : `${righe.join("\n")}${voce.senzaACapoPrima ? "" : "\n"}`;
  }
  if (adesso === null) return undefined;
  const { righe, aCapoFinale } = righeDel(adesso);
  const risultato: string[] = [];
  let posizione = 0;
  for (const pezzo of voce.pezzi) {
    const inizio = pezzo.inizioDopo - 1;
    if (inizio < posizione || inizio > righe.length) return undefined;
    risultato.push(...righe.slice(posizione, inizio));
    posizione = inizio;
    for (const riga of pezzo.righe) {
      if (riga.tipo === "-") {
        risultato.push(riga.testo);
        continue;
      }
      if (righe[posizione] !== riga.testo) return undefined;
      if (riga.tipo === " ") risultato.push(riga.testo);
      posizione++;
    }
  }
  risultato.push(...righe.slice(posizione));
  if (risultato.length === 0) return "";
  // L'a capo finale di prima: quello di adesso, salvo quando il diff dice che cambiava.
  const aCapoPrima = voce.senzaACapoPrima ? false : voce.senzaACapoDopo ? true : aCapoFinale;
  return `${risultato.join("\n")}${aCapoPrima ? "\n" : ""}`;
}

/**
 * Il file del disco a cui si riferisce un percorso del diff, tra quelli che le modifiche del turno
 * hanno toccato (assoluti): quello che finisce con il percorso del diff.
 */
export function fileToccato(percorso: string, toccati: Iterable<string>): string | undefined {
  const cercato = percorso.split("\\").join("/");
  let trovato: string | undefined;
  for (const assoluto of toccati) {
    const normale = assoluto.split("\\").join("/");
    if (normale === cercato || normale.endsWith(`/${cercato}`)) {
      // Se più file finiscono allo stesso modo, il diff è ambiguo: meglio non indovinare.
      if (trovato !== undefined && trovato !== assoluto) return undefined;
      trovato = assoluto;
    }
  }
  return trovato;
}
