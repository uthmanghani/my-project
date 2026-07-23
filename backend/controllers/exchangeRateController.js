// Server-side proxy for live exchange rates. Centralizing the fetch here
// (rather than calling the provider directly from the browser) means:
//  - the provider URL/key isn't exposed to every client
//  - all users share one cache instead of each hitting the provider
//  - we can swap providers later without touching the frontend
//
// NOTE: this cache is in-memory (per server process). On Render's free tier
// (single instance, resets on redeploy) that's fine. If this ever runs on
// multiple instances, move `cache` into Mongo/Redis so instances agree.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PROVIDER_URL = 'https://open.er-api.com/v6/latest/NGN';
const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'EUR']; // keep in sync with frontend CURRENCIES

let cache = {
  rates: null,        // { USD: <NGN per 1 USD>, GBP: ..., EUR: ... }
  fetchedAt: null,     // ISO string
  status: 'never_fetched' // 'live' | 'stale' | 'never_fetched'
};

async function fetchFromProvider() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(PROVIDER_URL, { signal: controller.signal });
    if (!res.ok) throw new Error('Rate provider returned HTTP ' + res.status);

    const data = await res.json();
    if (!data || data.result !== 'success' || !data.rates || typeof data.rates !== 'object') {
      throw new Error('Rate provider returned an invalid response');
    }

    // Provider direction is NGN→CUR (e.g. rates.USD ≈ 0.00063), so invert to
    // get NGN-per-CUR, which is what invoices need to convert amounts to NGN.
    const nextRates = {};
    SUPPORTED_CURRENCIES.forEach(cur => {
      const raw = Number(data.rates[cur]);
      if (!Number.isFinite(raw) || raw <= 0) return;
      const inverted = 1 / raw;
      if (Number.isFinite(inverted) && inverted > 0) nextRates[cur] = inverted;
    });

    if (Object.keys(nextRates).length === 0) throw new Error('No valid rates in provider response');

    return nextRates;
  } finally {
    clearTimeout(timeoutId);
  }
}

// GET /api/exchange-rates?force=true
exports.getRates = async (req, res) => {
  const force = req.query.force === 'true' || req.query.force === '1';
  const isFresh = cache.fetchedAt && (Date.now() - new Date(cache.fetchedAt).getTime()) < CACHE_TTL_MS;

  if (!force && isFresh) {
    return res.json({ rates: cache.rates, fetchedAt: cache.fetchedAt, status: cache.status, source: 'cache' });
  }

  try {
    const rates = await fetchFromProvider();
    cache = { rates, fetchedAt: new Date().toISOString(), status: 'live' };
    return res.json({ rates: cache.rates, fetchedAt: cache.fetchedAt, status: cache.status, source: 'live' });
  } catch (err) {
    console.warn('Exchange rate refresh failed:', err.message);

    if (cache.rates) {
      // Serve the last known-good rates rather than an error, so the frontend
      // never has to fall back to blank/zeroed exchange rates.
      cache.status = 'stale';
      return res.json({ rates: cache.rates, fetchedAt: cache.fetchedAt, status: 'stale', source: 'cache_after_failed_refresh' });
    }

    return res.status(502).json({ error: 'Could not fetch exchange rates and no cached rates are available yet.' });
  }
};
