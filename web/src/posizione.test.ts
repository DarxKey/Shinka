import assert from "node:assert/strict";
import { test } from "node:test";
import { chiediPosizione, dalBrowser, perchéNo, SERVE_HTTPS } from "./posizione.ts";

test("la posizione del browser arriva al centro con la precisione in metri e la sua ora", () => {
  assert.deepEqual(
    dalBrowser({ coords: { latitude: 35.68963, longitude: 139.6917, accuracy: 18.4 }, timestamp: Date.parse("2026-11-13T05:32:10Z") }),
    { lat: 35.68963, lon: 139.6917, precisioneM: 18, quando: "2026-11-13T05:32:10.000Z" },
  );
  assert.equal(dalBrowser({ coords: { latitude: 1, longitude: 2, accuracy: Number.NaN }, timestamp: 1 }).precisioneM, undefined);
});

test("se il browser non la dà, il proprietario sa perché e che cosa fare", async () => {
  assert.match(perchéNo(1), /permesso/);
  assert.match(perchéNo(3), /in tempo/);
  assert.match(perchéNo(2), /\/posizione/);
  // In una pagina che non è HTTPS non si chiede nemmeno.
  await assert.rejects(chiediPosizione({ isSecureContext: false, navigator: {} as Navigator }), { message: SERVE_HTTPS });

  const conPermesso = {
    isSecureContext: true,
    navigator: {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 45.4642, longitude: 9.19, accuracy: 30 }, timestamp: Date.parse("2026-11-13T09:00:00Z") } as GeolocationPosition),
      },
    } as unknown as Navigator,
  };
  assert.deepEqual(await chiediPosizione(conPermesso), { lat: 45.4642, lon: 9.19, precisioneM: 30, quando: "2026-11-13T09:00:00.000Z" });

  const negato = {
    isSecureContext: true,
    navigator: { geolocation: { getCurrentPosition: (_ok: PositionCallback, no: PositionErrorCallback) => no({ code: 1 } as GeolocationPositionError) } } as unknown as Navigator,
  };
  await assert.rejects(chiediPosizione(negato), /permesso/);
});
