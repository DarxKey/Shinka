// Il service worker di Shinka: serve solo alle notifiche dell'app. Non tiene copie delle pagine e
// non si mette in mezzo alle richieste: l'interfaccia arriva sempre dal centro.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

// Arriva un avviso dal centro, cifrato per questo dispositivo: lo si mostra sempre.
self.addEventListener("push", (evento) => {
  let avviso = {};
  try {
    avviso = evento.data === null ? {} : evento.data.json();
  } catch {
    avviso = { corpo: evento.data === null ? "" : evento.data.text() };
  }
  const vai = typeof avviso.vai === "string" ? avviso.vai : "/";
  const lavori = [
    self.registration.showNotification(typeof avviso.titolo === "string" && avviso.titolo !== "" ? avviso.titolo : "Shinka", {
      body: typeof avviso.corpo === "string" ? avviso.corpo : "",
      icon: "/icona-192.png",
      badge: "/icona-192.png",
      // Un avviso nuovo della stessa conversazione prende il posto di quello di prima.
      tag: vai,
      data: { vai },
    }),
  ];
  // Il numero sull'icona dell'app: quante conversazioni aspettano il proprietario.
  if (typeof avviso.distintivo === "number" && typeof self.navigator.setAppBadge === "function") {
    lavori.push(self.navigator.setAppBadge(avviso.distintivo).catch(() => {}));
  }
  evento.waitUntil(Promise.all(lavori));
});

// Un tocco sulla notifica porta alla conversazione di cui parla: nella finestra aperta, se c'è.
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const vai = evento.notification.data && typeof evento.notification.data.vai === "string" ? evento.notification.data.vai : "/";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((finestre) => {
      const aperta = finestre[0];
      if (aperta === undefined) return self.clients.openWindow(`/#${vai}`);
      aperta.postMessage({ tipo: "vai", vai });
      return aperta.focus();
    }),
  );
});
