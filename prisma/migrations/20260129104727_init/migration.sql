-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PENDING', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "authority" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "packPrice" BIGINT NOT NULL,
    "totalPacks" INTEGER NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PENDING',
    "publicKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pack" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "tokenAmount" BIGINT NOT NULL,
    "salt" TEXT NOT NULL,
    "tier" TEXT NOT NULL,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_seed_key" ON "Campaign"("seed");

-- CreateIndex
CREATE UNIQUE INDEX "Pack_campaignId_index_key" ON "Pack"("campaignId", "index");

-- AddForeignKey
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
