// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PaymentRouterTest is Base {
    event InvoiceCreated(bytes32 indexed invoiceId, address indexed merchant, uint256 amount, uint64 dueAt);
    event InvoicePaid(bytes32 indexed invoiceId, address indexed payer, uint256 amount, bool gasless);
    event InvoiceRefunded(bytes32 indexed invoiceId, address indexed to, uint256 amount);
    event Withdrawn(bytes32 indexed invoiceId, address indexed merchant, uint256 amount);

    // ------------------------------------------------------------ create

    function test_createInvoice() public {
        uint64 due = uint64(block.timestamp + 1 days);
        vm.expectEmit(address(router));
        emit InvoiceCreated(INV, merchant, AMOUNT, due);
        vm.prank(merchant);
        router.createInvoice(INV, AMOUNT, due);
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(inv.merchant, merchant);
        assertEq(inv.amount, AMOUNT);
        assertEq(inv.dueAt, due);
        assertEq(uint8(inv.status), uint8(PaymentRouter.Status.Open));
    }

    function test_createInvoiceFor_byOperator() public {
        vm.prank(operator);
        router.createInvoiceFor(INV, merchant, AMOUNT, 0);
        assertEq(router.getInvoice(INV).merchant, merchant);
    }

    function test_revert_createInvoiceFor_notOperator() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NotOperator.selector, stranger));
        router.createInvoiceFor(INV, merchant, AMOUNT, 0);
    }

    function test_revert_create_duplicate() public {
        _create(INV, AMOUNT);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.InvoiceExists.selector, INV));
        router.createInvoice(INV, AMOUNT, 0);
    }

    function test_revert_create_zeroAmount() public {
        vm.prank(merchant);
        vm.expectRevert(PaymentRouter.InvalidAmount.selector);
        router.createInvoice(INV, 0, 0);
    }

    function test_revert_createFor_zeroMerchant() public {
        vm.prank(operator);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.createInvoiceFor(INV, address(0), AMOUNT, 0);
    }

    function test_admin_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        router.setOperator(stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        router.setNoteContract(stranger);
        vm.prank(owner);
        router.setOperator(stranger);
        assertEq(router.operator(), stranger);
    }

    // ------------------------------------------------------------ pay (self-paid)

    function test_pay_selfPaid() public {
        _create(INV, AMOUNT);
        vm.prank(payer);
        usdt.approve(address(router), AMOUNT);
        vm.expectEmit(address(router));
        emit InvoicePaid(INV, payer, AMOUNT, false);
        vm.prank(payer);
        router.pay(INV);
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(uint8(inv.status), uint8(PaymentRouter.Status.Paid));
        assertEq(inv.payer, payer);
        assertEq(inv.balance, AMOUNT);
        assertEq(usdt.balanceOf(address(router)), AMOUNT);
    }

    function test_revert_pay_unknownInvoice() public {
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.InvoiceNotFound.selector, INV));
        router.pay(INV);
    }

    // ------------------------------------------------------------ pay (gasless EIP-3009)

    function test_payWithAuthorization() public {
        _create(INV, AMOUNT);
        uint256 payerBefore = usdt.balanceOf(payer);
        bytes32 nonce = router.paymentNonce(INV);
        assertEq(nonce, keccak256(abi.encode(address(router), INV)));
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        vm.expectEmit(address(router));
        emit InvoicePaid(INV, payer, AMOUNT, true);
        vm.prank(operator); // relayer submits; payer sends no tx
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
        assertEq(usdt.balanceOf(payer), payerBefore - AMOUNT);
        assertEq(router.getInvoice(INV).balance, AMOUNT);
        assertEq(router.getInvoice(INV).payer, payer);
        assertTrue(usdt.authorizationState(payer, nonce));
    }

    function test_revert_payWithAuthorization_wrongValue() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT - 1, 0, vb, nonce);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.WrongValue.selector, AMOUNT, AMOUNT - 1));
        router.payWithAuthorization(INV, payer, AMOUNT - 1, 0, vb, nonce, v, r, s);
    }

    function test_revert_payWithAuthorization_wrongNonce() public {
        _create(INV, AMOUNT);
        bytes32 bad = keccak256("random");
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, bad);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.WrongNonce.selector, router.paymentNonce(INV), bad));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, bad, v, r, s);
    }

    /// A payer's signature for invoice A cannot be redirected to invoice B of the same amount.
    function test_revert_payWithAuthorization_redirectToOtherInvoice() public {
        bytes32 other = keccak256("attacker-invoice");
        _create(INV, AMOUNT);
        vm.prank(stranger);
        router.createInvoice(other, AMOUNT, 0);
        bytes32 nonceA = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonceA);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.WrongNonce.selector, router.paymentNonce(other), nonceA));
        router.payWithAuthorization(other, payer, AMOUNT, 0, vb, nonceA, v, r, s);
    }

    function test_revert_payWithAuthorization_replay() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.InvoiceNotOpen.selector, INV));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
    }

    /// Replayed EIP-3009 nonce is rejected by the token itself (same payer, same nonce already used).
    function test_revert_payWithAuthorization_usedNonceAtToken() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        // the payer burns the nonce first in a direct receive to themselves (simulates a used/cancelled auth)
        (uint8 v0, bytes32 r0, bytes32 s0) = _signAuth(payerKey, payer, 1, 0, vb, nonce);
        vm.prank(payer);
        usdt.receiveWithAuthorization(payer, payer, 1, 0, vb, nonce, v0, r0, s0);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        vm.expectRevert(bytes("FiatTokenV2: authorization is used or canceled"));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
    }

    function test_revert_payWithAuthorization_expired() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, 0, vb, nonce);
        vm.warp(vb);
        vm.expectRevert(bytes("FiatTokenV2: authorization is expired"));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
    }

    function test_revert_payWithAuthorization_notYetValid() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 va = block.timestamp + 60;
        uint256 vb = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payerKey, address(router), AMOUNT, va, vb, nonce);
        vm.expectRevert(bytes("FiatTokenV2: authorization is not yet valid"));
        router.payWithAuthorization(INV, payer, AMOUNT, va, vb, nonce, v, r, s);
    }

    function test_revert_payWithAuthorization_badPayerSignature() public {
        _create(INV, AMOUNT);
        bytes32 nonce = router.paymentNonce(INV);
        uint256 vb = block.timestamp + 600;
        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(otherKey, address(router), AMOUNT, 0, vb, nonce);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        router.payWithAuthorization(INV, payer, AMOUNT, 0, vb, nonce, v, r, s);
    }

    // ------------------------------------------------------------ refund

    function test_refund_partialThenFull() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 before = usdt.balanceOf(payer);
        vm.expectEmit(address(router));
        emit InvoiceRefunded(INV, payer, 9e6);
        vm.prank(merchant);
        router.refund(INV, 9e6);
        assertEq(usdt.balanceOf(payer), before + 9e6);
        assertEq(uint8(router.getInvoice(INV).status), uint8(PaymentRouter.Status.Paid));
        vm.prank(merchant);
        router.refund(INV, AMOUNT - 9e6);
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertEq(uint8(inv.status), uint8(PaymentRouter.Status.Refunded));
        assertEq(inv.balance, 0);
        assertEq(inv.refunded, AMOUNT);
        assertEq(usdt.balanceOf(payer), before + AMOUNT);
    }

    function test_revert_refund_overBalance() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, AMOUNT, AMOUNT + 1));
        router.refund(INV, AMOUNT + 1);
    }

    function test_revert_refund_unpaid() public {
        _create(INV, AMOUNT);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 0, 1));
        router.refund(INV, 1);
    }

    function test_revert_refund_notMerchant() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NotMerchant.selector, stranger));
        router.refund(INV, 1);
    }

    function test_revert_refund_zero() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.prank(merchant);
        vm.expectRevert(PaymentRouter.InvalidAmount.selector);
        router.refund(INV, 0);
    }

    function _refundSig(uint256 key, bytes32 id, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            key, router.DOMAIN_SEPARATOR(), keccak256(abi.encode(router.REFUND_TYPEHASH(), id, amount, nonce, deadline))
        );
    }

    function test_refundWithSig() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundSig(merchantKey, INV, AMOUNT, router.nonces(merchant), deadline);
        uint256 before = usdt.balanceOf(payer);
        vm.prank(operator);
        router.refundWithSig(INV, AMOUNT, deadline, sig);
        assertEq(usdt.balanceOf(payer), before + AMOUNT);
        assertEq(router.nonces(merchant), 1);
        assertEq(uint8(router.getInvoice(INV).status), uint8(PaymentRouter.Status.Refunded));
    }

    function test_revert_refundWithSig_badMerchantSignature() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        (, uint256 otherKey) = makeAddrAndKey("other");
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundSig(otherKey, INV, AMOUNT, 0, deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV, AMOUNT, deadline, sig);
    }

    function test_revert_refundWithSig_tamperedAmount() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundSig(merchantKey, INV, 1e6, 0, deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV, AMOUNT, deadline, sig);
    }

    function test_revert_refundWithSig_replayedNonce() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundSig(merchantKey, INV, 1e6, 0, deadline);
        router.refundWithSig(INV, 1e6, deadline, sig);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.refundWithSig(INV, 1e6, deadline, sig);
    }

    function test_revert_refundWithSig_expired() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _refundSig(merchantKey, INV, 1e6, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.SignatureExpired.selector, deadline));
        router.refundWithSig(INV, 1e6, deadline, sig);
    }

    // ------------------------------------------------------------ withdraw

    function test_withdraw_thenRefundImpossible() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.prank(merchant);
        router.refund(INV, 4e6);
        vm.expectEmit(address(router));
        emit Withdrawn(INV, merchant, AMOUNT - 4e6);
        vm.prank(merchant);
        router.withdraw(INV);
        assertEq(usdt.balanceOf(merchant), AMOUNT - 4e6);
        assertEq(uint8(router.getInvoice(INV).status), uint8(PaymentRouter.Status.Withdrawn));
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 0, 1));
        router.refund(INV, 1);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NothingToWithdraw.selector, INV));
        router.withdraw(INV);
    }

    function test_revert_withdraw_notMerchant() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NotMerchant.selector, stranger));
        router.withdraw(INV);
    }

    function _withdrawSig(uint256 key, bytes32 id, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        return _sig(key, router.DOMAIN_SEPARATOR(), keccak256(abi.encode(router.WITHDRAW_TYPEHASH(), id, nonce, deadline)));
    }

    function test_withdrawWithSig() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _withdrawSig(merchantKey, INV, 0, deadline);
        vm.prank(operator);
        router.withdrawWithSig(INV, deadline, sig);
        assertEq(usdt.balanceOf(merchant), AMOUNT);
        assertEq(usdt.balanceOf(operator), 0);
    }

    function test_revert_withdrawWithSig_badMerchantSignature() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _withdrawSig(payerKey, INV, 0, deadline);
        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.withdrawWithSig(INV, deadline, sig);
    }

    function test_revert_withdrawWithSig_expired() public {
        _create(INV, AMOUNT);
        _payGasless(INV, AMOUNT);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _withdrawSig(merchantKey, INV, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.SignatureExpired.selector, deadline));
        router.withdrawWithSig(INV, deadline, sig);
    }

    // ------------------------------------------------------------ financing hook

    function test_revert_markFinanced_notNoteContract() public {
        _create(INV, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NotNoteContract.selector, stranger));
        router.markFinanced(INV, 1);
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_payAndRefund(uint256 amount, uint256 refundAmt) public {
        amount = bound(amount, 1, 1_000e6);
        refundAmt = bound(refundAmt, 1, amount);
        _create(INV, amount);
        _payGasless(INV, amount);
        vm.prank(merchant);
        router.refund(INV, refundAmt);
        vm.prank(merchant);
        if (refundAmt == amount) {
            vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NothingToWithdraw.selector, INV));
            router.withdraw(INV);
        } else {
            router.withdraw(INV);
            assertEq(usdt.balanceOf(merchant), amount - refundAmt);
        }
        assertEq(usdt.balanceOf(address(router)), 0);
    }
}
