/**
 * Host half of dsh-balance-badge.
 *
 * The badge itself is a browser-side Surface; this half only keeps the package a
 * real Cordis entry so the Loader composes its client bundle, and exposes one
 * public health route used to verify that the plugin mounted.
 */
export const name = "dsh-balance-badge";

export function apply(ctx) {
  ctx.inject(["webServer"], (child) => {
    child.effect(
      () =>
        child.webServer.register({
          kind: "exact",
          path: "/balance-badge/ping",
          handler: (_request, response) => {
            response.writeHead(200, {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
            });
            response.end(JSON.stringify({ ok: true, plugin: "dsh-balance-badge" }));
          },
        }),
      "balance-badge: ping route",
    );
  });
}
