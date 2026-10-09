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

export const LOAN_SCHEMES: LoanScheme[] = [
  {
    id: "PLAN_BULLET_01",
    name: "Bullet Repayment",
    interestRatePercent: "12.0",
    maxLtv: "0.70",
    tenureMonths: 12,
    repaymentType: "BULLET",
  },
  {
    id: "PLAN_EMI_01",
    name: "Monthly EMI",
    interestRatePercent: "10.5",
    maxLtv: "0.75",
    tenureMonths: 12,
    repaymentType: "EMI",
  },
];

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

    if (!result.isFinite()) {
      throw new Error("Non-finite number");
    }

    return result;
  } catch {
    throw new QuoteValidationError(`Invalid ${field}`, field);
  }
}

export function calculateQuote(input: QuoteInput): LoanQuote {
  const net = decimalInput(input.netWeightGrams, "netWeightGrams");
  const gross = decimalInput(input.grossWeightGrams, "grossWeightGrams");

  if (net.lte(0)) {
    throw new QuoteValidationError(
      "Net weight must be greater than zero",
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
    throw new QuoteValidationError(
      "Karat must be 18, 22, or 24",
      "karat",
    );
  }

  const scheme = LOAN_SCHEMES.find((item) => item.id === input.schemeId);

  if (!scheme) {
    throw new QuoteValidationError(
      "Loan scheme not found",
      "schemeId",
      404,
    );
  }

  const pureGoldGrams = net.mul(input.karat).div(24);
  const goldValue = pureGoldGrams.mul(MOCK_GOLD_RATE_PER_GRAM);

  const schemeLtv = new Decimal(scheme.maxLtv);
  const effectiveLtv = Decimal.min(schemeLtv, MAX_LTV);

  // Eligible loan is rounded down to a whole rupee.
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
    interestRatePercent: scheme.interestRatePercent,
    tenureMonths: scheme.tenureMonths,
    repaymentType: scheme.repaymentType,
  };
}


