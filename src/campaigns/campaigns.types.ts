// src/campaigns/dto/prepare-campaign.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tierSchema = z.object({
  name: z.string().min(1).max(32),
  chance: z.number().min(0).max(1),
  min: z.number().int().min(0),
  max: z.number().int().min(0),
});

const prepareCampaignSchema = z
  .object({
    authority: z.string().min(32),
    tokenMint: z.string().min(32),
    totalPacks: z.number().int().min(1).max(10000),
    packPrice: z.number().int().min(1),
    tiers: z.array(tierSchema).min(1).max(10),
    seed: z.string(), // REQUIRED - frontend must provide
  })
  .refine(
    (data) => {
      const totalChance = data.tiers.reduce((sum, t) => sum + t.chance, 0);
      return Math.abs(totalChance - 1) < 0.001;
    },
    { message: 'Tier chances must sum to 1' },
  )
  .refine((data) => data.tiers.every((t) => t.min <= t.max), {
    message: 'Tier min must be <= max',
  });

export class PrepareCampaignDto extends createZodDto(prepareCampaignSchema) {}

export type Tier = z.infer<typeof tierSchema>;

const confirmCampaignSchema = z.object({
  signature: z.string().min(64).max(128),
});

export class ConfirmCampaignDto extends createZodDto(confirmCampaignSchema) {}

const closeCampaignSchema = z.object({
  signature: z.string().min(64).max(128),
});

export class CloseCampaignDto extends createZodDto(closeCampaignSchema) {}
