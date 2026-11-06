// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {InvoiceNote} from "../src/InvoiceNote.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @notice Shared fixture: mock EIP-3009 USDT, router, note, actors with known keys.
abstract contract Base is Test {
    bytes32 internal constant RWA_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    MockEIP3009 internal usdt;
    PaymentRouter internal router;
    InvoiceNote internal note;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal merchant;
    uint256 internal merchantKey;
    address internal payer;
    uint256 internal payerKey;
    address internal investor = makeAddr("investor");
    address internal investor2 = makeAddr("investor2");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant INV = keccak256("invoice-1");
    uint256 internal constant AMOUNT = 49e6;

    function setUp() public virtual {
        (merchant, merchantKey) = makeAddrAndKey("merchant");
        (payer, payerKey) = makeAddrAndKey("payer");
        vm.warp(1_800_000_000);
        usdt = new MockEIP3009();
        router = new PaymentRouter(address(usdt), owner, operator);
        note = new InvoiceNote(address(usdt), address(router), owner);
        vm.startPrank(owner);
        router.setNoteContract(address(note));
        note.setAllowed(investor, true);
        note.setAllowed(investor2, true);
        vm.stopPrank();
        usdt.mint(payer, 1_000e6);
        usdt.mint(investor, 1_000e6);
    }

    function _create(bytes32 id, uint256 amount) internal {
        vm.prank(merchant);
        router.createInvoice(id, amount, uint64(block.timestamp + 30 days));
    }

    function _signAuth(uint256 key, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address from = vm.addr(key);
        bytes32 structHash = keccak256(abi.encode(RWA_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    function _payGasless(bytes32 id, uint256 amount) internal {
        bytes32 nonce = router.paymentNonce(id);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), amount, 0, vb, nonce);
        vm.prank(operator);
        router.payWithAuthorization(id, payer, amount, 0, vb, nonce, v, r, s);
    }

    function _sig(uint256 key, bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
