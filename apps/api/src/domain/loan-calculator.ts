import { Decimal } from "decimal.js";

export const MOCK_GOLD_RATE_PER_GRAM = new Decimal(7000);
export const MAX_LTV = new Decimal("0.75");

export type Karat = 18 | 22 | 24;

export interface LoanScheme {
  id: string;
  name: string;
  interestRatePercent: string;
  maxLtv: string;
  tenureMonths: number;
  repaymentType: "BULLET" | "EMI";
}

export interface QuoteInput {
  netWeightGrams: number | string;
  grossWeightGrams: number | string;
  karat: Karat;
  schemeId: string;
}

export interface LoanQuote {
  schemeId: string;
  schemeName: string;
  netWeightGrams: string;
  grossWeightGrams: string;
  karat: Karat;
  pureGoldGrams: string;
  goldRatePerGramRupees: number;
  goldValueRupees: number;
  ltvPercent: number;
  eligibleLoanRupees: number;
  interestRatePercent: string;
  tenureMonths: number;
  repaymentType: "BULLET" | "EMI";
}

export class QuoteValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "QuoteValidationError";
  }
}

function decimalInput(value: number | string, field: string): Decimal {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error("Non-finite number");
    return result;
  } catch {
    throw new QuoteValidationError(`Invalid ${field}`, field);
  }
}

export function calculateQuote(
  input: QuoteInput,
  scheme: LoanScheme,
): LoanQuote {
  const net = decimalInput(input.netWeightGrams, "netWeightGrams");
  const gross = decimalInput(input.grossWeightGrams, "grossWeightGrams");

  if (net.lte(0) || net.gt(1000)) {
    throw new QuoteValidationError(
      "Net weight must be greater than zero and at most 1000 grams",
      "netWeightGrams",
    );
  }

  if (gross.lte(0) || gross.gt(1000)) {
    throw new QuoteValidationError(
      "Gross weight must be greater than zero and at most 1000 grams",
      "grossWeightGrams",
    );
  }

  if (net.gt(gross)) {
    throw new QuoteValidationError(
      "Net weight cannot exceed gross weight",
      "netWeightGrams",
    );
  }

  if (![18, 22, 24].includes(input.karat)) {
    throw new QuoteValidationError("Karat must be 18, 22, or 24", "karat");
  }

  if (
    !Number.isFinite(scheme.tenureMonths) ||
    scheme.tenureMonths <= 0 ||
    !["BULLET", "EMI"].includes(scheme.repaymentType)
  ) {
    throw new Error("Invalid loan scheme configuration");
  }

  const schemeLtv = decimalInput(scheme.maxLtv, "maxLtv");
  const interestRate = decimalInput(
    scheme.interestRatePercent,
    "interestRatePercent",
  );

  if (schemeLtv.lte(0) || schemeLtv.gt(1) || interestRate.lt(0)) {
    throw new Error("Invalid loan scheme configuration");
  }

  const pureGoldGrams = net.mul(input.karat).div(24);
  const goldValue = pureGoldGrams.mul(MOCK_GOLD_RATE_PER_GRAM);
  const effectiveLtv = Decimal.min(schemeLtv, MAX_LTV);
  const eligibleLoan = goldValue.mul(effectiveLtv).floor();

  return {
    schemeId: scheme.id,
    schemeName: scheme.name,
    netWeightGrams: net.toString(),
    grossWeightGrams: gross.toString(),
    karat: input.karat,
    pureGoldGrams: pureGoldGrams.toDecimalPlaces(6).toString(),
    goldRatePerGramRupees: MOCK_GOLD_RATE_PER_GRAM.toNumber(),
    goldValueRupees: goldValue.toNumber(),
    ltvPercent: effectiveLtv.mul(100).toNumber(),
    eligibleLoanRupees: eligibleLoan.toNumber(),
    interestRatePercent: interestRate.toString(),
    tenureMonths: scheme.tenureMonths,
    repaymentType: scheme.repaymentType,
  };
}
