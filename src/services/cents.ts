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
  | 'AddIncome'
  | 'AddGoal'
  | 'AddToGoal'
  | 'WithdrawFromGoal'
  | 'AddAccount'
  | 'SetAccountBalance'
  | 'CategoryMismatch'
  | 'Unknown';

// One step of a multi-part request ("add a groceries budget 9000 AND log
// that receipt there"). Ordered for execution.
export interface CentsSubAction {
  intent: CentsIntent;
  amount: number;
  categoryName: string;
  item: string;
  accountName?: string; // payment source/destination if the user said one; '' otherwise
  targetDate?: string; // AddGoal deadline, ISO YYYY-MM-DD or ''
}

export interface CentsResult {
  intent: CentsIntent;
  amount: number;
  categoryName: string;
  item: string;
  accountName?: string; // M5.22: source/destination account named by the user ('' if none)
  targetDate?: string; // M5.28: goal deadline as ISO YYYY-MM-DD ('' when not stated)
  reply: string; // conversational answer, used for Unknown / general questions
  details: string; // scan analysis: what Cents saw and figured out (may be '')
  priceIsEstimate: boolean; // true when amount was estimated, not read off the photo
  lang: 'en' | 'fil'; // language of the user's message (fil = Tagalog/Taglish)
  actions: CentsSubAction[]; // every requested action in order; single-action = one entry
  // M5.12: when the user's message arrived as AUDIO (parseCentsVoice), the
  // exact transcription. Absent/'' for text messages and the offline parser.
  transcript?: string;
  // M5.16: how Cents would SAY the response out loud - complete conversational
  // sentences, no symbols/abbreviations, amounts as "250 pesos". The voice
  // speaks this; chat shows reply/cards. Absent for the offline parser.
  speechReply?: string;
  // M5.19: one coach-style insight/next step, held back until the user
  // CONFIRMS the action. '' when there is nothing genuinely useful to add.
  coachNote?: string;
  // M5.21: the user's message grants/refuses permission for the question
  // Cents asked in its immediately previous turn, in ANY phrasing. The app
  // executes/cancels the pending ask itself - never ask again.
  confirmGranted?: boolean;
  confirmDenied?: boolean;
}

export interface CentsHistoryTurn {
  sender: 'USER' | 'CENTS';
  text: string;
}

export interface CentsContext {
  // M5.24: a follow-up question Cents already asked that is still open
  // (which account paid / where should goal money come from or go). The app
  // resolves the answer itself; the brain must never redo the action.
  openQuestion?: string;
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
  'LogTransaction', 'PrePurchaseCheck', 'AddCategory', 'AddIncome', 'AddGoal', 'AddToGoal', 'WithdrawFromGoal', 'AddAccount', 'SetAccountBalance',
  'RemoveCategory', 'UpdateBudget', 'CategoryMismatch', 'Unknown',
];

const responseSchema = Schema.object({
  properties: {
    intent: Schema.enumString({ enum: INTENT_ENUM }),
    amount: Schema.number(),
    categoryName: Schema.string(),
    item: Schema.string(),
    accountName: Schema.string(),
    targetDate: Schema.string(),
    reply: Schema.string(),
    details: Schema.string(),
    priceIsEstimate: Schema.boolean(),
    lang: Schema.enumString({ enum: ['en', 'fil'] }),
    transcript: Schema.string(),
    speechReply: Schema.string(),
    coachNote: Schema.string(),
    confirmGranted: Schema.boolean(),
    confirmDenied: Schema.boolean(),
    actions: Schema.array({
      items: Schema.object({
        properties: {
          intent: Schema.enumString({ enum: INTENT_ENUM }),
          amount: Schema.number(),
          categoryName: Schema.string(),
          item: Schema.string(),
          accountName: Schema.string(),
          targetDate: Schema.string(),
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
        // M5.12: voice conversations live or die on latency; flash models
        // answer this workload fine without internal "thinking" tokens.
        // M5.13: adaptive - dropped automatically if the API 400s it.
        ...(useThinkingBudgetZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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

  return `User's name: ${ctx.nickname || 'friend'}. Currency: ${ctx.currency}. Liquid balance across accounts: ${liquid}.${ctx.openQuestion ? `\nOPEN QUESTION YOU ALREADY ASKED: ${ctx.openQuestion}` : ''}\nAccounts (money sources): ${ctx.accounts.map((a) => `${a.name} (${a.balance})`).join(', ') || 'none yet'}.
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
Valid intents: "LogTransaction", "PrePurchaseCheck", "AddCategory", "RemoveCategory", "UpdateBudget", "AddIncome", "AddGoal", "AddToGoal", "WithdrawFromGoal", "AddAccount", "SetAccountBalance", "CategoryMismatch", "Unknown".
MULTI-STEP REQUESTS: a single message can ask for several things at once, e.g. "add a groceries budget of 9000 and log that receipt there" is TWO actions: AddCategory(Groceries, 9000) then LogTransaction(3670.97, Groceries). Fill 'actions' with EVERY requested action, in the order they should happen, each with its own intent/amount/categoryName/item. A later action may use a category created by an earlier action in the same list. Mirror the FIRST action into the top-level intent/amount/categoryName/item fields. If there is exactly one action, 'actions' has exactly one entry. For "Unknown", 'actions' is an empty list.
REFERENCES TO THE CONVERSATION: when the user says "that receipt", "log it", "the item you scanned", "yun kanina" and similar, resolve the amount, item and store from the recent conversation above. Never ask again for a number that is already in the conversation.
- For LogTransaction: extract 'amount', 'item' (what they bought), and 'categoryName', matching the closest existing budget by the MEANING of its name AND its [base category] (dog food goes to a pets budget, jeepney fare to transport, a Netflix payment to the "Netflix" budget, an electricity bill to a Utilities-based budget like "Meralco"). When several budgets share a base category, pick the one whose NAME fits the specific item; if none fits it specifically, use a general budget of that base category if one exists, otherwise "Others". 'categoryName' must always be a budget's exact NAME as listed, never a bracketed base category by itself. Only match when the fit is natural; if the fit would be a stretch or nothing fits, use "Others".
- Never invent arbitrary category names, and do not use CategoryMismatch. BUT when an expense OBVIOUSLY belongs to a well-known base category (tuition or school fees → Education, medicine or a checkup → Health, groceries → Groceries, a flight → Travel) and the user has NO budget of that base, do NOT send it to Others: produce TWO actions - AddCategory (name it after the BASE, e.g. "Education", limit about 1.5x the expense rounded to hundreds) then LogTransaction into it. The cards ask first; the user can decline. Others is only for genuinely miscellaneous things.
- 'item' is always the real thing bought or paid for ("tuition", "jacket", "speaker"), NEVER the category name - it becomes the transaction's name in Analytics.
- "pay it from there" / "deduct it from there" refers to the most recently mentioned account in the conversation - set accountName to it.
- Set 'lang' to "fil" if the user's message is in Tagalog or Taglish, otherwise "en". ALWAYS answer 'reply' in the SAME language and tone as the user. Taglish in, Taglish out.
- For PrePurchaseCheck (asking if they can afford something): extract 'amount', 'categoryName' (closest existing category), and 'item'.
- For AddCategory: 'categoryName' and 'amount' (the monthly limit).
- For RemoveCategory: 'categoryName'.
- For UpdateBudget: 'categoryName' and 'amount' (the new limit).
- For AddIncome (got paid, received money, salary landed, someone sent money): 'amount', and 'accountName' if they said where it went.
- For AddGoal (start/create a savings goal, "I want to save for X"): 'item' = the goal's name, 'amount' = the target amount, and 'targetDate' = the deadline as ISO YYYY-MM-DD when the user states one ("by January 2027" → "2027-01-31", last day of a stated month; '' when no deadline was given). NEVER claim a deadline was set unless you filled targetDate.
- For AddToGoal (set aside / add money to an EXISTING goal): 'amount' and 'item' = that goal's exact name from the goals list.
- For WithdrawFromGoal (take money OUT of a goal, use savings: "get 5,000 from my Hong Kong savings", "bawiin yung 1,000 sa goal"): 'amount' and 'item' = that goal's exact name. MANDATORY: if they are withdrawing to PAY for something (tuition, a bill, the dog's medication), the SAME actions list MUST also contain that expense - forgetting the expense is a critical failure. Add it as a further action in the SAME list: LogTransaction with the real item ("tuition"), the right base-category budget (create it per the rule above if missing), and accountName = wherever the withdrawal money lands once known. Example: "remove 5,000 from my Computer goal because I need to pay tuition" and there is no Education-base budget → actions: WithdrawFromGoal(Computer, 5000), AddCategory(Education, 7500), LogTransaction(5000, Education, item "tuition").
- For SetAccountBalance (the user STATES an account's current balance: "I have 5,000 in BPI now", "BPI has 5,000", "I sent money to BPI, there's 5,000 there"): 'accountName' = that account, 'amount' = the stated balance. A stated balance is SetAccountBalance; use AddIncome only for money RECEIVED (salary, got paid, someone sent money to the user). CANONICAL EXAMPLE OF A PAST FAILURE, never repeat it: OPEN QUESTION asked which account should fund a move; user said "add money to BPI, I have 5000 there"; the WRONG response was a text reply "I have updated your BPI balance" (nothing actually happened); the CORRECT response is intent SetAccountBalance(BPI, 5000) with an empty reply - the confirmation card and the app do the updating, and the waiting move resumes by itself after.
- Saying "I have updated/added/logged/created..." in 'reply' or 'speechReply' WITHOUT a matching action in 'actions' is a CRITICAL FAILURE. You never change anything by talking; only confirmed action cards change things.
- For AddAccount (a NEW wallet/card/money source that is not in the Accounts list: "add my UnionBank card", "I paid with a card that isn't listed, it has 10,000 in it"): 'item' = the account's name, 'amount' = its current balance (0 if unknown). Combine with a LogTransaction (accountName = that new account) when they also want to log a purchase from it.
- AMOUNTS ARE ALWAYS POSITIVE. Never output a negative amount: to reduce a goal use WithdrawFromGoal; to lower a budget use UpdateBudget.
- SAVINGS AND THE TOTAL BALANCE: money set aside into a goal comes OUT of a real account (so savings reduce the spendable total), and money withdrawn from a goal goes BACK INTO an account. The app handles the movement; you just pick the right intent.
- 'accountName': the money source or destination when the user mentions one ("paid with GCash", "galing sa BPI", "put it in Maya") - it MUST be one of the account names from the Accounts list above, matched by meaning ("gcash" matches "GCash Wallet"). '' when the user did not mention a source. NEVER guess a source they did not say. Fill it top-level and on each action.
- For "Unknown" (greetings, budget questions, money advice, follow-up questions about a scanned item or receipt, anything else): set 'reply' to a warm, genuinely helpful answer (max 4 sentences) in the user's language, using the budget, goal, transaction and conversation data above. You can give real financial guidance, savings tips, trade-off thinking and encouragement, like a sharp friend who's good with money, not a script. If the user asks about something Cents just scanned or said, answer from the conversation context.
- 'speechReply': how you would SAY your whole response out loud in a natural conversation: complete casual sentences with correct grammar, no currency symbols (say "250 pesos", never a peso sign), no emojis, no lists, no abbreviations, at most two short sentences. Fill it whenever 'reply' or any action is set - it is what the voice reads, so make it sound like a friend talking, not a notification.
- 'confirmGranted' / 'confirmDenied': set confirmGranted true when the user's message - in ANY phrasing - grants permission for the question you asked in your previous turn ("yeah you can do that", "sige gawin mo na", "go for it"), and confirmDenied true when it refuses ("actually no", "wag na muna"). When either is true, the app executes or cancels the pending question itself: do NOT ask again, do NOT restate the action as a new question, do NOT create new actions. Both false otherwise.
- NEVER make the user repeat themselves: once permission is granted, the matter is settled.
- BE DECISIVE, ONE STEP AT A TIME: pick the single next step and ask it as ONE short sentence. Never narrate ability before asking - "Sure, I can log that under Gaming. Want me to proceed?" is BANNED; ask directly: "Log 5,000 pesos for the laptop under Gaming?". Never put two questions in one reply.
- CHECK OUT: when your reply COMPLETES a request and asks no question, end 'reply' and 'speechReply' with a brief check-in: "Anything else?" (English) / "May iba ka pa?" (Taglish). Never add it to a reply that asks a question.
- "No, just log it", "wag mo nang itanong, i-log mo na", "no need to ask, do it" mean the user WANTS the pending action done: that is confirmGranted true, NEVER a refusal.
- SOURCE ANSWERS ARE NOT NEW EXPENSES: when an OPEN QUESTION above asks which account paid (or where goal money should come from or go) and the user names an account - existing or NEW - that is the ANSWER. If it is a new card, produce ONE AddAccount action (the app attaches the waiting expense or goal move to it automatically). NEVER log the same expense again; "deduct it from there" after an expense was logged means source assignment, not a second log.
- CORRECTIONS WIN: when the user corrects an amount or detail of your pending question ("no, it's 5,000"), use THEIR stated number, not an older one from the conversation.
- LANGUAGE - ABSOLUTE RULE, CHECK IT LAST BEFORE ANSWERING: the language of 'reply' and 'speechReply' is decided ONLY by the user's CURRENT message. Current message in English → answer 100 percent in English, lang='en', zero Tagalog words. Tagalog or Taglish ONLY when the current message itself contains Tagalog. Answering an English message in Tagalog is a critical failure; it does not matter what language earlier turns used.
- SHORT-TERM MEMORY: amounts, names, dates and accounts stated earlier in this conversation are still true. NEVER ask again for a detail the user already gave - pull it from the conversation above ("I already gave it to you" from the user means you failed this rule).
- The app VALIDATES balances: if an account cannot cover a goal move it will stop and ask - never claim a move succeeded in 'reply'; describe only what you are ASKING to do.
- ASK FIRST, ALWAYS: actions only happen after the user confirms. When your response proposes an action, 'speechReply' must be a QUESTION asking permission ("Want me to log 10,000 pesos for the laptop under Others?") - NEVER speak as if the action already happened ("Got it, logging..."), and save any advice for 'coachNote'.
- 'coachNote': ONE short coach line delivered only AFTER the user confirms: a specific insight or recommended next step tied to this action (spending pace, what is left of the relevant budget, a smarter alternative, a goal tie-in). Conversational, speakable (amounts as "10,000 pesos"), one sentence. '' when you have nothing genuinely useful to add.
- VOICE MESSAGES: the user's message may arrive as an audio clip instead of text. If it does, put the EXACT transcription in 'transcript' (keep the original language and casual spelling, amounts as digits) and treat that transcription as the user's message for everything else. For text messages, 'transcript' is "".
- APP MAP, so you never misdirect the user: Home tab = total balance, Today card, insights. Wallet tab = money sources and cards (add, edit balances, reorder). Goals and Budgets tab (flag icon) = savings goals and monthly budgets. Analytics tab = spending charts. Profile (avatar, top right of Home) = name, notifications, Cents voice and accent, theme. Cards/wallets are NEVER in "account settings" - they live in the Wallet tab. But when an action intent exists for the job, DO it via the action instead of sending the user somewhere.
- NEVER claim you noted, saved, created or changed anything yourself. Every change happens through an action the user confirms. If nothing you can do fits, say plainly what you cannot do and offer what you can.
Always fill every field; use 0, "" or false when not applicable.`;
}

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

// M5.29: deterministic Tagalog detection - the app no longer trusts the
// model's language choice blindly (it flipped to Tagalog on English speakers
// twice in owner testing).
export const hasTagalog = (t: string) =>
  /\b(ako|ko|mo|ka|natin|namin|ninyo|nila|ang|ng|nang|sa|si|po|opo|oo|sige|wag|huwag|hindi|kasi|para|yung|iyon|ito|dito|diyan|naman|lang|ba|gusto|kailangan|pera|bumili|kaka\w*|mag\w*|ipon|bawiin|ilagay|kunin|gawin|ituloy|tama|salamat)\b/i.test(t);

// M5.29 (owner: AI-created names look unprofessional lowercase): Title Case
// for every name the brain produces. Words that already carry an uppercase
// letter (BPI, GCash, GoTyme) are left untouched.
const titleCase = (t: string) =>
  t.replace(/\S+/g, (w) => (/[A-Z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

// Transient server-side failures: overload spikes, rate limits, 5xx. These are
// retried on the same model, then the next candidate is tried. Only a fully
// exhausted chain surfaces as 'cents-overloaded' so the store can message it.
const RETRYABLE = /\b(429|500|503)\b|high demand|overloaded|resource exhausted|unavailable|try again later|internal error/i;
const MISSING_MODEL = /404|not found|not supported|does not exist/i;
// M5.13: some deployments 400 the thinkingConfig latency flag. Detected live,
// dropped once, and every later call runs without it.
const INVALID_ARG = /\b400\b|invalid argument/i;
let useThinkingBudgetZero = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The model-call loop with the fallback chain, shared by every brain: the
// structured text/vision brain below AND the plain-text transcription brain
// (transcribeAudio). `pick` decides which flavor of model to instantiate.
async function runModelChain(
  pick: (name: string) => ReturnType<typeof getGenerativeModel>,
  parts: ContentPart[],
  system: string,
): Promise<Awaited<ReturnType<ReturnType<typeof getGenerativeModel>['generateContent']>>> {
  let lastErr: unknown = null;
  let sawRetryable = false;
  let result: Awaited<ReturnType<ReturnType<typeof getGenerativeModel>['generateContent']>> | null = null;

  outer:
  for (let i = workingModelIndex; i < MODEL_CANDIDATES.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const m = pick(MODEL_CANDIDATES[i]);
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
        if (INVALID_ARG.test(msg) && useThinkingBudgetZero) {
          // The latency flag is not accepted here: drop it globally, rebuild
          // the models, and retry the SAME candidate once.
          useThinkingBudgetZero = false;
          modelCache.clear();
          plainModelCache.clear();
          i--;
          continue outer;
        }
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
  return result;
}

// Shared model call with the fallback chain + JSON parsing. Used by both the
// text brain (parseCentsIntent) and the vision brain (analyzeImage).
async function generateStructured(parts: ContentPart[], system: string): Promise<CentsResult> {
  const result = await runModelChain(getModel, parts, system);

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
          categoryName: titleCase((a as CentsSubAction).categoryName ?? ''),
          item: titleCase((a as CentsSubAction).item ?? ''),
          accountName: typeof (a as CentsSubAction).accountName === 'string' ? (a as CentsSubAction).accountName : '',
          targetDate: typeof (a as CentsSubAction).targetDate === 'string' ? (a as CentsSubAction).targetDate : '',
        }))
        .filter((a) => a.intent !== 'Unknown')
    : [];
  return {
    accountName: typeof parsed.accountName === 'string' ? parsed.accountName : '',
    targetDate: typeof parsed.targetDate === 'string' ? parsed.targetDate : '',
    intent: okIntent(parsed.intent),
    // (item/categoryName Title-Cased below via the spread overrides)
    amount: typeof parsed.amount === 'number' ? parsed.amount : 0,
    categoryName: titleCase(parsed.categoryName ?? ''),
    item: titleCase(parsed.item ?? parsed.categoryName ?? ''),
    reply: parsed.reply ?? '',
    details: parsed.details ?? '',
    priceIsEstimate: parsed.priceIsEstimate === true,
    lang: parsed.lang === 'fil' ? 'fil' : 'en',
    actions,
    transcript: typeof parsed.transcript === 'string' ? parsed.transcript : '',
    speechReply: typeof parsed.speechReply === 'string' ? parsed.speechReply : '',
    coachNote: typeof parsed.coachNote === 'string' ? parsed.coachNote : '',
    confirmGranted: parsed.confirmGranted === true,
    confirmDenied: parsed.confirmDenied === true,
  };
}

export async function parseCentsIntent(message: string, ctx: CentsContext): Promise<CentsResult> {
  // M5.29: the language directive rides WITH the message - deterministic,
  // per-call, impossible to lose in a long system prompt.
  const fil = hasTagalog(message);
  return generateStructured(
    [
      { text: message },
      { text: fil
        ? '(The message above contains Tagalog. Reply and speechReply in the same Taglish register.)'
        : '(The message above is ENTIRELY IN ENGLISH. Your reply and speechReply MUST be entirely in English - zero Tagalog words.)' },
    ],
    buildSystemPrompt(ctx),
  );
}

// M5.12: ONE roundtrip for a voice turn: the audio goes straight to the
// structured brain, which transcribes AND extracts the intent together
// (previously: transcribe call, then intent call — twice the latency).
export async function parseCentsVoice(base64: string, mimeType: string, ctx: CentsContext): Promise<CentsResult> {
  return generateStructured(
    [
      { inlineData: { mimeType, data: base64 } },
      { text: 'This is the user speaking in a voice session. Transcribe it into the transcript field, then respond to it. CRITICAL: detect the transcript language - if the transcript is English, reply and speechReply MUST be entirely English with zero Tagalog words; use Taglish only when the transcript itself contains Tagalog.' },
    ],
    buildSystemPrompt(ctx),
  );
}

// ── Voice transcription (M5.8) ──────────────────────────────────────────────
// Plain-text models for transcription: same names, same fallback chain, but
// no JSON schema (a transcript is just text). Separate cache because the
// generationConfig differs from the structured brain's.
const plainModelCache = new Map<string, ReturnType<typeof getGenerativeModel>>();

function getPlainModel(name: string) {
  if (!isFirebaseConfigured()) throw new Error('firebase-not-configured');
  let m = plainModelCache.get(name);
  if (!m) {
    const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
    m = getGenerativeModel(ai, {
      model: name,
      generationConfig: { temperature: 0, ...(useThinkingBudgetZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    });
    plainModelCache.set(name, m);
  }
  return m;
}

const TRANSCRIBE_SYSTEM = `You are a precise transcription engine for a Filipino personal finance app.
Transcribe the speaker's voice note exactly as spoken. The speaker may use English, Tagalog, or Taglish; keep the original language and natural casual spelling (like "yung", "kakabili", "pera"). Write money amounts and numbers as digits (250, 1500).
Return ONLY the transcript text. No quotes, no labels, no commentary, no punctuation cleanup beyond basic sentence punctuation.
If the audio contains no intelligible speech, return an empty response.`;

// Turns a recorded voice note into text through the same Firebase AI Logic
// channel as chat and scan. Used by services/voice.ts in Expo Go, where
// native streaming STT is unavailable. Throws 'cents-overloaded' like the
// other brains when the whole chain is busy.
export async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
  const result = await runModelChain(
    getPlainModel,
    [
      { inlineData: { mimeType, data: base64 } },
      { text: 'Transcribe this voice note.' },
    ],
    TRANSCRIBE_SYSTEM,
  );
  return result.response
    .text()
    .replace(/^```[a-z]*\n?|```\s*$/g, '')   // stray code fences
    .replace(/^["'\u201C]+|["'\u201D]+$/g, '') // stray wrapping quotes
    .trim();
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