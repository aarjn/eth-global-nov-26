// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

interface IUSDTDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice Hour-4 checkpoint: one real gasless USDT payment on Whitechain testnet.
///   1. (only if the payer has too little USDT) the deployer sends `AMOUNT` USDT to the demo payer;
///   2. the relayer (operator) creates an invoice for the demo merchant (`createInvoiceFor`);
///   3. the demo payer SIGNS EIP-3009 ReceiveWithAuthorization off chain (no tx, no gas);
///   4. the relayer submits `payWithAuthorization` and pays the WBT gas.
/// Run (from contracts/): set -a && . ../.env.local && set +a &&
///   forge script script/FirstPayment.s.sol --rpc-url whitechain_testnet --broadcast
/// Env: RELAYER_PRIVATE_KEY, DEMO_PAYER_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY (top-up only),
///      optional AMOUNT (USDT base units, default 1000000 = 1 USDT).
contract FirstPayment is Script {
    address constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    address constant DEMO_MERCHANT = 0xC038827b4E362B0de1Be859377508613CD028946;
    bytes32 constant RWA_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function run() external {
        require(block.chainid == 1874, "FirstPayment: not Whitechain testnet");
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/1874.json"));
        PaymentRouter router = PaymentRouter(vm.parseJsonAddress(json, ".paymentRouter"));
        uint256 amount = vm.envOr("AMOUNT", uint256(1e6));
        uint256 relayerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        uint256 payerKey = vm.envUint("DEMO_PAYER_PRIVATE_KEY");
        address payer = vm.addr(payerKey);

        uint256 payerBal = IERC20(USDT).balanceOf(payer);
        if (payerBal < amount) {
            uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
            address deployer = vm.addr(deployerKey);
            require(IERC20(USDT).balanceOf(deployer) >= amount - payerBal, "FirstPayment: payer and deployer lack USDT");
            vm.broadcast(deployerKey);
            IERC20(USDT).transfer(payer, amount - payerBal);
        }

        bytes32 invoiceId = keccak256(abi.encode("paisalink-first-payment", block.timestamp));
        vm.broadcast(relayerKey);
        router.createInvoiceFor(invoiceId, DEMO_MERCHANT, amount, uint64(block.timestamp + 7 days));

        // Payer signs typed data only (vm.sign does not broadcast anything from the payer).
        bytes32 nonce = router.paymentNonce(invoiceId);
        uint256 validBefore = block.timestamp + 30 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), amount, validBefore, nonce);

        vm.broadcast(relayerKey);
        router.payWithAuthorization(invoiceId, payer, amount, 0, validBefore, nonce, v, r, s);

        console2.log("router", address(router));
        console2.log("payer", payer);
        console2.logBytes32(invoiceId);
    }

    function _signAuth(uint256 payerKey, address router, uint256 amount, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash =
            keccak256(abi.encode(RWA_TYPEHASH, vm.addr(payerKey), router, amount, 0, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IUSDTDomain(USDT).DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerKey, digest);
    }
}
