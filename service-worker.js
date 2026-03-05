const CACHE_NAME = "daily-tasks-checker-cache-v2";
const NETWORK_WAIT_MS = 3000;
const BACKGROUND_RETRIES = 3;
const BACKGROUND_RETRY_WINDOW_MS = 10000;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isAppShellAsset = APP_SHELL.some((asset) => requestUrl.pathname.endsWith(asset.replace("./", "/")));

  if (!isSameOrigin || !isAppShellAsset) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }

  event.respondWith(networkWithFastFallback(event.request, event));
});

async function networkWithFastFallback(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  try {
    const networkResponse = await fetchWithTimeout(request, NETWORK_WAIT_MS);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    if (cachedResponse) {
      event.waitUntil(refreshInBackground(request, cache));
      return cachedResponse;
    }

    throw new Error("Network request failed and no cached response found.");
  }
}

async function refreshInBackground(request, cache) {
  const deadline = Date.now() + BACKGROUND_RETRY_WINDOW_MS;

  for (let attempt = 1; attempt <= BACKGROUND_RETRIES; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return;
    }

    const timeoutMs = Math.min(NETWORK_WAIT_MS, remaining);

    try {
      const response = await fetchWithTimeout(request, timeoutMs);
      cache.put(request, response.clone());
      return;
    } catch {
      const delayMs = Math.min(500 * attempt, Math.max(deadline - Date.now(), 0));
      if (attempt < BACKGROUND_RETRIES && delayMs > 0) {
        await delay(delayMs);
      }
    }
  }
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
