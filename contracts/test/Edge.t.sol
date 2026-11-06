// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {InvoiceNote} from "../src/InvoiceNote.sol";

/// @notice S1 edge-case tests: fuzzed amounts, replays, financed-invoice withdraw, cross-merchant signature replay.
contract EdgeTest is Base {
    bytes32 internal constant INV_B = keccak256("invoice-B");
    address internal merchant2;
    uint256 internal merchant2Key;

    function setUp() public override {
        super.setUp();
        (merchant2, merchant2Key) = makeAddrAndKey("merchant2");
    }

    function _createFor(address m, bytes32 id, uint256 amount) internal {
        vm.prank(operator);
        router.createInvoiceFor(id, m, amount, uint64(block.timestamp + 30 days));
    }

    function _refundDigestSig(uint256 key, bytes32 id, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            key,
            router.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(router.REFUND_TYPEHASH(), id, amount, nonce, deadline))
        );
    }

    function _withdrawDigestSig(uint256 key, bytes32 id, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            key, router.DOMAIN_SEPARATOR(), keccak256(abi.encode(router.WITHDRAW_TYPEHASH(), id, nonce, deadline))
        );
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_gaslessPay_anyAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000_000e6));
        usdt.mint(payer, amount);
        uint256 before = usdt.balanceOf(payer);
        _create(INV, amount);
        _payGasless(INV, amount);
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(uint8(inv.status), uint8(PaymentRouter.Status.Paid));
        assertEq(inv.balance, amount);
        assertEq(usdt.balanceOf(payer), before - amount);
        assertEq(usdt.balanceOf(address(router)), amount);
    }

    function testFuzz_wrongValue_reverts(uint96 amount, uint96 other) public {
        amount = uint96(bound(amount, 1, 1_000_000e6));
        vm.assume(other != amount);
        _create(INV, amount);
        bytes32 nonce = router.paymentNonce(INV);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), other, 0, block.timestamp + 600, nonce);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.WrongValue.selector, uint256(amount), uint256(other)));
        router.payWithAuthorization(INV, payer, other, 0, block.timestamp + 600, nonce, v, r, s);
    }

    function testFuzz_multiRefund_conservesFunds(uint96 amount, uint96 a, uint96 b) public {
        amount = uint96(bound(amount, 2, 1_000_000e6));
        usdt.mint(payer, amount);
        _create(INV, amount);
        _payGasless(INV, amount);
        a = uint96(bound(a, 1, amount - 1));
        vm.startPrank(merchant);
        router.refund(INV, a);
        uint256 left = amount - a;
        b = uint96(bound(b, 1, left));
        router.refund(INV, b);
        vm.stopPrank();
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(inv.balance, amount - a - b);
        assertEq(inv.refunded, uint256(a) + b);
        assertEq(usdt.balanceOf(address(router)), inv.balance);
    }

    function testFuzz_refundOverBalance_reverts(uint96 amount, uint96 extra) public {
        amount = uint96(bound(amount, 1, 1_000_000e6));
        extra = uint96(bound(extra, 1, 1_000_000e6));
        usdt.mint(payer, amount);
        _create(INV, amount);
        _payGasless(INV, amount);
        uint256 req = uint256(amount) + extra;
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, uint256(amount), req));
        router.refund(INV, req);
    }

    // ------------------------------------------------------------ replay / over-refund

    function test_revert_replayedEip3009Nonce_onSecondInvoice() public {
        // Pay invoice 1, then reuse the exact signed authorization against a second same-amount invoice.
        _create(INV, AMOUNT);
        _create(INV_B, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        vm.startPrank(operator);
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
        // Same sig on INV_B: router-level nonce binding rejects it.
        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.WrongNonce.selector, router.paymentNonce(INV_B), nonce)
        );
        router.payWithAuthorization(INV_B, payer, AMOUNT, 0, vb, nonce, v, r, s);
        vm.stopPrank();
        assertEq(usdt.balanceOf(address(router)), AMOUNT);
        assertTrue(usdt.authorizationState(payer, nonce));
    }

    function test_revert_replayedNonce_afterRefund_cannotRepay() public {
        // After full refund the invoice is Refunded (not Open): the same auth cannot re-collect funds.
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        vm.startPrank(operator);
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
        vm.stopPrank();
        vm.prank(merchant);
        router.refund(INV, AMOUNT);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.InvoiceNotOpen.selector, INV));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
        assertEq(usdt.balanceOf(payer), 1_000e6);
    }

    function test_revert_refund_overBalance_afterPartial() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.startPrank(merchant);
        router.refund(INV, 40e6);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 9e6, 9e6 + 1));
        router.refund(INV, 9e6 + 1);
        vm.stopPrank();
    }

    function test_revert_refund_afterWithdraw_overBalance() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.startPrank(merchant);
        router.withdraw(INV);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 0, 1));
        router.refund(INV, 1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ financed invoice: money goes to escrow

    function _financeAndPay() internal returns (uint256 noteId) {
        _create(INV, 100e6);
        vm.prank(merchant);
        noteId = note.issue(INV, 100e6, 97e6, uint64(block.timestamp + 3600));
        vm.startPrank(investor);
        usdt.approve(address(note), 97e6);
        note.fund(noteId);
        vm.stopPrank();
        _payGasless(INV, 100e6);
    }

    function test_revert_withdraw_afterFinancedInvoicePaid() public {
        _financeAndPay();
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(inv.balance, 0);
        assertTrue(inv.financed);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(usdt.balanceOf(address(note)), 100e6);
        uint256 before = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NothingToWithdraw.selector, INV));
        router.withdraw(INV);
        assertEq(usdt.balanceOf(merchant), before);
    }

    function test_revert_withdrawWithSig_afterFinancedInvoicePaid() public {
        _financeAndPay();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _withdrawDigestSig(merchantKey, INV, router.nonces(merchant), deadline);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NothingToWithdraw.selector, INV));
        router.withdrawWithSig(INV, deadline, sig);
        assertEq(usdt.balanceOf(address(note)), 100e6);
    }

    function test_revert_refund_afterFinancedInvoicePaid() public {
        _financeAndPay();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 0, 1));
        router.refund(INV, 1);
    }

    // ------------------------------------------------------------ signature replay across merchants

    function test_revert_refundSig_replayAcrossMerchants() public {
        _create(INV, AMOUNT); // merchant
        _createFor(merchant2, INV_B, AMOUNT); // merchant2
        _payGasless(INV, AMOUNT);
        // fund INV_B with a different payer authorization
        bytes32 nonceB = router.paymentNonce(INV_B);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonceB);
        vm.prank(operator);
        router.payWithAuthorization(INV_B, payer, AMOUNT, 0, vb, nonceB, v, r, s);

        // merchant signs a refund for INV (their invoice); relayer tries it against merchant2's INV_B.
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundDigestSig(merchantKey, INV, 10e6, router.nonces(merchant), deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV_B, 10e6, deadline, sig);
        // Also with the invoiceId swapped inside the digest: signed by merchant for INV_B -> still invalid
        // because INV_B's recorded merchant is merchant2.
        bytes memory sig2 = _refundDigestSig(merchantKey, INV_B, 10e6, router.nonces(merchant2), deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV_B, 10e6, deadline, sig2);
        assertEq(router.getInvoice(INV_B).balance, AMOUNT);
        assertEq(router.nonces(merchant2), 0);
    }

    function test_revert_withdrawSig_replayAcrossMerchants() public {
        _create(INV, AMOUNT);
        _createFor(merchant2, INV_B, AMOUNT);
        _payGasless(INV, AMOUNT);
        bytes32 nonceB = router.paymentNonce(INV_B);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonceB);
        vm.prank(operator);
        router.payWithAuthorization(INV_B, payer, AMOUNT, 0, vb, nonceB, v, r, s);

        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _withdrawDigestSig(merchantKey, INV_B, router.nonces(merchant2), deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.withdrawWithSig(INV_B, deadline, sig);
        assertEq(router.getInvoice(INV_B).balance, AMOUNT);
        assertEq(usdt.balanceOf(merchant2), 0);
    }

    function test_revert_refundSig_sameMerchant_otherInvoice() public {
        _create(INV, AMOUNT);
        _create(INV_B, AMOUNT);
        _payGasless(INV, AMOUNT);
        bytes32 nonceB = router.paymentNonce(INV_B);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonceB);
        vm.prank(operator);
        router.payWithAuthorization(INV_B, payer, AMOUNT, 0, vb, nonceB, v, r, s);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundDigestSig(merchantKey, INV, 10e6, router.nonces(merchant), deadline);
        router.refundWithSig(INV, 10e6, deadline, sig);
        // reusing the same signature on the other invoice fails (invoiceId bound + nonce consumed)
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV_B, 10e6, deadline, sig);
        // and replaying on the original fails as well
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV, 10e6, deadline, sig);
    }
}
