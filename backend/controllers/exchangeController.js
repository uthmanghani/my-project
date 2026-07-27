const ExchangeRateCache = require('../models/ExchangeRateCache');

// open.er-api.com is free, requires no API key, and returns rates FROM the
// base currency TO everything else. We fetch with NGN as the base, then
// invert each rate, because the app wants "1 USD = how many NGN" while the
// provider gives "1 NGN = how many USD".
const PROVIDER_URL = 'https://open.er-api.com/v6/latest/NGN';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'];

// In-memory cache — avoids hitting Mongo on every dashboard/invoice load
// while the server process is warm. Reset on every cold start, which is
// fine because we fall back to the DB copy in that case (see below).
let memoryCache = null; // { rates, fetchedAt: Date }

async function fetchFromProvider() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(PROVIDER_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Exchange rate provider responded with HTTP ${response.status}`);
    }
    const json = await response.json();
    if (json.result !== 'success' || !json.rates) {
      throw new Error('Exchange rate provider response did not include rates');
    }

    const rates = {};
    for (const cur of SUPPORTED_CURRENCIES) {
      const ngnToCur = Number(json.rates[cur]);
      if (Number.isFinite(ngnToCur) && ngnToCur > 0) {
        // Invert: 1 NGN = X USD  →  1 USD = 1/X NGN
        rates[cur] = Math.round((1 / ngnToCur) * 100) / 100;
      }
    }
    if (Object.keys(rates).length === 0) {
      throw new Error('None of the supported currencies were present in the provider response');
    }

    return { rates, fetchedAt: new Date() };
  } finally {
    clearTimeout(timeout);
  }
}

// GET /api/exchange-rates?force=true
exports.getRates = async (req, res) => {
  const force = req.query.force === 'true';

  try {
    // 1. Fresh in-memory cache — fastest path, hit on almost every request
    //    once the server has been warm for a while.
    if (!force && memoryCache && (Date.now() - memoryCache.fetchedAt.getTime()) < CACHE_TTL_MS) {
      return res.json({
        rates: memoryCache.rates,
        fetchedAt: memoryCache.fetchedAt.toISOString(),
        status: 'live'
      });
    }

    // 2. Cache expired (or force refresh requested) — try the provider.
    try {
      const fresh = await fetchFromProvider();
      memoryCache = fresh;

      // Persist so a cold start (Render's free tier sleeps after inactivity)
      // still has a recent rate instead of failing outright on next boot.
      await ExchangeRateCache.findByIdAndUpdate(
        'singleton',
        { rates: fresh.rates, fetchedAt: fresh.fetchedAt },
        { upsert: true, new: true }
      );

      return res.json({
        rates: fresh.rates,
        fetchedAt: fresh.fetchedAt.toISOString(),
        status: 'live'
      });
    } catch (providerErr) {
      console.warn('Exchange rate provider fetch failed:', providerErr.message);

      // 3. Provider failed — serve whatever is cached, even if stale.
      //    A day-old FX rate is still far more useful than none at all.
      if (memoryCache) {
        return res.json({
          rates: memoryCache.rates,
          fetchedAt: memoryCache.fetchedAt.toISOString(),
          status: 'stale'
        });
      }

      const dbCache = await ExchangeRateCache.findById('singleton');
      if (dbCache) {
        memoryCache = { rates: dbCache.rates, fetchedAt: dbCache.fetchedAt };
        return res.json({
          rates: dbCache.rates,
          fetchedAt: dbCache.fetchedAt.toISOString(),
          status: 'stale'
        });
      }

      // 4. Genuinely nothing to serve — provider is down AND this is the
      //    very first request this deployment has ever made.
      return res.status(503).json({
        error: 'Exchange rates are temporarily unavailable and no cached rates exist yet. Try again shortly.'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
