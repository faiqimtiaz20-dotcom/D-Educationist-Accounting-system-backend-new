const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.log({
    students: await prisma.student.count(),
    invoices: await prisma.invoice.count(),
    universities: await prisma.university.count(),
    glAccounts: await prisma.glAccount.count(),
    expenses: await prisma.expense.count(),
  });
}
main().finally(() => prisma.$disconnect());
