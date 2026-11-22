import assert from "node:assert/strict";
import { test } from "node:test";
import { campoDiCarta, divietoFisso, divietoNelSito } from "./divieti.ts";

test("cambiare una password e cancellare un account sono divieti fissi", () => {
  for (const comando of [
    "passwd mario",
    "sudo passwd root",
    "echo 'root:nuova' | chpasswd",
    "cd /tmp && /usr/bin/passwd -d ospite",
    "sudo -n usermod --password xyz mario",
    "smbpasswd -a mario",
    "Set-LocalUser -Name mario -Password $p",
  ]) {
    assert.equal(divietoFisso(comando), "cambiare una password", comando);
  }
  for (const comando of ["userdel -r ospite", "sudo deluser ospite", "ls; userdel ospite", "net user ospite /delete", "Remove-LocalUser ospite"]) {
    assert.equal(divietoFisso(comando), "cancellare un account", comando);
  }
});

test("un comando che solo nomina quelle parole passa", () => {
  for (const comando of [
    "cat /etc/passwd",
    "grep mario /etc/passwd | cut -d: -f1",
    "ls -l /usr/bin/passwd",
    "docker ps",
    "usermod -aG docker mario",
    "echo passwd",
    "uptime && df -h",
  ]) {
    assert.equal(divietoFisso(comando), undefined, comando);
  }
});

test("nei siti: i bottoni che pagano, cambiano una password o cancellano un account", () => {
  for (const parole of [
    "Paga ora",
    "Paga",
    "Pay now",
    "Pay with card",
    "Acquista ora",
    "Compra subito",
    "Conferma l'ordine",
    "Conferma ordine",
    "Completa l'acquisto",
    "Procedi al pagamento",
    "Vai alla cassa",
    "Place your order",
    "Proceed to checkout",
    "Conferma il bonifico",
    "Esegui bonifico",
    "Send money",
  ]) {
    assert.equal(divietoNelSito(parole), "pagare", parole);
  }
  for (const parole of ["Cambia password", "Modifica la password", "Reimposta password", "Change your password", "Password dimenticata?", "Forgot password?"]) {
    assert.equal(divietoNelSito(parole), "cambiare una password", parole);
  }
  for (const parole of ["Elimina account", "Elimina il mio account", "Cancella l'account", "Chiudi il conto", "Delete my account", "Disattiva profilo"]) {
    assert.equal(divietoNelSito(parole), "cancellare un account", parole);
  }
});

test("nei siti: ciò che solo nomina quelle parole passa", () => {
  for (const parole of [
    "Entra",
    "Accedi",
    "Cerca",
    "Pagamenti",
    "Storico dei pagamenti",
    "Metodi di pagamento",
    "I miei ordini",
    "Scarica la fattura",
    "Aggiungi al carrello",
    "Dettagli dell'ordine",
    "Mostra password",
    "Esci",
    "Chiudi",
    "Elimina filtro",
    "Conferma",
    "",
  ]) {
    assert.equal(divietoNelSito(parole), undefined, parole);
  }
});

test("un campo che vuole i dati di una carta si riconosce dal nome", () => {
  for (const descrizione of ["cardnumber cc-number", "Numero della carta", "card-number", "cvv", "Codice di sicurezza", "cc-csc", "security_code"]) {
    assert.ok(campoDiCarta(descrizione), descrizione);
  }
  for (const descrizione of ["utente username", "email", "cerca", "note", "discard", "numero di telefono", "carta fedeltà"]) {
    assert.ok(!campoDiCarta(descrizione), descrizione);
  }
});
