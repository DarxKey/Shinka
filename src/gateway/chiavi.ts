/**
 * La consegna delle chiavi a un'estensione che sta per partire. È l'unico punto da cui il valore
 * di una voce del vault esce dal gateway, per scelta del proprietario: riguarda solo le voci
 * inserite come chiave di quell'estensione, per l'ambiente scritto accanto. Ogni richiesta finisce
 * nel registro, consegnata o rifiutata, senza il valore.
 */

import { difettoDelNome, nomeDiChiaveValido } from "../protocollo/estensioni.ts";
import type { EsitoChiavi, RichiestaChiavi, VoceRegistro } from "../protocollo/vault.ts";
import type { Registro } from "./registro.ts";
import { UsoRifiutato, VaultChiuso, type Vault } from "./vault.ts";

/** Non lancia mai: l'esito dice com'è andata. */
export async function consegnaChiavi(vault: Vault, registro: Registro, richiesta: RichiestaChiavi, ora: number = Date.now()): Promise<EsitoChiavi> {
  const estensione = richiesta.estensione.trim();
  const ambiente = richiesta.ambiente.trim();
  const chiavi = [...new Set(richiesta.chiavi.map((chiave) => chiave.trim()))];
  const voce = (credenziale: string, esito: VoceRegistro["esito"], motivo?: string): VoceRegistro => ({
    quando: new Date(ora).toISOString(),
    credenziale,
    host: `ambiente ${ambiente}`,
    conversazione: `Estensione "${estensione}"`,
    comando: `Consegna ${chiavi.length === 1 ? "della chiave" : "delle chiavi"} ${chiavi.join(", ")} al programma dell'estensione`,
    esito,
    ...(motivo === undefined ? {} : { motivo }),
  });
  const rifiuta = async (motivo: string): Promise<EsitoChiavi> => {
    await registro.annota(voce("", "rifiutato", motivo));
    return { esito: "rifiutato", motivo };
  };
  if (difettoDelNome(estensione) !== undefined || ambiente === "" || chiavi.length === 0 || chiavi.some((chiave) => !nomeDiChiaveValido(chiave))) {
    return rifiuta("La richiesta non dice bene quale estensione, quale ambiente o quali chiavi.");
  }
  try {
    const { valori, credenziali } = vault.perEstensione(estensione, ambiente, chiavi);
    await vault.annotaConsegna(credenziali, ora);
    await registro.annota(voce(credenziali.join(", "), "eseguito"));
    return { esito: "consegnate", valori };
  } catch (errore) {
    if (errore instanceof VaultChiuso || errore instanceof UsoRifiutato) return rifiuta(errore.message);
    throw errore;
  }
}
