// Every route Express has registered, as { method, path }, walking nested routers (Bug #423, AB#956).
export function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods).map((m) => ({ method: m.toUpperCase(), path: prefix + layer.route.path }));
    }
    if (layer.name === "router" && layer.handle?.stack) {
      const mount = (layer.regexp.source.match(/^\^\\\/([^\\?]+)/) || [])[1];
      return routes(layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, "/")}` : prefix);
    }
    return [];
  });
}

/** A path Express will route for a pattern: each :param filled, :accountId with the account given. */
export const fill = (path, accountId = "acc-not-mine") => path.replace(/:accountId/g, accountId).replace(/:[A-Za-z]+/g, "x");
