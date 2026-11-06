// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {InvoiceNote} from "../src/InvoiceNote.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract InvoiceNoteTest is Base {
    uint256 internal constant FACE = 100e6;
    uint256 internal constant PRICE = 97e6;
    uint64 internal maturity;

    function setUp() public override {
        super.setUp();
        maturity = uint64(block.timestamp + 120);
        _create(INV, FACE);
    }

    function _issue() internal returns (uint256 id) {
        vm.prank(merchant);
        id = note.issue(INV, FACE, PRICE, maturity);
    }

    function _fund(uint256 id, address who) internal {
        vm.startPrank(who);
        usdt.approve(address(note), PRICE);
        note.fund(id);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ allowlist

    function test_setAllowed_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        note.setAllowed(stranger, true);
        vm.prank(owner);
        note.setAllowed(stranger, true);
        assertTrue(note.allowed(stranger));
    }

    // ------------------------------------------------------------ issue

    function test_issue() public {
        uint256 id = _issue();
        assertEq(id, 1);
        InvoiceNote.Note memory n = note.getNote(id);
        assertEq(n.invoiceId, INV);
        assertEq(n.issuer, merchant);
        assertEq(n.faceValue, FACE);
        assertEq(n.price, PRICE);
        assertEq(n.maturity, maturity);
        assertEq(uint8(n.state), uint8(InvoiceNote.NoteState.Issued));
        assertEq(note.noteOfInvoice(INV), 1);
    }

    function test_revert_issue_notMerchant() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotIssuer.selector, stranger));
        note.issue(INV, FACE, PRICE, maturity);
    }

    function test_revert_issue_twice() public {
        _issue();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.InvoiceAlreadyNoted.selector, INV, 1));
        note.issue(INV, FACE, PRICE, maturity);
    }

    function test_revert_issue_badTerms() public {
        vm.startPrank(merchant);
        vm.expectRevert(InvoiceNote.InvalidTerms.selector);
        note.issue(INV, FACE, FACE + 1, maturity); // price > face
        vm.expectRevert(InvoiceNote.InvalidTerms.selector);
        note.issue(INV, FACE + 1, PRICE, maturity); // face > invoice amount
        vm.expectRevert(InvoiceNote.InvalidTerms.selector);
        note.issue(INV, FACE, 0, maturity); // zero price
        vm.expectRevert(InvoiceNote.InvalidTerms.selector);
        note.issue(INV, FACE, PRICE, uint64(block.timestamp)); // maturity not in future
        vm.stopPrank();
    }

    function test_revert_issue_paidInvoice() public {
        _payGasless(INV, FACE);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.InvoiceNotOpen.selector, INV));
        note.issue(INV, FACE, PRICE, maturity);
    }

    function _issueSig(uint256 key, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        return _sig(
            key,
            note.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(note.ISSUE_TYPEHASH(), INV, FACE, PRICE, maturity, nonce, deadline))
        );
    }

    function test_issueWithSig() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _issueSig(merchantKey, 0, deadline);
        vm.prank(operator);
        uint256 id = note.issueWithSig(INV, FACE, PRICE, maturity, deadline, sig);
        assertEq(note.getNote(id).issuer, merchant);
        assertEq(note.nonces(merchant), 1);
    }

    function test_revert_issueWithSig_badMerchantSignature() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _issueSig(payerKey, 0, deadline);
        vm.expectRevert(InvoiceNote.InvalidSignature.selector);
        note.issueWithSig(INV, FACE, PRICE, maturity, deadline, sig);
    }

    function test_revert_issueWithSig_expired() public {
        uint256 deadline = block.timestamp + 10;
        bytes memory sig = _issueSig(merchantKey, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.SignatureExpired.selector, deadline));
        note.issueWithSig(INV, FACE, PRICE, maturity, deadline, sig);
    }

    // ------------------------------------------------------------ fund

    function test_fund_paysIssuerAndFinancesInvoice() public {
        uint256 id = _issue();
        _fund(id, investor);
        assertEq(usdt.balanceOf(merchant), PRICE); // cash today
        InvoiceNote.Note memory n = note.getNote(id);
        assertEq(n.holder, investor);
        assertEq(uint8(n.state), uint8(InvoiceNote.NoteState.Funded));
        PaymentRouter.Invoice memory inv = router.getInvoice(INV);
        assertTrue(inv.financed);
        assertEq(inv.noteId, id);
    }

    function test_revert_fund_notAllowlisted() public {
        uint256 id = _issue();
        usdt.mint(stranger, PRICE);
        vm.startPrank(stranger);
        usdt.approve(address(note), PRICE);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotAllowlisted.selector, stranger));
        note.fund(id);
        vm.stopPrank();
    }

    function test_revert_fund_afterMaturity() public {
        uint256 id = _issue();
        vm.warp(maturity);
        vm.startPrank(investor);
        usdt.approve(address(note), PRICE);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.MaturityPassed.selector, maturity));
        note.fund(id);
        vm.stopPrank();
    }

    function test_revert_fund_invoiceAlreadyPaid() public {
        uint256 id = _issue();
        _payGasless(INV, FACE);
        vm.startPrank(investor);
        usdt.approve(address(note), PRICE);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.InvoiceNotOpen.selector, INV));
        note.fund(id);
        vm.stopPrank();
    }

    function test_revert_fund_twice() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.startPrank(investor2);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.WrongState.selector, id, InvoiceNote.NoteState.Funded));
        note.fund(id);
        vm.stopPrank();
    }

    function test_revert_fund_unknownNote() public {
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NoteNotFound.selector, 7));
        note.fund(7);
    }

    // ------------------------------------------------------------ transfer

    function test_transfer_beforeMaturity() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.prank(investor);
        note.transfer(id, investor2);
        assertEq(note.getNote(id).holder, investor2);
    }

    function test_revert_transfer_toNotAllowlisted() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotAllowlisted.selector, stranger));
        note.transfer(id, stranger);
    }

    function test_revert_transfer_fromDelistedHolder() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.prank(owner);
        note.setAllowed(investor, false);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotAllowlisted.selector, investor));
        note.transfer(id, investor2);
    }

    function test_revert_transfer_afterMaturity() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.warp(maturity);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.MaturityPassed.selector, maturity));
        note.transfer(id, investor2);
    }

    function test_revert_transfer_notHolder() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotHolder.selector, investor2));
        note.transfer(id, investor2);
    }

    function test_revert_transfer_unfunded() public {
        uint256 id = _issue();
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.WrongState.selector, id, InvoiceNote.NoteState.Issued));
        note.transfer(id, investor2);
    }

    // ------------------------------------------------------------ full lifecycle + settle

    function test_lifecycle_paymentFundsEscrow_settlePaysFaceValue() public {
        uint256 id = _issue();
        _fund(id, investor);
        uint256 investorAfterFund = usdt.balanceOf(investor);

        _payGasless(INV, FACE); // customer pays the financed invoice
        assertEq(usdt.balanceOf(address(note)), FACE);
        assertEq(note.getNote(id).escrow, FACE);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(router.getInvoice(INV).balance, 0);

        // the merchant cannot divert the forwarded payment
        vm.startPrank(merchant);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.NothingToWithdraw.selector, INV));
        router.withdraw(INV);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.ExceedsBalance.selector, 0, 1));
        router.refund(INV, 1);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotMatured.selector, maturity));
        note.settle(id);

        vm.warp(maturity);
        vm.prank(stranger); // anyone can trigger settlement
        note.settle(id);
        assertEq(usdt.balanceOf(investor), investorAfterFund + FACE);
        assertEq(usdt.balanceOf(address(note)), 0);
        assertEq(uint8(note.getNote(id).state), uint8(InvoiceNote.NoteState.Settled));

        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.WrongState.selector, id, InvoiceNote.NoteState.Settled));
        note.settle(id);
    }

    function test_settle_paysCurrentHolderAfterTransfer() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.prank(investor);
        note.transfer(id, investor2);
        _payGasless(INV, FACE);
        vm.warp(maturity + 1);
        note.settle(id);
        assertEq(usdt.balanceOf(investor2), FACE);
    }

    function test_revert_settle_beforeMaturity() public {
        uint256 id = _issue();
        _fund(id, investor);
        _payGasless(INV, FACE);
        vm.warp(maturity - 1);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotMatured.selector, maturity));
        note.settle(id);
    }

    function test_revert_settle_escrowShort() public {
        uint256 id = _issue();
        _fund(id, investor);
        vm.warp(maturity);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.EscrowShort.selector, 0, FACE));
        note.settle(id);
    }

    function test_revert_settle_unfunded() public {
        uint256 id = _issue();
        vm.warp(maturity);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.WrongState.selector, id, InvoiceNote.NoteState.Issued));
        note.settle(id);
    }

    function test_repay_thenSettle_thenLatePaymentToIssuer() public {
        uint256 id = _issue();
        _fund(id, investor);
        uint256 investorAfterFund = usdt.balanceOf(investor);
        // invoice unpaid at maturity: issuer repays from the cash it received + own funds
        usdt.mint(merchant, FACE - PRICE);
        vm.startPrank(merchant);
        usdt.approve(address(note), FACE);
        note.repay(id);
        vm.stopPrank();
        vm.expectRevert(InvoiceNote.InvalidTerms.selector);
        note.repay(id); // already fully escrowed
        vm.warp(maturity);
        note.settle(id);
        assertEq(usdt.balanceOf(investor), investorAfterFund + FACE);
        assertEq(usdt.balanceOf(merchant), 0);
        // the customer pays late: the payment belongs to the issuer now
        _payGasless(INV, FACE);
        assertEq(usdt.balanceOf(merchant), FACE);
        assertEq(usdt.balanceOf(address(note)), 0);
    }

    function test_settle_returnsExcessToIssuer() public {
        bytes32 inv2 = keccak256("invoice-2");
        _create(inv2, 120e6);
        vm.prank(merchant);
        uint256 id = note.issue(inv2, FACE, PRICE, maturity);
        _fund(id, investor);
        _payGasless(inv2, 120e6);
        uint256 merchantBefore = usdt.balanceOf(merchant);
        vm.warp(maturity);
        note.settle(id);
        assertEq(usdt.balanceOf(merchant), merchantBefore + 20e6);
    }

    function test_revert_onInvoicePaid_notRouter() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoiceNote.NotRouter.selector, stranger));
        note.onInvoicePaid(INV, FACE);
    }

    function testFuzz_lifecycle(uint256 face, uint256 price) public {
        bytes32 id2 = keccak256("fuzz");
        face = bound(face, 1, 1_000e6);
        price = bound(price, 1, face);
        _create(id2, face);
        vm.prank(merchant);
        uint256 id = note.issue(id2, face, price, maturity);
        usdt.mint(investor, price);
        vm.startPrank(investor);
        usdt.approve(address(note), price);
        note.fund(id);
        vm.stopPrank();
        usdt.mint(payer, face);
        _payGasless(id2, face);
        uint256 before = usdt.balanceOf(investor);
        vm.warp(maturity);
        note.settle(id);
        assertEq(usdt.balanceOf(investor), before + face);
    }
}
