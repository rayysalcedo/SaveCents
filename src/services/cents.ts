// Cents' brain — Gemini via Firebase AI Logic.
// The Taglish intent-extraction prompt is ported from the original Kotlin
// FinanceViewModel and extended with goal awareness, conversation memory,
// recent-transaction context, and a conversational reply.

import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';
import { Account, Category, Goal, Transaction } from '../models/types';

export type CentsIntent =
  | 'LogTransaction'
  | 'PrePurchaseCheck'
  | 'AddCategory'
  | 'RemoveCategory'
  | 'UpdateBudget'
  | 'CategoryMismatch'
  | 'Unknown';

// One step of a multi-part request ("add a groceries budget 9000 AND log
// that receipt there"). Ordered for execution.
export interface CentsSubAction {
  intent: CentsIntent;
  amount: number;
  categoryName: string;
  item: string;
}

export interface CentsResult {
  intent: CentsIntent;
  amount: number;
  categoryName: string;
  item: string;
  reply: string; // conversational answer, used for Unknown / general questions
  details: string; // scan analysis: what Cents saw and figured out (may be '')
  priceIsEstimate: boolean; // true when amount was estimated, not read off the photo
  lang: 'en' | 'fil'; // language of the user's message (fil = Tagalog/Taglish)
  actions: CentsSubAction[]; // every requested action in order; single-action = one entry
}

export interface CentsHistoryTurn {
  sender: 'USER' | 'CENTS';
  text: string;
}

export interface CentsContext {
  categories: Category[];
  goals: Goal[];
  accounts: Account[];
  currency: string;
  nickname?: string;
  history?: CentsHistoryTurn[]; // recent chat turns, oldest first
  recentTransactions?: Transaction[]; // newest first
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

const INTENT_ENUM = [
  'LogTransaction', 'PrePurchaseCheck', 'AddCategory',
  'RemoveCategory', 'UpdateBudget', 'CategoryMismatch', 'Unknown',
];

const responseSchema = Schema.object({
  properties: {
    intent: Schema.enumString({ enum: INTENT_ENUM }),
    amount: Schema.number(),
    categoryName: Schema.string(),
    item: Schema.string(),
    reply: Schema.string(),
    details: Schema.string(),
    priceIsEstimate: Schema.boolean(),
    lang: Schema.enumString({ enum: ['en', 'fil'] }),
    actions: Schema.array({
      items: Schema.object({
        properties: {
          intent: Schema.enumString({ enum: INTENT_ENUM }),
          amount: Schema.number(),
          categoryName: Schema.string(),
          item: Schema.string(),
        },
      }),
    }),
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
        temperature: 0.3,
      },
    });
    modelCache.set(name, m);
  }
  return m;
}

// Shared situational context injected into every brain call so Cents always
// knows who it's talking to, what they have, and what was just said.
function buildSharedContext(ctx: CentsContext): string {
  const cats = ctx.categories
    .map((c) => `${c.name}${c.category && c.category !== c.name ? ` [${c.category}]` : ''} (limit ${c.limit}, spent ${c.spent})`)
    .join('; ');
  const goals = ctx.goals
    .map((g) => `${g.name} (target ${g.target}, saved ${g.current}, by ${g.date})`)
    .join('; ');
  const liquid = ctx.accounts.reduce((a, x) => a + x.balance, 0);
  const recent = (ctx.recentTransactions ?? [])
    .slice(0, 8)
    .map((t) => `${t.isIncome ? '+' : '-'}${t.amount} ${t.description}`)
    .join('; ');
  const history = (ctx.history ?? [])
    .map((h) => `${h.sender === 'USER' ? 'User' : 'Cents'}: ${h.text}`)
    .join('\n');

  return `User's name: ${ctx.nickname || 'friend'}. Currency: ${ctx.currency}. Liquid balance across accounts: ${liquid}.
Today: ${new Date().toDateString()}.
Budget categories: ${cats || 'none yet'}. A name in [brackets] is that budget's BASE CATEGORY: "Netflix [Subscriptions]" is a Subscriptions budget specifically for Netflix, "Meralco [Utilities]" is a Utilities budget for the electric bill.
Active goals: ${goals || 'none yet'}.
Recent transactions (newest first): ${recent || 'none yet'}.
${history ? `Recent conversation (oldest first):\n${history}\nUse this to resolve follow-ups like "yes", "the second one", "same as last time", or a bare amount that answers your last question.` : ''}`;
}

function buildSystemPrompt(ctx: CentsContext): string {
  return `You are Cents, the AI money coach inside SaveCents.
Personality: casual, warm, encouraging, like a sharp kaibigan who's great with money. Keep replies short and punchy. Hype small wins. Never lecture. Never use emojis. Never use em dashes.
The user might speak English or Taglish (e.g. 'Kakabili ko lang ng dog food 800', 'Kakasiya ba 'to if bumili ako ng 1500 game?').
${buildSharedContext(ctx)}

Extract the intent(s) from the user's message.
Valid intents: "LogTransaction", "PrePurchaseCheck", "AddCategory", "RemoveCategory", "UpdateBudget", "CategoryMismatch", "Unknown".
MULTI-STEP REQUESTS: a single message can ask for several things at once, e.g. "add a groceries budget of 9000 and log that receipt there" is TWO actions: AddCategory(Groceries, 9000) then LogTransaction(3670.97, Groceries). Fill 'actions' with EVERY requested action, in the order they should happen, each with its own intent/amount/categoryName/item. A later action may use a category created by an earlier action in the same list. Mirror the FIRST action into the top-level intent/amount/categoryName/item fields. If there is exactly one action, 'actions' has exactly one entry. For "Unknown", 'actions' is an empty list.
REFERENCES TO THE CONVERSATION: when the user says "that receipt", "log it", "the item you scanned", "yun kanina" and similar, resolve the amount, item and store from the recent conversation above. Never ask again for a number that is already in the conversation.
- For LogTransaction: extract 'amount', 'item' (what they bought), and 'categoryName', matching the closest existing budget by the MEANING of its name AND its [base category] (dog food goes to a pets budget, jeepney fare to transport, a Netflix payment to the "Netflix" budget, an electricity bill to a Utilities-based budget like "Meralco"). When several budgets share a base category, pick the one whose NAME fits the specific item; if none fits it specifically, use a general budget of that base category if one exists, otherwise "Others". 'categoryName' must always be a budget's exact NAME as listed, never a bracketed base category by itself. Only match when the fit is natural; if the fit would be a stretch or nothing fits, use "Others".
- Never invent new category names; only use the user's existing categories or "Others". Do not use CategoryMismatch.
- Set 'lang' to "fil" if the user's message is in Tagalog or Taglish, otherwise "en". ALWAYS answer 'reply' in the SAME language and tone as the user. Taglish in, Taglish out.
- For PrePurchaseCheck (asking if they can afford something): extract 'amount', 'categoryName' (closest existing category), and 'item'.
- For AddCategory: 'categoryName' and 'amount' (the monthly limit).
- For RemoveCategory: 'categoryName'.
- For UpdateBudget: 'categoryName' and 'amount' (the new limit).
- For "Unknown" (greetings, budget questions, money advice, follow-up questions about a scanned item or receipt, anything else): set 'reply' to a warm, genuinely helpful answer (max 4 sentences) in the user's language, using the budget, goal, transaction and conversation data above. You can give real financial guidance, savings tips, trade-off thinking and encouragement, like a sharp friend who's good with money, not a script. If the user asks about something Cents just scanned or said, answer from the conversation context.
Always fill every field; use 0, "" or false when not applicable.`;
}

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

// Transient server-side failures: overload spikes, rate limits, 5xx. These are
// retried on the same model, then the next candidate is tried. Only a fully
// exhausted chain surfaces as 'cents-overloaded' so the store can message it.
const RETRYABLE = /\b(429|500|503)\b|high demand|overloaded|resource exhausted|unavailable|try again later|internal error/i;
const MISSING_MODEL = /404|not found|not supported|does not exist/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared model call with the fallback chain + JSON parsing. Used by both the
// text brain (parseCentsIntent) and the vision brain (analyzeImage).
async function generateStructured(parts: ContentPart[], system: string): Promise<CentsResult> {
  let lastErr: unknown = null;
  let sawRetryable = false;
  let result: Awaited<ReturnType<ReturnType<typeof getGenerativeModel>['generateContent']>> | null = null;

  outer:
  for (let i = workingModelIndex; i < MODEL_CANDIDATES.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const m = getModel(MODEL_CANDIDATES[i]);
        result = await m.generateContent({
          contents: [{ role: 'user', parts }],
          systemInstruction: { role: 'system', parts: [{ text: system }] },
        });
        workingModelIndex = i; // remember the model that works
        break outer;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        if (MISSING_MODEL.test(msg)) continue outer; // retired name → next candidate
        if (RETRYABLE.test(msg)) {
          sawRetryable = true;
          if (attempt === 0) { await sleep(900); continue; } // brief backoff, same model
          continue outer; // still busy → next candidate
        }
        throw e; // real error (auth, network, quota config…)
      }
    }
  }
  if (!result) {
    if (sawRetryable) throw new Error('cents-overloaded');
    throw lastErr ?? new Error('all-models-failed');
  }

  const text = result.response.text();
  const parsed = JSON.parse(text) as Partial<CentsResult>;
  const okIntent = (v: unknown): CentsIntent =>
    (INTENT_ENUM.includes(String(v)) ? (v as CentsIntent) : 'Unknown');
  const actions: CentsSubAction[] = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter((a) => a && typeof a === 'object')
        .map((a) => ({
          intent: okIntent((a as CentsSubAction).intent),
          amount: typeof (a as CentsSubAction).amount === 'number' ? (a as CentsSubAction).amount : 0,
          categoryName: (a as CentsSubAction).categoryName ?? '',
          item: (a as CentsSubAction).item ?? '',
        }))
        .filter((a) => a.intent !== 'Unknown')
    : [];
  return {
    intent: okIntent(parsed.intent),
    amount: typeof parsed.amount === 'number' ? parsed.amount : 0,
    categoryName: parsed.categoryName ?? '',
    item: parsed.item ?? parsed.categoryName ?? '',
    reply: parsed.reply ?? '',
    details: parsed.details ?? '',
    priceIsEstimate: parsed.priceIsEstimate === true,
    lang: parsed.lang === 'fil' ? 'fil' : 'en',
    actions,
  };
}

export async function parseCentsIntent(message: string, ctx: CentsContext): Promise<CentsResult> {
  return generateStructured([{ text: message }], buildSystemPrompt(ctx));
}

// ── M4/M5.5: Vision ──────────────────────────────────────────────────────────
export type VisionMode = 'receipt' | 'price';

function buildVisionPrompt(mode: VisionMode, ctx: CentsContext): string {
  const common = `You are Cents, the casual, encouraging AI money coach inside SaveCents, like a sharp kaibigan who's great with money. Never use emojis. Never use em dashes.
${buildSharedContext(ctx)}
Read the attached photo carefully. Fill EVERY schema field; use 0, "" or false when not applicable.
Category matching: pick the existing budget whose MEANING best fits WHAT WAS BOUGHT, using both its name and its [base category], e.g. a motorcycle cover or fuel goes to a motorcycle/vehicle/gas budget; dog food to a pets budget; Jollibee to dining; a Meralco bill to a Utilities-based budget named "Meralco"; a Netflix charge to a Subscriptions-based budget named "Netflix". Think about what the items are FOR. 'categoryName' must be a budget's exact NAME as listed. Never invent names; if nothing fits naturally, use "Others".
Set lang to "fil" if the photo or its context is Filipino, else "en". Write reply and details in that language, casual coach tone.`;
  if (mode === 'receipt') {
    return `${common}
The image is a PURCHASE RECEIPT or an ONLINE ORDER page (Shopee, Lazada, Grab, bank app, etc.).
- intent MUST be "LogTransaction".
- amount = the FINAL TOTAL PAID, the order total after discounts, vouchers and shipping, NOT the item's list price. If no total is readable, set amount to 0 and say so in reply.
- Receipts are often HANDWRITTEN (common on Filipino service receipts: laundry, sari-sari, carinderia, vulcanizing). Read handwritten digits character by character and cross-check against any per-item prices and quantities (e.g. 2 items x 150 = 300). If the handwriting is ambiguous, give your best reading BUT say you're not sure in the reply so the user double-checks, e.g. "Mukhang P300 ang total pero medyo malabo ang sulat, check mo muna bago natin i-log."
- item = the main product bought, short and human (e.g. "Motorcycle cover", "Dog food 10kg"). Only fall back to the store name if the items aren't identifiable.
- details = a short breakdown of what you analyzed: the store, the line items with their prices when readable, any discount or shipping, and the category you'd file it under. 2 to 4 short lines, each on its own line. This is shown to the user as your analysis.
- reply = one friendly sentence naming the item, the store and the total, then invite them to log it or ask about it, e.g. "Nice, motorcycle cover from Autop.ph, P278 all-in. Want to log it, or curious about anything on it?"
- priceIsEstimate = false for receipts.`;
  }
  return `${common}
The image shows a PRODUCT, its PRICE TAG, or an item the user is thinking about buying (store shelf, online listing, or just the item itself).
- intent MUST be "PrePurchaseCheck".
- FIRST identify the item as precisely as you can: what it is, and brand or model if recognizable.
- amount = the product's current price if one is visible (use the discounted price if displayed) and set priceIsEstimate to false.
- If NO price is visible: estimate the typical current price for this item in the user's market (Philippine retail and online prices if currency is PHP) and set amount to that estimate with priceIsEstimate = true. Give a realistic single number, not a range.
- item = the product name, short and human (e.g. "Nike Air Force 1", "Stand mixer").
- details = what you can tell about the item: what it is, brand or model if identifiable, roughly what it goes for in the market and where it's usually cheapest to buy, plus one sharp buying tip if you have one. 2 to 4 short lines, each on its own line.
- reply = one friendly sentence naming the product and the price you read or estimated. If estimated, SAY it's your estimate since there was no tag, then offer to run their numbers, e.g. "That's a Nike Air Force 1, no tag visible but these usually go for around P5,495. Want me to check if it fits your budget?"`;
}

export async function analyzeImage(
  base64: string, mimeType: string, mode: VisionMode, ctx: CentsContext,
): Promise<CentsResult> {
  return generateStructured(
    [
      { inlineData: { mimeType, data: base64 } },
      { text: mode === 'receipt' ? 'Read and analyze this receipt.' : 'Identify this item and figure out its price.' },
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
  // Match by budget NAME first ("netflix" → the Netflix budget); if nothing
  // hits, fall back to base CATEGORY words ("subscription" → a Subscriptions-
  // based budget), so grouped budgets still resolve offline.
  const byName = ctx.categories.find((c) =>
    lower.includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().split(' ').some((w) => w.length > 2 && lower.includes(w)),
  );
  const byBase = ctx.categories.find((c) => {
    const base = (c.category ?? '').toLowerCase();
    return base && (lower.includes(base) || base.split(' ').some((w) => w.length > 2 && lower.includes(w)));
  });
  const category = byName ?? byBase;
  const afford = /afford|can i|kakasiya|kaya ko ba|worth it|should i buy/.test(lower);
  const spent = /spent|bought|buy|kakabili|binili|bumili|nabili|nagbayad|paid|log|receipt|resibo|worth|total|nagastos|gastos/.test(lower);

  const base = { details: '', priceIsEstimate: false, actions: [] as CentsSubAction[] } as const;
  if (afford && amount > 0) {
    return {
      ...base, intent: 'PrePurchaseCheck', amount,
      categoryName: category?.name ?? ctx.categories[0]?.name ?? '',
      item: category?.name ?? 'this item', reply: '', lang: 'en',
    };
  }
  if (spent && amount > 0 && category) {
    return { ...base, intent: 'LogTransaction', amount, categoryName: category.name, item: category.name, reply: '', lang: 'en' };
  }
  if (spent && amount > 0) {
    return {
      ...base, intent: 'LogTransaction', amount, categoryName: 'Others',
      item: message.replace(/\d+/g, '').trim().slice(0, 24) || 'this item', reply: '', lang: 'en',
    };
  }
  return {
    ...base, intent: 'Unknown', amount: 0, categoryName: '', item: '', lang: 'en',
    reply: isFirebaseConfigured()
      ? "I didn't catch that. Try 'spent 250 on gas' or 'can I afford a 1500 game?'."
      : "I'm running on my offline parser. Try 'spent 250 on gas'. Connect Firebase (see src/services/firebaseConfig.ts) to unlock my full brain.",
  };
}