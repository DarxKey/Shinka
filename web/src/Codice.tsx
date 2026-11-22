/**
 * Ciò che nelle risposte di Claude non è solo testo: i blocchi di codice, con il colore della
 * sintassi, il nome del linguaggio e il pulsante Copia, e i diagrammi Mermaid. Le librerie che
 * servono si caricano la prima volta che servono: aprire una chat senza codice non le scarica.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { useAspetto } from "./aspetto.ts";
import { copia } from "./copia.ts";

/** Il pulsante Copia: per un blocco di codice o per una risposta intera. */
export function PulsanteCopia({ testo, etichetta = "Copia" }: { testo: string; etichetta?: string }): ReactNode {
  const [fatto, setFatto] = useState<"copiato" | "non-riuscito">();
  useEffect(() => {
    if (fatto === undefined) return;
    const sveglia = setTimeout(() => setFatto(undefined), 1800);
    return () => clearTimeout(sveglia);
  }, [fatto]);
  return (
    <button
      type="button"
      className="copia"
      aria-label={etichetta}
      title={etichetta}
      onClick={() => void copia(testo).then((riuscito) => setFatto(riuscito ? "copiato" : "non-riuscito"))}
    >
      {fatto === "copiato" ? "Copiato" : fatto === "non-riuscito" ? "Non copiato" : "Copia"}
    </button>
  );
}

/** Un blocco di codice: il linguaggio, il pulsante Copia, e il codice con i suoi colori quando sono pronti. */
export function BloccoCodice({ codice, linguaggio }: { codice: string; linguaggio: string }): ReactNode {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    let valido = true;
    setHtml(undefined);
    void import("./evidenzia.ts").then(({ evidenzia }) => {
      if (valido) setHtml(evidenzia(codice, linguaggio));
    });
    return () => {
      valido = false;
    };
  }, [codice, linguaggio]);
  if (linguaggio === "mermaid") return <Diagramma codice={codice} />;
  return (
    <div className="blocco-codice">
      <div className="testa-codice">
        <span className="linguaggio">{linguaggio === "" ? "codice" : linguaggio}</span>
        <PulsanteCopia testo={codice} etichetta="Copia il codice" />
      </div>
      <pre>
        {html === undefined ? <code>{codice}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
    </div>
  );
}

/** Un diagramma Mermaid, disegnato dalla sua libreria; se non si disegna, resta il codice con il perché. */
function Diagramma({ codice }: { codice: string }): ReactNode {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { tema } = useAspetto();
  const [svg, setSvg] = useState<string>();
  const [errore, setErrore] = useState<string>();
  useEffect(() => {
    let valido = true;
    const scuro = tema === "scuro" || (tema === "automatico" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        // "strict": niente script né collegamenti attivi nel disegno.
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: scuro ? "dark" : "neutral", fontFamily: "inherit" });
        const { svg: disegnato } = await mermaid.render(id, codice);
        if (valido) setSvg(disegnato);
      })
      .catch((causa: unknown) => {
        if (valido) setErrore(causa instanceof Error ? causa.message : String(causa));
      });
    return () => {
      valido = false;
    };
  }, [codice, id, tema]);
  if (svg !== undefined) {
    return (
      <div className="blocco-codice diagramma">
        <div className="testa-codice">
          <span className="linguaggio">diagramma</span>
          <PulsanteCopia testo={codice} etichetta="Copia il codice del diagramma" />
        </div>
        <div className="disegno" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    );
  }
  return (
    <div className="blocco-codice">
      <div className="testa-codice">
        <span className="linguaggio">mermaid</span>
        <PulsanteCopia testo={codice} etichetta="Copia il codice" />
      </div>
      <pre>
        <code>{codice}</code>
      </pre>
      {errore !== undefined && <p className="tenue errore-diagramma">Il diagramma non si è potuto disegnare: {errore.split("\n")[0]}</p>}
    </div>
  );
}
