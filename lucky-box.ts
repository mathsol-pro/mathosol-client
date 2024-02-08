import { MathsolClient } from "./sdk/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

export class LuckyBox {
    constructor(private readonly client: MathsolClient) {}

    async run(user: Keypair, referrer: PublicKey) {
        let userInfo = await this.client.queryLuckyBoxUserAccount(user.publicKey);
        if (!userInfo) {
            const tx = await this.client.luckyBoxMintNft(user, referrer);
            console.log("tx", tx);
            userInfo = await this.client.queryLuckyBoxUserAccount(user.publicKey);
        }
        console.log("userInfo", userInfo);
    }
}
