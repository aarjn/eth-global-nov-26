// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {InvoiceNote} from "../src/InvoiceNote.sol";

interface IUSDT is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address, bytes32) external view returns (bool);
}

/// @notice Runs against a fork of Whitechain testnet with the REAL USDT (TetherTokenV2, EIP-3009).
///         Run: RUN_FORK=1 forge test --match-contract ForkUSDT   (skipped otherwise).
contract ForkUSDTTest is Test {
    address constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    bytes32 constant PINNED_DOMAIN = 0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25;
    bytes32 constant RWA_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    IUSDT usdt = IUSDT(USDT);
    PaymentRouter router;
    InvoiceNote note;
    address payer;
    uint256 payerKey;
    address merchant = makeAddr("fork-merchant");
    address relayer = makeAddr("fork-relayer");
    address investor = makeAddr("fork-investor");

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("whitechain_testnet");
        (payer, payerKey) = makeAddrAndKey("fork-payer");
        router = new PaymentRouter(USDT, address(this), relayer);
        note = new InvoiceNote(USDT, address(router), address(this));
        router.setNoteContract(address(note));
        note.setAllowed(investor, true);
        deal(USDT, payer, 500e6);
        deal(USDT, investor, 500e6);
    }

    function _sign(address to, uint256 value, uint256 vb, bytes32 nonce) internal view returns (uint8, bytes32, bytes32) {
        bytes32 sh = keccak256(abi.encode(RWA_TYPEHASH, payer, to, value, 0, vb, nonce));
        return vm.sign(payerKey, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)));
    }

    function test_fork_domainPinned() public view {
        assertEq(usdt.DOMAIN_SEPARATOR(), PINNED_DOMAIN);
    }

    function test_fork_payWithAuthorization_realUSDT_andReplayRejected() public {
        bytes32 id = keccak256("fork-invoice");
        vm.prank(relayer);
        router.createInvoiceFor(id, merchant, 49e6, 0);
        bytes32 nonce = router.paymentNonce(id);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(address(router), 49e6, vb, nonce);
        vm.prank(relayer);
        router.payWithAuthorization(id, payer, 49e6, 0, vb, nonce, v, r, s);
        assertEq(usdt.balanceOf(address(router)), 49e6);
        assertTrue(usdt.authorizationState(payer, nonce));

        // second invoice with the same id cannot exist; replaying on a fresh router-bound invoice fails at USDT
        bytes32 id2 = keccak256("fork-invoice-2");
        vm.prank(relayer);
        router.createInvoiceFor(id2, merchant, 49e6, 0);
        vm.expectRevert(); // WrongNonce (router) before USDT is even called
        router.payWithAuthorization(id2, payer, 49e6, 0, vb, nonce, v, r, s);

        vm.prank(merchant);
        router.refund(id, 49e6);
        assertEq(usdt.balanceOf(payer), 500e6);
    }

    function test_fork_expiredAuthorization_reverts() public {
        bytes32 id = keccak256("fork-expired");
        vm.prank(relayer);
        router.createInvoiceFor(id, merchant, 10e6, 0);
        bytes32 nonce = router.paymentNonce(id);
        uint256 vb = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sign(address(router), 10e6, vb, nonce);
        vm.warp(vb + 1);
        vm.expectRevert();
        router.payWithAuthorization(id, payer, 10e6, 0, vb, nonce, v, r, s);
    }

    function test_fork_financingLifecycle_realUSDT() public {
        bytes32 id = keccak256("fork-financed");
        vm.prank(relayer);
        router.createInvoiceFor(id, merchant, 100e6, 0);
        uint64 maturity = uint64(block.timestamp + 120);
        vm.prank(merchant);
        uint256 nid = note.issue(id, 100e6, 97e6, maturity);
        vm.startPrank(investor);
        usdt.approve(address(note), 97e6);
        note.fund(nid);
        vm.stopPrank();
        assertEq(usdt.balanceOf(merchant), 97e6);
        bytes32 nonce = router.paymentNonce(id);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(address(router), 100e6, vb, nonce);
        router.payWithAuthorization(id, payer, 100e6, 0, vb, nonce, v, r, s);
        assertEq(usdt.balanceOf(address(note)), 100e6);
        vm.warp(maturity);
        note.settle(nid);
        assertEq(usdt.balanceOf(investor), 500e6 - 97e6 + 100e6);
    }
}
