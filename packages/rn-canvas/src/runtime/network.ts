/**
 * Coupe le réseau d'un écran du canevas : sans session, les appels à l'API de l'app échouent de toute
 * façon (401) et sollicitent pour rien un back de dev ou de préprod. Le bundle, Metro et localhost
 * restent joignables. Désactivable avec `network: 'allow'` dans rn-canvas.config.tsx.
 */
let installed = false;

function isLocal(url: string): boolean {
  try {
    const { hostname, origin } = new URL(url, window.location.href);
    return origin === window.location.origin || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
  } catch {
    return true;
  }
}

export function blockNetwork(storyId: string) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let blocked = 0;
  const report = (url: string) => {
    blocked += 1;
    window.parent?.postMessage({ source: 'rn-canvas', type: 'network-blocked', story: storyId, url, count: blocked }, '*');
  };
  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isLocal(url)) return nativeFetch(input, init);
      report(url);
      return Promise.resolve(new Response(JSON.stringify({ error: 'rn-canvas : réseau coupé dans le canevas' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }) as typeof window.fetch;
  }
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (this: XMLHttpRequest & { __rncBlocked?: string }, method: string, url: string | URL, ...rest: unknown[]) {
      const href = String(url);
      this.__rncBlocked = isLocal(href) ? undefined : href;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (open as any).call(this, method, this.__rncBlocked ? 'data:application/json,{}' : url, ...rest);
    } as typeof XHR.prototype.open;
    XHR.prototype.send = function (this: XMLHttpRequest & { __rncBlocked?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
      if (!this.__rncBlocked) return send.call(this, body);
      report(this.__rncBlocked);
      // Échec réseau immédiat, comme hors ligne : les clients HTTP (axios…) le gèrent déjà.
      setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
    };
  }
  console.info(`[rn-canvas] Réseau coupé pour cet écran (sauf localhost). Pour l'autoriser : network: 'allow' dans rn-canvas.config.tsx.`);
}
