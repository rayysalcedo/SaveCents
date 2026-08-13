// v5.11: monthly report files for the "email me my July report" Cents flow.
// One month = the 1st through that month's real last day (31/30/29/28 falls
// out of Date math automatically). Produces a CSV, an editorial-themed PDF
// (matching the app: warm paper, forest green, charcoal ink), and summary
// stats for the email body.
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { Transaction, peso } from '../models/types';
import { REPORT_LOGO_B64 } from './reportLogo';

export interface ReportStats {
  income: number;
  expenses: number;
  net: number;
  count: number;
}

export interface MonthlyReport {
  label: string;      // "July 2026"
  fileBase: string;   // "SAVECENTS-REPORT-JUL-2026"
  csvBase64: string;
  pdfBase64: string;
  stats: ReportStats;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthWindow(monthIndex: number, year: number) {
  const start = new Date(year, monthIndex, 1).getTime();
  const end = new Date(year, monthIndex + 1, 1).getTime(); // exclusive
  return { start, end };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csvCell = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

export async function buildMonthlyReport(
  transactions: Transaction[],
  monthIndex: number,
  year: number,
  preparedFor: string,
): Promise<MonthlyReport | null> {
  const { start, end } = monthWindow(monthIndex, year);
  const rows = transactions
    .filter((tx) => tx.timestamp >= start && tx.timestamp < end)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length === 0) return null;

  const income = rows.reduce((a, tx) => a + (tx.isIncome ? tx.amount : 0), 0);
  const expenses = rows.reduce((a, tx) => a + (tx.isIncome ? 0 : tx.amount), 0);
  const stats: ReportStats = { income, expenses, net: income - expenses, count: rows.length };
  const label = `${MONTHS[monthIndex]} ${year}`;
  const fileBase = `SAVECENTS-REPORT-${MONTHS[monthIndex].slice(0, 3).toUpperCase()}-${year}`;

  // ── CSV ────────────────────────────────────────────────────────────────
  const csv = [
    'SaveCents Monthly Report',
    `Prepared for,${csvCell(preparedFor)}`,
    `Month,${csvCell(label)}`,
    `Generated,${csvCell(new Date().toLocaleString())}`,
    `Income,${income.toFixed(2)}`,
    `Expenses,${expenses.toFixed(2)}`,
    `Net,${(income - expenses).toFixed(2)}`,
    '',
    'Date,Description,Category,Type,Amount',
    ...rows.map((tx) => [
      new Date(tx.timestamp).toISOString().slice(0, 10),
      csvCell(tx.description),
      csvCell(tx.goalId ? 'Savings' : tx.categoryId),
      tx.isIncome ? 'Income' : 'Expense',
      tx.amount.toFixed(2),
    ].join(',')),
  ].join('\n');
  const csvBase64 = btoa(unescape(encodeURIComponent(csv)));

  // ── PDF (editorial theme) ──────────────────────────────────────────────
  const tr = rows.map((tx, i) => `
    <tr style="background:${i % 2 ? '#FFFFFF' : '#FAF9F6'};">
      <td style="padding:9px 12px;color:#6C757D;font-size:11px;white-space:nowrap;">${new Date(tx.timestamp).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</td>
      <td style="padding:9px 12px;color:#1A1D20;font-size:12px;">${esc(tx.description)}</td>
      <td style="padding:9px 12px;color:#6C757D;font-size:11px;">${esc(tx.goalId ? 'Savings' : tx.categoryId)}</td>
      <td style="padding:9px 12px;text-align:right;font-size:12px;font-weight:700;color:${tx.isIncome ? '#8A5C00' : '#1A1D20'};white-space:nowrap;">${tx.isIncome ? '+' : '-'}${peso(tx.amount)}</td>
    </tr>`).join('');
  const stat = (labelTxt: string, value: string, color = '#1A1D20') => `
    <td style="padding:14px 16px;background:#FAF9F6;border:1px solid #E9ECEF;border-radius:12px;">
      <div style="color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:600;">${labelTxt}</div>
      <div style="color:${color};font-size:19px;font-weight:800;margin-top:3px;">${value}</div>
    </td>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#FFFFFF;">
    <div style="padding:34px 34px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <img src="data:image/png;base64,${REPORT_LOGO_B64}" style="width:168px;display:block;" alt="SaveCents" />
          <div style="height:1px;background:#E9ECEF;margin:18px 0 16px;"></div>
          <div style="color:#1A1D20;font-size:26px;font-weight:800;">Monthly report</div>
          <div style="color:#6C757D;font-size:13px;margin-top:4px;">${esc(label)} &middot; Prepared for ${esc(preparedFor)}</div>
        </td>
      </tr></table>
      <table width="100%" cellpadding="0" cellspacing="10" style="margin-top:18px;"><tr>
        ${stat('INCOME', peso(income), '#8A5C00')}
        ${stat('EXPENSES', peso(expenses))}
        ${stat('NET', `${stats.net < 0 ? '-' : ''}${peso(Math.abs(stats.net))}`, stats.net < 0 ? '#DC2626' : '#8A5C00')}
      </tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #E9ECEF;border-radius:14px;overflow:hidden;">
        <tr style="background:#F4F3EF;">
          <td style="padding:10px 12px;color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:700;">DATE</td>
          <td style="padding:10px 12px;color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:700;">DESCRIPTION</td>
          <td style="padding:10px 12px;color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:700;">CATEGORY</td>
          <td style="padding:10px 12px;color:#6C757D;font-size:10px;letter-spacing:1px;font-weight:700;text-align:right;">AMOUNT</td>
        </tr>
        ${tr}
      </table>
      <div style="color:#ADB5BD;font-size:10px;margin-top:16px;">Generated by Cents &middot; ${esc(new Date().toLocaleString())}</div>
    </div>
  </body></html>`;

  const { uri } = await Print.printToFileAsync({ html });
  const pdfBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

  return { label, fileBase, csvBase64, pdfBase64, stats };
}

// "send me my july report" / "export last month's expenses" → month + year.
export function matchReportRequest(text: string): { monthIndex: number; year: number } | null {
  const lower = text.toLowerCase();
  if (!/\b(report|export|summary|statement)\b/.test(lower)) return null;
  const now = new Date();
  if (/\bthis month\b/.test(lower)) return { monthIndex: now.getMonth(), year: now.getFullYear() };
  if (/\blast month\b/.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { monthIndex: d.getMonth(), year: d.getFullYear() };
  }
  const mi = MONTHS.findIndex((m) => lower.includes(m.toLowerCase()) || lower.includes(m.slice(0, 3).toLowerCase() + ' '));
  const mi2 = mi >= 0 ? mi : MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3).toLowerCase()}\\b`).test(lower));
  const monthIndex = mi >= 0 ? mi : mi2;
  if (monthIndex < 0) return null;
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  let year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();
  // A named month later than now with no explicit year means LAST year's.
  if (!yearMatch && (monthIndex > now.getMonth())) year -= 1;
  return { monthIndex, year };
}
