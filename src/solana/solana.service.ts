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
    packIndex: number,
  ): Promise<{ buyer: PublicKey; isClaimed: boolean } | null> {
    const [receiptPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('receipt'),
        campaignPda.toBuffer(),
        Buffer.from(new Uint32Array([packIndex]).buffer),
      ],
      programId,
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(receiptPda);
      if (!accountInfo) return null;

      const data = accountInfo.data;
      const buyer = new PublicKey(data.slice(8, 40));
      const isClaimed = data[72] === 1;

      return { buyer, isClaimed };
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
