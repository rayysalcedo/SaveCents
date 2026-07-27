// Cents' brain — Gemini via Firebase AI Logic.
// The Taglish intent-extraction prompt is ported from the original Kotlin
// FinanceViewModel and extended with goal awareness + a conversational reply.

import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';
import { Account, Category, Goal } from '../models/types';

export type CentsIntent =
  | 'LogTransaction'
  | 'PrePurchaseCheck'
  | 'AddCategory'
  | 'RemoveCategory'
  | 'UpdateBudget'
  | 'CategoryMismatch'
  | 'Unknown';

export interface CentsResult {
  intent: CentsIntent;
  amount: number;
  categoryName: string;
  item: string;
  reply: string; // conversational answer, used for Unknown / general questions
  lang: 'en' | 'fil'; // language of the user's message (fil = Tagalog/Taglish)
}

interface CentsContext {
  categories: Category[];
  goals: Goal[];
  accounts: Account[];
  currency: string;
}

// Model fallback chain — Google retires Gemini models on ~yearly cycles and
// retired names return 404. We try newest-stable first and remember the winner.
// (At launch: move this to Firebase Remote Config per Google's recommendation.)
const MODEL_CANDIDATES = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];
let workingModelIndex = 0;
const modelCache = new Map<string, ReturnType<typeof getGenerativeModel>>();

const responseSchema = Schema.object({
  properties: {
    intent: Schema.enumString({
      enum: [
        'LogTransaction', 'PrePurchaseCheck', 'AddCategory',
        'RemoveCategory', 'UpdateBudget', 'CategoryMismatch', 'Unknown',
      ],
    }),
    amount: Schema.number(),
    categoryName: Schema.string(),
    item: Schema.string(),
    reply: Schema.string(),
    lang: Schema.enumString({ enum: ['en', 'fil'] }),
  },
});

function getModel(name: string) {
  if (!isFirebaseConfigured()) throw new Error('firebase-not-configured');
  let m = modelCache.get(name);
  if (!m) {
    const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
    m = getGenerativeModel(ai, {
      model: name,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2,
      },
    });
    modelCache.set(name, m);
  }
  return m;
}

function buildSystemPrompt(ctx: CentsContext): string {
  const cats = ctx.categories
    .map((c) => `${c.name} (limit ${c.limit}, spent ${c.spent})`)
    .join('; ');
  const goals = ctx.goals
    .map((g) => `${g.name} (target ${g.target}, saved ${g.current}, by ${g.date})`)
    .join('; ');
  const liquid = ctx.accounts.reduce((a, x) => a + x.balance, 0);

  return `You are Cents, the AI money coach inside SaveCents.
Personality: casual, warm, encouraging — like a sharp kaibigan who's great with money. Keep replies short and punchy. Hype small wins. Never lecture.
The user might speak English or Taglish (e.g. 'Kakabili ko lang ng dog food 800', 'Kakasiya ba 'to if bumili ako ng 1500 game?').
Currency: ${ctx.currency}. Liquid balance: ${liquid}.
Current budget categories: ${cats || 'none'}.
Active goals: ${goals || 'none'}.

Extract the intent from the user's message.
Valid intents: "LogTransaction", "PrePurchaseCheck", "AddCategory", "RemoveCategory", "UpdateBudget", "CategoryMismatch", "Unknown".
- For LogTransaction: extract 'amount', 'item' (what they bought), and 'categoryName' — match the closest existing category by MEANING (dog food → a pets category, jeepney fare → transport, Netflix → subscriptions). Only match when the fit is natural; if the fit would be a stretch or nothing fits, use "Others".
- Never invent new category names; only use the user's existing categories or "Others". Do not use CategoryMismatch.
- Set 'lang' to "fil" if the user's message is in Tagalog or Taglish, otherwise "en". ALWAYS answer 'reply' in the SAME language and tone as the user — Taglish in, Taglish out.
- For PrePurchaseCheck (asking if they can afford something): extract 'amount', 'categoryName' (closest existing category), and 'item'.
- For AddCategory: 'categoryName' and 'amount' (the monthly limit).
- For RemoveCategory: 'categoryName'.
- For UpdateBudget: 'categoryName' and 'amount' (the new limit).
- For "Unknown" (greetings, budget questions, money advice, anything else): set 'reply' to a warm, genuinely helpful answer (max 4 sentences) in the user's language, using the budget/goal data above. You can give real financial guidance — savings tips, trade-off thinking, encouragement — like a sharp friend who's good with money, not a script.
Always fill every field; use 0 or "" when not applicable.`;
}

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

// Shared model call with the fallback chain + JSON parsing. Used by both the
// text brain (parseCentsIntent) and the vision brain (analyzeImage).
async function generateStructured(parts: ContentPart[], system: string): Promise<CentsResult> {
  let lastErr: unknown = null;
  let result: Awaited<ReturnType<ReturnType<typeof getGenerativeModel>['generateContent']>> | null = null;

  for (let i = workingModelIndex; i < MODEL_CANDIDATES.length; i++) {
    try {
      const m = getModel(MODEL_CANDIDATES[i]);
      result = await m.generateContent({
        contents: [{ role: 'user', parts }],
        systemInstruction: { role: 'system', parts: [{ text: system }] },
      });
      workingModelIndex = i; // remember the model that works
      break;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      // Retired/unknown model → try the next candidate; anything else → real error
      if (/404|not found|not supported|does not exist/i.test(msg)) continue;
      throw e;
    }
  }
  if (!result) throw lastErr ?? new Error('all-models-failed');

  const text = result.response.text();
  const parsed = JSON.parse(text) as Partial<CentsResult>;
  return {
    intent: (parsed.intent as CentsIntent) ?? 'Unknown',
    amount: typeof parsed.amount === 'number' ? parsed.amount : 0,
    categoryName: parsed.categoryName ?? '',
    item: parsed.item ?? parsed.categoryName ?? '',
    reply: parsed.reply ?? '',
    lang: parsed.lang === 'fil' ? 'fil' : 'en',
  };
}

export async function parseCentsIntent(message: string, ctx: CentsContext): Promise<CentsResult> {
  return generateStructured([{ text: message }], buildSystemPrompt(ctx));
}

// ── M4: Vision ──────────────────────────────────────────────────────────────
export type VisionMode = 'receipt' | 'price';

function buildVisionPrompt(mode: VisionMode, ctx: CentsContext): string {
  const cats = ctx.categories.map((c) => c.name).join('; ');
  const common = `You are Cents, the casual, encouraging AI money coach inside SaveCents — like a sharp kaibigan who's great with money.
Currency: ${ctx.currency}. The user's existing budget categories: ${cats || 'none'}.
Read the attached photo carefully. Fill EVERY schema field; use 0 or "" when not applicable.
Category matching: pick the existing category whose MEANING best fits WHAT WAS BOUGHT — e.g. a motorcycle cover or fuel → a motorcycle/vehicle/gas category; dog food → a pets category; Jollibee → dining. Think about what the items are FOR. Never invent category names; if nothing fits naturally, use "Others".
Set lang to "fil" if the receipt or its context is Filipino, else "en". Write reply in that language: casual coach tone, ONE short sentence, no lecture.`;
  if (mode === 'receipt') {
    return `${common}
The image is a PURCHASE RECEIPT or an ONLINE ORDER page (Shopee, Lazada, Grab, bank app, etc.).
- intent MUST be "LogTransaction".
- amount = the FINAL TOTAL PAID — the order total after discounts, vouchers and shipping, NOT the item's list price. If no total is readable, set amount to 0 and say so in reply.
- Receipts are often HANDWRITTEN (common on Filipino service receipts: laundry, sari-sari, carinderia, vulcanizing). Read handwritten digits character by character and cross-check against any per-item prices and quantities (e.g. 2 items × 150 = 300). If the handwriting is ambiguous, give your best reading BUT say you're not sure in the reply so the user double-checks — e.g. "Mukhang ₱300 ang total pero medyo malabo ang sulat — check mo muna bago natin i-log.".
- item = the main product bought, short and human (e.g. "Motorcycle cover", "Dog food 10kg"). Only fall back to the store name if the items aren't identifiable.
- reply = one friendly sentence naming the item, the store, and the total — e.g. "Nice — motorcycle cover from Autop.ph, ₱278 all-in. Log it?"`;
  }
  return `${common}
The image shows a PRODUCT or its PRICE TAG in a store or online listing.
- intent MUST be "PrePurchaseCheck".
- amount = the product's current price as shown (use the discounted price if one is displayed). If no price is visible, set amount to 0 and say so in reply.
- item = the product name, short and human (e.g. "Nike Air Force 1", "Stand mixer").
- reply = one friendly sentence naming the product and price you read — e.g. "Okay, eyeing that stand mixer at ₱4,500 — let me check your numbers."`;
}

export async function analyzeImage(
  base64: string, mimeType: string, mode: VisionMode, ctx: CentsContext,
): Promise<CentsResult> {
  return generateStructured(
    [
      { inlineData: { mimeType, data: base64 } },
      { text: mode === 'receipt' ? 'Read this receipt.' : 'Check this product/price tag.' },
    ],
    buildVisionPrompt(mode, ctx),
  );
}

// ── Offline fallback ─────────────────────────────────────────────────────────
// Heuristic parser used before Firebase is configured or when the network
// call fails, so the app always responds.
export function localParseIntent(message: string, ctx: CentsContext): CentsResult {
  const lower = message.toLowerCase();
  const amountMatch = lower.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
  const category = ctx.categories.find((c) =>
    lower.includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().split(' ').some((w) => w.length > 2 && lower.includes(w)),
  );
  const afford = /afford|can i|kakasiya|kaya ko ba|worth it|should i buy/.test(lower);
  const spent = /spent|bought|buy|kakabili|binili|bumili|nabili|nagbayad|paid|log/.test(lower);

  if (afford && amount > 0) {
    return {
      intent: 'PrePurchaseCheck', amount,
      categoryName: category?.name ?? ctx.categories[0]?.name ?? '',
      item: category?.name ?? 'this item', reply: '', lang: 'en',
    };
  }
  if (spent && amount > 0 && category) {
    return { intent: 'LogTransaction', amount, categoryName: category.name, item: category.name, reply: '', lang: 'en' };
  }
  if (spent && amount > 0) {
    return {
      intent: 'LogTransaction', amount, categoryName: 'Others',
      item: message.replace(/\d+/g, '').trim().slice(0, 24) || 'this item', reply: '', lang: 'en',
    };
  }
  return {
    intent: 'Unknown', amount: 0, categoryName: '', item: '', lang: 'en',
    reply: isFirebaseConfigured()
      ? "I didn't catch that — try 'spent 250 on gas' or 'can I afford a 1500 game?'."
      : "I'm running on my offline parser. Try 'spent 250 on gas' — and connect Firebase (see src/services/firebaseConfig.ts) to unlock my full brain.",
  };
}