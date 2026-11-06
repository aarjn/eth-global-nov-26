// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {InvoiceNote} from "../src/InvoiceNote.sol";

/// @notice Deploys PaymentRouter + InvoiceNote on Whitechain testnet (1874).
///   cd contracts && set -a && . ../.env.local && set +a
///   forge script script/Deploy.s.sol --rpc-url whitechain_testnet --broadcast
///   bun script/write-deployment.ts      # writes deployments/1874.json from the broadcast file
/// Env: DEPLOYER_PRIVATE_KEY (required). Owner = deployer, operator = relayer.
contract Deploy is Script {
    address constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    address constant RELAYER = 0x645bDbd12f7EC7cf773b0C13Dce941057057DA8F;
    address constant DEMO_INVESTOR = 0xe7CfE30ED69450427FFf6bbBe143E5da71E4AF87;
    address constant DEMO_PAYER = 0x32c84603C9848FFa470FB07C9bCe820944D04c52; // second allowlisted holder for the transfer demo

    function run() external returns (PaymentRouter router, InvoiceNote note) {
        require(block.chainid == 1874, "Deploy: not Whitechain testnet");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        console2.log("deployer", deployer);

        vm.startBroadcast(key);
        router = new PaymentRouter(USDT, deployer, RELAYER);
        note = new InvoiceNote(USDT, address(router), deployer);
        router.setNoteContract(address(note));
        note.setAllowed(DEMO_INVESTOR, true);
        note.setAllowed(DEMO_PAYER, true);
        vm.stopBroadcast();

        console2.log("PaymentRouter", address(router));
        console2.log("InvoiceNote", address(note));
    }
}
