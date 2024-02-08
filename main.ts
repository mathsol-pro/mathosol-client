import { MathsolClient } from "./sdk/sdk";
import * as bs58 from "bs58";
import { privateKey } from "./key.json";
import { Keypair } from "@solana/web3.js";
import { FailrLaunch } from "./fair-launch";

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

async function main() {
    await runDevnet();
}

async function runDevnet() {
    const client = MathsolClient.fromEndpoint("https://api.devnet.solana.com");
    const user = Keypair.fromSecretKey(bs58.decode(privateKey));
    const fairLaunch = new FailrLaunch(client, "https://abi.mathsol.pro");
    await fairLaunch.run(user);
}

async function runMainnet() {
    const client = MathsolClient.fromEndpoint("https://api.mainnet-beta.solana.com");
    const user = Keypair.fromSecretKey(bs58.decode(privateKey));
    const fairLaunch = new FailrLaunch(client, "https://api.mathsol.pro");
    console.log("user", user.publicKey.toBase58());
    await fairLaunch.run(user);
}
