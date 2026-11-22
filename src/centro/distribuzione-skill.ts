/**
 * Porta le skill di Shinka in ogni ambiente: a ogni nodo appena viene accolto, e a tutti
 * quelli attivi ogni volta che una skill nasce, cambia o viene annullata.
 */

import type { RegistroAmbienti } from "./ambienti.ts";
import type { RegistroSkill } from "./skill.ts";

export function distribuisciSkill(
  skill: RegistroSkill,
  ambienti: RegistroAmbienti,
  /** Chiamata a ogni cambiamento: per far rileggere le skill alle conversazioni dell'ambiente del centro. */
  alCambio?: () => void,
): void {
  const manda = (idAmbiente: string): void => {
    ambienti.inviaAlNodo(idAmbiente, { tipo: "skill", skill: skill.daDistribuire() });
  };
  ambienti.iscriviCollegamenti(manda);
  skill.ascolta(() => {
    for (const idAmbiente of ambienti.collegati()) manda(idAmbiente);
    alCambio?.();
  });
}
