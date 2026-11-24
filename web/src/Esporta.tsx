/** Il menu Esporta, un'icona nella testata della chat: la conversazione in Markdown, oppure stampata o salvata in PDF. */

import type { ReactNode } from "react";

export function MenuEsporta({ base }: { base: string }): ReactNode {
  return (
    <details className="menu-esporta">
      <summary aria-label="Esporta la conversazione" title="Esporta la conversazione">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14.5V16h12v-1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="voci-esporta">
        <a href={`${base}/esporta`} download>
          Scarica in Markdown
        </a>
        <button
          type="button"
          onClick={(evento) => {
            evento.currentTarget.closest("details")?.removeAttribute("open");
            // Il browser stampa la conversazione intera; da lì si può anche salvare in PDF.
            setTimeout(() => window.print(), 50);
          }}
        >
          Stampa o salva in PDF
        </button>
      </div>
    </details>
  );
}
