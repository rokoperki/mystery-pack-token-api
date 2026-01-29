/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `Campaign` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "expiresAt",
ADD COLUMN     "confirmedAt" TIMESTAMP(3);
