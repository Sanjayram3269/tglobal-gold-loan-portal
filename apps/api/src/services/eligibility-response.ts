export type EligibilityScheme = {
  id: string;
  name: string;
  interestRatePercent: { toString(): string } | string | number;
  maxLtv: { toString(): string } | string | number;
  tenureMonths: number;
  repaymentType: string;
};

export function isEligibilityCriteriaQuestion(message: string): boolean {
  return /\b(eligib(?:le|ility)|qualif(?:y|ies|ication|ications)|criteria|requirements?|who can apply|minimum age|minimum income|income requirement|credit history|credit score|documents?.{0,30}required|documentation.{0,30}required)\b/i.test(
    message,
  );
}

export function buildEligibilityCriteriaReply(
  schemes: EligibilityScheme[],
): string {
  const configuredTerms = schemes.map((scheme) => {
    const rate = String(scheme.interestRatePercent);
    const ltv = Number(scheme.maxLtv) * 100;
    const repayment =
      scheme.repaymentType === "EMI"
        ? "Monthly EMI"
        : scheme.repaymentType === "BULLET"
          ? "Bullet Repayment"
          : scheme.repaymentType;

    return `- ${scheme.name}: ${rate}% p.a., up to ${ltv}% loan-to-value (LTV), ${scheme.tenureMonths} months.`;
  });

  const schemeText = configuredTerms.length
    ? configuredTerms.join("\n")
    : "No active loan schemes are currently configured.";

  return [
    "The portal does not define the lender's full eligibility criteria, so I can't confirm requirements such as minimum age or income, credit history, or required documents.",
    "",
    "The scheme terms currently configured in this demo are:",
    schemeText,
    "",
    "For application input validation, the portal accepts 18K, 22K, or 24K gold; net weight must not exceed gross weight, and each weight must be greater than 0 and at most 1,000 g. These are form-validation rules, not a guarantee of lender eligibility.",
    "",
    "Please confirm age, income, documentation, and final eligibility requirements directly with the lender. Any quote from this demo is indicative and does not mean your loan is approved.",
  ].join("\n");
}
