import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is missing");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const schemes = [
    {
      id: "PLAN_BULLET_01",
      name: "Bullet Repayment",
      interestRatePercent: "12.00",
      maxLtv: "0.700",
      tenureMonths: 12,
      repaymentType: "BULLET",
    },
    {
      id: "PLAN_EMI_01",
      name: "Monthly EMI",
      interestRatePercent: "10.50",
      maxLtv: "0.750",
      tenureMonths: 12,
      repaymentType: "EMI",
    },
  ];

  for (const scheme of schemes) {
    await prisma.loanScheme.upsert({
      where: { id: scheme.id },
      update: scheme,
      create: scheme,
    });
  }

  console.log(`Seeded ${schemes.length} loan schemes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
