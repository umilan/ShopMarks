// Reads product data out of a Document. It runs in three places: injected into
// the active tab, in the dashboard against re-fetched pages, and in
// tests/extractor.test.html. That is why it is a dependency-free classic script.
(() => {
  const CURRENCY_SYMBOLS = [
    ['€', 'EUR'], ['Kč', 'CZK'], ['£', 'GBP'], ['zł', 'PLN'], ['Ft', 'HUF'], ['¥', 'JPY'], ['$', 'USD'],
  ];
  const CURRENCY_CODE = /\b(EUR|USD|GBP|CZK|PLN|HUF|CHF|SEK|NOK|DKK|RON|BGN|JPY|CAD|AUD)\b/i;
  // Grouped thousands ("1 299,90", "1.299,90", "1,299.90") or plain digits ("1299.90").
  const PRICE = /\d{1,3}(?:[\s'.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?/;
  const OLD_PRICE = /old|was|before|strike|original|rrp|list-?price|compare|crossed|previous|saving/i;
  const MAX_PRICE_CANDIDATES = 300;

  // `machine` is for structured data, where "19.990" means 19.99 and not 19 990.
  function parsePrice(raw, machine = false) {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
    if (typeof raw !== 'string') return null;
    if (machine && /^\s*\d+(\.\d+)?\s*$/.test(raw)) return Number(raw) || null;
    const match = raw.match(PRICE);
    if (!match) return null;
    const decimal = match[0].match(/[.,](\d{1,2})$/);
    const whole = (decimal ? match[0].slice(0, decimal.index) : match[0]).replace(/\D/g, '');
    const value = Number(decimal ? `${whole}.${decimal[1]}` : whole);
    return value > 0 ? value : null;
  }

  function detectCurrency(text) {
    if (typeof text !== 'string') return null;
    const code = text.match(CURRENCY_CODE);
    if (code) return code[1].toUpperCase();
    const symbol = CURRENCY_SYMBOLS.find(([sign]) => text.includes(sign));
    return symbol ? symbol[1] : null;
  }

  const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
  const list = (value) => [].concat(value ?? []);
  const isType = (node, type) => list(node['@type']).some((t) => typeof t === 'string' && t.split('/').pop() === type);

  function jsonLdNodes(doc) {
    const nodes = [];
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      nodes.push(value);
      walk(value['@graph']);
      walk(value.mainEntity);
    };
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(script.textContent));
      } catch {
        // Shops ship broken JSON-LD often enough that one bad block must not stop the rest.
      }
    }
    return nodes;
  }

  function jsonLdProduct(doc) {
    const nodes = jsonLdNodes(doc);
    const product = nodes.find((node) => isType(node, 'Product'));
    if (product) return product;
    const group = nodes.find((node) => isType(node, 'ProductGroup'));
    if (!group) return null;
    const variant = list(group.hasVariant).find((v) => v && typeof v === 'object') ?? {};
    return { ...group, ...variant, name: group.name ?? variant.name };
  }

  function readOffer(offers) {
    for (const offer of list(offers)) {
      if (!offer || typeof offer !== 'object') continue;
      const spec = list(offer.priceSpecification)[0];
      const price = parsePrice(offer.price ?? offer.lowPrice ?? spec?.price, true);
      if (price != null) return { price, currency: offer.priceCurrency ?? spec?.priceCurrency ?? null };
      const nested = readOffer(offer.offers);
      if (nested) return nested;
    }
    return null;
  }

  function imageUrls(value) {
    return list(value)
      .map((item) => (typeof item === 'string' ? item : item?.url ?? item?.contentUrl))
      .filter((item) => typeof item === 'string');
  }

  function meta(doc, ...keys) {
    for (const key of keys) {
      const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`);
      const content = el?.getAttribute('content')?.trim();
      if (content) return content;
    }
    return null;
  }

  function microdata(doc) {
    const scope = doc.querySelector('[itemtype*="schema.org/Product"]');
    if (!scope) return null;
    const prop = (name) => {
      const el = scope.querySelector(`[itemprop="${name}"]`);
      if (!el) return null;
      return clean(el.getAttribute('content') ?? el.getAttribute('src') ?? el.getAttribute('href') ?? el.textContent) || null;
    };
    return { name: prop('name'), image: prop('image'), price: prop('price'), currency: prop('priceCurrency') };
  }

  function priceText(el) {
    if (el.hasAttribute('content')) return el.getAttribute('content');
    const copy = el.cloneNode(true);
    copy.querySelectorAll('del, s, strike').forEach((old) => old.remove());
    return copy.textContent;
  }

  // Last resort for shops without structured data: the price shown in the
  // largest type is almost always the product's own. Needs layout, so it only
  // works on a live page, never on a re-fetched document.
  function visiblePrice(doc) {
    const view = doc.defaultView;
    if (!view) return null;
    const candidates = doc.querySelectorAll('[itemprop="price"], [data-price], [class*="price" i], [id*="price" i]');
    let best = null;
    for (const el of [...candidates].slice(0, MAX_PRICE_CANDIDATES)) {
      if (el.closest('del, s, strike') || OLD_PRICE.test(`${el.getAttribute('class')} ${el.id}`)) continue;
      if (el.textContent.length > 80) continue;
      const text = clean(priceText(el));
      const price = parsePrice(text);
      if (price == null) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const size = parseFloat(view.getComputedStyle(el).fontSize) || 0;
      if (!best || size > best.size) best = { price, currency: detectCurrency(text), size };
    }
    return best && { price: best.price, currency: best.currency };
  }

  // A page read as HTML (fetched, not open in a tab) has no loaded pictures, so their real
  // size is unknown: then only pictures that do not declare themselves small are taken.
  function pageImages(doc, fetched) {
    if (fetched) {
      const declared = (value) => (value == null ? Infinity : Number(value));
      const srcOf = (img) => img.getAttribute('src') || img.getAttribute('data-src');
      return [...doc.images]
        .filter((img) => srcOf(img) && declared(img.getAttribute('width')) >= 200 && declared(img.getAttribute('height')) >= 200)
        .slice(0, 8)
        .map(srcOf);
    }
    return [...doc.images]
      .filter((img) => img.naturalWidth >= 200 && img.naturalHeight >= 200)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
      .slice(0, 8)
      .map((img) => img.currentSrc || img.src);
  }

  function normalizeCurrency(value) {
    if (typeof value !== 'string') return null;
    return /^[a-z]{3}$/i.test(value.trim()) ? value.trim().toUpperCase() : detectCurrency(value);
  }

  // The price at a spot the user pointed out on this shop (see picker.js): the label next
  // to it ("Cena:"), which survives rows moving around, else a CSS selector. Older spots
  // are a bare selector string.
  function spotText(doc, spot) {
    if (!spot?.selector) return null;
    try {
      return clean(doc.querySelector(spot.selector)?.textContent) || null;
    } catch {
      return null; // Not a valid selector any more.
    }
  }

  function spotPrice(doc, spot) {
    if (!spot) return null;
    const { selector, label } = typeof spot === 'string' ? { selector: spot } : spot;
    const texts = [];
    if (label) {
      const labelled = [...doc.querySelectorAll('body *')].find((el) => clean(el.textContent) === label && el.nextElementSibling);
      texts.push(labelled?.nextElementSibling.textContent);
    }
    try {
      if (selector) texts.push(doc.querySelector(selector)?.textContent);
    } catch {
      // Not a valid selector any more.
    }
    for (const text of texts) {
      const price = parsePrice(text);
      if (price != null) return { price, currency: detectCurrency(text) };
    }
    return null;
  }

  // options.priceSpot: where this shop shows its price, picked by the user; it wins over
  // everything read automatically, as the user said that is the right number.
  function extract(doc, pageUrl, options = {}) {
    const absolute = (value) => {
      if (typeof value !== 'string' || !value) return null;
      try {
        const url = new URL(value, pageUrl);
        return /^https?:$/.test(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    };

    const ld = jsonLdProduct(doc);
    const micro = microdata(doc);
    const metaPrice = parsePrice(meta(doc, 'product:sale_price:amount', 'product:price:amount', 'og:price:amount'), true);
    const microPrice = parsePrice(micro?.price, true);

    const spot = spotPrice(doc, options.priceSpot);
    let found = readOffer(ld?.offers);
    if (!found && metaPrice != null) {
      found = { price: metaPrice, currency: meta(doc, 'product:sale_price:currency', 'product:price:currency', 'og:price:currency') };
    }
    if (!found && microPrice != null) found = { price: microPrice, currency: micro.currency };
    const structured = Boolean(found);
    if (!found) found = visiblePrice(doc);

    let currency = normalizeCurrency(found?.currency);
    if (found && !currency && structured) currency = visiblePrice(doc)?.currency ?? null;
    if (spot) {
      // The spot's own text may not name a currency; then what the page says otherwise stands.
      currency = spot.currency ?? currency;
      found = spot;
    }

    const siteName = meta(doc, 'og:site_name');
    // options.titleSpot: where this shop shows the product name, picked by the user; it wins
    // over everything read automatically, like the price spot.
    const spotTitle = spotText(doc, options.titleSpot);
    const title =
      spotTitle ||
      clean(ld?.name) ||
      clean(meta(doc, 'og:title', 'twitter:title')) ||
      clean(micro?.name) ||
      clean(doc.querySelector('h1')?.textContent) ||
      clean(doc.title);

    const images = [
      ...imageUrls(ld?.image),
      meta(doc, 'og:image:secure_url', 'og:image'),
      meta(doc, 'twitter:image'),
      micro?.image,
      ...pageImages(doc, options.fetched),
    ].map(absolute).filter(Boolean);

    // A canonical URL drops tracking noise, but some shops point it at the home
    // page or another domain, and then it would no longer identify the product.
    const canonical = absolute(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'));
    const page = new URL(pageUrl);
    const usable = canonical && new URL(canonical).hostname === page.hostname && new URL(canonical).pathname !== '/';

    return {
      url: usable ? canonical : page.href,
      title,
      titleFromSpot: Boolean(spotTitle),
      images: [...new Set(images)].slice(0, 12),
      price: found?.price ?? null,
      currency,
      siteName,
      // A price found where the user pointed it out on this shop also marks a product page.
      isProduct: Boolean(ld || micro || metaPrice != null || spot || /product/i.test(meta(doc, 'og:type') ?? '')),
    };
  }

  globalThis.SaverExtract = Object.assign(extract, { parsePrice, detectCurrency });
})();
