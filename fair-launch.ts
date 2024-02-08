import { MathsolClient } from "./sdk/sdk";
import * as bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import axios from "axios";

export class FailrLaunch {
    constructor(
        private readonly client: MathsolClient,
        private readonly apiDomain: string
    ) {}

    async run(user: Keypair) {
        console.log("user", user.publicKey.toBase58());
        for (let i = 0; i < 1000; i++) {
            const ts = await this.client.fairLaunchDraw(user);
            console.log("fairLaunchDraw", ts);
            await new Promise((r) => setTimeout(r, 3000));
            await this.claim(user);
            await this.refund(user);
        }
    }

    async claim(user: Keypair) {
        let res = await axios.get(`${this.apiDomain}/api/fair-launch/user-draw-logs?&user=${user.publicKey.toBase58()}`);
        const drawIds = res.data.data.filter((item) => item.isSuccess && item.claimTime == 0).map((item) => item.drawId);
        if (drawIds.length > 10) {
            const url = `${this.apiDomain}/api/fair-launch/claim-params?&user=${user.publicKey.toBase58()}&drawId=${drawIds.join(",")}`;
            let res = await axios.get(url);
            let { signer, message, signature } = res.data.data;
            const ts = await this.client.fairLaunchBatchClaim(
                user,
                new PublicKey(signer),
                drawIds.map((drawId: number) => new BN(drawId)),
                bs58.decode(message),
                bs58.decode(signature)
            );
            console.log("fairLaunchBatchClaim", ts);
        }
    }

    async refund(user: Keypair) {
        let res = await axios.get(`${this.apiDomain}/api/fair-launch/user-draw-logs?&user=${user.publicKey.toBase58()}`);
        const drawIds = res.data.data.filter((item) => !item.isSuccess && item.refundTime == 0).map((item) => item.drawId);
        if (drawIds.length > 10) {
            const url = `${this.apiDomain}/api/fair-launch/refund-params?&user=${user.publicKey.toBase58()}&drawId=${drawIds.join(",")}`;
            let res = await axios.get(url);
            let { signer, message, signature } = res.data.data;
            const ts = await this.client.fairLaunchBatchRefund(
                user,
                new PublicKey(signer),
                drawIds.map((drawId: number) => new BN(drawId)),
                bs58.decode(message),
                bs58.decode(signature)
            );
            console.log("fairLaunchBatchRefund", ts);
        }
    }
}
