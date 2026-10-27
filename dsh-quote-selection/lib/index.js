/**
 * Host half of dsh-quote-selection.
 *
 * The feature is a browser Surface; this entry only keeps the package a real
 * Cordis entry so the Loader composes its client bundle, plus one health route.
 */
export const name = "dsh-quote-selection";

export function apply(ctx) {
  ctx.inject(["webServer"], (child) => {
    child.effect(
      () =>
        child.webServer.register({
          kind: "exact",
          path: "/quote-selection/ping",
          handler: (_request, response) => {
            response.writeHead(200, {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
            });
            response.end(JSON.stringify({ ok: true, plugin: "dsh-quote-selection" }));
          },
        }),
      "quote-selection: ping route",
    );
  });
}
