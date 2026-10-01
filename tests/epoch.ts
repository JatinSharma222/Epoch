import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Epoch } from "../target/types/epoch";
import { expect } from "chai";

describe("epoch", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Epoch as Program<Epoch>;

  it("Initializes a ~10 KB zero-copy batch account", async () => {
    const batchKeypair = anchor.web3.Keypair.generate();
    const batchId = new anchor.BN(42);

    const tx = await program.methods
      .initializeBatch(batchId)
      .accounts({
        batch: batchKeypair.publicKey,
        payer: program.provider.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([batchKeypair])
      .rpc();

    console.log("InitializeBatch transaction signature:", tx);

    const batchAccount = await program.account.batch.fetch(batchKeypair.publicKey);
    expect(batchAccount.batchId.toNumber()).to.equal(42);
    expect(batchAccount.status).to.equal(1);
    expect(batchAccount.numOrders).to.equal(0);
  });
});
