import * as anchor from "@coral-xyz/anchor";
import { Program, BN, EventParser, BorshCoder, AnchorProvider } from "@coral-xyz/anchor";
import { Mathsol, IDL } from "../target/types/mathsol";
import { Keypair, PublicKey, Connection, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as spl from "@solana/spl-token";
import { Metadata, PROGRAM_ID as METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { Metaplex } from "@metaplex-foundation/js";

export class MathsolClient {
    public connection: Connection;
    public commitmentConfirmedConnection: Connection;
    public program: Program<Mathsol>;
    public metaplex: Metaplex;
    public eventParser: EventParser;
    public endpoint: string;

    public static programId: string = "4Mhnc3XvRMEbKYns84dhtEgPjA9ZATcwgDGb2dNdARmF";

    public static fromEndpoint(endpoint: string) {
        const program = new Program(
            IDL,
            new PublicKey(MathsolClient.programId),
            new AnchorProvider(new Connection(endpoint), null, AnchorProvider.defaultOptions())
        );
        return new MathsolClient(program);
    }

    constructor(program: Program<Mathsol>) {
        this.connection = program["_provider"].connection;
        // this.connection.commitment;
        this.program = program;
        this.metaplex = Metaplex.make(this.connection);
        this.eventParser = new EventParser(this.program.programId, new BorshCoder(this.program.idl));
        this.endpoint = this.connection["_rpcEndpoint"];
        this.commitmentConfirmedConnection = new Connection(this.endpoint, { commitment: "confirmed" });
    }

    findCollectionPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("Collection")], this.program.programId)[0];
    }

    findTokenPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("Token")], this.program.programId)[0];
    }

    findLuckyBoxAccountPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("LuckyBox")], this.program.programId)[0];
    }

    findLuckyBoxUserAccountPDA(user: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("LuckyBoxUser"), user.toBuffer()], this.program.programId)[0];
    }

    findFairLaunchAccountPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("FairLaunch")], this.program.programId)[0];
    }

    findFairLaunchValultAccountPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("FairLaunchVault")], this.program.programId)[0];
    }

    findFairLaunchUserAccountPDA(user: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("FairLaunchUser"), user.toBuffer()], this.program.programId)[0];
    }

    async queryLuckyBoxAccount() {
        return await this.program.account.luckyBoxAccount.fetchNullable(this.findLuckyBoxAccountPDA());
    }

    async queryLuckyBoxUserAccount(user: PublicKey) {
        return await this.program.account.luckyBoxUserAccount.fetchNullable(this.findLuckyBoxUserAccountPDA(user));
    }

    async querySignatures(utilSignature: string | null) {
        return await this.commitmentConfirmedConnection.getSignaturesForAddress(this.program.programId, { until: utilSignature });
    }

    async queryTransaction(signature: string) {
        return await this.commitmentConfirmedConnection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    }

    parseEvents(tx: anchor.web3.VersionedTransactionResponse) {
        return this.eventParser.parseLogs(tx.meta.logMessages);
    }

    async luckyBoxInitialize(admin: Keypair, signer: PublicKey, mintStartTime: BN, swapStartTime: BN, seedNftCount: BN) {
        return await this.program.methods
            .luckyBoxInitialize(signer, mintStartTime, swapStartTime, seedNftCount)
            .accounts({
                admin: admin.publicKey,
                luckyBoxAccount: this.findLuckyBoxAccountPDA(),
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
    }

    async luckyBoxUpdate(admin: Keypair, signer: PublicKey, mintStartTime: BN, swapStartTime: BN, seedNftCount: BN) {
        return await this.program.methods
            .luckyBoxUpdate(signer, mintStartTime, swapStartTime, seedNftCount)
            .accounts({
                admin: admin.publicKey,
                luckyBoxAccount: this.findLuckyBoxAccountPDA(),
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
    }

    async queryMetadata(pda: PublicKey) {
        const accInfo = await this.connection.getAccountInfo(pda);
        return accInfo && Metadata.deserialize(accInfo.data, 0)[0];
    }

    async queryCollectionMetadata() {
        const metadataPDA = await this.metaplex.nfts().pdas().metadata({ mint: this.findCollectionPDA() });
        return await this.queryMetadata(metadataPDA);
    }

    async createCollection(admin: Keypair, name: string, symbol: string, uri: string) {
        const collectionPDA = await this.findCollectionPDA();
        const collectionMetadataPDA = await this.metaplex.nfts().pdas().metadata({ mint: collectionPDA });
        const collectionMasterEditionPDA = await this.metaplex.nfts().pdas().masterEdition({ mint: collectionPDA });
        const collectionTokenAccount = await spl.getAssociatedTokenAddress(collectionPDA, admin.publicKey);
        const modifyComputeUnits = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
        const transaction = await this.program.methods
            .createCollection(name, symbol, uri)
            .accounts({
                authority: admin.publicKey,
                collectionMint: collectionPDA,
                metadataAccount: collectionMetadataPDA,
                masterEdition: collectionMasterEditionPDA,
                tokenAccount: collectionTokenAccount,
                tokenMetadataProgram: METADATA_PROGRAM_ID,
            })
            .transaction();
        const transferTransaction = new anchor.web3.Transaction().add(modifyComputeUnits, transaction);
        return await anchor.web3.sendAndConfirmTransaction(this.connection, transferTransaction, [admin], { skipPreflight: true });
    }

    async queryTokenMetadata() {
        const tokenMintPDA = this.findTokenPDA();
        const metadataPDA = await this.metaplex.nfts().pdas().metadata({ mint: tokenMintPDA });
        return await this.queryMetadata(metadataPDA);
    }

    async createToken(payer: Keypair, name: string, symbol: string, uri: string, decimals: number) {
        const tokenMintPDA = this.findTokenPDA();
        const metadataPDA = await this.metaplex.nfts().pdas().metadata({ mint: tokenMintPDA });
        const modifyComputeUnits = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
        const transaction = await this.program.methods
            .createToken(name, symbol, uri, decimals)
            .accounts({
                authority: payer.publicKey,
                metadataAccount: metadataPDA,
                tokenMint: tokenMintPDA,
                tokenMetadataProgram: METADATA_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .transaction();
        const transferTransaction = new anchor.web3.Transaction().add(modifyComputeUnits, transaction);
        return await anchor.web3.sendAndConfirmTransaction(this.connection, transferTransaction, [payer], { skipPreflight: true });
    }

    findMetadataPDA(mint: PublicKey) {
        return this.metaplex.nfts().pdas().metadata({ mint });
    }

    findMasterEditionPDA(mint: PublicKey) {
        return this.metaplex.nfts().pdas().masterEdition({ mint });
    }

    async luckyBoxMintNft(user: Keypair, referrer: PublicKey) {
        const collectionPDA = this.findCollectionPDA();
        const mint = anchor.web3.Keypair.generate();
        const metadataPDA = this.findMetadataPDA(mint.publicKey);
        const masterEditionPDA = this.findMasterEditionPDA(mint.publicKey);
        const tokenAccount = await spl.getAssociatedTokenAddress(mint.publicKey, user.publicKey);
        const collectionMetadataPDA = this.findMetadataPDA(collectionPDA);
        const collectionMasterEditionPDA = this.findMasterEditionPDA(collectionPDA);
        const modifyComputeUnits = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 40_0000 });

        const method = this.program.methods.luckyBoxMintNft(referrer).accounts({
            user: user.publicKey,
            luckyBoxAccount: this.findLuckyBoxAccountPDA(),
            userAccount: this.findLuckyBoxUserAccountPDA(user.publicKey),
            collectionMint: collectionPDA,
            collectionMetadataAccount: collectionMetadataPDA,
            collectionMasterEdition: collectionMasterEditionPDA,
            nftMint: mint.publicKey,
            metadataAccount: metadataPDA,
            masterEdition: masterEditionPDA,
            tokenAccount: tokenAccount,
            tokenMetadataProgram: METADATA_PROGRAM_ID,
        });
        // return await method.signers([user, mint]).rpc({ skipPreflight: true });
        const transferTransaction = new anchor.web3.Transaction().add(modifyComputeUnits, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, transferTransaction, [user, mint], { skipPreflight: true });
    }

    //burn nft from user and mint token to user
    async luckyBoxSwap(user: Keypair, nftMintAddress: PublicKey, signer: PublicKey, tokenAmount: BN, message: Uint8Array, signature: Uint8Array) {
        const nftTokenAccount = await spl.getAssociatedTokenAddress(nftMintAddress, user.publicKey);
        const ed25519Instruction = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: signer.toBytes(),
            message,
            signature,
        });
        const tokenPDA = this.findTokenPDA();
        const mintAddress = (await this.queryTokenMetadata()).mint;
        const tokenAccount = await spl.getAssociatedTokenAddress(mintAddress, user.publicKey);
        const method = this.program.methods.luckyBoxSwap(tokenAmount, Array.from(signature)).accounts({
            user: user.publicKey,
            luckyBoxAccount: this.findLuckyBoxAccountPDA(),
            nftMint: nftMintAddress,
            nftTokenAccount: nftTokenAccount,
            tokenMint: tokenPDA,
            tokenAccount: tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        });
        const t = new anchor.web3.Transaction().add(ed25519Instruction, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchInitialize(admin: Keypair, signer: PublicKey, startTime: BN, drawPrice: BN, solRefundAmount: BN, tokenClaimAmount: BN) {
        return await this.program.methods
            .fairLaunchInitialize(signer, startTime, drawPrice, solRefundAmount, tokenClaimAmount)
            .accounts({
                admin: admin.publicKey,
                fairLaunchAccount: this.findFairLaunchAccountPDA(),
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
    }

    async fairLaunchUpdate(admin: Keypair, signer: PublicKey, startTime: BN, drawPrice: BN, solRefundAmount: BN, tokenClaimAmount: BN) {
        return await this.program.methods
            .fairLaunchUpdate(signer, startTime, drawPrice, solRefundAmount, tokenClaimAmount)
            .accounts({
                admin: admin.publicKey,
                fairLaunchAccount: this.findFairLaunchAccountPDA(),
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
    }

    async fairLaunchGetInitializeUserTransaction(user: PublicKey) {
        return await this.program.methods
            .fairLaunchInitializeUser()
            .accounts({
                user: user,
                userAccount: this.findFairLaunchUserAccountPDA(user),
                systemProgram: SystemProgram.programId,
            })
            .transaction();
    }

    async fairLaunchGetReallocUserrTransaction(user: PublicKey, count: number) {
        return await this.program.methods
            .fairLaunchReallocUser(new BN(count))
            .accounts({
                user: user,
                userAccount: this.findFairLaunchUserAccountPDA(user),
                systemProgram: SystemProgram.programId,
            })
            .transaction();
    }

    async fairLaunchDraw(user: Keypair) {
        const userAccount = await this.queryFairLaunchUserAccount(user.publicKey);
        const transactions = [];
        if (userAccount == null) {
            transactions.push(await this.fairLaunchGetInitializeUserTransaction(user.publicKey));
        }
        if (await this.shouldFairLaunchReallocUser(user.publicKey, 1)) {
            console.log("realloc user account");
            transactions.push(await this.fairLaunchGetReallocUserrTransaction(user.publicKey, 10));
        }
        const transaction = await this.program.methods
            .fairLaunchDraw()
            .accounts({
                user: user.publicKey,
                vaultAccount: this.findFairLaunchValultAccountPDA(),
                fairLaunchAccount: this.findFairLaunchAccountPDA(),
                userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
                systemProgram: SystemProgram.programId,
            })
            .transaction();
        transactions.push(transaction);
        const t = new anchor.web3.Transaction().add(...transactions);
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchBatchDraw(user: Keypair, drawCount: number) {
        const userAccount = await this.queryFairLaunchUserAccount(user.publicKey);
        const transactions = [];
        if (userAccount == null) {
            transactions.push(await this.fairLaunchGetInitializeUserTransaction(user.publicKey));
        }
        if (await this.shouldFairLaunchReallocUser(user.publicKey, drawCount)) {
            console.log("realloc user account");
            transactions.push(await this.fairLaunchGetReallocUserrTransaction(user.publicKey, drawCount + 10));
        }
        const transaction = await this.program.methods
            .fairLaunchBatchDraw(new BN(drawCount))
            .accounts({
                user: user.publicKey,
                vaultAccount: this.findFairLaunchValultAccountPDA(),
                fairLaunchAccount: this.findFairLaunchAccountPDA(),
                userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
                systemProgram: SystemProgram.programId,
            })
            .transaction();
        transactions.push(transaction);
        const t = new anchor.web3.Transaction().add(...transactions);
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchRefund(user: Keypair, signer: PublicKey, drawId: BN, message: Uint8Array, signature: Uint8Array) {
        const ed25519Instruction = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: signer.toBytes(),
            message,
            signature,
        });
        const method = this.program.methods.fairLaunchRefund(drawId, Array.from(signature)).accounts({
            user: user.publicKey,
            vaultAccount: this.findFairLaunchValultAccountPDA(),
            fairLaunchAccount: this.findFairLaunchAccountPDA(),
            userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
            systemProgram: SystemProgram.programId,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        });
        const t = new anchor.web3.Transaction().add(ed25519Instruction, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchBatchRefund(user: Keypair, signer: PublicKey, drawIds: BN[], message: Uint8Array, signature: Uint8Array) {
        const ed25519Instruction = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: signer.toBytes(),
            message,
            signature,
        });
        const method = this.program.methods.fairLaunchBatchRefund(drawIds, Array.from(signature)).accounts({
            user: user.publicKey,
            vaultAccount: this.findFairLaunchValultAccountPDA(),
            fairLaunchAccount: this.findFairLaunchAccountPDA(),
            userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
            systemProgram: SystemProgram.programId,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        });
        const t = new anchor.web3.Transaction().add(ed25519Instruction, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchClaim(user: Keypair, signer: PublicKey, drawId: BN, message: Uint8Array, signature: Uint8Array) {
        const mintAddress = (await this.queryTokenMetadata()).mint;
        const tokenAccount = await spl.getAssociatedTokenAddress(mintAddress, user.publicKey);
        const ed25519Instruction = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: signer.toBytes(),
            message,
            signature,
        });
        const method = this.program.methods.fairLaunchClaim(drawId, Array.from(signature)).accounts({
            user: user.publicKey,
            fairLaunchAccount: this.findFairLaunchAccountPDA(),
            userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
            tokenMint: this.findTokenPDA(),
            tokenAccount: tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        });
        const t = new anchor.web3.Transaction().add(ed25519Instruction, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchBatchClaim(user: Keypair, signer: PublicKey, drawIds: BN[], message: Uint8Array, signature: Uint8Array) {
        const mintAddress = (await this.queryTokenMetadata()).mint;
        const tokenAccount = await spl.getAssociatedTokenAddress(mintAddress, user.publicKey);
        const ed25519Instruction = anchor.web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: signer.toBytes(),
            message,
            signature,
        });
        const method = this.program.methods.fairLaunchBatchClaim(drawIds, Array.from(signature)).accounts({
            user: user.publicKey,
            fairLaunchAccount: this.findFairLaunchAccountPDA(),
            userAccount: this.findFairLaunchUserAccountPDA(user.publicKey),
            tokenMint: this.findTokenPDA(),
            tokenAccount: tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        });
        const t = new anchor.web3.Transaction().add(ed25519Instruction, await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async fairLaunchEmergencyWithdraw(admin: Keypair, to: PublicKey, amount: BN) {
        return await this.program.methods
            .fairLaunchEmergencyWithdraw(amount)
            .accounts({
                admin: admin.publicKey,
                vaultAccount: this.findFairLaunchValultAccountPDA(),
                fairLaunchAccount: this.findFairLaunchAccountPDA(),
                recipientAccount: to,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
    }

    async queryFairLaunchAccount() {
        return await this.program.account.fairLaunchAccount.fetchNullable(this.findFairLaunchAccountPDA());
    }

    async shouldFairLaunchReallocUser(user: PublicKey, drawAmount: number = 1) {
        const pda = this.findFairLaunchUserAccountPDA(user);
        const info = await this.program.account.fairLaunchUserAccount.getAccountInfo(pda);
        // console.log("info", info);
        if (!info) return true;
        const userAccount = await this.queryFairLaunchUserAccount(user);
        // console.log("userAccount", userAccount);
        if (!userAccount) return true;
        // console.log((info["space"] - 12) / 8);
        return (info["space"] - 12) / 8 <= userAccount.drawIds.length + drawAmount;
    }

    async queryFairLaunchUserAccount(user: PublicKey) {
        const pda = this.findFairLaunchUserAccountPDA(user);
        return await this.program.account.fairLaunchUserAccount.fetchNullable(pda);
    }
}
