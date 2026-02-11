-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "nonce" BIGINT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_campaignId_buyer_nonce_key" ON "Purchase"("campaignId", "buyer", "nonce");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
