// src/solana/solana.service.ts
import { Injectable } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';

@Injectable()
export class SolanaService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    );
  }

  async verifyTransaction(signature: string): Promise<boolean> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      return tx !== null && tx.meta?.err === null;
    } catch {
      return false;
    }
  }

  async getReceipt(
    programId: PublicKey,
    campaignPda: PublicKey,
    buyer: PublicKey,
    nonce: bigint,
  ): Promise<{
    buyer: PublicKey;
    packIndex: number;
    isClaimed: boolean;
    nonce: bigint;
  } | null> {
    const [receiptPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('receipt'),
        campaignPda.toBuffer(),
        buyer.toBuffer(),
        this.bigintToLeBytes(nonce),
      ],
      programId,
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(receiptPda, {
        commitment: 'confirmed',
      });
      if (!accountInfo) return null;

      const data = accountInfo.data;
      // Receipt layout (1-byte discriminator):
      // [0]: discriminator, [1..33]: campaign, [33..65]: buyer,
      // [65..69]: pack_index (u32 LE), [69]: is_claimed, [70..78]: nonce (u64 LE)
      const receiptBuyer = new PublicKey(data.slice(33, 65));
      const packIndex = data.readUInt32LE(65);
      const isClaimed = data[69] === 1;
      const receiptNonce = data.readBigUInt64LE(70);

      return { buyer: receiptBuyer, packIndex, isClaimed, nonce: receiptNonce };
    } catch {
      return null;
    }
  }

  getCampaignPda(programId: PublicKey, seed: bigint): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('campaign'), this.bigintToLeBytes(seed)],
      programId,
    );
    return pda;
  }

  private bigintToLeBytes(value: bigint): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value);
    return buffer;
  }
}
