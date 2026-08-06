// v4.1 Recent-activity branding: well-known (mostly PH) merchants detected
// from the transaction description. Each entry carries the brand's EXACT
// color and a monogram so rows read like real app icons; anything unknown
// falls back to the budget-category icon in a neutral chip.
//
// To ship true logo artwork, drop a PNG into assets/brands/ and register it
// in BRAND_LOGOS inside src/components/BrandBadge.tsx — the badge prefers a
// registered image and uses the colored monogram only as the fallback.

export interface Brand {
  name: string;
  color: string;    // exact brand color
  initial: string;  // monogram fallback (1–2 chars)
  keywords: string[];
}

export const BRANDS: Brand[] = [
  // Food & dining
  { name: 'Jollibee', color: '#E4002B', initial: 'J', keywords: ['jollibee', 'jabee'] },
  { name: "McDonald's", color: '#DA291C', initial: 'M', keywords: ['mcdo', 'mcdonald'] },
  { name: 'KFC', color: '#A6192E', initial: 'K', keywords: ['kfc'] },
  { name: 'Chowking', color: '#C8102E', initial: 'C', keywords: ['chowking'] },
  { name: 'Mang Inasal', color: '#FFC845', initial: 'MI', keywords: ['mang inasal', 'inasal'] },
  { name: 'Starbucks', color: '#00704A', initial: 'S', keywords: ['starbucks'] },
  { name: 'foodpanda', color: '#D70F64', initial: 'fp', keywords: ['foodpanda', 'panda'] },
  { name: 'GrabFood', color: '#00B14F', initial: 'G', keywords: ['grabfood', 'grab food'] },

  // Shopping & delivery
  { name: 'Shopee', color: '#EE4D2D', initial: 'S', keywords: ['shopee', 'spaylater', 'spay later', 'seller center'] },
  { name: 'Lazada', color: '#0F146D', initial: 'Lz', keywords: ['lazada', 'lazpaylater'] },
  { name: 'SM', color: '#0054A6', initial: 'SM', keywords: ['sm store', 'sm super', 'sm mall', 'sm hyper'] },
  { name: 'Puregold', color: '#0B7A3B', initial: 'P', keywords: ['puregold'] },
  { name: '7-Eleven', color: '#008163', initial: '7', keywords: ['7-eleven', '7 eleven', '7-11', '7/11'] },
  { name: 'Mercury Drug', color: '#0057A8', initial: 'MD', keywords: ['mercury drug', 'mercury'] },
  { name: 'Watsons', color: '#00A0AF', initial: 'W', keywords: ['watsons'] },
  { name: 'Uniqlo', color: '#FF0000', initial: 'U', keywords: ['uniqlo'] },

  // Transport & fuel
  { name: 'Grab', color: '#00B14F', initial: 'G', keywords: ['grab', 'grabcar'] },
  { name: 'Angkas', color: '#0057FF', initial: 'A', keywords: ['angkas'] },
  { name: 'Shell', color: '#DD1D21', initial: 'Sh', keywords: ['shell'] },
  { name: 'Petron', color: '#0033A0', initial: 'P', keywords: ['petron'] },
  { name: 'Caltex', color: '#E4002B', initial: 'C', keywords: ['caltex'] },

  // Utilities & telco
  { name: 'Meralco', color: '#F58220', initial: 'M', keywords: ['meralco'] },
  { name: 'Maynilad', color: '#0072BC', initial: 'My', keywords: ['maynilad'] },
  { name: 'Manila Water', color: '#00AEEF', initial: 'MW', keywords: ['manila water'] },
  { name: 'Globe', color: '#1F4E9C', initial: 'G', keywords: ['globe'] },
  { name: 'Smart', color: '#00B140', initial: 'S', keywords: ['smart', 'giga'] },
  { name: 'PLDT', color: '#D22630', initial: 'P', keywords: ['pldt'] },
  { name: 'Converge', color: '#00A651', initial: 'Cv', keywords: ['converge'] },

  // Subscriptions & digital
  { name: 'Netflix', color: '#E50914', initial: 'N', keywords: ['netflix'] },
  { name: 'Spotify', color: '#1DB954', initial: 'Sp', keywords: ['spotify'] },
  { name: 'YouTube', color: '#FF0000', initial: 'YT', keywords: ['youtube'] },
  { name: 'Steam', color: '#171A21', initial: 'St', keywords: ['steam'] },
  { name: 'Disney+', color: '#01147C', initial: 'D+', keywords: ['disney'] },

  // Banks & wallets (payments TO them, e.g. credit card / loan payments)
  { name: 'BPI', color: '#B11116', initial: 'B', keywords: ['bpi'] },
  { name: 'BDO', color: '#003A70', initial: 'BD', keywords: ['bdo'] },
  { name: 'UnionBank', color: '#FF6F00', initial: 'U', keywords: ['unionbank', 'union bank'] },
  { name: 'Metrobank', color: '#00539F', initial: 'Mb', keywords: ['metrobank'] },
  { name: 'MariBank', color: '#00D0C2', initial: 'Mr', keywords: ['maribank', 'mari bank'] },
  { name: 'SeaBank', color: '#F94D2A', initial: 'Se', keywords: ['seabank'] },
  { name: 'GCash', color: '#0071F2', initial: 'G', keywords: ['gcash', 'ggives', 'gloan'] },
  { name: 'Maya', color: '#12B76A', initial: 'M', keywords: ['maya', 'paymaya'] },
  { name: 'Pag-IBIG', color: '#00529B', initial: 'PI', keywords: ['pag-ibig', 'pagibig'] },
  { name: 'SSS', color: '#0038A8', initial: 'SS', keywords: ['sss'] },
  { name: 'PhilHealth', color: '#009B48', initial: 'PH', keywords: ['philhealth'] },

  // Pets & misc known
  { name: 'Pet Express', color: '#E87722', initial: 'PE', keywords: ['pet express'] },
];

/** Longest-keyword-wins match against a transaction description. */
export function brandFor(description: string): Brand | undefined {
  const d = description.toLowerCase();
  let best: Brand | undefined;
  let bestLen = 0;
  for (const b of BRANDS) {
    for (const k of b.keywords) {
      if (d.includes(k) && k.length > bestLen) { best = b; bestLen = k.length; }
    }
  }
  return best;
}
