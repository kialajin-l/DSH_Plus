/**
 * Host half of dsh-model-picker.
 *
 * The picker is a browser-side Surface replacing the composer model seat; this
 * half only keeps the package a real Cordis entry so the Loader composes its
 * client bundle, and exposes one public health route used to verify mounting.
 */
export const name = "dsh-model-picker";

export function apply(ctx) {
  ctx.inject(["webServer"], (child) => {
    child.effect(
      () =>
        child.webServer.register({
          kind: "exact",
          path: "/model-picker/ping",
          handler: (_request, response) => {
            response.writeHead(200, {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
            });
            response.end(JSON.stringify({ ok: true, plugin: "dsh-model-picker" }));
          },
        }),
      "model-picker: ping route",
    );
  });
}
